/**
 * Central LLM model/provider registry.
 * ALL model IDs and free-tier limits live here. Verified 2026-09-29.
 * Groq models verified: GET /openai/v1/models
 * Gemini models verified: GET /v1beta/models
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
  gemini: {
    id: "gemini",
    baseURL: "https://generativelanguage.googleapis.com",
    envKey: "GEMINI_API_KEY",
    openaiCompat: false,
  },
  groq: {
    id: "groq",
    baseURL: "https://api.groq.com/openai/v1",
    envKey: "GROQ_API_KEY",
    openaiCompat: true,
  },
};

// ─── Models (verified against live /models endpoints 2026-09-29) ─────────────

/** Fast models for live turns (orchestrator): speed first. Interleaved so hedging races DIFFERENT providers. */
export const LIVE_TURN_MODELS: ModelConfig[] = [
  // Primary: Groq (super fast TTFT)
  { id: "openai/gpt-oss-20b",    provider: "groq",   contextTokens: 16384,  tps: 250, jsonMode: true },
  // Hedge 1: Gemini (different provider!)
  { id: "gemini-3.8-flash",      provider: "gemini", contextTokens: 1048576, tps: 150, jsonMode: true },
  // Hedge 2: Groq alternative
  { id: "qwen/qwen3.8-27b",      provider: "groq",   contextTokens: 32768,  tps: 200, jsonMode: true },
  // Fallback: Gemini fast lite
  { id: "gemini-3.5-flash-lite", provider: "gemini", contextTokens: 1048576, tps: 200, jsonMode: true },
];

/** Heavy models for resume parse, plan, feedback: quality first */
export const HEAVY_TASK_MODELS: ModelConfig[] = [
  { id: "gemini-3.8-flash",      provider: "gemini", contextTokens: 1048576, tps: 150, jsonMode: true },
  { id: "openai/gpt-oss-120b",   provider: "groq",   contextTokens: 16384,  tps: 100, jsonMode: true },
  { id: "gemini-3.5-flash-lite", provider: "gemini", contextTokens: 1048576, tps: 200, jsonMode: true },
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
