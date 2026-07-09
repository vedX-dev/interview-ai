import { GoogleGenAI } from "@google/genai";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { db } from "@/src/db/index";
import { interviews, transcriptChunks } from "@/src/db/schema";
import { FeedbackReportSchema } from "@/src/schemas/feedback";
import "@/src/lib/config";

const SYSTEM_INSTRUCTION = `You are an expert technical interviewer and hiring manager. Analyze the interview transcript and generate a comprehensive feedback report.

Scoring guidelines:
- 90-100: Exceptional candidate, strong hire
- 75-89: Good candidate, hire
- 60-74: Decent but has gaps, consider
- Below 60: Not ready, do not hire

For each question, assess:
- Answer quality based on technical accuracy, depth, and communication
- Specific strengths in their response
- Knowledge gaps or areas they missed
- Concrete improvement suggestions
- Note if follow-ups were needed and whether the candidate improved with clarification

For skill assessments:
- Mark skills as demonstrated only if the candidate showed clear understanding
- Confidence levels based on depth of answers (high = deep understanding, medium = functional, low = surface-level)
- Consider whether follow-up questions revealed deeper understanding or exposed gaps

Adaptive interview context:
- This interview may include follow-up questions that probe deeper into topics
- Use the full conversation context to assess depth of understanding
- Note if candidate improved their answers with follow-up prompts or struggled with clarification
- Consider whether follow-ups revealed strengths that weren't apparent in initial answers

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

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const interviewId = params.id;

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

    if (chunks.length === 0) {
      return NextResponse.json(
        { error: "No transcript data available for analysis" },
        { status: 400 },
      );
    }

    // Build transcript context
    const transcript = chunks
      .map((chunk) => `[${chunk.speaker.toUpperCase()}]: ${chunk.content}`)
      .join("\n");

    const interviewContext = `
Interview Details:
- Job Role: ${interview.jobRole}
- Status: ${interview.status}
- Created: ${interview.createdAt}

Full Transcript:
${transcript}
`;

    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      console.error(
        "❌ CRITICAL: GEMINI_API_KEY is missing from environment variables",
      );
      return NextResponse.json(
        { error: "GEMINI_API_KEY is missing from environment variables" },
        { status: 500 },
      );
    }

    const ai = new GoogleGenAI({ apiKey: geminiApiKey });

    const geminiResult = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: `${interviewContext}\n\nGenerate a comprehensive feedback report with exactly this JSON shape:\n${JSON_OUTPUT_SHAPE}`,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
      },
    });

    const rawJson = geminiResult.text;
    if (!rawJson) {
      console.warn("AI returned empty response, generating basic feedback");
      // Generate basic fallback feedback
      const fallbackFeedback = {
        overallScore: 50,
        summary: "Unable to generate detailed AI feedback due to service issues. Interview completed successfully.",
        strengths: ["Completed interview session", "Provided responses to questions"],
        areasForImprovement: ["Unable to assess due to feedback generation failure"],
        skillAssessments: [],
        questionFeedback: chunks.map((chunk, i) => ({
          question: chunk.speaker === "ai" ? chunk.content : "N/A",
          focusArea: "General",
          answerQuality: "fair" as const,
          strengths: [],
          gaps: ["Unable to assess due to feedback generation failure"],
          suggestedImprovement: "Retry feedback generation later",
        })),
        recommendedFollowUp: "Retry feedback generation or review transcript manually",
        hiringRecommendation: "consider" as const,
        interviewDuration: interview.createdAt 
          ? Math.round((new Date().getTime() - new Date(interview.createdAt).getTime()) / 60000)
          : 0,
      };
      
      await db
        .update(interviews)
        .set({
          feedback: fallbackFeedback,
          score: fallbackFeedback.overallScore,
          status: "completed",
        })
        .where(eq(interviews.id, interviewId));
      
      return NextResponse.json(fallbackFeedback);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawJson);
    } catch {
      console.warn("AI returned invalid JSON, generating basic feedback");
      // Same fallback as above
      const fallbackFeedback = {
        overallScore: 50,
        summary: "Unable to generate detailed AI feedback due to service issues. Interview completed successfully.",
        strengths: ["Completed interview session", "Provided responses to questions"],
        areasForImprovement: ["Unable to assess due to feedback generation failure"],
        skillAssessments: [],
        questionFeedback: chunks.map((chunk, i) => ({
          question: chunk.speaker === "ai" ? chunk.content : "N/A",
          focusArea: "General",
          answerQuality: "fair" as const,
          strengths: [],
          gaps: ["Unable to assess due to feedback generation failure"],
          suggestedImprovement: "Retry feedback generation later",
        })),
        recommendedFollowUp: "Retry feedback generation or review transcript manually",
        hiringRecommendation: "consider" as const,
        interviewDuration: interview.createdAt 
          ? Math.round((new Date().getTime() - new Date(interview.createdAt).getTime()) / 60000)
          : 0,
      };
      
      await db
        .update(interviews)
        .set({
          feedback: fallbackFeedback,
          score: fallbackFeedback.overallScore,
          status: "completed",
        })
        .where(eq(interviews.id, interviewId));
      
      return NextResponse.json(fallbackFeedback);
    }

    const validatedFeedback = FeedbackReportSchema.parse(parsedJson);

    // Update interview with feedback
    await db
      .update(interviews)
      .set({
        feedback: validatedFeedback,
        score: validatedFeedback.overallScore,
        status: "completed",
      })
      .where(eq(interviews.id, interviewId));

    return NextResponse.json(validatedFeedback);
  } catch (error) {
    console.error("🔥 Feedback generation error:", error);

    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "AI response did not match the expected feedback schema",
          details: error.flatten(),
        },
        { status: 422 },
      );
    }

    return NextResponse.json(
      {
        error: "Failed to generate feedback report",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
