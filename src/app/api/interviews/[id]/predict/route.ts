/**
 * POST /api/interviews/[id]/predict
 *
 * Prediction Worker endpoint — called fire-and-forget from the browser
 * while the candidate is still speaking (every ~3 seconds of interim STT).
 *
 * Uses Groq (fast, cheap) to pre-generate 2-3 candidate next-questions
 * and stores them in Upstash Redis under interview:{id}:pool.
 *
 * The orchestrator reads this pool after the candidate finishes speaking
 * and can select a prepared question, skipping a full LLM generation.
 *
 * Design constraints (from README):
 * - Keep the browser responsible for real-time capture/rendering
 * - Move prediction, caching, and pooling into the existing backend
 * - Optimize latency through parallelism and pre-generation, not CORS changes
 */

import { auth } from "@clerk/nextjs/server";
import { eq, and } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/src/db/index";
import { interviews } from "@/src/db/schema";
import { PredictRequestSchema } from "@/src/schemas/prediction";
import type { PredictionPool, CandidateQuestion, PredictRequest } from "@/src/schemas/prediction";
import { setPool } from "@/src/lib/pool";

// Groq model for prediction: fastest available production model
const GROQ_PREDICT_MODEL = "openai/gpt-oss-20b";

const PREDICT_SYSTEM_INSTRUCTION = `You are a technical interview prediction engine. Based on the partial answer a candidate is giving right now (their speech is not yet complete), generate 2-3 likely follow-up questions the interviewer might ask.

Rules:
- Generate exactly 2-3 questions
- Each question should be a natural follow-up to what the candidate is discussing
- Match the technical depth to what the candidate has shown so far  
- Use type "follow-up" for direct follow-ups, "probe" for deeper technical probes, "scenario" for hypothetical scenarios
- Assign confidence 0.0-1.0 (how likely this question fits based on the partial answer)
- Keep questions concise and natural-sounding (as a real interviewer would ask)
- Only generate technical/rapport questions appropriate to the current phase`;

const PREDICT_JSON_SHAPE = `{
  "questions": [
    {
      "text": "the question text",
      "type": "follow-up" | "probe" | "scenario",
      "confidence": 0.85,
      "topic": "topic name (e.g. React, System Design, etc.)"
    }
  ]
}`;

async function callGroqPredict(
  interimTranscript: string,
  phase: string,
  resumeData: PredictRequest["resumeData"],
  recentTranscript: Array<{ speaker: string; content: string }>,
): Promise<CandidateQuestion[]> {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    throw new Error("GROQ_API_KEY not configured");
  }

  // Build a focused context — only the last 4 turns to keep it fast
  const recentContext = recentTranscript
    .slice(-4)
    .map((t) => `[${t.speaker.toUpperCase()}]: ${t.content}`)
    .join("\n");

  const resumeContext = resumeData
    ? `Candidate: ${resumeData.fullName}, ${resumeData.yearsOfExperience} yrs exp, Skills: ${resumeData.topSkills.join(", ")}`
    : "";

  const userMessage = [
    `Current phase: ${phase}`,
    resumeContext,
    recentContext ? `Recent conversation:\n${recentContext}` : "",
    `\nCandidate is currently saying (partial, not finished):\n"${interimTranscript}"`,
    `\nGenerate candidate next questions with exactly this JSON shape:\n${PREDICT_JSON_SHAPE}`,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_PREDICT_MODEL,
        messages: [
          { role: "system", content: PREDICT_SYSTEM_INSTRUCTION },
          { role: "user", content: userMessage },
        ],
        response_format: { type: "json_object" },
        temperature: 0.6,
        max_tokens: 512,
      }),
    },
  );

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(
      `Groq predict failed (${response.status}): ${errText}`,
    );
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Groq predict returned empty content");
  }

  const parsed = JSON.parse(content);
  const questions = parsed.questions;

  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("Groq predict returned no questions");
  }

  // Validate and clamp each question
  return questions.slice(0, 3).map((q: CandidateQuestion) => ({
    text: String(q.text || "").trim(),
    type: (["follow-up", "probe", "scenario"] as const).includes(q.type)
      ? q.type
      : "follow-up",
    confidence: Math.min(1, Math.max(0, Number(q.confidence) || 0.5)),
    topic: String(q.topic || "General").trim(),
  }));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const tStart = performance.now();

  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: interviewId } = await params;

    // Verify interview exists and belongs to user (lightweight check)
    const [interview] = await db
      .select({ id: interviews.id, status: interviews.status })
      .from(interviews)
      .where(and(eq(interviews.id, interviewId), eq(interviews.userId, userId)))
      .limit(1);

    if (!interview || interview.status !== "ongoing") {
      // Silently ignore if interview is done or not found — this is fire-and-forget
      return NextResponse.json({ ok: false, reason: "interview not active" });
    }

    const body = PredictRequestSchema.parse(await req.json());

    // Skip prediction for short interim transcripts — not enough signal yet
    if (body.interimTranscript.trim().length < 15) {
      return NextResponse.json({ ok: false, reason: "interim too short" });
    }

    // Skip prediction for non-technical phases where pool is not useful
    if (body.phase === "greeting" || body.phase === "closed") {
      return NextResponse.json({ ok: false, reason: "phase does not use pool" });
    }

    console.log(
      `[PREDICT] Generating question pool for interview ${interviewId} (phase: ${body.phase})`,
    );

    const questions = await callGroqPredict(
      body.interimTranscript,
      body.phase,
      body.resumeData,
      body.recentTranscript,
    );

    const pool: PredictionPool = {
      questions,
      generatedAt: Date.now(),
      interimText: body.interimTranscript,
      phase: body.phase,
      turnId: body.turnId,
      predictionVersion: body.predictionVersion,
    };

    await setPool(interviewId, pool);

    const elapsed = (performance.now() - tStart).toFixed(1);
    console.log(
      `[PREDICT] Pool stored: ${questions.length} question(s) in ${elapsed}ms (turnId=${body.turnId}, v=${body.predictionVersion})`,
    );

    return NextResponse.json({ ok: true, count: questions.length });
  } catch (error) {
    // Prediction failures are non-fatal — the orchestrator falls back to Gemini
    const elapsed = (performance.now() - tStart).toFixed(1);
    if (error instanceof ZodError) {
      console.warn(`[PREDICT] Validation error in ${elapsed}ms:`, error.flatten());
      return NextResponse.json({ ok: false, reason: "validation error" });
    }
    console.warn(`[PREDICT] Failed in ${elapsed}ms:`, error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, reason: "prediction failed" });
  }
}
