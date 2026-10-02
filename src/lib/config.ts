/**
 * Environment configuration validation.
 * Only DATABASE_URL is hard-required (without it nothing works).
 * LLM providers are optional — routes use the shared LLM layer which
 * skips any provider whose env key is absent.
 *
 * Model IDs and provider configs live in src/lib/llm/config.ts.
 */

const HARD_REQUIRED = ["DATABASE_URL"] as const;

if (typeof window === "undefined") {
  for (const varName of HARD_REQUIRED) {
    if (!process.env[varName]) {
      console.error(
        `❌ CRITICAL: Required environment variable ${varName} is missing. ` +
          `Copy .env.example to .env.local and fill in the value.`,
      );
      // Don't throw — let individual routes surface errors with context.
    }
  }

  // Soft warnings for optional providers
  const optional: Record<string, string> = {
    GEMINI_API_KEY: "Gemini LLM + embeddings",
    GROQ_API_KEY: "Groq LLM (fast fallback)",
    SARVAM_API_KEY: "Sarvam TTS",
    LOG_SALT: "Audit log IP hashing salt (fallback salt will be used)",
    ADMIN_USER_IDS: "Admin dashboard access (Clerk user IDs)",
    ADMIN_ALLOWED_IPS: "Admin dashboard IP allowlist (network restriction)",
  };

  for (const [key, desc] of Object.entries(optional)) {
    if (!process.env[key]) {
      console.warn(`⚠️  ${key} not set — ${desc} will be unavailable.`);
    }
  }
}

export function getRequiredEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Environment variable ${name} is not configured`);
  return val;
}
