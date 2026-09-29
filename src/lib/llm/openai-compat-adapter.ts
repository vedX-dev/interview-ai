/**
 * Generic OpenAI-compatible adapter.
 * Works with Groq and any other OpenAI-compatible provider.
 */

import type { z } from "zod";
import type { GenerateOptions, GenerateResult } from "./gemini-adapter";
import { PROVIDERS } from "./config";
import { recordFailure, recordSuccess } from "./circuit-breaker";

export async function openaiCompatGenerate(
  providerId: string,
  opts: GenerateOptions,
): Promise<GenerateResult> {
  const provider = PROVIDERS[providerId];
  if (!provider || !provider.openaiCompat) {
    throw new Error(`Unknown or non-OpenAI-compat provider: ${providerId}`);
  }

  const apiKey = process.env[provider.envKey];
  if (!apiKey) throw new Error(`${provider.envKey} not configured`);

  const timeoutMs = opts.timeoutMs ?? 20000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const start = Date.now();

  try {
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user",   content: opts.prompt },
      ],
      temperature: 0.7,
    };

    if (opts.jsonSchema) {
      body.response_format = { type: "json_object" };
    }

    const resp = await fetch(`${provider.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const latencyMs = Date.now() - start;

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      const retryAfter = parseRetryAfterHeader(
        resp.headers.get("retry-after"),
      );
      console.warn(
        `[LLM] ${providerId}/${opts.model} FAIL ${latencyMs}ms status=${resp.status} ${errBody.slice(0, 120)}`,
      );
      recordFailure(providerId, opts.model, resp.status, retryAfter, errBody.slice(0, 120));
      throw new Error(
        `${providerId} API ${resp.status}: ${errBody.slice(0, 200)}`,
      );
    }

    const data = await resp.json();
    const text: string = data.choices?.[0]?.message?.content ?? "";

    console.log(`[LLM] ${providerId}/${opts.model} ok ${latencyMs}ms`);
    recordSuccess(providerId, opts.model);
    return { text, provider: providerId, model: opts.model, latencyMs };
  } catch (err: any) {
    clearTimeout(timer);
    const latencyMs = Date.now() - start;

    if (err?.name === "AbortError") {
      console.warn(
        `[LLM] ${providerId}/${opts.model} TIMEOUT ${latencyMs}ms`,
      );
      recordFailure(providerId, opts.model, undefined, undefined, "timeout");
    }
    throw err;
  }
}

function parseRetryAfterHeader(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = parseInt(header, 10);
  return isNaN(seconds) ? undefined : seconds * 1000;
}
