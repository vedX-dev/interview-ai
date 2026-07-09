import { GoogleGenAI } from "@google/genai";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { db } from "@/src/db/index";
import { interviews, transcriptChunks } from "@/src/db/schema";
import { 
  OrchestratorRequestSchema, 
  OrchestratorDecisionSchema,
  type OrchestratorRequest 
} from "@/src/schemas/orchestrator";
import "@/src/lib/config";

// Groq API integration
async function callGroqAPI(context: string, systemInstruction: string) {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    throw new Error("GROQ_API_KEY not configured");
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${groqApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: systemInstruction,
        },
        {
          role: "user",
          content: `${context}\n\nReturn JSON with exactly this shape:\n${JSON_OUTPUT_SHAPE}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    throw new Error(`Groq API failed: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

const DEBUG = true; // Set to false in production

function debugLog(...args: any[]) {
  if (DEBUG) {
    console.log("[ORCHESTRATOR DEBUG]", ...args);
  }
}

// Phase-specific system instructions
const PHASE_INSTRUCTIONS = {
  greeting: `You are opening a technical interview. Be warm and professional.
- Greet the candidate naturally (e.g., "Hi, good evening — thanks for joining. Ready to get started?")
- Do NOT ask technical questions in this phase
- Keep it brief and welcoming
- Set the stage for the conversation
- After greeting, signal readiness to move to rapport phase`,

  rapport: `You are building rapport before technical questions.
- Ask 1-2 open questions to get to know the candidate
- Examples: "Tell me a bit about yourself", "What have you been working on recently?"
- Keep answers in context for later technical questions
- Be conversational and friendly
- CRITICAL: After the candidate has answered 1-2 rapport questions, set phaseComplete: true to move to technical phase
- CRITICAL: Do NOT repeat the same question multiple times. If the candidate has already answered, acknowledge their response and move to a different topic or advance to technical phase.`,

  technical: `You are conducting the technical interview phase.
- Ask technical questions based on candidate's skills and job role
- Max 2 follow-ups per question to probe deeper
- For non-answers ("no no no"), acknowledge briefly then redirect to current question
- For small talk, acknowledge briefly then redirect to current question
- For language switches, acknowledge and request English response
- Move to wrapup after 5 technical questions (anchor structure)`,

  wrapup: `You are wrapping up the interview.
- Ask if candidate has questions for you
- Thank them for their time
- Signal the interview is ending
- Be professional and courteous
- After this, move to closed phase`,

  closed: `The interview is complete. No further utterances needed.`,
};

const JSON_OUTPUT_SHAPE = `{
  "phase": "greeting" | "rapport" | "technical" | "wrapup" | "closed",
  "aiUtterance": "what the AI should say next",
  "phaseComplete": boolean (whether to advance to next phase),
  "reasoning": "why this decision was made (optional)"
}`;

// Helper function for handling temporary API failures with exponential backoff and fallback
async function callAIWithFallback(context: string, systemInstruction: string) {
  let aiProvider = "gemini";
  
  try {
    // Try Gemini first with retry
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      throw new Error("GEMINI_API_KEY not configured");
    }

    const ai = new GoogleGenAI({ apiKey: geminiApiKey });
    
    let delay = 1000;
    for (let i = 0; i < 3; i++) {
      try {
        const geminiResult = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: `${context}\n\nReturn JSON with exactly this shape:\n${JSON_OUTPUT_SHAPE}`,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
          },
        });
        return { provider: "gemini", text: geminiResult.text };
      } catch (error: any) {
        const is503 = error?.status === 503 || error?.message?.includes("503");
        const isLastRetry = i === 2;
        
        if (is503 && !isLastRetry) {
          console.warn(`Gemini 503 error. Retrying in ${delay}ms... (Attempt ${i + 1}/3)`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2;
          continue;
        }
        throw error;
      }
    }
  } catch (error: any) {
    console.warn("Gemini failed, falling back to Groq:", error.message);
    aiProvider = "groq";
    
    try {
      const groqText = await callGroqAPI(context, systemInstruction);
      return { provider: "groq", text: groqText };
    } catch (groqError: any) {
      console.error("Groq also failed:", groqError.message);
      throw new Error("All AI providers failed");
    }
  }
  
  return { provider: aiProvider, text: "" };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: interviewId } = await params;

    // Verify user owns this interview
    const [interview] = await db
      .select({ 
        id: interviews.id,
        currentPhase: interviews.currentPhase,
        geminiCallsCount: interviews.geminiCallsCount,
        totalTurns: interviews.totalTurns,
        adaptiveDecisionsCount: interviews.adaptiveDecisionsCount,
        userId: interviews.userId,
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
      // Fallback: return safe default for current phase
      return NextResponse.json({
        phase: interview.currentPhase || "greeting",
        aiUtterance: getFallbackUtterance(interview.currentPhase || "greeting"),
        phaseComplete: false,
        reasoning: "Gemini API not configured, using fallback",
      });
    }

    const body = OrchestratorRequestSchema.parse(await req.json());

    debugLog("Request payload:", JSON.stringify(body, null, 2));

    // Safety checks
    if (body.totalTurns >= 20) {
      debugLog("Total turn limit reached (20), forcing wrapup");
      return NextResponse.json({
        phase: "wrapup",
        aiUtterance: "We've covered a lot of ground. Do you have any questions for me?",
        phaseComplete: false,
        reasoning: "Turn limit reached, moving to wrapup",
      });
    }

    // Update tracking counters
    await db
      .update(interviews)
      .set({
        geminiCallsCount: (interview.geminiCallsCount || 0) + 1,
        totalTurns: body.totalTurns,
        adaptiveDecisionsCount: (interview.adaptiveDecisionsCount || 0) + 1,
        currentPhase: body.currentPhase,
      })
      .where(eq(interviews.id, interviewId));

    // Build context based on phase
    const context = buildContext(body, interview.currentPhase || "greeting");
    debugLog("Context:", context);

    const systemInstruction = PHASE_INSTRUCTIONS[body.currentPhase as keyof typeof PHASE_INSTRUCTIONS];

    const aiResult = await callAIWithFallback(context, systemInstruction);
    console.log(`[ORCHESTRATOR] Using AI provider: ${aiResult.provider}`);

    const rawJson = aiResult.text;
    debugLog("Raw AI response:", rawJson);

    if (!rawJson) {
      console.warn("AI returned empty response, using fallback");
      return NextResponse.json({
        phase: body.currentPhase,
        aiUtterance: getFallbackUtterance(body.currentPhase),
        phaseComplete: false,
        reasoning: "AI returned empty response, using fallback",
      });
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawJson);
      debugLog("Parsed JSON:", parsedJson);
    } catch (error) {
      console.warn("AI returned invalid JSON, using fallback:", error);
      return NextResponse.json({
        phase: body.currentPhase,
        aiUtterance: getFallbackUtterance(body.currentPhase),
        phaseComplete: false,
        reasoning: "AI returned invalid JSON, using fallback",
      });
    }

    const decision = OrchestratorDecisionSchema.parse(parsedJson);
    debugLog("Validated decision:", decision);

    // Update phase in database if changed
    if (decision.phase !== body.currentPhase) {
      await db
        .update(interviews)
        .set({ currentPhase: decision.phase })
        .where(eq(interviews.id, interviewId));
      debugLog("Phase updated from", body.currentPhase, "to", decision.phase);
    }

    // If phase is closed, trigger feedback generation
    if (decision.phase === "closed") {
      await db
        .update(interviews)
        .set({ status: "completed" })
        .where(eq(interviews.id, interviewId));
      debugLog("Interview marked as completed");
    }

    const response = NextResponse.json(decision);
    response.headers.set("X-AI-Provider", aiResult.provider);
    return response;
  } catch (error) {
    console.error("🔥 Orchestrator error:", error);

    if (error instanceof ZodError) {
      console.error("Zod validation error:", error.flatten());
      return NextResponse.json(
        {
          error: "Invalid orchestrator payload",
          details: error.flatten(),
        },
        { status: 422 },
      );
    }

    // Fallback: always return safe default on error
    return NextResponse.json({
      phase: "rapport",
      aiUtterance: "Could you tell me a bit about yourself?",
      phaseComplete: false,
      reasoning: "Error in orchestrator, using fallback",
    });
  }
}

