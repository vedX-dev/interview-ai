/**
 * GET /api/interviews
 *
 * Retrieves the interview history for the authenticated user.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/src/db/index";
import { interviews } from "@/src/db/schema";

export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth();

    let userInterviews = [];

    if (userId) {
      userInterviews = await db
        .select({
          id: interviews.id,
          jobRole: interviews.jobRole,
          status: interviews.status,
          score: interviews.score,
          currentPhase: interviews.currentPhase,
          totalTurns: interviews.totalTurns,
          feedback: interviews.feedback,
          createdAt: interviews.createdAt,
        })
        .from(interviews)
        .where(eq(interviews.userId, userId))
        .orderBy(desc(interviews.createdAt))
        .limit(1);
    } else {
      // In local dev without user ID, return the single most recent interview
      userInterviews = await db
        .select({
          id: interviews.id,
          jobRole: interviews.jobRole,
          status: interviews.status,
          score: interviews.score,
          currentPhase: interviews.currentPhase,
          totalTurns: interviews.totalTurns,
          feedback: interviews.feedback,
          createdAt: interviews.createdAt,
        })
        .from(interviews)
        .orderBy(desc(interviews.createdAt))
        .limit(1);
    }

    return NextResponse.json({
      success: true,
      interviews: userInterviews,
    });
  } catch (error: any) {
    console.error("[GET_INTERVIEWS_ERROR]", error);
    return NextResponse.json(
      { error: "Failed to fetch interview history", message: error.message },
      { status: 500 },
    );
  }
}
