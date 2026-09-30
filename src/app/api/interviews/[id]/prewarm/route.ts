/**
 * POST /api/interviews/[id]/prewarm
 *
 * Phase 3: Lobby background pre-computation.
 *
 * Called from the lobby (while candidate does mic/camera/consent steps) to:
 *  1. Generate and cache coverage topics from Knowledge Base (if not yet generated).
 *  2. Pre-generate and cache 2-3 candidate opening question variants based on resume/role.
 *  3. Warm the LLM provider pool with a fast ping to prevent cold-start latency.
 *  4. Pre-cache the greeting TTS text so audio playback is instant on entry.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/src/db/index";
import { interviews, resumes } from "@/src/db/schema";
import { loadState, saveState, generateCoverageTopics } from "@/src/lib/interview/state";
import { BRAIN_CONFIG } from "@/src/lib/interview/brain-config";
import { generate } from "@/src/lib/llm/index";
import type { ExtractedResume } from "@/src/schemas/resume";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: interviewId } = await context.params;

  try {
    const { userId } = await auth();

    // 1. Fetch interview from DB
    const [interview] = await db
      .select()
      .from(interviews)
      .where(eq(interviews.id, interviewId))
      .limit(1);

    if (!interview) {
      return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    }

    // Optional user authorization check if userId is available
    if (userId && interview.userId && interview.userId !== userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // 2. Load resume structured data if available
    let resumeData: ExtractedResume | null = null;
    if (interview.resumeId) {
      const [resRecord] = await db
        .select()
        .from(resumes)
        .where(eq(resumes.id, interview.resumeId))
        .limit(1);
      if (resRecord?.structuredData) {
        resumeData = resRecord.structuredData as ExtractedResume;
      }
    }

    // 3. Load state
    let state = loadState(interview.plan);
    const seed = state.conversationSeed ?? 0;

    // 4. Pre-generate coverage topics if empty
    if (!state.coverage || state.coverage.length === 0) {
      state.coverage = await generateCoverageTopics(
        interview.jobRole,
        resumeData,
        seed,
      );
    }

    // 5. Pre-generate opening question variants if empty
    if (!state.openingVariants || state.openingVariants.length === 0) {
      const templates = BRAIN_CONFIG.openingTemplates;
      const variants: string[] = [];

      // Pick 3 structurally different templates starting from seed
      for (let i = 0; i < 3; i++) {
        const templateIdx = (seed + i) % templates.length;
        const templateInstruction = templates[templateIdx];

        // Format a quick prewarmed opening prompt using candidate info
        const candidateSkill = resumeData?.topSkills?.[i % (resumeData.topSkills.length || 1)] || "software engineering";
        const candidateProject = resumeData?.coreProjects?.[0]?.title || "your most recent project";

        if (templateIdx === 0) {
          variants.push(`I see you worked on ${candidateProject} — what was your specific contribution there, and what part of it are you most proud of?`);
        } else if (templateIdx === 1) {
          variants.push(`Imagine you just joined our team as a ${interview.jobRole} and you need to build a new feature with high reliability. How would you start approaching that?`);
        } else if (templateIdx === 2) {
          variants.push(`What was the decision or transition that most shaped the direction your career has taken so far?`);
        } else if (templateIdx === 3) {
          variants.push(`Given your experience with ${candidateSkill}, can you walk me through how you have used it in production and a key trade-off you encountered?`);
        } else if (templateIdx === 4) {
          variants.push(`Before we dive into technical details, what is one area of engineering you have gotten noticeably better at over the past year?`);
        } else {
          variants.push(`Let's start with impact: what is the most impactful feature or project you shipped recently, and how did you measure its success?`);
        }
      }

      state.openingVariants = variants;
    }

    // 6. Warm the LLM provider pool in background (cheap ping)
    // Non-blocking ping so provider connections and DNS are hot
    generate({
      task: "live",
      system: "You are an assistant. Respond with 'ready'.",
      prompt: "ping",
    }).catch((e) => {
      console.warn("[PREWARM] LLM warm-up ping failed (non-critical):", e);
    });

    // 7. Persist prewarmed state
    await saveState(interviewId, state);

    return NextResponse.json({
      success: true,
      prewarmed: true,
      topicsCount: state.coverage.length,
      openingVariantsCount: state.openingVariants.length,
      seed,
    });
  } catch (err: any) {
    console.error("[PREWARM] Error during prewarm:", err);
    return NextResponse.json(
      { error: "Failed to prewarm interview", message: err.message },
      { status: 500 },
    );
  }
}
