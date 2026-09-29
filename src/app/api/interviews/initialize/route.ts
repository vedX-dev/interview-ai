/**
 * POST /api/interviews/initialize
 *
 * Creates the interview row, generates coverage topics (async after response),
 * and returns a FIXED greeting string — never LLM-generated, never repeatable.
 *
 * The greeting uses the candidate's FIRST name only.
 * The client must display + speak it once, then call /api/interviews/[id]/turn
 * for every subsequent AI response.
 */

import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { db } from "@/src/db/index";
import { interviews, resumes, transcriptChunks } from "@/src/db/schema";
import { DUMMY_RESUME_ID, MOCK_STRUCTURED_RESUME } from "@/src/lib/default-interview-plan";
import { ExtractedResumeSchema } from "@/src/schemas/resume";
import { ConversationStateSchema } from "@/src/schemas/brain";
import { checkInterviewCreate } from "@/src/lib/rate-limit";
import { generateCoverageTopics } from "@/src/lib/interview/state";
import "@/src/lib/config";

const InitializeRequestSchema = z.object({
  resumeId: z.string(),
  jobRole: z.string().min(1).max(200),
  customCandidateProfile: ExtractedResumeSchema.optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = checkInterviewCreate(userId);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: rl.reason, code: rl.code, retryAfterSec: rl.retryAfterSec },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 60) } },
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
        console.warn("Resume lookup skipped or failed; using mock profile:", lookupError);
      }
    }

    if (body.customCandidateProfile) {
      candidateProfile = body.customCandidateProfile;
      if (resumeIdForDb) {
        try {
          await db
            .update(resumes)
            .set({ fullName: candidateProfile.fullName, structuredData: candidateProfile })
            .where(eq(resumes.id, resumeIdForDb));
        } catch (updateErr) {
          console.warn("Failed to persist updated resume to DB:", updateErr);
        }
      }
    }

    // ── Fixed greeting (first name only, never LLM-generated) ────────────────
    const firstName = candidateProfile.fullName
      ? candidateProfile.fullName.split(" ")[0]
      : "there";

    const greeting =
      `Hi ${firstName}, welcome! I'm glad you could make it today. ` +
      `Before we begin, is there anything you'd like to check on your end — audio, video, anything like that?`;

    // ── Bootstrap ConversationState ──────────────────────────────────────────
    const initialState = ConversationStateSchema.parse({
      phase: "intro",
      coverage: [], // Populated in after() below to not block the response
      asked: [],
      scores: [],
      followUpsOnCurrent: 0,
      turnCount: 0,
      firstName,
    });

    // ── Create interview row ─────────────────────────────────────────────────
    const [createdInterview] = await db
      .insert(interviews)
      .values({
        userId,
        resumeId: resumeIdForDb,
        jobRole: body.jobRole,
        status: "ongoing",
        currentPhase: "greeting",
        feedback: { candidateProfile },
        plan: initialState as any,
      })
      .returning();

    // ── Store fixed greeting in transcript ───────────────────────────────────
    await db.insert(transcriptChunks).values({
      interviewId: createdInterview.id,
      speaker: "ai",
      content: greeting,
    });

    // ── Generate topics asynchronously (non-blocking) ────────────────────────
    after(async () => {
      try {
        const topics = await generateCoverageTopics(body.jobRole, candidateProfile);
        const stateWithTopics = { ...initialState, coverage: topics };
        await db
          .update(interviews)
          .set({ plan: stateWithTopics as any })
          .where(eq(interviews.id, createdInterview.id));
        console.log(`[INITIALIZE] Generated ${topics.length} coverage topics for ${createdInterview.id}`);
      } catch (err) {
        console.warn("[INITIALIZE] after(): topic generation failed:", (err as Error).message);
      }
    });

    console.log(`[INITIALIZE] Interview created: ${createdInterview.id} role=${body.jobRole} candidate=${firstName}`);

    return NextResponse.json({
      ...createdInterview,
      greeting,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Request did not match the expected schema", details: error.flatten() },
        { status: 422 },
      );
    }
    console.error("Initialize interview error:", error);
    return NextResponse.json(
      {
        error: "Failed to initialize interview session",
        detail: error instanceof Error ? error.message : "Unknown error occurred",
      },
      { status: 500 },
    );
  }
}
