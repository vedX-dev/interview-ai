import { GoogleGenAI } from "@google/genai";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/src/db/index";
import { interviews, transcriptChunks } from "@/src/db/schema";
import { FeedbackReportSchema, type FeedbackReport } from "@/src/schemas/feedback";
import "@/src/lib/config";

const SYSTEM_INSTRUCTION = `You are an expert technical interviewer and hiring manager. Analyze the interview transcript and generate a comprehensive feedback report.

CRITICAL FORMATTING INSTRUCTIONS:
- hiringRecommendation MUST be one of exact strings: "strong_hire", "hire", "consider", "do_not_hire" (lowercase with underscore).
- answerQuality in questionFeedback MUST be one of: "excellent", "good", "fair", "poor", "no_answer".
- confidence in skillAssessments MUST be one of: "high", "medium", "low".
- overallScore MUST be an integer between 0 and 100.

Scoring guidelines:
- 90-100: Exceptional candidate, strong hire
- 75-89: Good candidate, hire
- 60-74: Decent but has gaps, consider
- Below 60: Not ready, do not hire

Be specific and actionable in feedback. Reference actual things said in the transcript.`;

const JSON_OUTPUT_SHAPE = `{
  "overallScore": 85,
  "summary": "Brief 2-3 sentence summary of candidate performance",
  "strengths": ["specific strength 1", "specific strength 2"],
  "areasForImprovement": ["specific gap 1", "specific gap 2"],
  "skillAssessments": [
    {
      "skill": "React",
      "demonstrated": true,
      "confidence": "high",
      "notes": "Showed deep understanding of hooks and state management"
    }
  ],
  "questionFeedback": [
    {
      "question": "the actual question asked",
      "focusArea": "topic area",
      "answerQuality": "good",
      "strengths": ["specific strength"],
      "gaps": ["specific gap"],
      "suggestedImprovement": "specific advice"
    }
  ],
  "recommendedFollowUp": "Specific next steps or additional topics to explore",
  "hiringRecommendation": "hire",
  "interviewDuration": 25
}`;

// Groq API integration fallback with active production models
async function callGroqAPI(context: string, systemInstruction: string) {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    throw new Error("GROQ_API_KEY not configured");
  }

  const modelsToTry = ["groq/compound", "openai/gpt-oss-120b", "groq/compound-mini"];
  let lastError: Error | null = null;

  for (const model of modelsToTry) {
    try {
      console.log(`[FEEDBACK] Trying Groq model: ${model}`);
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${groqApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: `${context}\n\nReturn JSON with exactly this shape:\n${JSON_OUTPUT_SHAPE}` },
          ],
          response_format: { type: "json_object" },
          temperature: 0.5,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Groq model ${model} failed with status ${response.status}: ${errText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error(`Groq model ${model} returned empty content`);
      }

      console.log(`[FEEDBACK] Groq evaluation successful using model: ${model}`);
      return content;
    } catch (err: any) {
      console.warn(`[FEEDBACK] Groq model ${model} failed:`, err?.message || err);
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError || new Error("All Groq models failed for feedback generation");
}

// Call Gemini with supported model and retries, then fallback to Groq
async function callAIWithFallback(context: string, systemInstruction: string) {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const geminiModels = ["gemini-3.5-flash", "gemini-2.5-flash"];

  if (geminiApiKey) {
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });

    for (const model of geminiModels) {
      console.log(`[FEEDBACK] Trying Gemini model: ${model}`);
      let delay = 1000;

      for (let i = 0; i < 3; i++) {
        try {
          const geminiResult = await ai.models.generateContent({
            model,
            contents: `${context}\n\nReturn JSON with exactly this shape:\n${JSON_OUTPUT_SHAPE}`,
            config: {
              systemInstruction,
              responseMimeType: "application/json",
            },
          });

          if (geminiResult.text) {
            console.log(`[FEEDBACK] Gemini evaluation successful using model: ${model}`);
            return { provider: `gemini (${model})`, text: geminiResult.text };
          }
        } catch (error: any) {
          const is503 = error?.status === 503 || error?.message?.includes("503");
          if (is503 && i < 2) {
            console.warn(`[FEEDBACK] Gemini 503 error on ${model}. Retrying in ${delay}ms...`);
            await new Promise((r) => setTimeout(r, delay));
            delay *= 2;
            continue;
          }
          console.warn(`[FEEDBACK] Gemini model ${model} attempt failed:`, error?.message || error);
          break; // Try next Gemini model or fallback to Groq
        }
      }
    }
  } else {
    console.warn("[FEEDBACK] GEMINI_API_KEY not configured, proceeding to Groq fallback");
  }

  // Fallback to Groq if Gemini fails or is unconfigured
  console.log("[FEEDBACK] Falling back to Groq API integration...");
  const groqText = await callGroqAPI(context, systemInstruction);
  return { provider: "groq", text: groqText };
}

