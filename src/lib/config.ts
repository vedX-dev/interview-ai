/**
 * Environment configuration validation
 * Fails loudly if critical environment variables are missing
 */

const REQUIRED_ENV_VARS = [
  "GEMINI_API_KEY",
  "DATABASE_URL",
] as const;

type RequiredEnvVar = (typeof REQUIRED_ENV_VARS)[number];

const MISSING_ENV_VAR_ERROR = (varName: string) => `
❌ CRITICAL CONFIGURATION ERROR ❌

Required environment variable is missing: ${varName}

This application cannot function without this variable.

To fix this:
1. Copy .env.example to .env
2. Add ${varName}=your_value_here to .env
3. Restart the development server

For ${varName === "GEMINI_API_KEY" ? "Gemini API key" : "database connection"} help, see the README.
`;

export function validateEnvVars(): void {
  const missing: RequiredEnvVar[] = [];

  for (const varName of REQUIRED_ENV_VARS) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    const errorMessages = missing.map(MISSING_ENV_VAR_ERROR).join("\n");
    console.error(errorMessages);
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. Check console for details.`
    );
  }

  console.log("✅ All required environment variables are configured");
}

// Validate on import (will fail fast on startup)
if (typeof window === "undefined") {
  validateEnvVars();
}

export function getEnvVar(varName: RequiredEnvVar): string {
  const value = process.env[varName];
  if (!value) {
    throw new Error(`Environment variable ${varName} is not configured`);
  }
  return value;
}
