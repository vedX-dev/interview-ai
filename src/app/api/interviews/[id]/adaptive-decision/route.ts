import { GoogleGenAI } from "@google/genai";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { db } from "@/src/db/index";
import { interviews } from "@/src/db/schema";
import { 
  AdaptiveDecisionRequestSchema, 
  AdaptiveDecisionSchema 
} from "@/src/schemas/adaptive";
import "@/src/lib/config";

const SYSTEM_INSTRUCTION = `You are an adaptive technical interviewer conducting a 5-question interview.

Your role is to analyze the user's response and decide the next action.

Decision rules:
1. Max 2 follow-ups per planned question
2. Max 15 total turns per interview  
3. Acknowledge off-topic inputs briefly, then redirect to current question
4. Move to next question when answer is complete or follow-up limit reached

When to ask a follow-up:
- User provides a partial or unclear answer that needs clarification
- User mentions a relevant skill/experience that warrants deeper exploration
- User's answer is technically correct but lacks depth
- User's answer reveals a gap that should be probed further

When to move to next question:
- User provides a complete, well-structured answer
- User has already had 2 follow-ups on current question
- User's answer is off-topic and redirection has been attempted once
- User indicates they want to move on

When to acknowledge and redirect:
- Small talk (e.g., "this is going great")
- Language switching (e.g., Hindi statements)
- Personal statements unrelated to question (e.g., "my name is Vedant")

Return structured decision with reasoning.`;

const JSON_OUTPUT_SHAPE = `{
  "action": "follow_up" | "next_question" | "acknowledge_redirect",
  "followUpText": "string (only for follow_up action)",
  "reasoning": "string (why this decision was made)",
  "shouldContinue": "boolean (for acknowledge_redirect - whether to continue with current question)"
}`;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const interviewId = params.id;

    // Verify user owns this interview
    const [interview] = await db
      .select({ 
        id: interviews.id,
        geminiCallsCount: interviews.geminiCallsCount,
        totalTurns: interviews.totalTurns,
        adaptiveDecisionsCount: interviews.adaptiveDecisionsCount,
      })
      .from(interviews)
      .where(and(eq(interviews.id, interviewId), eq(interviews.userId, userId)))
      .limit(1);

    if (!interview) {
      return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    }

    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      console.error("❌ CRITICAL: GEMINI_API_KEY is missing from environment variables");
      // Fallback: return next_question action
      return NextResponse.json({
        action: "next_question",
        reasoning: "Gemini API not configured, using fallback",
      });
    }

    const body = AdaptiveDecisionRequestSchema.parse(await req.json());

    // Safety check: if we've hit limits, force next question
    if (body.followUpCount >= 2) {
      return NextResponse.json({
        action: "next_question",
        reasoning: "Follow-up limit reached (2 per question)",
      });
    }

    if (body.totalTurns >= 15) {
      return NextResponse.json({
        action: "next_question",
        reasoning: "Total turn limit reached (15 per interview)",
      });
    }

    // Update tracking counters
    await db
      .update(interviews)
      .set({
        geminiCallsCount: (interview.geminiCallsCount || 0) + 1,
        totalTurns: body.totalTurns,
        adaptiveDecisionsCount: (interview.adaptiveDecisionsCount || 0) + 1,
      })
      .where(eq(interviews.id, interviewId));

    const ai = new GoogleGenAI({ apiKey: geminiApiKey });

    const context = `
Current Interview State:
- Question ${body.currentQuestionIndex + 1} of 5: ${body.currentQuestion}
- Follow-up count for this question: ${body.followUpCount}/2
- Total turns so far: ${body.totalTurns}/15
- Remaining questions: ${body.remainingQuestions.length}

User's Response:
${body.userResponse}

Analyze this response and decide the next action using the rules provided.`;

    const geminiResult = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: `${context}\n\nReturn JSON with exactly this shape:\n${JSON_OUTPUT_SHAPE}`,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
      },
    });

    const rawJson = geminiResult.text;
    if (!rawJson) {
      console.warn("AI returned empty response, using fallback");
      return NextResponse.json({
        action: "next_question",
        reasoning: "AI returned empty response, using fallback",
      });
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawJson);
    } catch {
      console.warn("AI returned invalid JSON, using fallback");
      return NextResponse.json({
        action: "next_question",
        reasoning: "AI returned invalid JSON, using fallback",
      });
    }

    const decision = AdaptiveDecisionSchema.parse(parsedJson);

    // Post-processing validation
    if (decision.action === "follow_up" && body.followUpCount >= 2) {
      return NextResponse.json({
        action: "next_question",
        reasoning: "Follow-up limit reached, overriding AI decision",
      });
    }

    if (decision.action === "follow_up" && body.totalTurns >= 15) {
      return NextResponse.json({
        action: "next_question",
        reasoning: "Total turn limit reached, overriding AI decision",
      });
    }

    return NextResponse.json(decision);
  } catch (error) {
    console.error("🔥 Adaptive decision error:", error);

    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Invalid adaptive decision payload",
          details: error.flatten(),
        },
        { status: 422 },
      );
    }

    // Fallback: always return next_question on error
    return NextResponse.json({
      action: "next_question",
      reasoning: "Error in adaptive decision engine, using fallback",
    });
  }
}
