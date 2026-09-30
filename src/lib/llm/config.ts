/**
 * Central LLM model/provider registry.
 * ALL model IDs and free-tier limits live here.
 *
 * Provider Notes & Exclusions (Phase 4):
 * - CEREBRAS: EXCLUDED. Cerebras is NOT permanently free — new accounts get a $5 credit
 *   that expires in 30 days and requires a verified payment method just to activate API
 *   access at all (confirmed from Cerebras official docs). Do NOT re-add without confirmation.
 * - MISTRAL: EXCLUDED (Pending manual verification). Mistral's free-tier terms are unclear
 *   and undergoing restructuring as of September 2026. Left out of the active pool for now.
 * - GROQ: ACTIVE. True free tier (no credit card required). Fast inference for live turns.
 * - GEMINI: ACTIVE. True free tier (no credit card required). Large context window (1M tokens).
 * - OPENROUTER: ACTIVE (Secondary / Overflow). Free models ending in ":free". Capped at 20 RPM / 50 RPD.
 */

export interface ProviderConfig {
  id: string;
  baseURL: string;
  /** env key holding the API secret */
  envKey: string;
  /** whether this is an OpenAI-compatible endpoint */
  openaiCompat: boolean;
}

export interface ModelConfig {
  id: string;
  provider: string;
  /** context window in tokens */
  contextTokens: number;
  /** approximate output tokens/sec on free tier */
  tps?: number;
  /** supports JSON mode / response_format: json_object */
  jsonMode: boolean;
}

// ─── Providers ───────────────────────────────────────────────────────────────

export const PROVIDERS: Record<string, ProviderConfig> = {
  groq: {
    id: "groq",
    baseURL: "https://api.groq.com/openai/v1",
    envKey: "GROQ_API_KEY",
    openaiCompat: true,
  },
  gemini: {
    id: "gemini",
    baseURL: "https://generativelanguage.googleapis.com",
    envKey: "GEMINI_API_KEY",
    openaiCompat: false,
  },
  openrouter: {
    id: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
    openaiCompat: true,
  },
};

// ─── Models (verified against live endpoints) ────────────────────────────────

/** Fast models for live turns (orchestrator): Groq -> Gemini -> OpenRouter */
export const LIVE_TURN_MODELS: ModelConfig[] = [
  // Primary: Groq (ultra fast TTFT)
  { id: "openai/gpt-oss-20b",                       provider: "groq",       contextTokens: 16384,   tps: 250, jsonMode: true },
  // Hedge 1: Gemini (cross-provider race)
  { id: "gemini-3.8-flash",                         provider: "gemini",     contextTokens: 1048576, tps: 150, jsonMode: true },
  // Hedge 2: Groq alternative
  { id: "qwen/qwen3.8-27b",                         provider: "groq",       contextTokens: 32768,   tps: 200, jsonMode: true },
  // Fallback 1: Gemini fast lite
  { id: "gemini-3.5-flash-lite",                    provider: "gemini",     contextTokens: 1048576, tps: 200, jsonMode: true },
  // Fallback 2: OpenRouter free tier (overflow)
  { id: "meta-llama/llama-3.3-70b-instruct:free",   provider: "openrouter", contextTokens: 16384,   tps: 80,  jsonMode: true },
];

/** Heavy models for resume parse, plan, feedback: Gemini -> Groq -> OpenRouter */
export const HEAVY_TASK_MODELS: ModelConfig[] = [
  { id: "gemini-3.8-flash",                         provider: "gemini",     contextTokens: 1048576, tps: 150, jsonMode: true },
  { id: "openai/gpt-oss-120b",                      provider: "groq",       contextTokens: 16384,   tps: 100, jsonMode: true },
  { id: "gemini-3.5-flash-lite",                    provider: "gemini",     contextTokens: 1048576, tps: 200, jsonMode: true },
  { id: "meta-llama/llama-3.3-70b-instruct:free",   provider: "openrouter", contextTokens: 16384,   tps: 80,  jsonMode: true },
];

/** Embedding model */
export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = 768; // Matches pgvector column

// ─── Timeouts ────────────────────────────────────────────────────────────────

/** Time-to-first-token budget for live turns (ms) */
export const LIVE_TTFT_MS = 3000;

/** Time-to-first-token for hedging: fire second provider if none in this time */
export const HEDGE_FIRE_MS = 1500;

/** Total timeout for heavy tasks (ms) */
export const HEAVY_TIMEOUT_MS = 20000;

// ─── Circuit breaker ─────────────────────────────────────────────────────────

/** Consecutive failures before opening the circuit */
export const CB_FAILURE_THRESHOLD = 2;

/** How long to keep a tripped circuit open (ms) */
export const CB_OPEN_MS = 5 * 60 * 1000; // 5 minutes
