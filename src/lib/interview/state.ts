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
  type CandidateIntent,
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
      plan: state as any,
      ...(extraFields?.currentPhase ? { currentPhase: extraFields.currentPhase as any } : {}),
      ...(extraFields?.status ? { status: extraFields.status as any } : {}),
    })
    .where(eq(interviews.id, interviewId));
}

// ─── Phase Transition Helper (Pure) ──────────────────────────────────────────

export interface AdvancePhaseOptions {
  candidateAskedToStart?: boolean;
  lastIntent?: CandidateIntent;
}

/**
 * Pure function: Evaluates and advances interview phase.
 * Warmup ends when warmupTurns >= minWarmupTurns (3), extended up to maxWarmupTurns (5)
 * if the candidate's last message was a question to the AI.
 * Early exit occurs if the candidate explicitly asks to start and warmupTurns >= 2.
 */
export function advancePhase(
  state: ConversationState,
  options?: AdvancePhaseOptions,
): ConversationState {
  const nextState = structuredClone(state);

  if (nextState.phase === "intro") {
    nextState.phase = "warmup";
    nextState.warmupTurns = 0;
    nextState.startedAt = Date.now();
    return nextState;
  }

  if (nextState.phase === "warmup") {
    const turns = nextState.warmupTurns ?? 0;
    const askedToStart = options?.candidateAskedToStart ?? false;
    const lastIntent = options?.lastIntent;

    // Early exit: candidate explicitly asks to start AND warmupTurns >= 2
    const canEarlyExit = askedToStart && turns >= BRAIN_CONFIG.minWarmupTurnsEarlyExit;

    // Extension: if candidate asked a question to AI on last turn, extend warmup by 1 turn (up to maxWarmupTurns)
    const isQuestionToAi = lastIntent === "question_to_ai";
    const requiredTurns = isQuestionToAi
      ? Math.min(BRAIN_CONFIG.maxWarmupTurns, BRAIN_CONFIG.minWarmupTurns + 1)
      : BRAIN_CONFIG.minWarmupTurns;

    const meetsMinTurns = turns >= requiredTurns;
    const hitsMaxTurns = turns >= BRAIN_CONFIG.maxWarmupTurns;

    if (canEarlyExit || meetsMinTurns || hitsMaxTurns) {
      nextState.phase = "core";
      // Activate first topic on transition to core (bridge turn)
      if (!nextState.coverage.some((t) => t.status === "active")) {
        const { nextState: activatedState } = activateNextTopic(nextState);
        return activatedState;
      }
    }
  }

  return nextState;
}

// ─── Topic generation (called once per interview) ─────────────────────────────

const TopicsResponseSchema = z.object({
  topics: z.array(z.object({
    id: z.string(),
    label: z.string(),
    goal: z.string(),
  })).min(4).max(6),
});

export async function generateCoverageTopics(
  jobRole: string,
  resume: ExtractedResume | null,
  seed: number = 0,
): Promise<CoverageTopic[]> {
  const kbTopics = selectKBTopics(jobRole, resume, seed);
  if (kbTopics.length >= 4) {
    const shuffled = shuffleWithSeed(kbTopics, seed);
    const reordered = reorderForSeed(shuffled, seed);
    return reordered.slice(0, BRAIN_CONFIG.maxCoreTopics).map((t) => ({
      id: t.id,
      label: t.label,
      goal: buildGoalFromKB(t),
      status: "todo" as const,
      followUps: 0,
    }));
  }

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
      const shuffled = shuffleWithSeed(rawTopics, seed);
      return shuffled.slice(0, BRAIN_CONFIG.maxCoreTopics).map((t) => ({
        ...t,
        status: "todo" as const,
        followUps: 0,
      }));
    }
    console.warn("[BRAIN] Topic generation parse failed, using defaults");
  } catch (err) {
    console.warn("[BRAIN] Topic generation LLM failed, using defaults:", (err as Error).message);
  }

  const defaults = shuffleWithSeed(BRAIN_CONFIG.defaultTopics, seed);
  return defaults.slice(0, BRAIN_CONFIG.maxCoreTopics).map((t) => ({
    ...t,
    status: "todo" as const,
    followUps: 0,
  }));
}

// ─── Answer Signal Extraction ──────────────────────────────────────────────────

export interface AnswerSignals {
  technologies: string[];
  claims: string[];
  openThreads: string[];
}

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

  const sentences = utterance.split(/[.!?;]/).map((s) => s.trim()).filter((s) => s.length > 10);
  const claimSignals = /\b(\d+[kKmMbBgGtT%]?|used|worked|built|designed|led|architected|reduced|increased|improved|migrated|scaled|deployed|solved|implemented|integrated|owned|created|managed|developed)\b/i;
  for (const s of sentences) {
    if (claimSignals.test(s)) claims.push(s.slice(0, 120));
  }

  const openSignals = /\b(also|and|plus|additionally|etc\.?|among others|some other)\b/i;
  for (const s of sentences) {
    if (openSignals.test(s) && tech.some((t) => s.toLowerCase().includes(t))) {
      open.push(s.slice(0, 120));
    }
  }

  const knownLower = knownFacts.join(" ").toLowerCase();
  const novelTech = [...new Set(tech)].filter((t) => !knownLower.includes(t));

  return {
    technologies: novelTech.slice(0, 6),
    claims: claims.slice(0, 4),
    openThreads: open.slice(0, 3),
  };
}

