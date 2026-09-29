/**
 * Interview plan generation — uses shared LLM layer (heavy task).
 * Returns JSON on every error path.
 */

import { auth } from "@clerk/nextjs/server";
import { z, ZodError } from "zod";
import type { ExtractedResume } from "@/src/schemas/resume";
import {
  DEFAULT_INTERVIEW_PLAN,
} from "@/src/lib/default-interview-plan";
import { InterviewPlanResponseSchema } from "@/src/schemas/interview";
import { generate, tryParseAndValidate } from "@/src/lib/llm/index";

const GeneratePlanRequestSchema = z.object({
  candidateProfile: z.object({
    fullName: z.string(),
    topSkills: z.array(z.string()),
    yearsOfExperience: z.number(),
    coreProjects: z.array(z.object({ title: z.string(), description: z.string() })),
  }),
  jobRole: z.string().min(1).max(200),
});

const SYSTEM_INSTRUCTION = `You are an expert technical interviewer for top-tier tech companies. Generate 5 personalized interview questions based on the candidate's resume and target job role.

Rules:
- Generate exactly 5 questions
- Mix of technical questions (3) and coding questions (2)
- Questions should probe the candidate's listed skills and experience
- For senior candidates (3+ years), ask system design/architecture questions
- For junior/fresher candidates, focus on fundamentals
- Each question should be answerable in 5-10 minutes
- Focus areas should match the candidate's skills or the job role
- Questions must be spoken-English friendly: no code blocks in the question text`;

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
      return Response.json({ error: "Unauthorized", code: "AUTH_REQUIRED" }, { status: 401 });
    }

    const body = GeneratePlanRequestSchema.parse(await req.json());
    const { candidateProfile, jobRole } = body;

    const resumeContext = `Candidate Profile:
- Name: ${candidateProfile.fullName}
- Experience: ${candidateProfile.yearsOfExperience} years
- Top Skills: ${candidateProfile.topSkills.join(", ")}
- Projects: ${candidateProfile.coreProjects.map((p) => p.title).join(", ")}

Target Job Role: ${jobRole}`;

    try {
      const result = await generate({
        task: "heavy",
        system: SYSTEM_INSTRUCTION,
        prompt: `${resumeContext}\n\nGenerate a personalized interview plan with exactly this JSON shape:\n${JSON_OUTPUT_SHAPE}`,
        jsonSchema: InterviewPlanResponseSchema,
      });

      const parsed = tryParseAndValidate(result.text, InterviewPlanResponseSchema);
      if (!parsed.ok) {
        console.warn("[GENERATE-PLAN] Schema validation failed, using default plan");
        return Response.json(DEFAULT_INTERVIEW_PLAN);
      }

      console.log(`[GENERATE-PLAN] provider=${result.provider} model=${result.model} latency=${result.latencyMs}ms`);
      return Response.json(parsed.data);
    } catch (llmErr) {
      console.warn("[GENERATE-PLAN] LLM failed, using default plan:", llmErr);
      return Response.json(DEFAULT_INTERVIEW_PLAN);
    }
  } catch (error) {
    console.error("[GENERATE-PLAN] Error:", error);

    if (error instanceof ZodError) {
      // Return default plan on validation failure — never a dead end
      console.warn("[GENERATE-PLAN] Validation failed, using default plan");
      return Response.json(DEFAULT_INTERVIEW_PLAN);
    }

    return Response.json(DEFAULT_INTERVIEW_PLAN);
  }
}
