/**
 * Local Decision Engine
 *
 * Selects the best question from the prediction pool against the candidate's
 * FINAL transcript using deterministic constraints — not by trusting the
 * model's confidence number alone.
 *
 * Selection order (all must pass before a candidate is accepted):
 *
 * 1. TURN GUARD       — Pool turnId must match the current transcript length.
 *                       Any pool from a previous turn is hard-rejected.
 *
 * 2. TOPIC COVERAGE   — Skip topics already thoroughly covered (≥ 3 candidate
 *                       responses). Prevents repeating ground the interview
 *                       has already explored.
 *
 * 3. FINAL ANSWER     — Keyword overlap between the question and the
 *                       candidate's final utterance must exceed a minimum
 *                       threshold. This guards against the main stale-pool
 *                       failure mode: "I used Redis... but we removed Redis."
 *
 * 4. PHASE RELEVANCE  — Question type must suit the current phase.
 *
 * 5. TIEBREAKER       — Among candidates that pass all checks, prefer the one
 *                       with the highest model confidence.
 *
 * Result: ACCEPTED (use this question) or REJECTED (fall through to Gemini).
 */

import type { PredictionPool, CandidateQuestion } from "@/src/schemas/prediction";
import type { CoverageMap } from "@/src/lib/state-engine";

export type DecisionResult =
  | { accepted: true; question: CandidateQuestion; reason: string }
  | { accepted: false; reason: string };

// Minimum fraction of content words from the question that must appear
// in the candidate's final answer for the question to be considered relevant.
// 0.25 = at least 1 in 4 meaningful words must overlap.
const FINAL_ANSWER_OVERLAP_THRESHOLD = 0.25;

// Minimum number of overlapping words (absolute floor regardless of ratio)
const MIN_OVERLAP_WORDS = 2;

// Topics saturated at this many candidate responses are skipped
const TOPIC_SATURATION_THRESHOLD = 3;

// Stop-words to exclude from keyword overlap check
const STOP_WORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with",
  "by","from","is","was","are","were","be","been","being","have","has",
  "had","do","does","did","will","would","could","should","may","might",
  "shall","can","i","you","we","they","he","she","it","that","this",
  "these","those","not","no","so","if","as","its","my","your","our",
  "their","what","how","why","when","where","which",
]);

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

function overlapRatio(questionWords: Set<string>, answerWords: Set<string>): {
  ratio: number;
  count: number;
} {
  let count = 0;
  for (const w of questionWords) {
    if (answerWords.has(w)) count++;
  }
  const ratio = questionWords.size > 0 ? count / questionWords.size : 0;
  return { ratio, count };
}

/**
 * Run the local decision engine.
 *
 * @param pool            The pre-generated prediction pool
 * @param finalAnswer     The candidate's actual final utterance (from the final STT result)
 * @param currentTurnId   transcript.length AFTER the user's answer is appended
 *                        (i.e., the expected turnId + 1, since pool.turnId was set before
 *                        the user's entry was saved)
 * @param coverageMap     Current topic coverage from the state engine
 * @param currentPhase    Current interview phase
 */
export function runLocalDecisionEngine(
  pool: PredictionPool,
  finalAnswer: string,
  currentTurnId: number,
  coverageMap: CoverageMap,
  currentPhase: string,
): DecisionResult {
  // ─── CHECK 1: TURN GUARD ───────────────────────────────────────────────────
  // pool.turnId was set to transcript.length BEFORE the user spoke.
  // After the user's entry is saved, transcript.length = pool.turnId + 1.
  // We accept ±0 or +1 to account for timing between save and orchestrator call.
  const expectedTurnId = currentTurnId - 1;
  if (pool.turnId !== expectedTurnId && pool.turnId !== currentTurnId) {
    return {
      accepted: false,
      reason: `Stale pool — pool.turnId=${pool.turnId}, expected=${expectedTurnId} or ${currentTurnId}. Discarding.`,
    };
  }

  // ─── CHECK 2: TOPIC COVERAGE ───────────────────────────────────────────────
  // Build a set of saturated topics (covered too thoroughly to revisit)
  const saturatedTopics = new Set(
    coverageMap.topics
      .filter((t) => t.candidateTurns >= TOPIC_SATURATION_THRESHOLD)
      .map((t) => t.topic.toLowerCase()),
  );

  const answerWords = contentWords(finalAnswer);

  const scoredCandidates: Array<{
    question: CandidateQuestion;
    overlap: number;
    overlapCount: number;
  }> = [];

  for (const q of pool.questions) {
    // Skip saturated topics
    if (saturatedTopics.has(q.topic.toLowerCase())) {
      debugLog(`[LDE] Skipping saturated topic: ${q.topic}`);
      continue;
    }

    // ─── CHECK 3: FINAL ANSWER RELEVANCE ───────────────────────────────────
    const qWords = contentWords(q.text);
    const { ratio, count } = overlapRatio(qWords, answerWords);

    if (ratio < FINAL_ANSWER_OVERLAP_THRESHOLD && count < MIN_OVERLAP_WORDS) {
      debugLog(
        `[LDE] Low overlap for "${q.text.slice(0, 50)}..." — ratio=${ratio.toFixed(2)}, count=${count}`,
      );
      continue;
    }

    // ─── CHECK 4: PHASE RELEVANCE ───────────────────────────────────────────
    // Scenario questions are only appropriate in technical phase
    if (q.type === "scenario" && currentPhase !== "technical") {
      debugLog(`[LDE] Skipping scenario question outside technical phase`);
      continue;
    }

    scoredCandidates.push({ question: q, overlap: ratio, overlapCount: count });
  }

  if (scoredCandidates.length === 0) {
    return {
      accepted: false,
      reason: `No pool candidate passed deterministic checks (turn=${pool.turnId}, v=${pool.predictionVersion}, checked ${pool.questions.length} questions).`,
    };
  }

  // ─── CHECK 5: TIEBREAKER (model confidence as secondary sort only) ────────
  scoredCandidates.sort((a, b) => {
    // Primary: overlap count (more shared words = more relevant to final answer)
    if (b.overlapCount !== a.overlapCount) return b.overlapCount - a.overlapCount;
    // Secondary: model confidence
    return b.question.confidence - a.question.confidence;
  });

  const winner = scoredCandidates[0];

  return {
    accepted: true,
    question: winner.question,
    reason: `Pool hit — topic=${winner.question.topic}, overlap=${winner.overlapCount} word(s), confidence=${winner.question.confidence.toFixed(2)}, turnId=${pool.turnId}, v=${pool.predictionVersion}`,
  };
}

function debugLog(...args: unknown[]): void {
  if (process.env.NODE_ENV !== "production") {
    console.log("[LOCAL-DECISION-ENGINE]", ...args);
  }
}
