/**
 * Interview brain schemas.
 * ConversationState lives in interviews.plan (jsonb) — no schema migration needed.
 * All shapes are Zod-validated at every API boundary.
 */

import { z } from "zod";

// ─── Coverage (topics generated once at plan-time) ────────────────────────────

export const CoverageTopicSchema = z.object({
  id: z.string(),           // e.g. "background", "project_alpha"
  label: z.string(),        // Human label: "Background & Motivation"
  goal: z.string(),         // What the AI should assess, not the question
  status: z.enum(["todo", "active", "done"]),
  score: z.number().min(0).max(10).optional(),
  confidence: z.number().min(0).max(1).optional(),
  followUps: z.number().int().min(0).default(0),
});

export type CoverageTopic = z.infer<typeof CoverageTopicSchema>;

// ─── Asked question record ────────────────────────────────────────────────────

export const AskedQuestionSchema = z.object({
  question: z.string(),
  topic: z.string(),
  turnIndex: z.number().int(),
});

export type AskedQuestion = z.infer<typeof AskedQuestionSchema>;

// ─── Per-turn score record ────────────────────────────────────────────────────

export const TurnScoreSchema = z.object({
  turnIndex: z.number().int(),
  topic: z.string(),
  score: z.number().min(0).max(10),
  confidence: z.number().min(0).max(1),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
});

export type TurnScore = z.infer<typeof TurnScoreSchema>;

// ─── Intent classification schema ──────────────────────────────────────────────

export const IntentSchema = z.enum([
  "answer",
  "partial",
  "repeat_request",
  "meta",
  "question_to_ai",
  "smalltalk",
  "offtopic",
  "unprofessional",
  "garbled",
  "stop",
]);

export type CandidateIntent = z.infer<typeof IntentSchema>;

// ─── Server-owned ConversationState (stored in interviews.plan) ───────────────

export const ConversationStateSchema = z.object({
  phase: z.enum(["intro", "warmup", "core", "wrapup", "closing"]).default("intro"),
  coverage: z.array(CoverageTopicSchema).default([]),
  asked: z.array(AskedQuestionSchema).default([]),
  scores: z.array(TurnScoreSchema).default([]),
  followUpsOnCurrent: z.number().int().min(0).default(0),
  turnCount: z.number().int().min(0).default(0),
  /** Number of warmup turns completed so far */
  warmupTurns: z.number().int().min(0).default(0),
  /** Consecutive off-topic / smalltalk turns in core phase */
  consecutiveSmalltalkCount: z.number().int().min(0).default(0),
  /** Unix ms timestamp when the interview actually started (post-greeting) */
  startedAt: z.number().optional(),
  /** Candidate first name extracted once at init */
  firstName: z.string().optional(),
  /** Last idempotency request ID processed */
  lastRequestId: z.string().optional(),
  /** Cached response for the last request ID */
  lastResponse: z.any().optional(),
  /** Facts memory extracted about candidate */
  facts: z.array(z.string()).default([]),
  /** Last 8 spoken replies for phrase-level repeat guard */
  spokenReplies: z.array(z.string()).default([]),
  /** Unprofessional language counter */
  unprofessionalCount: z.number().int().min(0).default(0),
  /** Clarification count on current topic */
  clarifyCount: z.number().int().min(0).default(0),
  /** Candidate language choice */
  candidateLang: z.enum(["en-IN", "hi-IN", "hinglish"]).default("en-IN"),
  /**
   * The open conversational thread being actively followed from the candidate's last answer.
   * e.g. "built solo to give creators one mood-board space"
   */
  activeThread: z.string().optional(),
  /** How many consecutive turns have focused on the current activeThread */
  threadDepth: z.number().int().min(0).default(0),
  /**
   * Random seed (0-999) assigned at initialize, persisted for the lifetime of the interview.
   * Drives topic shuffle order, opening template selection, and fallback phrasing rotation.
   * Never changes after creation.
   */
  conversationSeed: z.number().int().min(0).max(999).default(0),
  /**
   * K-Score: rolling exponentially-weighted knowledge/performance score (0-10).
   * Tracks candidate quality trend across scored turns, separate from per-turn scores.
   * Updated after every scorable turn (intent=answer|partial).
   */
  kScore: z.number().min(0).max(10).default(5),
  /** Trend direction for K-Score: rising after 2+ strong turns, falling after 2+ weak turns, flat otherwise */
  kScoreTrend: z.enum(["rising", "flat", "falling"]).default("flat"),
  /**
   * Adaptive depth target for the current turn, computed by the brain from kScore + kScoreTrend.
   * Passed to the LLM as an instruction. Recomputed each turn.
   */
  targetDepth: z.enum(["easy", "medium", "hard"]).default("easy"),
  /**
   * Pre-generated opening question variants (up to 3), created during lobby pre-warm.
   * One is selected by conversationSeed when the interview starts.
   */
  openingVariants: z.array(z.string()).default([]),
});