// ─── Similarity check (repeated question guard) ───────────────────────────────

function tokenise(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

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

export function isTooSimilar(question: string, asked: AskedQuestion[]): boolean {
  for (const prev of asked) {
    if (tokenOverlap(question, prev.question) >= BRAIN_CONFIG.similarityThreshold) {
      return true;
    }
  }
  return false;
}

// ─── Phrase-Level Repeat Guard ───────────────────────────────────────────────

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
 * Enforces caps, clarify ladder, professionalism nudges, repeat guards, and minTurnsPerTopic pacing.
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
      return {
        action: "nudge",
        say: "Let's keep our focus professional, and I am glad to continue with our question.",
        shouldAdvanceTopic: false,
        shouldEndInterview: false,
        updatedState: currentState,
      };
    }
    return {
      action: "smalltalk_redirect",
      say: say || "Let's bring our discussion back to your engineering experience.",
      shouldAdvanceTopic: false,
      shouldEndInterview: false,
      updatedState: currentState,
    };
  }

  // 3. WARMUP PHASE INTENT POLICY:
  // In warmup, smalltalk / question_to_ai / meta NEVER become smalltalk_redirect or a generic redirect.
  // Use the LLM's say (fallback only if empty).
  if (currentState.phase === "warmup") {
    if (
      intent === "smalltalk" ||
      intent === "question_to_ai" ||
      intent === "meta" ||
      intent === "offtopic"
    ) {
      return {
        action: "meta_acknowledge",
        say: say && say.trim().length > 3 ? say : "I'm glad to hear that! How has your day been going so far?",
        shouldAdvanceTopic: false,
        shouldEndInterview: false,
        updatedState: currentState,
      };
    }
  }

  // 4. Candidate asked a question to AI / conversational permission request
  if (intent === "question_to_ai") {
    return {
      action: "meta_acknowledge",
      say: say.length > 5 ? say : "Of course, go ahead.",
      shouldAdvanceTopic: false,
      shouldEndInterview: false,
      updatedState: currentState,
    };
  }

  // 5. Candidate asked AI to repeat or meta comments
  if (intent === "repeat_request" || intent === "meta" || decision.action === "meta_acknowledge") {
    const acknowledgeSay = say.length > 5
      ? say
      : "Got it — let me rephrase our question.";
    return {
      action: "meta_acknowledge",
      say: acknowledgeSay,
      shouldAdvanceTopic: false,
      shouldEndInterview: false,
      updatedState: currentState,
    };
  }

  // 6. Genuine garble / acoustic corruption → Clarify ladder
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

  // 7. CORE PHASE: Off-topic / smalltalk handling
  // In core, smalltalk_redirect ONLY after two consecutive off-topic/smalltalk turns.
  if (intent === "offtopic" || intent === "smalltalk" || evaluation.offTopic || decision.action === "smalltalk_redirect") {
    const consec = (currentState.consecutiveSmalltalkCount || 0) + 1;
    currentState.consecutiveSmalltalkCount = consec;

    if (consec < 2) {
      return {
        action: "meta_acknowledge",
        say: say || "That makes sense!",
        shouldAdvanceTopic: false,
        shouldEndInterview: false,
        updatedState: currentState,
      };
    }

    return {
      action: "smalltalk_redirect",
      say: say || "I'd love to bring our focus back to your engineering experience.",
      shouldAdvanceTopic: false,
      shouldEndInterview: false,
      updatedState: currentState,
    };
  }

  // Reset consecutive smalltalk counter on scorable technical answer
  if (intent === "answer" || intent === "partial") {
    currentState.consecutiveSmalltalkCount = 0;
  }

  // 8. Check follow-up caps and minTurnsPerTopic on answers/partials
  const activeTopic = currentState.coverage.find((t) => t.status === "active");
  const followUpsOnCurrent = currentState.followUpsOnCurrent;
  const turnsOnCurrentTopic = (activeTopic?.followUps ?? 0) + 1; // 1 main question + followUps
  const minTurnsMet = turnsOnCurrentTopic >= BRAIN_CONFIG.minTurnsPerTopic;

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
      updatedState: currentState,
    };
  }

  // 9. Score-based override for evaluated answers
  const scoreVal = evaluation.score ?? 5;
  if (decision.action === "next_topic" || decision.action === "followup" || decision.action === "wrapup") {
    // Score >= 7 override MUST respect minTurnsPerTopic!
    if (
      scoreVal >= BRAIN_CONFIG.scoreForNextTopic &&
      evaluation.confidence >= BRAIN_CONFIG.confidenceForNextTopic &&
      minTurnsMet
    ) {
      if (decision.action !== "wrapup") {
        return {
          action: "next_topic",
          say,
          shouldAdvanceTopic: true,
          shouldEndInterview: false,
          updatedState: currentState,
        };
      }
    }

    // If score >= 7 but minTurnsPerTopic is NOT met yet, ask follow-up instead of skipping early!
    if (
      scoreVal >= BRAIN_CONFIG.scoreForNextTopic &&
      !minTurnsMet &&
      followUpsOnCurrent < maxFollowUps &&
      activeTopic
    ) {
      return {
        action: "followup",
        say,
        shouldAdvanceTopic: false,
        shouldEndInterview: false,
        updatedState: currentState,
      };
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
        updatedState: currentState,
      };
    }
  }

  if (decision.action === "wrapup") {
    return { action: "wrapup", say, shouldAdvanceTopic: false, shouldEndInterview: false, updatedState: currentState };
  }

  return {
    action: decision.action,
    say,
    shouldAdvanceTopic: decision.action === "next_topic",
    shouldEndInterview: false,
    updatedState: currentState,
  };
}

