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
import { KSCORE_CONFIG, type TargetDepth, type KScoreTrend } from "./kscore-config";
import { generate, tryParseAndValidate } from "@/src/lib/llm/index";
import { buildTopicsPrompt } from "./prompt";
import { selectKBTopics } from "./knowledge-base/index";
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
  seed: number = 0,
): Promise<CoverageTopic[]> {
  // First, try KB-based topic selection (faster, no LLM call)
  const kbTopics = selectKBTopics(jobRole, resume, seed);
  if (kbTopics.length >= 4) {
    // Shuffle by seed to vary topic order across interviews
    const shuffled = shuffleWithSeed(kbTopics, seed);
    // Always keep background/motivation in the first 2 slots (natural conversation flow)
    // but allow other openers when seed pushes for variety
    const reordered = reorderForSeed(shuffled, seed);
    return reordered.map((t) => ({
      id: t.id,
      label: t.label,
      goal: buildGoalFromKB(t),
      status: "todo" as const,
      followUps: 0,
    }));
  }

  // Fall back to LLM-generated topics for unusual roles
  try {
    const result = await generate({
      task: "heavy",
      system: "You are a senior hiring manager designing an interview coverage plan. Respond with JSON only.",
      prompt: buildTopicsPrompt(jobRole, resume),
      jsonSchema: TopicsResponseSchema,
    });

    const parsed = tryParseAndValidate(result.text, TopicsResponseSchema);
    if (parsed.ok) {
      const rawTopics = (parsed.data as z.infer<typeof TopicsResponseSchema>).topics;
      // Shuffle by seed
      const shuffled = shuffleWithSeed(rawTopics, seed);
      return shuffled.map((t) => ({
        ...t,
        status: "todo" as const,
        followUps: 0,
      }));
    }
    console.warn("[BRAIN] Topic generation parse failed, using defaults");
  } catch (err) {
    console.warn("[BRAIN] Topic generation LLM failed, using defaults:", (err as Error).message);
  }

  // Fallback to default topic mix (shuffled by seed)
  const defaults = shuffleWithSeed(BRAIN_CONFIG.defaultTopics, seed);
  return defaults.map((t) => ({
    ...t,
    status: "todo" as const,
    followUps: 0,
  }));
}
// ─── Answer Signal Extraction ──────────────────────────────────────────────────

export interface AnswerSignals {
  /** Specific technologies, frameworks, services mentioned */
  technologies: string[];
  /** Concrete claims or decisions (e.g. "used Kafka for 50k RPS") */
  claims: string[];
  /** Brief mentions that need follow-up ("also used X", "and Y") */
  openThreads: string[];
}

/**
 * Lightweight extractor: identifies concrete technical signals in the latest answer.
 * Pure — no LLM call. Used to build the ACTIVE THREAD context block for answer-grounded follow-ups.
 */
