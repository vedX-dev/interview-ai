/**
 * Server-side ConversationState helpers.
 *
 * State is stored in interviews.plan (jsonb). No schema migration needed.
 * All reads are from DB — client phase/turn claims are ignored.
 */

import { eq } from "drizzle-orm";
import { db } from "@/src/db/index";
import { interviews } from "@/src/db/schema";
import {
  ConversationStateSchema,
  type ConversationState,
  type CoverageTopic,
  type AskedQuestion,
  type TurnScore,
  type LLMTurnResponse,
} from "@/src/schemas/brain";
import type { ExtractedResume } from "@/src/schemas/resume";
import { BRAIN_CONFIG } from "./brain-config";
import { generate, tryParseAndValidate } from "@/src/lib/llm/index";
import { buildTopicsPrompt } from "./prompt";
import { z } from "zod";

// ─── Load state from DB ───────────────────────────────────────────────────────

/**
 * Load and parse ConversationState from interviews.plan.
 * Returns a validated default state if plan is null or malformed.
 */
export function loadState(planJson: unknown): ConversationState {
  if (!planJson || typeof planJson !== "object") {
    return ConversationStateSchema.parse({});
  }
  const result = ConversationStateSchema.safeParse(planJson);
  if (result.success) return result.data;
  // Malformed plan → reset cleanly (log so we can catch regressions)
  console.warn("[BRAIN] ConversationState parse failed, resetting:", result.error.message);
  return ConversationStateSchema.parse({});
}

// ─── Persist state to DB ──────────────────────────────────────────────────────

export async function saveState(
  interviewId: string,
  state: ConversationState,
  extraFields?: {
    currentPhase?: string;
    status?: "ongoing" | "completed" | "failed";
  },
): Promise<void> {
  await db
    .update(interviews)
    .set({
      plan: state as any, // stored in jsonb
      ...(extraFields?.currentPhase ? { currentPhase: extraFields.currentPhase as any } : {}),
      ...(extraFields?.status ? { status: extraFields.status as any } : {}),
    })
    .where(eq(interviews.id, interviewId));
}

// ─── Topic generation (called once per interview) ─────────────────────────────

const TopicsResponseSchema = z.object({
  topics: z.array(z.object({
    id: z.string(),
    label: z.string(),
    goal: z.string(),
  })).min(4).max(8),
});

export async function generateCoverageTopics(
  jobRole: string,
  resume: ExtractedResume | null,
): Promise<CoverageTopic[]> {
  try {
    const result = await generate({
      task: "heavy",
      system: "You are a senior hiring manager designing an interview coverage plan. Respond with JSON only.",
      prompt: buildTopicsPrompt(jobRole, resume),
      jsonSchema: TopicsResponseSchema,
    });

    const parsed = tryParseAndValidate(result.text, TopicsResponseSchema);
    if (parsed.ok) {
      return (parsed.data as z.infer<typeof TopicsResponseSchema>).topics.map((t) => ({
        ...t,
        status: "todo" as const,
        followUps: 0,
      }));
    }
    console.warn("[BRAIN] Topic generation parse failed, using defaults");
  } catch (err) {
    console.warn("[BRAIN] Topic generation LLM failed, using defaults:", (err as Error).message);
  }

  // Fallback to default topic mix
  return BRAIN_CONFIG.defaultTopics.map((t) => ({
    ...t,
    status: "todo" as const,
    followUps: 0,
  }));
}

// ─── Similarity check (repeated question guard) ───────────────────────────────