// ─── State mutation helpers (Pure & Idempotent) ──────────────────────────────

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

export function updateKScore(
  currentKScore: number,
  newScore: number,
  recentScores: number[],
): { kScore: number; kScoreTrend: KScoreTrend } {
  const { alpha, strongTurnThreshold, weakTurnThreshold, risingRunLength, fallingRunLength } = KSCORE_CONFIG;

  const kScore = Math.max(0, Math.min(10, alpha * newScore + (1 - alpha) * currentKScore));

  const window = [...recentScores, newScore].slice(-Math.max(risingRunLength, fallingRunLength));
  const lastN = window.slice(-risingRunLength);
  const allStrong = lastN.length >= risingRunLength && lastN.every((s) => s >= strongTurnThreshold);
  const allWeak = lastN.length >= fallingRunLength && lastN.every((s) => s <= weakTurnThreshold);

  const kScoreTrend: KScoreTrend = allStrong ? "rising" : allWeak ? "falling" : "flat";

  return { kScore, kScoreTrend };
}

export function computeTargetDepth(
  kScore: number,
  kScoreTrend: KScoreTrend,
  turnsOnCurrentTopic: number = 0,
): TargetDepth {
  const { hardDepthMinScore, mediumDepthMinScore, risingTrendBoost, fallingTrendDampener } = KSCORE_CONFIG;

  const trendAdjust = kScoreTrend === "rising" ? -risingTrendBoost : kScoreTrend === "falling" ? fallingTrendDampener : 0;

  const effectiveHard = hardDepthMinScore + trendAdjust;
  const effectiveMedium = mediumDepthMinScore + trendAdjust;

  if (kScore >= effectiveHard) return "hard";
  if (kScore >= effectiveMedium) return "medium";
  return "easy";
}

export function computeAvgAnswerLength(recentTranscript: Array<{ speaker: string; content: string }>): number {
  const userTurns = recentTranscript
    .filter((e) => e.speaker === "user")
    .slice(-KSCORE_CONFIG.lengthAdaptationWindow);
  if (userTurns.length === 0) return 0;
  const totalWords = userTurns.reduce((sum, e) => sum + e.content.split(/\s+/).filter(Boolean).length, 0);
  return totalWords / userTurns.length;
}

// ─── Topic shuffle helpers (Phase 1 seed-based variation) ────────────────────

function shuffleWithSeed<T>(arr: readonly T[], seed: number): T[] {
  const copy = [...arr];
  let s = seed;
  for (let i = copy.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const j = Math.abs(s) % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }  
  return copy;
}

function reorderForSeed<T extends { id: string }>(topics: T[], seed: number): T[] {
  const mode = seed % 3;
  if (mode === 0) {
    const bgIdx = topics.findIndex((t) => t.id === "background_motivation" || t.id === "background");
    if (bgIdx > 0) {
      const reordered = [...topics];
      const [bg] = reordered.splice(bgIdx, 1);
      reordered.unshift(bg);
      return reordered;
    }
  } else if (mode === 1) {
    const projIdx = topics.findIndex((t) => t.id.includes("project"));
    if (projIdx > 0) {
      const reordered = [...topics];
      const [proj] = reordered.splice(projIdx, 1);
      reordered.unshift(proj);
      return reordered;
    }
  }
  return topics;
}

function buildGoalFromKB(entry: import("./knowledge-base/types").KnowledgeTopicEntry): string {
  return `Probe: ${entry.concepts.slice(0, 3).join(", ")}. Signal of strength: ${entry.signalsOfStrength[0]}.`;
}

export function getOpeningTemplate(seed: number): string {
  const templates = BRAIN_CONFIG.openingTemplates;
  return templates[seed % templates.length];
}

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
      const phrasingIdx = (seed + state.turnCount) % phrasings.length;
      return phrasings[phrasingIdx];
    }
  }

  return "We have covered a lot of ground today. Do you have any questions for me before we finish?";
}