export function extractSignalsFromAnswer(utterance: string, knownFacts: string[]): AnswerSignals {
  if (!utterance || utterance.length < 8) return { technologies: [], claims: [], openThreads: [] };

  const tech: string[] = [];
  const claims: string[] = [];
  const open: string[] = [];

  const techPatterns = [
    /\b(react|next\.?js|nuxt|vue|angular|svelte)\b/gi,
    /\b(node|express|fastapi|django|flask|rails|spring|nest\.?js)\b/gi,
    /\b(postgres|mysql|mongodb|redis|elasticsearch|cassandra|dynamodb|sqlite)\b/gi,
    /\b(pgvector|pinecone|weaviate|chroma|qdrant|milvus)\b/gi,
    /\b(kafka|rabbitmq|sqs|pubsub|nats|celery)\b/gi,
    /\b(kubernetes|k8s|docker|helm|terraform|ansible|pulumi)\b/gi,
    /\b(aws|gcp|azure|cloudflare|vercel|netlify|heroku)\b/gi,
    /\b(graphql|rest|grpc|websocket|webhooks?)\b/gi,
    /\b(typescript|python|golang|go|rust|java|kotlin|swift|c\+\+)\b/gi,
    /\b(llm|gpt|gemini|claude|langchain|openai|embedding|rag|vector search)\b/gi,
    /\b(microservices?|monolith|serverless|lambda|edge functions?)\b/gi,
    /\b(ci[\/-]cd|github actions|jenkins|circleci|gitlab ci)\b/gi,
    /\b(testing|jest|vitest|cypress|playwright|selenium|unit test|e2e)\b/gi,
  ];

  for (const pattern of techPatterns) {
    const matches = utterance.match(pattern);
    if (matches) tech.push(...matches.map((m) => m.toLowerCase()));
  }

  // Claim detection: sentences with numbers/percentages or strong action verbs
  const sentences = utterance.split(/[.!?;]/).map((s) => s.trim()).filter((s) => s.length > 10);
  const claimSignals = /\b(\d+[kKmMbBgGtT%]?|used|worked|built|designed|led|architected|reduced|increased|improved|migrated|scaled|deployed|solved|implemented|integrated|owned|created|managed|developed)\b/i;
  for (const s of sentences) {
    if (claimSignals.test(s)) claims.push(s.slice(0, 120));
  }

  // Open thread detection: sentences with brief tech mentions + trailing connectors
  const openSignals = /\b(also|and|plus|additionally|etc\.?|among others|some other)\b/i;
  for (const s of sentences) {
    if (openSignals.test(s) && tech.some((t) => s.toLowerCase().includes(t))) {
      open.push(s.slice(0, 120));
    }
  }

  // Focus on NOVEL signals — filter out tech already in known facts
  const knownLower = knownFacts.join(" ").toLowerCase();
  const novelTech = [...new Set(tech)].filter((t) => !knownLower.includes(t));

  return {
    technologies: novelTech.slice(0, 6),
    claims: claims.slice(0, 4),
    openThreads: open.slice(0, 3),
  };
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

  // 3. Candidate asked a question to AI / conversational permission request
  // e.g. "can I ask you a question?", "can I ask something?", "can I clarify something?"
  // → respond naturally and WAIT, do NOT continue the technical interview
  if (intent === "question_to_ai") {
    return {
      action: "meta_acknowledge",
      say: say.length > 5 ? say : "Of course, go ahead.",
      shouldAdvanceTopic: false,
      shouldEndInterview: false,
    };
  }

  // 4. Candidate asked AI to repeat or meta comments ("why are you repeating")
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

// ─── K-Score Update (Phase 2: Adaptive Difficulty) ────────────────────────────

/**
 * Update the rolling K-Score using exponential weighted average.
 * Only called for scorable intents (answer | partial).
 *
 * @param currentKScore - Current K-score (0-10)
 * @param newScore - This turn's score (0-10)
 * @param recentScores - Recent per-turn scores for trend detection
 * @returns Updated { kScore, kScoreTrend }
 */
export function updateKScore(
  currentKScore: number,
  newScore: number,
  recentScores: number[],
): { kScore: number; kScoreTrend: KScoreTrend } {
  const { alpha, strongTurnThreshold, weakTurnThreshold, risingRunLength, fallingRunLength } = KSCORE_CONFIG;

  // EWA update
  const kScore = Math.max(0, Math.min(10, alpha * newScore + (1 - alpha) * currentKScore));

  // Trend detection on last N scores
  const window = [...recentScores, newScore].slice(-Math.max(risingRunLength, fallingRunLength));
  const lastN = window.slice(-risingRunLength);
  const allStrong = lastN.length >= risingRunLength && lastN.every((s) => s >= strongTurnThreshold);
  const allWeak = lastN.length >= fallingRunLength && lastN.every((s) => s <= weakTurnThreshold);

  const kScoreTrend: KScoreTrend = allStrong ? "rising" : allWeak ? "falling" : "flat";

  return { kScore, kScoreTrend };
}

/**
 * Compute the target depth for the next question based on kScore + kScoreTrend.
 * Called once per turn before building the context block.
 *
 * @param kScore - Current K-score
 * @param kScoreTrend - Current trend
 * @param turnsOnCurrentTopic - How many turns spent on the current topic
 * @returns "easy" | "medium" | "hard"
 */
export function computeTargetDepth(
  kScore: number,
  kScoreTrend: KScoreTrend,
  turnsOnCurrentTopic: number = 0,
): TargetDepth {
  const { hardDepthMinScore, mediumDepthMinScore, risingTrendBoost, fallingTrendDampener } = KSCORE_CONFIG;

  // Adjust thresholds based on trend
  const trendAdjust = kScoreTrend === "rising" ? -risingTrendBoost : kScoreTrend === "falling" ? fallingTrendDampener : 0;

  const effectiveHard = hardDepthMinScore + trendAdjust;
  const effectiveMedium = mediumDepthMinScore + trendAdjust;

  if (kScore >= effectiveHard) return "hard";
  if (kScore >= effectiveMedium) return "medium";
  return "easy";
}

/**
 * Compute average word count of recent candidate answers for length adaptation.
 * Returns the average, or 0 if no data.
 */
export function computeAvgAnswerLength(recentTranscript: Array<{ speaker: string; content: string }>): number {
  const userTurns = recentTranscript
    .filter((e) => e.speaker === "user")
    .slice(-KSCORE_CONFIG.lengthAdaptationWindow);
  if (userTurns.length === 0) return 0;
  const totalWords = userTurns.reduce((sum, e) => sum + e.content.split(/\s+/).filter(Boolean).length, 0);
  return totalWords / userTurns.length;
}

// ─── Topic shuffle helpers (Phase 1 seed-based variation) ────────────────────

/** Deterministic Fisher-Yates shuffle seeded by a numeric seed. */
function shuffleWithSeed<T>(arr: readonly T[], seed: number): T[] {
  const copy = [...arr];
  let s = seed;
  for (let i = copy.length - 1; i > 0; i--) {
    // LCG-style pseudo random
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const j = Math.abs(s) % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }  
  return copy;
}

/**
 * Reorder topics so background/motivation is not ALWAYS turn 1.
 * When seed % 3 === 0 → background first (natural HR flow)
 * When seed % 3 === 1 → most recent project first (skip biography)
 * When seed % 3 === 2 → keep shuffle order (arbitrary start)
 */
function reorderForSeed<T extends { id: string }>(topics: T[], seed: number): T[] {
  const mode = seed % 3;
  if (mode === 0) {
    // Background first
    const bgIdx = topics.findIndex((t) => t.id === "background_motivation" || t.id === "background");
    if (bgIdx > 0) {
      const reordered = [...topics];
      const [bg] = reordered.splice(bgIdx, 1);
      reordered.unshift(bg);
      return reordered;
    }
  } else if (mode === 1) {
    // Project first — background moves to slot 2
    const projIdx = topics.findIndex((t) => t.id.includes("project"));
    if (projIdx > 0) {
      const reordered = [...topics];
      const [proj] = reordered.splice(projIdx, 1);
      reordered.unshift(proj);
      return reordered;
    }
  }
  // mode === 2: keep shuffle order
  return topics;
}

/** Build a goal string from KB entry concepts for use as a CoverageTopic.goal */
function buildGoalFromKB(entry: import("./knowledge-base/types").KnowledgeTopicEntry): string {
  return `Probe: ${entry.concepts.slice(0, 3).join(", ")}. Signal of strength: ${entry.signalsOfStrength[0]}.`;
}

/** Get the opening template instruction for the current interview seed */
export function getOpeningTemplate(seed: number): string {
  const templates = BRAIN_CONFIG.openingTemplates;
  return templates[seed % templates.length];
}

/** Get seed-based fallback phrasing (never repeats same phrasing for the same account) */
export function getSeedFallbackUtterance(state: ConversationState): string {
  const seed = state.conversationSeed ?? 0;
  const asked = new Set(state.asked.map((a) => a.topic));

  if (state.phase === "wrapup" || state.phase === "closing") {
    const wrapupFb = BRAIN_CONFIG.fallbackQuestions.find((f) => f.topic === "wrapup");
    const phrasings = wrapupFb?.phrasings || ["Do you have any questions for me?"];
    return phrasings[(seed + state.turnCount) % phrasings.length];
  }

  for (const fb of BRAIN_CONFIG.fallbackQuestions) {
    if (!asked.has(fb.topic)) {
      const phrasings = fb.phrasings as readonly string[];
      // Use seed + turnCount for rotation so neither account nor turn repeats same phrasing
      const phrasingIdx = (seed + state.turnCount) % phrasings.length;
      return phrasings[phrasingIdx];
    }
  }

  return "We have covered a lot of ground today. Do you have any questions for me before we finish?";
}
