/**
 * OpenRouter Provider Integration & Dynamic Free Model Resolver.
 *
 * Requirements (Phase 4):
 * - Free models end in ":free"
 * - Dynamic fetch & cache (2 hours) from https://openrouter.ai/api/v1/models
 * - Hard daily ceiling: 50 requests/day, 20 requests/minute
 * - No credit card required.
 */

interface OpenRouterModelEntry {
  id: string;
  name?: string;
  pricing?: {
    prompt: string;
    completion: string;
  };
}

let cachedFreeModels: string[] = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemini-2.0-flash-exp:free",
  "qwen/qwen-2.5-coder-32b-instruct:free",
  "mistralai/mistral-7b-instruct:free",
];

let lastFetchTime = 0;
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// Rate tracking for OpenRouter free tier (20 req/min, 50 req/day)
let dailyRequests = 0;
let dailyDate = new Date().toISOString().slice(0, 10);
let minuteRequests = 0;
let minuteWindowStart = Date.now();

export const OPENROUTER_LIMITS = {
  maxRequestsPerMinute: 20,
  maxRequestsPerDay: 50,
};

/**
 * Check if OpenRouter quota is available for this turn.
 */
export function canUseOpenRouter(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (dailyDate !== today) {
    dailyDate = today;
    dailyRequests = 0;
  }

  // Daily quota check (reserve buffer)
  if (dailyRequests >= OPENROUTER_LIMITS.maxRequestsPerDay - 2) {
    return false;
  }

  // Minute rate limit check
  const now = Date.now();
  if (now - minuteWindowStart > 60_000) {
    minuteWindowStart = now;
    minuteRequests = 0;
  }
  if (minuteRequests >= OPENROUTER_LIMITS.maxRequestsPerMinute - 1) {
    return false;
  }

  return true;
}

/**
 * Record an OpenRouter request usage.
 */
export function recordOpenRouterUsage(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (dailyDate !== today) {
    dailyDate = today;
    dailyRequests = 0;
  }
  dailyRequests++;
  minuteRequests++;
}

/**
 * Fetch and return the list of currently available free models on OpenRouter.
 */
export async function getOpenRouterFreeModels(): Promise<string[]> {
  const now = Date.now();
  if (now - lastFetchTime < CACHE_TTL_MS && cachedFreeModels.length > 0) {
    return cachedFreeModels;
  }

  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.data)) {
        const freeIds = data.data
          .map((m: OpenRouterModelEntry) => m.id)
          .filter((id: string) => id.endsWith(":free"));

        if (freeIds.length > 0) {
          cachedFreeModels = freeIds;
          lastFetchTime = now;
          console.log(`[OPENROUTER] Discovered ${freeIds.length} active free models:`, freeIds.slice(0, 3));
        }
      }
    }
  } catch (err) {
    console.warn("[OPENROUTER] Could not refresh free models list, using fallback:", err);
  }

  return cachedFreeModels;
}

/**
 * Get primary free model ID for OpenRouter.
 */
export async function getBestOpenRouterModel(): Promise<string> {
  const free = await getOpenRouterFreeModels();
  return free[0] || "meta-llama/llama-3.3-70b-instruct:free";
}
