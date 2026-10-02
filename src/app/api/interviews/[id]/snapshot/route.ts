/**
 * POST /api/interviews/[id]/snapshot
 *
 * Saves a candidate camera screenshot captured during their interview session.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/src/db/index";
import { interviews } from "@/src/db/schema";
import { eq, and } from "drizzle-orm";
import { logEvent } from "@/src/lib/audit";
import { z } from "zod";

const SnapshotRequestSchema = z.object({
  snapshot: z.string().min(10, "Invalid snapshot data"),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, sessionId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: interviewId } = await params;
    const body = await req.json();
    const { snapshot } = SnapshotRequestSchema.parse(body);

    // Verify interview exists and belongs to candidate
    const [interview] = await db
      .select({ id: interviews.id })
      .from(interviews)
      .where(and(eq(interviews.id, interviewId), eq(interviews.userId, userId)))
      .limit(1);

    if (!interview) {
      return NextResponse.json({ error: "Interview session not found" }, { status: 404 });
    }

    // Store snapshot in DB
    await db
      .update(interviews)
      .set({ candidateSnapshot: snapshot })
      .where(eq(interviews.id, interviewId));

    logEvent(req, {
      userId,
      sessionId,
      interviewId,
      type: "candidate_snapshot_captured",
    });

    return NextResponse.json({ success: true, message: "Snapshot saved successfully" });
  } catch (error: any) {
    console.error("[SNAPSHOT_ERROR]", error);
    return NextResponse.json(
      { error: "Failed to save candidate snapshot", details: error.message },
      { status: 500 }
    );
  }
}
