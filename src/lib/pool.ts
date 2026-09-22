/**
 * Candidate question pool — in-process memory store.
 *
 * The pool is ephemeral: it only needs to survive a single candidate speaking
 * turn (seconds, not minutes). A plain Map in the Next.js server process is
 * sufficient and matches the README requirement of using the "existing backend"
 * without introducing new infrastructure.
 *
 * Why NOT Redis here:
 * - The README says "move pooling into the existing backend" — the running
 *   Next.js API process IS the existing backend.
 * - Pool entries are short-lived (< 30 seconds in practice). Redis adds
 *   network RTT and an infra dependency for data that doesn't need to outlive
 *   the current server process.
 * - In a single-server dev setup (the current stage), the browser and API
 *   routes share the same process. A Map is zero-latency.
 *
 * Tradeoff acknowledged: this pool is not shared across multiple server
 * replicas. That is acceptable for the current phase; if horizontal scaling
 * is introduced later, the store can be swapped to Redis then.
 */

import type { PredictionPool } from "@/src/schemas/prediction";

type PoolEntry = {
  pool: PredictionPool;
  /** Absolute ms timestamp after which this entry is considered stale */
  expiresAt: number;
};

const POOL_TTL_MS = 60_000; // 60 seconds — well beyond any single turn

// Global map persisted for the lifetime of the server process
const poolStore = new Map<string, PoolEntry>();

/**
 * Store a prediction pool for the given interview.
 * Overwrites any existing pool.
 */
export function setPool(interviewId: string, pool: PredictionPool): void {
  poolStore.set(interviewId, {
    pool,
    expiresAt: Date.now() + POOL_TTL_MS,
  });
  console.log(
    `[POOL] Stored ${pool.questions.length} candidate question(s) for interview ${interviewId}`,
  );
}

/**
 * Retrieve the current prediction pool for an interview.
 * Returns null if no pool exists or it has expired.
 */
export function getPool(interviewId: string): PredictionPool | null {
  const entry = poolStore.get(interviewId);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    poolStore.delete(interviewId);
    console.log(`[POOL] Pool for interview ${interviewId} expired — removed`);
    return null;
  }

  return entry.pool;
}

/**
 * Delete the prediction pool for an interview.
 * Call after a pool-hit selection is used so stale questions are not
 * reused on the next turn.
 */
export function clearPool(interviewId: string): void {
  poolStore.delete(interviewId);
  console.log(`[POOL] Cleared pool for interview ${interviewId}`);
}
