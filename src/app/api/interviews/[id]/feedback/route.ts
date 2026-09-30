/**
 * GET & POST /api/interviews/[id]/feedback
 *
 * Provides the feedback report for a completed or terminated interview.
 * If feedback is not yet generated, it automatically invokes generation.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/src/db/index";
import { interviews, transcriptChunks } from "@/src/db/schema";
import { loadState } from "@/src/lib/interview/state";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: interviewId } = await context.params;

  try {
    const { userId } = await auth();

    const [interview] = await db
      .select()
      .from(interviews)
      .where(eq(interviews.id, interviewId))
      .limit(1);

    if (!interview) {
      return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    }

    if (userId && interview.userId && interview.userId !== userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // If feedback is already generated and valid, return it directly
    const feedbackObj = interview.feedback as any;
    if (feedbackObj && feedbackObj.overallScore !== undefined) {
      return NextResponse.json({
        success: true,
        interview: {
          id: interview.id,
          jobRole: interview.jobRole,
          status: interview.status,
          createdAt: interview.createdAt,
          score: interview.score,
        },
        feedback: feedbackObj,
      });
    }

    // Feedback not yet generated -> fetch chunks and trigger generate route logic internally
    const chunks = await db
      .select()
      .from(transcriptChunks)
      .where(eq(transcriptChunks.interviewId, interviewId));

    // If empty transcript or brand new interview
    if (!chunks || chunks.length === 0) {
      return NextResponse.json({
        success: true,
        interview: {
          id: interview.id,
          jobRole: interview.jobRole,
          status: interview.status,
          createdAt: interview.createdAt,
          score: 0,
        },
        feedback: {
          overallScore: 0,
          summary: "Interview ended before any technical questions were answered.",
          strengths: [],
          areasForImprovement: ["Interview was not completed."],
          skillAssessments: [],
          questionFeedback: [],
          recommendedFollowUp: "Reschedule interview session.",
          hiringRecommendation: "do_not_hire",
          interviewDuration: 0,
        },
      });
    }

    // Call generate endpoint internally or redirect
    const url = new URL(req.url);
    const generateUrl = `${url.origin}/api/interviews/${interviewId}/feedback/generate`;
    const genRes = await fetch(generateUrl, {
      method: "POST",
      headers: {
        cookie: req.headers.get("cookie") || "",
      },
    });

    if (genRes.ok) {
      const generatedFeedback = await genRes.json();
      return NextResponse.json({
        success: true,
        interview: {
          id: interview.id,
          jobRole: interview.jobRole,
          status: "completed",
          createdAt: interview.createdAt,
          score: generatedFeedback.overallScore,
        },
        feedback: generatedFeedback,
      });
    }

    // Fallback if generate endpoint fails
    return NextResponse.json({
      success: true,
      interview: {
        id: interview.id,
        jobRole: interview.jobRole,
        status: interview.status,
        createdAt: interview.createdAt,
        score: interview.score ?? 50,
      },
      feedback: feedbackObj || {
        overallScore: interview.score ?? 50,
        summary: `Interview session completed for ${interview.jobRole}.`,
        strengths: ["Completed technical interview session."],
        areasForImprovement: [],
        skillAssessments: [],
        questionFeedback: [],
        recommendedFollowUp: "Review transcript for details.",
        hiringRecommendation: "consider",
        interviewDuration: 0,
      },
    });
  } catch (error: any) {
    console.error("[FEEDBACK_GET_ERROR]", error);
    return NextResponse.json(
      { error: "Failed to retrieve feedback report", message: error.message },
      { status: 500 },
    );
  }
}
