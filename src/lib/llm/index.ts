/**
 * Shared LLM generate() function used by every route.
 *
 * Features:
 * - Task-based model priority lists (live turns vs heavy tasks)
 * - Circuit breaker per provider+model
 * - AbortController timeouts (3s TTFT for live, 20s for heavy)
 * - Hedging for live turns: fire second provider at 1.5s if no response
 * - JSON mode with Zod validation and one retry on same provider
 * - Structured logging: provider, model, latency, failure reason
 */

import { z } from "zod";
import {
  LIVE_TURN_MODELS,
  HEAVY_TASK_MODELS,
  LIVE_TTFT_MS,
  HEDGE_FIRE_MS,
  HEAVY_TIMEOUT_MS,
  PROVIDERS,
  type ModelConfig,
} from "./config";
import { isOpen } from "./circuit-breaker";
import { geminiGenerate } from "./gemini-adapter";
import { openaiCompatGenerate } from "./openai-compat-adapter";
import type { GenerateOptions, GenerateResult } from "./gemini-adapter";

export type TaskType = "live" | "heavy";

export interface LLMGenerateOptions {
  task: TaskType;
  system: string;
  /** Plain text prompt (user turn content) */
  prompt: string;
  /** If provided, parse/validate LLM output with this Zod schema */
  jsonSchema?: z.ZodTypeAny;
}

export interface AttemptLog {
  provider: string;
  model: string;
  outcome: "success" | "error" | "circuit_broken" | "disabled";
  latencyMs: number;
  error?: string;
}

export interface ExtendedGenerateResult extends GenerateResult {
  attempts: AttemptLog[];
}

// ─── Environment Outage Simulation ──────────────────────────────────────────

export function getDisabledProviders(): Set<string> {
  const envStr = process.env.LLM_DISABLE_PROVIDERS || "";
  return new Set(
    envStr
      .toLowerCase()
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean),
  );
}

// ─── Startup Table Logger ───────────────────────────────────────────────────

let loggedStartupTable = false;
export function logLLMStartupTable() {
  if (loggedStartupTable) return;
  loggedStartupTable = true;
  const disabled = getDisabledProviders();

  console.log("\n=== LLM PROVIDER & MODEL REGISTRY ===");
  const rows = [
    ...LIVE_TURN_MODELS.map((m) => ({ task: "live", ...m })),
    ...HEAVY_TASK_MODELS.map((m) => ({ task: "heavy", ...m })),
  ].map((m) => {
    const provConfig = PROVIDERS[m.provider];
    const hasKey = provConfig ? !!process.env[provConfig.envKey] : false;
    const isDis = disabled.has(m.provider);
    const cb = isOpen(m.provider, m.id);
    return {
      Task: m.task,
      "Model ID": m.id,
      Provider: m.provider,
      Configured: hasKey ? "YES" : "NO (Missing Key)",
      Status: isDis ? "DISABLED (env)" : cb ? "CIRCUIT_OPEN" : "ACTIVE",
    };
  });
  console.table(rows);
  console.log("======================================\n");
}

// Trigger startup log once on module load
try { logLLMStartupTable(); } catch {}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Generate text using the best available LLM for the given task.
 * Returns ExtendedGenerateResult with attempts[]. Throws if ALL providers fail.
 */
export async function generate(opts: LLMGenerateOptions): Promise<ExtendedGenerateResult> {
  const models = opts.task === "live" ? LIVE_TURN_MODELS : HEAVY_TASK_MODELS;
  const timeoutMs = opts.task === "live" ? LIVE_TTFT_MS : HEAVY_TIMEOUT_MS;
  const disabled = getDisabledProviders();
  const attempts: AttemptLog[] = [];

  // Filter out disabled & circuit-broken models
  const available = models.filter((m) => {
    if (disabled.has(m.provider)) {
      attempts.push({ provider: m.provider, model: m.id, outcome: "disabled", latencyMs: 0, error: "Disabled by LLM_DISABLE_PROVIDERS" });
      return false;
    }
    if (isOpen(m.provider, m.id)) {
      attempts.push({ provider: m.provider, model: m.id, outcome: "circuit_broken", latencyMs: 0, error: "Circuit open" });
      return false;
    }
    return true;
  });

  if (available.length === 0) {
    const errMessage = disabled.size > 0
      ? `[LLM] All providers disabled (${Array.from(disabled).join(",")}) or circuit-broken. No models available.`
      : "[LLM] All providers are circuit-broken. No models available.";
    throw new Error(errMessage);
  }

  if (opts.task === "live") {
    const res = await generateWithHedging(available, opts, timeoutMs, attempts);
    return { ...res, attempts };
  } else {
    const res = await generateSequential(available, opts, timeoutMs, attempts);
    return { ...res, attempts };
  }
}

// ─── Sequential fallback (heavy tasks) ───────────────────────────────────────

async function generateSequential(
  models: ModelConfig[],
  opts: LLMGenerateOptions,
  timeoutMs: number,
  attempts: AttemptLog[],
): Promise<GenerateResult> {
  let lastError: Error | null = null;

  for (const model of models) {
    const start = Date.now();
    try {
      const result = await callModel(model, opts, timeoutMs);

      // Validate JSON if schema provided
      if (opts.jsonSchema) {
        const validated = await validateAndRetry(result, model, opts, timeoutMs);
        attempts.push({ provider: model.provider, model: model.id, outcome: "success", latencyMs: Date.now() - start });
        return validated;
      }

      attempts.push({ provider: model.provider, model: model.id, outcome: "success", latencyMs: Date.now() - start });
      return result;
    } catch (err: any) {
      attempts.push({ provider: model.provider, model: model.id, outcome: "error", latencyMs: Date.now() - start, error: err?.message });
      lastError = err;
      console.warn(`[LLM] Sequential: ${model.provider}/${model.id} failed, trying next. ${err?.message}`);
    }
  }

  throw lastError ?? new Error("[LLM] All sequential providers failed");
}