/** Normalise text to lowercase tokens, strip punctuation */
function tokenise(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

/** Jaccard overlap of token sets */
export function tokenOverlap(a: string, b: string): number {
  const setA = tokenise(a);
  const setB = tokenise(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

/** Returns true if `question` is too similar to any previously asked question */
export function isTooSimilar(question: string, asked: AskedQuestion[]): boolean {
  for (const prev of asked) {
    if (tokenOverlap(question, prev.question) >= BRAIN_CONFIG.similarityThreshold) {
      return true;
    }
  }
  return false;
}

// ─── Phrase-Level Repeat Guard ───────────────────────────────────────────────

/** Returns true if `say` opener (first 3 words) or full text matches any recent spoken reply */
export function isPhraseRepeated(say: string, spokenReplies: string[]): boolean {
  const cleanSay = say.trim().toLowerCase();
  const words = cleanSay.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const opener = words.slice(0, 3).join(" ");

  const window = spokenReplies.slice(-BRAIN_CONFIG.historyRepeatWindow);
  for (const prev of window) {
    const cleanPrev = prev.trim().toLowerCase();
    const prevWords = cleanPrev.split(/\s+/).filter(Boolean);
    const prevOpener = prevWords.slice(0, 3).join(" ");

    if (opener.length >= 6 && opener === prevOpener) return true;
    if (cleanSay === cleanPrev) return true;
  }
  return false;
}

// ─── Clarification Ladder ───────────────────────────────────────────────────

export function getClarifyUtterance(state: ConversationState): {
  say: string;
  nextState: ConversationState;
} {
  const nextState = structuredClone(state);
  const count = nextState.clarifyCount || 0;
  const idx = Math.min(count, BRAIN_CONFIG.clarifyLadder.length - 1);
  const say = BRAIN_CONFIG.clarifyLadder[idx];
  nextState.clarifyCount = count + 1;
  return { say, nextState };
}

// ─── Decision enforcement (intent-first & code-level policy) ────────────────

export interface DecisionResult {
  action: LLMTurnResponse["decision"]["action"];
  say: string;
  shouldAdvanceTopic: boolean;
  shouldEndInterview: boolean;
  updatedState?: ConversationState;
}

/**
 * Apply intent-first decision policy on top of LLM response.
 * Enforces caps, clarify ladder, professionalism nudges, and repeat guards.
 */
export function enforceDecisionPolicy(
  llmResponse: LLMTurnResponse,
  state: ConversationState,
): DecisionResult {
  const { intent, evaluation, decision, say } = llmResponse;
  let currentState = structuredClone(state);

  // 1. Stop request
  if (intent === "stop" || decision.action === "end") {
    return {
      action: "end",
      say: say || "Thank you for your time today. Best of luck with your application!",
      shouldAdvanceTopic: false,
      shouldEndInterview: true,
    };
  }

  // 2. Unprofessional language (Professionalism Nudge flag)
  if (intent === "unprofessional" || decision.action === "nudge") {
    const unproCount = currentState.unprofessionalCount || 0;
    currentState.unprofessionalCount = unproCount + 1;

    if (BRAIN_CONFIG.PROFESSIONALISM_NUDGE && unproCount === 0) {
      // 1st time: polite boundary statement + continue
      return {
        action: "nudge",
        say: "Let's keep our focus professional, and I am glad to continue with our question.",
        shouldAdvanceTopic: false,
        shouldEndInterview: false,
        updatedState: currentState,
      };
    }
    // 2nd+ time: quiet redirect without commenting
    return {
      action: "smalltalk_redirect",
      say: say || "Let's bring our discussion back to your engineering experience.",
      shouldAdvanceTopic: false,
      shouldEndInterview: false,
      updatedState: currentState,
    };
  }

  // 3. Candidate asked AI to repeat or meta comments ("why are you repeating")
  if (intent === "repeat_request" || intent === "meta" || decision.action === "meta_acknowledge") {
    const activeTopic = currentState.coverage.find((t) => t.status === "active");
    const acknowledgeSay = say.length > 5
      ? say
      : "Got it — let me rephrase our technical question.";
    return {
      action: "meta_acknowledge",
      say: acknowledgeSay,
      shouldAdvanceTopic: false,
      shouldEndInterview: false,
    };
  }

  // 4. Genuine garble / acoustic corruption → Clarify ladder
  if (intent === "garbled" || evaluation.unclearOrGarbled || decision.action === "clarify") {
    const { say: clarifySay, nextState } = getClarifyUtterance(currentState);
    return {
      action: "clarify",
      say: clarifySay,
      shouldAdvanceTopic: false,
      shouldEndInterview: false,
      updatedState: nextState,
    };
  }

  // 5. Off-topic / small talk
  if (intent === "offtopic" || intent === "smalltalk" || evaluation.offTopic || decision.action === "smalltalk_redirect") {
    return {
      action: "smalltalk_redirect",
      say: say || "I'd love to stay focused on your technical experience today.",
      shouldAdvanceTopic: false,
      shouldEndInterview: false,
    };
  }

  // 6. Check follow-up caps on answers/partials
  const activeTopic = currentState.coverage.find((t) => t.status === "active");
  const followUpsOnCurrent = currentState.followUpsOnCurrent;
  const maxFollowUps =
    evaluation.confidence < 0.6
      ? BRAIN_CONFIG.maxFollowUpsLowConfidence
      : BRAIN_CONFIG.maxFollowUpsNormal;

  if (decision.action === "followup" && followUpsOnCurrent >= maxFollowUps) {
    return {
      action: "next_topic",
      say,
      shouldAdvanceTopic: true,
      shouldEndInterview: false,
    };
  }

  // 7. Score-based override for evaluated answers
  const scoreVal = evaluation.score ?? 5;
  if (decision.action === "next_topic" || decision.action === "followup" || decision.action === "wrapup") {
    if (scoreVal >= BRAIN_CONFIG.scoreForNextTopic && evaluation.confidence >= BRAIN_CONFIG.confidenceForNextTopic) {
      if (decision.action !== "wrapup") {
        return {
          action: "next_topic",
          say,
          shouldAdvanceTopic: true,
          shouldEndInterview: false,
        };
      }
    }

    if (
      scoreVal >= BRAIN_CONFIG.scoreForFollowup_min &&
      scoreVal <= BRAIN_CONFIG.scoreForFollowup_max &&
      followUpsOnCurrent < maxFollowUps &&
      activeTopic
    ) {
      return {
        action: "followup",
        say,
        shouldAdvanceTopic: false,
        shouldEndInterview: false,
      };
    }
  }

  if (decision.action === "wrapup") {
    return { action: "wrapup", say, shouldAdvanceTopic: false, shouldEndInterview: false };
  }

  return {
    action: decision.action,
    say,
    shouldAdvanceTopic: decision.action === "next_topic",
    shouldEndInterview: false,
  };
}

// ─── State mutation helpers (Pure & Idempotent) ──────────────────────────────

/**
 * Pure function: Marks the first "todo" topic as "active".
 * Idempotent: if a topic is already "active", returns it without changing state.
 * Never mutates `state`. Returns `{ nextState, activatedTopic }`.
 */
export function activateNextTopic(state: ConversationState): {
  nextState: ConversationState;
  activatedTopic: CoverageTopic | null;
} {
  const nextState = structuredClone(state);
  const existingActive = nextState.coverage.find((t) => t.status === "active");
  if (existingActive) {
    return { nextState, activatedTopic: existingActive };
  }

  const nextIdx = nextState.coverage.findIndex((t) => t.status === "todo");
  if (nextIdx === -1) {
    return { nextState, activatedTopic: null };
  }

  nextState.coverage[nextIdx].status = "active";
  return { nextState, activatedTopic: nextState.coverage[nextIdx] };
}

/**
 * Pure function: Marks current active topic as done, records score.
 * Idempotent: if no topic is active, returns nextState unchanged.
 * Never mutates `state`. Returns updated `ConversationState`.
 */
export function closeActiveTopic(
  state: ConversationState,
  score: number,
  confidence: number,
): ConversationState {
  const nextState = structuredClone(state);
  const activeIdx = nextState.coverage.findIndex((t) => t.status === "active");
  if (activeIdx === -1) return nextState;

  nextState.coverage[activeIdx].status = "done";
  nextState.coverage[activeIdx].score = score;
  nextState.coverage[activeIdx].confidence = confidence;
  nextState.followUpsOnCurrent = 0;
  nextState.clarifyCount = 0;
  return nextState;
}

/** Get a fallback utterance when ALL LLMs fail (uses multi-phrasing bank) */
export function getFallbackUtterance(state: ConversationState): string {
  const asked = new Set(state.asked.map((a) => a.topic));

  if (state.phase === "wrapup" || state.phase === "closing") {
    const wrapupFb = BRAIN_CONFIG.fallbackQuestions.find((f) => f.topic === "wrapup");
    const phrasings = wrapupFb?.phrasings || ["Do you have any questions for me?"];
    return phrasings[state.turnCount % phrasings.length];
  }

  for (const fb of BRAIN_CONFIG.fallbackQuestions) {
    if (!asked.has(fb.topic)) {
      const phrasings = fb.phrasings;
      const phrasingIdx = state.turnCount % phrasings.length;
      return phrasings[phrasingIdx];
    }
  }

  return "We have covered a lot of ground today. Do you have any questions for me before we finish?";
}
