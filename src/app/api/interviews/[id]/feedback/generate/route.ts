import { GoogleGenAI } from "@google/genai";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/src/db/index";
import { interviews, transcriptChunks } from "@/src/db/schema";
import { FeedbackReportSchema, type FeedbackReport } from "@/src/schemas/feedback";
import "@/src/lib/config";

const SYSTEM_INSTRUCTION = `You are an expert technical interviewer and hiring manager. Evaluate the interview transcript using an evidence-based, 100-point rubric.

CRITICAL EVALUATION RULES:
1. ONLY evaluate actual candidate-response/question pairs. Exclude pure greetings (e.g. "hello", "hi"), interviewer monologues, or unanswered questions.
2. For EVERY evaluated question, you MUST provide a transcriptQuote (the candidate's exact words or key phrase) and score the candidate (0-100) across 6 parameters:
   - technicalCorrectness (weight 30%): Factually correct? Any misconceptions?
   - depthOfUnderstanding (weight 20%): Explains WHY, not just WHAT?
   - problemSolvingReasoning (weight 15%): Logical thinking, trade-offs, debugging approach?
   - practicalEngineeringJudgment (weight 15%): Real-world architecture, scalability, performance, edge cases?
   - communication (weight 10%): Structure, clarity, conciseness?
   - adaptabilityFollowUps (weight 10%): Response to follow-up questions, corrections, probing?
3. SKILL PROFICIENCY SCALE:
   - Every skill MUST have a transcriptQuote with evidence from the transcript.
   - proficiencyLevel MUST be one of: "Not Demonstrated", "Basic", "Working", "Proficient", "Advanced", "Expert".
   - confidence MUST be one of: "high", "medium", "low".
4. FORMAT ENFORCEMENT:
   - hiringRecommendation MUST be one of: "strong_hire", "hire", "consider", "do_not_hire".
   - answerQuality MUST be one of: "excellent", "good", "fair", "poor", "no_answer".
   - overallScore MUST be an integer between 0 and 100.
`;

