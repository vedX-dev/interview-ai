import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { db } from "@/src/db/index";
import { interviews, resumes } from "@/src/db/schema";
import {
  DUMMY_RESUME_ID,
  MOCK_STRUCTURED_RESUME,
} from "@/src/lib/default-interview-plan";
import { ExtractedResumeSchema } from "@/src/schemas/resume";
import { checkRateLimit, checkDailyLimit } from "@/src/lib/rate-limit";
import "@/src/lib/config";

const InitializeRequestSchema = z.object({
  resumeId: z.string().uuid(),
  jobRole: z.string().min(1).max(200),
});

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limiting check
    const rateLimitCheck = checkRateLimit(userId);
    if (!rateLimitCheck.allowed) {
      return NextResponse.json(
        { 
          error: rateLimitCheck.reason,
          retryAfter: rateLimitCheck.retryAfter 
        },
        { status: 429 },
      );
    }

    const dailyLimitCheck = checkDailyLimit(userId);
    if (!dailyLimitCheck.allowed) {
      return NextResponse.json(
        { 
          error: dailyLimitCheck.reason,
          retryAfter: dailyLimitCheck.retryAfter 
        },
        { status: 429 },
      );
    }

    const body = InitializeRequestSchema.parse(await req.json());
    const isDummyResume = body.resumeId === DUMMY_RESUME_ID;

    let resumeIdForDb: string | null = null;
    let candidateProfile = MOCK_STRUCTURED_RESUME;

    if (!isDummyResume) {
      try {
        const [resume] = await db
          .select()
          .from(resumes)
          .where(and(eq(resumes.id, body.resumeId), eq(resumes.userId, userId)))
          .limit(1);

        if (resume) {
          resumeIdForDb = resume.id;
          candidateProfile = ExtractedResumeSchema.parse(resume.structuredData);
        }
      } catch (lookupError) {
        console.warn(
          "Resume lookup skipped or failed; using mock profile:",
          lookupError,
        );
      }
    }

    // Create interview with greeting phase
    const [createdInterview] = await db
      .insert(interviews)
      .values({
        userId,
        resumeId: resumeIdForDb,
        jobRole: body.jobRole,
        status: "ongoing",
        currentPhase: "greeting",
        feedback: { candidateProfile }, // Store candidate profile for orchestrator
      })
      .returning();

    // Call orchestrator to generate greeting
    let greeting = "Hi, thanks for joining. Ready to get started?";
    try {
      console.log("[INITIALIZE] Calling orchestrator for interview:", createdInterview.id);
      const orchestratorResponse = await fetch(
        `${req.nextUrl.origin}/api/interviews/${createdInterview.id}/orchestrator`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            interviewId: createdInterview.id,
            currentPhase: "greeting",
            transcript: [],
            resumeData: candidateProfile,
            jobRole: body.jobRole,
            geminiCallsCount: 0,
            totalTurns: 0,
            adaptiveDecisionsCount: 0,
          }),
        },
      );

      console.log("[INITIALIZE] Orchestrator response status:", orchestratorResponse.status);
      
      if (orchestratorResponse.ok) {
        const decision = await orchestratorResponse.json();
        greeting = decision.aiUtterance;
        console.log("[INITIALIZE] Generated greeting via orchestrator:", greeting);
      } else {
        const errorText = await orchestratorResponse.text();
        console.warn("[INITIALIZE] Orchestrator failed with status:", orchestratorResponse.status, "Error:", errorText);
      }
    } catch (orchestratorError) {
      console.warn("[INITIALIZE] Orchestrator call failed, using default greeting:", orchestratorError);
    }

    return NextResponse.json({
      ...createdInterview,
      greeting, // Include greeting for the lobby to use
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Request did not match the expected schema",
          details: error.flatten(),
        },
        { status: 422 },
      );
    }

    console.error("Initialize interview error:", error);
    return NextResponse.json(
      { 
        error: "Failed to initialize interview session",
        detail: error instanceof Error ? error.message : "Unknown error occurred while creating interview"
      },
      { status: 500 },
    );
  }
}