function buildContext(body: OrchestratorRequest, currentPhase: string): string {
  const { transcript, resumeData, jobRole } = body;

  let context = `Current Phase: ${currentPhase}\n`;
  context += `Target Job Role: ${jobRole}\n`;
  context += `Total Turns So Far: ${body.totalTurns}\n\n`;

  if (resumeData) {
    context += `Candidate Profile:\n`;
    context += `- Name: ${resumeData.fullName}\n`;
    context += `- Experience: ${resumeData.yearsOfExperience} years\n`;
    context += `- Skills: ${resumeData.topSkills.join(", ")}\n`;
    context += `- Projects: ${resumeData.coreProjects.map((p: { title: string }) => p.title).join(", ")}\n\n`;
  }

  if (transcript.length > 0) {
    context += `Conversation So Far:\n`;
    transcript.forEach((entry: { speaker: string; content: string }, i: number) => {
      context += `${i + 1}. [${entry.speaker.toUpperCase()}]: ${entry.content}\n`;
    });
    context += "\n";
  } else {
    context += `No conversation yet (this is the first turn).\n\n`;
  }

  return context;
}

function getFallbackUtterance(phase: string): string {
  const fallbacks: Record<string, string> = {
    greeting: "Hi there, thanks for joining. Ready to get started?",
    rapport: "Tell me a bit about yourself.",
    technical: "Let's start with your technical background. What's your experience with your main programming language?",
    wrapup: "Do you have any questions for me?",
    closed: "Thank you for your time. The interview is complete.",
  };
  return fallbacks[phase] || fallbacks.rapport;
}