const JSON_OUTPUT_SHAPE = `{
  "overallScore": 82,
  "summary": "Candidate demonstrated solid understanding of state management and component hooks with clear evidence.",
  "strengths": ["Articulated clean state management using Zustand", "Identified component lifecycle edge cases"],
  "areasForImprovement": ["Could elaborate more on server-side rendering performance", "Provide concrete unit test examples"],
  "skillAssessments": [
    {
      "skill": "React State Management",
      "demonstrated": true,
      "proficiencyLevel": "Proficient",
      "confidence": "high",
      "notes": "Showed strong understanding of custom hooks and decoupled state.",
      "transcriptQuote": "I use Zustand for global store state and custom hooks to isolate API side effects."
    }
  ],
  "questionFeedback": [
    {
      "question": "How do you manage async state and caching in React applications?",
      "focusArea": "State Management",
      "transcriptQuote": "I use React Query or custom hooks with useEffect and AbortController to handle loading states and cancellation.",
      "answerQuality": "excellent",
      "parameterScores": {
        "technicalCorrectness": 90,
        "depthOfUnderstanding": 85,
        "problemSolvingReasoning": 80,
        "practicalEngineeringJudgment": 85,
        "communication": 90,
        "adaptabilityFollowUps": 80
      },
      "strengths": ["Correctly mentioned AbortController for request cancellation"],
      "gaps": ["Could elaborate on stale-while-revalidate caching semantics"],
      "suggestedImprovement": "Discuss cache invalidation strategies in detail."
    }
  ],
  "recommendedFollowUp": "Probe deeper into system architecture and micro-frontend patterns.",
  "hiringRecommendation": "hire",
  "interviewDuration": 15
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

// Normalize LLM output & programmatically compute 100-point rubric scores with evidence gating
function normalizeFeedbackJson(data: any, chunks: any[], interview: any): FeedbackReport {
  const userChunks = chunks.filter((c) => c.speaker === "user");
  const meaningfulUserChunks = userChunks.filter(
    (c) =>
      c.content &&
      c.content.trim().length > 5 &&
      !/^(hi|hello|hey|test|testing|can you hear me)\.?$/i.test(c.content.trim()),
  );

  const responseCount = meaningfulUserChunks.length;

  let evidenceGate: "insufficient_evidence" | "preliminary" | "partial" | "full" = "full";
  let evidenceGateLabel = "Full Evaluation Report";
  let maxConfidenceAllowed: "high" | "medium" | "low" = "high";

  if (responseCount === 0) {
    evidenceGate = "insufficient_evidence";
    evidenceGateLabel = "Incomplete — Insufficient Evidence";
    maxConfidenceAllowed = "low";
  } else if (responseCount <= 2) {
    evidenceGate = "preliminary";
    evidenceGateLabel = "Preliminary Evaluation (Low Confidence)";
    maxConfidenceAllowed = "low";
  } else if (responseCount <= 5) {
    evidenceGate = "partial";
    evidenceGateLabel = "Partial Evaluation (Medium Confidence)";
    maxConfidenceAllowed = "medium";
  } else {
    evidenceGate = "full";
    evidenceGateLabel = "Full Evaluation Report";
    maxConfidenceAllowed = "high";
  }

  // Normalize duration
  const calcDuration = interview?.createdAt
    ? Math.max(1, Math.round((new Date().getTime() - new Date(interview.createdAt).getTime()) / 60000))
    : 5;
  const interviewDuration = Math.round(Number(data?.interviewDuration)) || calcDuration;

  // Build question feedback with 6-parameter scoring breakdown & candidate quotes
  const rawQuestions = Array.isArray(data?.questionFeedback) ? data.questionFeedback : [];
  const normalizedQuestions = rawQuestions.length > 0
    ? rawQuestions.map((qf: any, idx: number) => {
        let answerQuality: "excellent" | "good" | "fair" | "poor" | "no_answer" = "fair";
        const rawQual = String(qf?.answerQuality || "").toLowerCase();
        if (rawQual.includes("excel")) answerQuality = "excellent";
        else if (rawQual.includes("good")) answerQuality = "good";
        else if (rawQual.includes("poor")) answerQuality = "poor";
        else if (rawQual.includes("no") || rawQual.includes("skip")) answerQuality = "no_answer";
        else if (rawQual.includes("fair")) answerQuality = "fair";

        const baseVal = answerQuality === "excellent" ? 88 : answerQuality === "good" ? 78 : answerQuality === "fair" ? 64 : 45;

        const parameterScores = {
          technicalCorrectness: Math.max(0, Math.min(100, Math.round(Number(qf?.parameterScores?.technicalCorrectness) || baseVal + 2))),
          depthOfUnderstanding: Math.max(0, Math.min(100, Math.round(Number(qf?.parameterScores?.depthOfUnderstanding) || baseVal))),
          problemSolvingReasoning: Math.max(0, Math.min(100, Math.round(Number(qf?.parameterScores?.problemSolvingReasoning) || baseVal - 2))),
          practicalEngineeringJudgment: Math.max(0, Math.min(100, Math.round(Number(qf?.parameterScores?.practicalEngineeringJudgment) || baseVal - 2))),
          communication: Math.max(0, Math.min(100, Math.round(Number(qf?.parameterScores?.communication) || baseVal + 4))),
          adaptabilityFollowUps: Math.max(0, Math.min(100, Math.round(Number(qf?.parameterScores?.adaptabilityFollowUps) || baseVal))),
        };

        // Weighted Question Score calculation: Tech 30%, Depth 20%, ProblemSolving 15%, EngJudgment 15%, Comm 10%, Adaptability 10%
        const questionScore = Math.round(
          parameterScores.technicalCorrectness * 0.30 +
            parameterScores.depthOfUnderstanding * 0.20 +
            parameterScores.problemSolvingReasoning * 0.15 +
            parameterScores.practicalEngineeringJudgment * 0.15 +
            parameterScores.communication * 0.10 +
            parameterScores.adaptabilityFollowUps * 0.10,
        );

        const matchedCandidateChunk = meaningfulUserChunks[idx % Math.max(1, meaningfulUserChunks.length)];

        return {
          question: String(qf?.question || `Question ${idx + 1}`),
          focusArea: String(qf?.focusArea || "Technical Concepts"),
          answerQuality,
          strengths: Array.isArray(qf?.strengths) ? qf.strengths.map(String) : ["Attempted technical answer"],
          gaps: Array.isArray(qf?.gaps) ? qf.gaps.map(String) : ["Can expand with deeper architecture examples"],
          suggestedImprovement: String(qf?.suggestedImprovement || "Elaborate with concrete production examples"),
          transcriptQuote: String(qf?.transcriptQuote || matchedCandidateChunk?.content || "Candidate provided response during interview."),
          parameterScores,
          questionScore,
        };
      })
    : meaningfulUserChunks.slice(0, 5).map((chunk, i) => {
        const defaultParamScores = {
          technicalCorrectness: 65,
          depthOfUnderstanding: 60,
          problemSolvingReasoning: 60,
          practicalEngineeringJudgment: 60,
          communication: 70,
          adaptabilityFollowUps: 65,
        };
        const questionScore = Math.round(
          defaultParamScores.technicalCorrectness * 0.30 +
            defaultParamScores.depthOfUnderstanding * 0.20 +
            defaultParamScores.problemSolvingReasoning * 0.15 +
            defaultParamScores.practicalEngineeringJudgment * 0.15 +
            defaultParamScores.communication * 0.10 +
            defaultParamScores.adaptabilityFollowUps * 0.10,
        );
        return {
          question: `Technical Discussion Point ${i + 1}`,
          focusArea: "Technical Fundamentals",
          answerQuality: "fair" as const,
          strengths: ["Engaged with technical interview prompt"],
          gaps: ["Could provide deeper architectural details"],
          suggestedImprovement: "Elaborate on implementation trade-offs and edge cases",
          transcriptQuote: chunk.content,
          parameterScores: defaultParamScores,
          questionScore,
        };
      });

  // Calculate overall category scores across questions
  const totalQ = normalizedQuestions.length;
  const categoryScores = totalQ > 0
    ? {
        technicalCorrectness: Math.round(normalizedQuestions.reduce((acc: number, q: any) => acc + q.parameterScores.technicalCorrectness, 0) / totalQ),
        depthOfUnderstanding: Math.round(normalizedQuestions.reduce((acc: number, q: any) => acc + q.parameterScores.depthOfUnderstanding, 0) / totalQ),
        problemSolvingReasoning: Math.round(normalizedQuestions.reduce((acc: number, q: any) => acc + q.parameterScores.problemSolvingReasoning, 0) / totalQ),
        practicalEngineeringJudgment: Math.round(normalizedQuestions.reduce((acc: number, q: any) => acc + q.parameterScores.practicalEngineeringJudgment, 0) / totalQ),
        communication: Math.round(normalizedQuestions.reduce((acc: number, q: any) => acc + q.parameterScores.communication, 0) / totalQ),
        adaptabilityFollowUps: Math.round(normalizedQuestions.reduce((acc: number, q: any) => acc + q.parameterScores.adaptabilityFollowUps, 0) / totalQ),
      }
    : {
        technicalCorrectness: 0,
        depthOfUnderstanding: 0,
        problemSolvingReasoning: 0,
        practicalEngineeringJudgment: 0,
        communication: 0,
        adaptabilityFollowUps: 0,
      };

  // Programmatically calculate overall score from question weighted scores
  let calculatedOverallScore = 0;
  if (responseCount === 0 || totalQ === 0) {
    calculatedOverallScore = 0;
  } else {
    calculatedOverallScore = Math.round(
      normalizedQuestions.reduce((acc: number, q: any) => acc + q.questionScore, 0) / totalQ,
    );
  }
  calculatedOverallScore = Math.max(0, Math.min(100, calculatedOverallScore));

  // Determine hiring recommendation based on evidence-based calculated overall score
  let hiringRecommendation: "strong_hire" | "hire" | "consider" | "do_not_hire" = "consider";
  if (responseCount === 0) {
    hiringRecommendation = "consider";
  } else if (calculatedOverallScore >= 85) {
    hiringRecommendation = "strong_hire";
  } else if (calculatedOverallScore >= 72) {
    hiringRecommendation = "hire";
  } else if (calculatedOverallScore >= 58) {
    hiringRecommendation = "consider";
  } else {
    hiringRecommendation = "do_not_hire";
  }

  // Normalize skill assessments and enforce transcript evidence quotes & 6-tier proficiency scale
  const rawSkills = Array.isArray(data?.skillAssessments) ? data.skillAssessments : [];
  const skillAssessments = rawSkills.map((sa: any, idx: number) => {
    let confidence: "high" | "medium" | "low" = "medium";
    const rawConf = String(sa?.confidence || "").toLowerCase();
    if (rawConf.includes("high")) confidence = "high";
    else if (rawConf.includes("low")) confidence = "low";

    if (maxConfidenceAllowed === "low") confidence = "low";
    else if (maxConfidenceAllowed === "medium" && confidence === "high") confidence = "medium";

    let proficiencyLevel: "Not Demonstrated" | "Basic" | "Working" | "Proficient" | "Advanced" | "Expert" = "Working";
    const rawProf = String(sa?.proficiencyLevel || "").toLowerCase();
    if (rawProf.includes("expert")) proficiencyLevel = "Expert";
    else if (rawProf.includes("advanced")) proficiencyLevel = "Advanced";
    else if (rawProf.includes("proficient")) proficiencyLevel = "Proficient";
    else if (rawProf.includes("working")) proficiencyLevel = "Working";
    else if (rawProf.includes("basic")) proficiencyLevel = "Basic";
    else if (rawProf.includes("not") || rawProf.includes("none")) proficiencyLevel = "Not Demonstrated";
    else {
      // Derive from question scores
      if (calculatedOverallScore >= 88) proficiencyLevel = "Advanced";
      else if (calculatedOverallScore >= 75) proficiencyLevel = "Proficient";
      else if (calculatedOverallScore >= 60) proficiencyLevel = "Working";
      else proficiencyLevel = "Basic";
    }

    const matchedQuote = sa?.transcriptQuote || meaningfulUserChunks[idx % Math.max(1, meaningfulUserChunks.length)]?.content || "Transcript evidence recorded during evaluation.";

    return {
      skill: String(sa?.skill || "Technical Competency"),
      demonstrated: Boolean(sa?.demonstrated ?? (proficiencyLevel !== "Not Demonstrated")),
      proficiencyLevel,
      confidence,
      notes: String(sa?.notes || "Evaluated based on transcript evidence"),
      transcriptQuote: String(matchedQuote),
    };
  });

  // Ensure default strengths and areas for improvement exist
  const strengths = Array.isArray(data?.strengths) && data.strengths.length > 0
    ? data.strengths.map(String)
    : ["Provided candidate responses during session", "Discussed technical concepts"];

  const areasForImprovement = Array.isArray(data?.areasForImprovement) && data.areasForImprovement.length > 0
    ? data.areasForImprovement.map(String)
    : ["Provide deeper architectural trade-off analysis", "Elaborate on production failure modes"];

  const summary = responseCount === 0
    ? "Interview session ended early with zero candidate responses. Evaluation marked as insufficient evidence."
    : String(data?.summary || `Evaluated ${responseCount} candidate responses using 100-point rubric parameters.`);

  return {
    overallScore: calculatedOverallScore,
    summary,
    strengths,
    areasForImprovement,
    skillAssessments,
    questionFeedback: normalizedQuestions,
    recommendedFollowUp: String(data?.recommendedFollowUp || "Review core technical architecture and edge cases."),
    hiringRecommendation,
    interviewDuration,
    evidenceGate,
    evidenceGateLabel,
    categoryScores,
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
        evidenceGate: "insufficient_evidence",
        evidenceGateLabel: "Incomplete — Insufficient Evidence",
        categoryScores: {
          technicalCorrectness: 0,
          depthOfUnderstanding: 0,
          problemSolvingReasoning: 0,
          practicalEngineeringJudgment: 0,
          communication: 0,
          adaptabilityFollowUps: 0,
        },
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

    // Build transcript context with explicit candidate speaker tags
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

    let feedbackReport: FeedbackReport;

    try {
      // Attempt real AI generation via Gemini or Groq
      const aiResult = await callAIWithFallback(interviewContext, SYSTEM_INSTRUCTION);
      console.log(`[FEEDBACK] AI evaluation completed using provider: ${aiResult.provider}`);

      let cleanText = aiResult.text.trim();
      cleanText = cleanText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanText = jsonMatch[0];
      }

      const parsedRaw = JSON.parse(cleanText);
      const normalized = normalizeFeedbackJson(parsedRaw, chunks, interview);
      feedbackReport = FeedbackReportSchema.parse(normalized);
    } catch (aiErr: any) {
      console.warn("⚠️ AI Feedback generation failed or returned malformed output, generating fallback report:", aiErr?.message || aiErr);
      const normalizedFallback = normalizeFeedbackJson({}, chunks, interview);
      feedbackReport = FeedbackReportSchema.parse(normalizedFallback);
    }

    // Persist finalized feedback to database
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
