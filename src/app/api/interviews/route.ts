/**
 * GET /api/interviews
 *
 * Retrieves full interview history for the authenticated user and session cookies.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { desc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/src/db/index";
import { interviews } from "@/src/db/schema";

export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth();

    // Retrieve interview IDs tracked in cookie
    const cookieHeader = req.cookies.get("intervia_interview_ids")?.value ?? "";
    const cookieInterviewIds = cookieHeader
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    const conditions = [];

    if (userId) {
      conditions.push(eq(interviews.userId, userId));
    }

    if (cookieInterviewIds.length > 0) {
      conditions.push(inArray(interviews.id, cookieInterviewIds));
    }

    let userInterviews = [];

    if (conditions.length > 0) {
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
        .where(conditions.length === 1 ? conditions[0] : or(...conditions))
        .orderBy(desc(interviews.createdAt))
        .limit(50);
    } else {
      // In local dev without user ID or cookies, return recent 50 interviews
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
        .limit(50);
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