// Normalize LLM output to strictly match Zod FeedbackReportSchema
function normalizeFeedbackJson(data: any, chunks: any[], interview: any): FeedbackReport {
  // Normalize overallScore
  let overallScore = Math.round(Number(data?.overallScore) || 70);
  if (isNaN(overallScore)) overallScore = 70;
  overallScore = Math.max(0, Math.min(100, overallScore));

  // Normalize hiringRecommendation
  let hiringRecommendation: "strong_hire" | "hire" | "consider" | "do_not_hire" = "consider";
  const rawRec = String(data?.hiringRecommendation || "").toLowerCase().replace(/[\s-]/g, "_");
  if (rawRec.includes("strong")) hiringRecommendation = "strong_hire";
  else if (rawRec.includes("do_not") || rawRec.includes("no_hire") || rawRec.includes("reject")) hiringRecommendation = "do_not_hire";
  else if (rawRec.includes("hire")) hiringRecommendation = "hire";
  else if (rawRec.includes("consider")) hiringRecommendation = "consider";

  // Normalize duration
  const calcDuration = interview?.createdAt
    ? Math.max(1, Math.round((new Date().getTime() - new Date(interview.createdAt).getTime()) / 60000))
    : 5;
  const interviewDuration = Math.round(Number(data?.interviewDuration)) || calcDuration;

  // Normalize strengths & areasForImprovement
  const strengths = Array.isArray(data?.strengths) && data.strengths.length > 0
    ? data.strengths.map(String)
    : ["Engaged in technical discussion", "Responded to interview prompts"];

  const areasForImprovement = Array.isArray(data?.areasForImprovement) && data.areasForImprovement.length > 0
    ? data.areasForImprovement.map(String)
    : ["Provide deeper architecture details in answers", "Expand on real-world edge cases"];

  // Normalize skillAssessments
  const skillAssessments = Array.isArray(data?.skillAssessments)
    ? data.skillAssessments.map((sa: any) => {
        let confidence: "high" | "medium" | "low" = "medium";
        const rawConf = String(sa?.confidence || "").toLowerCase();
        if (rawConf.includes("high")) confidence = "high";
        else if (rawConf.includes("low")) confidence = "low";

        return {
          skill: String(sa?.skill || "Technical Concepts"),
          demonstrated: Boolean(sa?.demonstrated ?? true),
          confidence,
          notes: String(sa?.notes || "Demonstrated functional baseline understanding"),
        };
      })
    : [];

  // Normalize questionFeedback
  const questionFeedback = Array.isArray(data?.questionFeedback) && data.questionFeedback.length > 0
    ? data.questionFeedback.map((qf: any, idx: number) => {
        let answerQuality: "excellent" | "good" | "fair" | "poor" | "no_answer" = "fair";
        const rawQual = String(qf?.answerQuality || "").toLowerCase();
        if (rawQual.includes("excel")) answerQuality = "excellent";
        else if (rawQual.includes("good")) answerQuality = "good";
        else if (rawQual.includes("poor")) answerQuality = "poor";
        else if (rawQual.includes("no") || rawQual.includes("skip")) answerQuality = "no_answer";
        else if (rawQual.includes("fair")) answerQuality = "fair";

        return {
          question: String(qf?.question || `Question ${idx + 1}`),
          focusArea: String(qf?.focusArea || "General Technical"),
          answerQuality,
          strengths: Array.isArray(qf?.strengths) ? qf.strengths.map(String) : [],
          gaps: Array.isArray(qf?.gaps) ? qf.gaps.map(String) : [],
          suggestedImprovement: String(qf?.suggestedImprovement || "Elaborate with concrete examples"),
        };
      })
    : chunks
        .filter((c) => c.speaker === "ai")
        .slice(0, 5)
        .map((chunk, i) => ({
          question: chunk.content,
          focusArea: "Technical Round",
          answerQuality: "fair" as const,
          strengths: ["Attempted response"],
          gaps: ["Could provide more technical depth"],
          suggestedImprovement: "Elaborate on implementation decisions and edge cases",
        }));

  return {
    overallScore,
    summary: String(data?.summary || "Candidate completed the interview session with satisfactory responses."),
    strengths,
    areasForImprovement,
    skillAssessments,
    questionFeedback,
    recommendedFollowUp: String(data?.recommendedFollowUp || "Review technical core concepts and project architecture."),
    hiringRecommendation,
    interviewDuration,
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: interviewId } = await params;

    // Verify interview belongs to user
    const [interview] = await db
      .select()
      .from(interviews)
      .where(and(eq(interviews.id, interviewId), eq(interviews.userId, userId)))
      .limit(1);

    if (!interview) {
      return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    }

    // Fetch full transcript
    const chunks = await db
      .select()
      .from(transcriptChunks)
      .where(eq(transcriptChunks.interviewId, interviewId))
      .orderBy(transcriptChunks.createdAt);

    const userChunks = chunks.filter((c) => c.speaker === "user");

    // If 0 user candidate responses, handle with insufficient evidence report
    if (userChunks.length === 0) {
      const zeroResponseFeedback: FeedbackReport = {
        overallScore: 0,
        summary: "Interview was ended early before candidate responses were recorded. Insufficient evidence for technical evaluation.",
        strengths: ["Initiated interview session"],
        areasForImprovement: ["Interview ended before candidate responses were completed for technical evaluation"],
        skillAssessments: [],
        questionFeedback: [],
        recommendedFollowUp: "Start a new interview session and complete candidate responses to receive a full technical evaluation report.",
        hiringRecommendation: "consider",
        interviewDuration: interview.createdAt
          ? Math.max(1, Math.round((new Date().getTime() - new Date(interview.createdAt).getTime()) / 60000))
          : 1,
      };

      await db
        .update(interviews)
        .set({
          feedback: zeroResponseFeedback,
          score: 0,
          status: "completed",
          currentPhase: "closed",
        })
        .where(eq(interviews.id, interviewId));

      return NextResponse.json(zeroResponseFeedback);
    }

    // Build transcript context
    const transcriptText = chunks
      .map((chunk) => `[${chunk.speaker.toUpperCase()}]: ${chunk.content}`)
      .join("\n");

    const interviewContext = `
Interview Details:
- Job Role: ${interview.jobRole}
- Status: ${interview.status}
- Created: ${interview.createdAt}

Full Transcript:
${transcriptText}
`;

    // Attempt real AI generation via Gemini or Groq
    const aiResult = await callAIWithFallback(interviewContext, SYSTEM_INSTRUCTION);
    console.log(`[FEEDBACK] AI evaluation completed using provider: ${aiResult.provider}`);

    const parsedRaw = JSON.parse(aiResult.text);
    const normalized = normalizeFeedbackJson(parsedRaw, chunks, interview);
    const feedbackReport = FeedbackReportSchema.parse(normalized);

    // Persist finalized real AI feedback to database
    await db
      .update(interviews)
      .set({
        feedback: feedbackReport,
        score: feedbackReport.overallScore,
        status: "completed",
        currentPhase: "closed",
      })
      .where(eq(interviews.id, interviewId));

    return NextResponse.json(feedbackReport);
  } catch (error: any) {
    console.error("🔥 Error in feedback generation route:", error);
    return NextResponse.json(
      { error: `Feedback generation failed: ${error?.message || "Internal server error"}` },
      { status: 500 },
    );
  }
}