// ─── Hedging (live turns: cross-provider) ───────────────────────────────────

async function generateWithHedging(
  availableModels: ModelConfig[],
  opts: LLMGenerateOptions,
  timeoutMs: number,
  attempts: AttemptLog[],
): Promise<GenerateResult> {
  if (availableModels.length === 0) throw new Error("[LLM] No models available for hedging");

  const primary = availableModels[0];

  // Re-order remaining models so first hedge is a DIFFERENT provider than primary
  const diffProviderHedge = availableModels.slice(1).find((m) => m.provider !== primary.provider);
  const remaining = availableModels.slice(1).filter((m) => m !== diffProviderHedge);
  const hedgeModels = diffProviderHedge ? [diffProviderHedge, ...remaining] : availableModels.slice(1);

  return new Promise<GenerateResult>((resolve, reject) => {
    let settled = false;

    function settle(result: GenerateResult) {
      if (settled) return;
      settled = true;
      resolve(result);
    }

    function fail(err: Error) {
      if (settled) return;
      if (attempts.filter((a) => a.outcome === "error").length >= availableModels.length) {
        reject(err);
      }
    }

    // Fire primary
    const pStart = Date.now();
    callModel(primary, opts, timeoutMs)
      .then((r) => {
        attempts.push({ provider: primary.provider, model: primary.id, outcome: "success", latencyMs: Date.now() - pStart });
        settle(r);
      })
      .catch((e) => {
        attempts.push({ provider: primary.provider, model: primary.id, outcome: "error", latencyMs: Date.now() - pStart, error: e?.message });
        fail(e);
        // On primary failure, fire first hedge immediately if available
        if (!settled && hedgeModels.length > 0) {
          const hedge = hedgeModels[0];
          const hStart = Date.now();
          callModel(hedge, opts, timeoutMs)
            .then((r) => {
              attempts.push({ provider: hedge.provider, model: hedge.id, outcome: "success", latencyMs: Date.now() - hStart });
              settle(r);
            })
            .catch((he) => {
              attempts.push({ provider: hedge.provider, model: hedge.id, outcome: "error", latencyMs: Date.now() - hStart, error: he?.message });
              fail(he);
            });
        }
      });

    // Hedging timer: fire cross-provider hedge after HEDGE_FIRE_MS if primary slow
    if (hedgeModels.length > 0) {
      setTimeout(() => {
        if (settled) return;
        const hedge = hedgeModels[0];
        console.log(`[LLM] Hedging: firing ${hedge.provider}/${hedge.id} after ${HEDGE_FIRE_MS}ms (cross-provider race)`);
        const hStart = Date.now();
        callModel(hedge, opts, timeoutMs)
          .then((r) => {
            attempts.push({ provider: hedge.provider, model: hedge.id, outcome: "success", latencyMs: Date.now() - hStart });
            settle(r);
          })
          .catch((he) => {
            attempts.push({ provider: hedge.provider, model: hedge.id, outcome: "error", latencyMs: Date.now() - hStart, error: he?.message });
            fail(he);
          });
      }, HEDGE_FIRE_MS);
    }
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function callModel(
  model: ModelConfig,
  opts: LLMGenerateOptions,
  timeoutMs: number,
): Promise<GenerateResult> {
  const callOpts: GenerateOptions = {
    system: opts.system,
    prompt: opts.prompt,
    model: model.id,
    jsonSchema: opts.jsonSchema,
    timeoutMs,
  };

  if (model.provider === "gemini") {
    return geminiGenerate(callOpts);
  } else {
    return openaiCompatGenerate(model.provider, callOpts);
  }
}

async function validateAndRetry(
  result: GenerateResult,
  model: ModelConfig,
  opts: LLMGenerateOptions,
  timeoutMs: number,
): Promise<GenerateResult> {
  const parsed = tryParseAndValidate(result.text, opts.jsonSchema!);
  if (parsed.ok) return result;

  console.warn(
    `[LLM] JSON validation failed for ${model.provider}/${model.id}, retrying once. ${parsed.error}`,
  );

  const retry = await callModel(model, opts, timeoutMs);
  const retryParsed = tryParseAndValidate(retry.text, opts.jsonSchema!);
  if (retryParsed.ok) return retry;

  throw new Error(
    `[LLM] JSON schema validation failed after retry: ${retryParsed.error}`,
  );
}

export function tryParseAndValidate(
  text: string,
  schema: z.ZodTypeAny,
): { ok: true; data: unknown } | { ok: false; error: string } {
  let cleanText = text.trim();
  // Strip markdown code fences if present (e.g. ```json ... ```)
  cleanText = cleanText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  let json: unknown;
  try {
    json = JSON.parse(cleanText);
  } catch {
    return { ok: false, error: "Not valid JSON" };
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    return { ok: false, error: result.error.message };
  }
  return { ok: true, data: result.data };
}
