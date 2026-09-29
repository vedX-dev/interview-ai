/**
 * Per-provider circuit breaker.
 * Keyed by "provider:model". After CB_FAILURE_THRESHOLD consecutive failures,
 * or any 404/401/429, the circuit opens for CB_OPEN_MS.
 * Stored in module-level memory (shared across requests in the same process).
 */

import { CB_FAILURE_THRESHOLD, CB_OPEN_MS } from "./config";

interface CircuitState {
  failures: number;
  openUntil: number; // epoch ms; 0 = closed
  lastReason?: string;
}

const circuits = new Map<string, CircuitState>();

function key(provider: string, model: string): string {
  return `${provider}:${model}`;
}

/** Returns true if the circuit is open (provider+model should be skipped). */
export function isOpen(provider: string, model: string): boolean {
  const state = circuits.get(key(provider, model));
  if (!state) return false;
  if (state.openUntil > 0 && Date.now() < state.openUntil) return true;
  // Circuit expired — reset
  if (state.openUntil > 0 && Date.now() >= state.openUntil) {
    circuits.set(key(provider, model), { failures: 0, openUntil: 0 });
  }
  return false;
}

/**
 * Record a failure. Opens the circuit immediately on 404/401/429,
 * or after CB_FAILURE_THRESHOLD consecutive failures.
 */
export function recordFailure(
  provider: string,
  model: string,
  statusCode?: number,
  retryAfterMs?: number,
  reason?: string,
): void {
  const k = key(provider, model);
  const state = circuits.get(k) ?? { failures: 0, openUntil: 0 };

  const isFatal =
    statusCode === 404 || statusCode === 401 || statusCode === 429;

  state.failures += 1;
  state.lastReason = reason;

  if (isFatal || state.failures >= CB_FAILURE_THRESHOLD) {
    const openDuration =
      statusCode === 429 && retryAfterMs ? retryAfterMs : CB_OPEN_MS;
    state.openUntil = Date.now() + openDuration;
    console.warn(
      `[CB] Circuit OPEN for ${k} for ${Math.round(openDuration / 1000)}s. ` +
        `Reason: ${reason ?? statusCode}`,
    );
  }

  circuits.set(k, state);
}

/** Record a success — resets consecutive failure count. */
export function recordSuccess(provider: string, model: string): void {
  const k = key(provider, model);
  const state = circuits.get(k);
  if (state) {
    state.failures = 0;
    // Don't clear openUntil; the circuit stays open until the timer expires.
    circuits.set(k, state);
  }
}

/** How many ms until the circuit closes, or 0 if already closed. */
export function msUntilClose(provider: string, model: string): number {
  const state = circuits.get(key(provider, model));
  if (!state || state.openUntil === 0) return 0;
  return Math.max(0, state.openUntil - Date.now());
}