export type ConversationState = z.infer<typeof ConversationStateSchema>;

// ─── LLM TurnDecision output (validate every response) ───────────────────────

export const TurnEvaluationSchema = z.object({
  answeredQuestion: z.boolean(),
  unclearOrGarbled: z.boolean(),
  offTopic: z.boolean(),
  score: z.number().min(0).max(10).nullable().optional(),
  confidence: z.number().min(0).max(1),
  strengths: z.array(z.string()).default([]),
  gaps: z.array(z.string()).default([]),
  facts: z.array(z.string()).default([]),
  openThread: z.string().nullable().optional().default(null),
});

export const TurnDecisionSchema = z.object({
  action: z.enum([
    "next_topic",
    "followup",
    "clarify",
    "meta_acknowledge",
    "smalltalk_redirect",
    "nudge",
    "wrapup",
    "end",
  ]),
  nextTopic: z.string().nullable().optional(),
  reason: z.string(),
});

export const LLMTurnResponseSchema = z.object({
  intent: IntentSchema,
  evaluation: TurnEvaluationSchema,
  decision: TurnDecisionSchema,
  say: z.string().min(1).max(600),
});

export type LLMTurnResponse = z.infer<typeof LLMTurnResponseSchema>;

// ─── HTTP API shapes ──────────────────────────────────────────────────────────

/** Client → POST /api/interviews/[id]/turn */
export const TurnRequestSchema = z.object({
  /** The candidate's latest spoken/typed text */
  userUtterance: z.string(),
  /**
   * Last 6 transcript entries for context — client sends these
   * but server ALWAYS reads DB state as truth for phase/coverage/asked.
   */
  recentTranscript: z.array(z.object({
    speaker: z.enum(["user", "ai"]),
    content: z.string(),
  })).max(12),
  /** Optional client requestId for idempotency */
  clientRequestId: z.string().optional(),
  /** STT confidence score (0-1) */
  sttConfidence: z.number().min(0).max(1).optional(),
  /** Selected candidate language */
  lang: z.enum(["en-IN", "hi-IN", "hinglish"]).optional(),
});

export type TurnRequest = z.infer<typeof TurnRequestSchema>;

/** Server → TurnResponse (what the client needs to render/speak) */
export const TurnResponseSchema = z.object({
  say: z.string(),
  phase: z.enum(["intro", "warmup", "core", "wrapup", "closing"]),
  isComplete: z.boolean(),
  /** Dev-only: strip in production if desired */
  _dev: z.object({
    intent: IntentSchema.optional(),
    evaluation: TurnEvaluationSchema.optional(),
    decision: TurnDecisionSchema.optional(),
    provider: z.string(),
    latencyMs: z.number(),
    action: z.string(),
    attempts: z.array(z.any()).optional(),
  }).optional(),
});

export type TurnResponse = z.infer<typeof TurnResponseSchema>;
