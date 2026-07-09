import { GoogleGenAI } from "@google/genai";
import { auth } from "@clerk/nextjs/server";
import { z, ZodError } from "zod";
import type { ExtractedResume } from "@/src/schemas/resume";
import {
  DEFAULT_INTERVIEW_PLAN,
  MOCK_STRUCTURED_RESUME,
} from "@/src/lib/default-interview-plan";
import { InterviewPlanResponseSchema } from "@/src/schemas/interview";
import "@/src/lib/config";

const GeneratePlanRequestSchema = z.object({
  candidateProfile: z.object({
    fullName: z.string(),
    topSkills: z.array(z.string()),
    yearsOfExperience: z.number(),
    coreProjects: z.array(
      z.object({
        title: z.string(),
        description: z.string(),
      }),
    ),
  }),
  jobRole: z.string().min(1).max(200),
});

const SYSTEM_INSTRUCTION = `You are an expert technical interviewer for top-tier tech companies. Generate 5 personalized interview questions based on the candidate's resume and target job role.

Rules:
- Generate exactly 5 questions
- Mix of technical questions (3) and coding questions (2)
- Questions should probe the candidate's listed skills and experience
- For senior candidates, ask deeper system design/architecture questions
- For junior/fresher candidates, focus on fundamentals and problem-solving
- Coding questions should be algorithmic/data structure problems relevant to their skills
- Each question should be specific and answerable in 5-10 minutes
- Focus areas should match the candidate's skills or the job role`;

const JSON_OUTPUT_SHAPE = `{
  "interviewPlan": [
    {
      "id": 1,
      "type": "technical",
      "question": "specific question text",
      "focusArea": "relevant skill/topic",
      "expectedDurationMinutes": 5
    }
  ]
}`;

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      console.error(
        "❌ CRITICAL: GEMINI_API_KEY is missing from environment variables",
      );
      return Response.json(
        {
          error:
            "GEMINI_API_KEY is missing from environment variables. Using default interview plan.",
          interviewPlan: DEFAULT_INTERVIEW_PLAN.interviewPlan,
        },
        { status: 500 },
      );
    }

    const body = GeneratePlanRequestSchema.parse(await req.json());
    const { candidateProfile, jobRole } = body;

    const ai = new GoogleGenAI({ apiKey: geminiApiKey });

    const resumeContext = `
Candidate Profile:
- Name: ${candidateProfile.fullName}
- Experience: ${candidateProfile.yearsOfExperience} years
- Top Skills: ${candidateProfile.topSkills.join(", ")}
- Projects: ${candidateProfile.coreProjects.map((p) => p.title).join(", ")}

Target Job Role: ${jobRole}
`;

    const geminiResult = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: `${resumeContext}\n\nGenerate a personalized interview plan with exactly this JSON shape:\n${JSON_OUTPUT_SHAPE}`,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
      },
    });

    const rawJson = geminiResult.text;
    if (!rawJson) {
      console.warn("AI returned empty response, using default plan");
      return Response.json(DEFAULT_INTERVIEW_PLAN);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawJson);
    } catch {
      console.warn("AI returned invalid JSON, using default plan");
      return Response.json(DEFAULT_INTERVIEW_PLAN);
    }

    const validatedPlan = InterviewPlanResponseSchema.parse(parsedJson);
    return Response.json(validatedPlan);
  } catch (error) {
    console.error("🔥 Interview plan generation error:", error);

    if (error instanceof ZodError) {
      console.warn("Generated plan failed schema validation, using default");
      return Response.json(DEFAULT_INTERVIEW_PLAN);
    }

    console.warn("Plan generation failed, using default plan");
    return Response.json(DEFAULT_INTERVIEW_PLAN);
  }
}
