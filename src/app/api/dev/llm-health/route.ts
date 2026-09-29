import { NextRequest, NextResponse } from "next/server";
import { LIVE_TURN_MODELS, HEAVY_TASK_MODELS, PROVIDERS } from "@/src/lib/llm/config";
import { isOpen } from "@/src/lib/llm/circuit-breaker";
import { generate } from "@/src/lib/llm/index";
import "@/src/lib/config";

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Dev-only endpoint" }, { status: 403 });
  }

  const disabledStr = process.env.LLM_DISABLE_PROVIDERS || "";
  const disabledSet = new Set(disabledStr.toLowerCase().split(",").map((s) => s.trim()).filter(Boolean));

  // 1. Check Gemini endpoint
  let geminiVerification: any = { status: "not_checked" };
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`);
      if (resp.ok) {
        const data = await resp.json();
        const availableGeminiModels = (data.models || [])
          .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
          .map((m: any) => m.name.replace("models/", ""));
        geminiVerification = { status: "ok", availableModels: availableGeminiModels };
      } else {
        const errText = await resp.text();
        geminiVerification = { status: "error", code: resp.status, detail: errText };
      }
    } catch (e: any) {
      geminiVerification = { status: "error", detail: e.message };
    }
  } else {
    geminiVerification = { status: "unconfigured", reason: "GEMINI_API_KEY is missing in env" };
  }

  // 2. Ping each configured model
  const allModels = [...LIVE_TURN_MODELS, ...HEAVY_TASK_MODELS];
  const modelMap = new Map<string, typeof allModels[0]>();
  for (const m of allModels) {
    modelMap.set(`${m.provider}:${m.id}`, m);
  }

  const results: Array<{
    provider: string;
    model: string;
    configured: boolean;
    disabledByEnv: boolean;
    circuitOpen: boolean;
    status: "ok" | "error" | "disabled" | "unconfigured";
    latencyMs: number;
    error?: string;
  }> = [];

  for (const m of Array.from(modelMap.values())) {
    const provConfig = PROVIDERS[m.provider];
    const key = provConfig ? process.env[provConfig.envKey] : undefined;
    const isConfigured = !!key;
    const isDisabled = disabledSet.has(m.provider);
    const cbOpen = isOpen(m.provider, m.id);

    if (!isConfigured) {
      results.push({
        provider: m.provider,
        model: m.id,
        configured: false,
        disabledByEnv: isDisabled,
        circuitOpen: cbOpen,
        status: "unconfigured",
        latencyMs: 0,
        error: `${provConfig?.envKey ?? "API_KEY"} missing`,
      });
      continue;
    }

    if (isDisabled) {
      results.push({
        provider: m.provider,
        model: m.id,
        configured: true,
        disabledByEnv: true,
        circuitOpen: cbOpen,
        status: "disabled",
        latencyMs: 0,
        error: `Disabled by LLM_DISABLE_PROVIDERS`,
      });
      continue;
    }

    // Ping model
    const start = Date.now();
    try {
      const res = await generate({
        task: "live",
        system: "You are a health check assistant. Respond with 'OK' only.",
        prompt: "Say OK",
      });
      const latencyMs = Date.now() - start;
      results.push({
        provider: res.provider,
        model: res.model,
        configured: true,
        disabledByEnv: false,
        circuitOpen: cbOpen,
        status: "ok",
        latencyMs,
      });
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      results.push({
        provider: m.provider,
        model: m.id,
        configured: true,
        disabledByEnv: false,
        circuitOpen: cbOpen,
        status: "error",
        latencyMs,
        error: err.message,
      });
    }
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    disabledProviders: Array.from(disabledSet),
    geminiVerification,
    results,
  });
}
