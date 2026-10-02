import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/src/db/index";
import { interviews } from "@/src/db/schema";
import { IntegrityEventSchema, type IntegrityEvent } from "@/src/schemas/integrity";
import { checkIntegrityLimit } from "@/src/lib/rate-limit";
import { INTEGRITY_CONFIG } from "@/src/lib/integrity/config";
import { logEvent } from "@/src/lib/audit";
import "@/src/lib/config";

/** Server-side dedup: key = interviewId + type + timestamp (ms, bucketed to nearest 2s) */
const seenIntegrityEvents = new Map<string, number>();

function isDuplicateEvent(interviewId: string, event: IntegrityEvent): boolean {
  const bucket = Math.floor((event.timestamp ?? Date.now()) / 2000); // 2-second bucket
  const key = `${interviewId}:${event.type}:${bucket}`;
  const now = Date.now();

  // Prune entries older than 10 minutes
  for (const [k, ts] of seenIntegrityEvents) {
    if (now - ts > 10 * 60 * 1000) seenIntegrityEvents.delete(k);
  }

  if (seenIntegrityEvents.has(key)) return true;
  seenIntegrityEvents.set(key, now);
  return false;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId, sessionId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
    }

    const { id: interviewId } = await params;

    // Rate limit: per-interview bucket, NOT the interview-creation bucket
    const rl = checkIntegrityLimit(interviewId);
    if (!rl.allowed) {
      logEvent(req, { userId, sessionId, interviewId, type: "rate_limited", meta: { bucket: "integrity" } });
      return NextResponse.json(
        { error: "Too many integrity events — please wait.", code: "RATE_LIMITED", retryAfterSec: rl.retryAfterSec ?? 10 },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 10) } },
      );
    }

    // Verify interview ownership
    const [interview] = await db
      .select({
        id: interviews.id,
        userId: interviews.userId,
        status: interviews.status,
        feedback: interviews.feedback,
      })
      .from(interviews)
      .where(and(eq(interviews.id, interviewId), eq(interviews.userId, userId)))
      .limit(1);

    if (!interview) {
      return NextResponse.json({ error: "Interview not found", code: "NOT_FOUND" }, { status: 404 });
    }

    const eventPayload = IntegrityEventSchema.parse(await req.json());

    // Server-side dedup: identical event type in same 2-second window → silently accept
    if (isDuplicateEvent(interviewId, eventPayload)) {
      console.log(`[INTEGRITY_API] Dedup: interview=${interviewId} type=${eventPayload.type} (suppressed)`);
      const currentFeedback = (interview.feedback as Record<string, any>) || {};
      const existingEvents: IntegrityEvent[] = Array.isArray(currentFeedback.integrityEvents)
        ? currentFeedback.integrityEvents
        : [];
      return NextResponse.json({
        success: true,
        strikeNumber: existingEvents.length,
        isTerminated: currentFeedback.integrityStatus === "flagged_terminated",
        terminationReason: "",
        recordedEvent: eventPayload,
        deduplicated: true,
      });
    }

    // Extract existing feedback object & integrity events
    const currentFeedback = (interview.feedback as Record<string, any>) || {};
    const existingEvents: IntegrityEvent[] = Array.isArray(currentFeedback.integrityEvents)
      ? currentFeedback.integrityEvents
      : [];

    // Append new event
    const updatedEvents = [...existingEvents, eventPayload];

    // Server-side decision on strike count & termination
    let serverStrikes = 0;
    let isTerminated = false;
    let terminationReason = "";

    for (const evt of updatedEvents) {
      if ((INTEGRITY_CONFIG.immediateStopTypes as readonly string[]).includes(evt.type)) {
        serverStrikes = INTEGRITY_CONFIG.maxStrikes;
        isTerminated = true;
        terminationReason = `Immediate interview termination: sustained ${evt.type.replace("_", " ")} detected.`;
        break;
      }
      serverStrikes++;
    }

    if (serverStrikes >= INTEGRITY_CONFIG.maxStrikes) {
      isTerminated = true;
      if (!terminationReason) {
        terminationReason = `Interview terminated: accumulated ${serverStrikes} integrity warnings.`;
      }
    }

    // Update DB row
    const updatedFeedback = {
      ...currentFeedback,
      integrityEvents: updatedEvents,
      integrityStrikes: serverStrikes,
      integrityStatus: isTerminated ? "flagged_terminated" : "monitoring_active",
    };

    await db
      .update(interviews)
      .set({
        feedback: updatedFeedback,
        ...(isTerminated ? { status: "failed" as const, currentPhase: "closed" as const } : {}),
      })
      .where(eq(interviews.id, interviewId));

    console.log(
      `[INTEGRITY_API] interview=${interviewId} type=${eventPayload.type} strikes=${serverStrikes} terminated=${isTerminated}`,
    );

    logEvent(req, {
      userId,
      sessionId,
      interviewId,
      type: `integrity:${eventPayload.type}`,
      meta: {
        violationType: eventPayload.type,
        strikeCount: serverStrikes,
      },
    });

    return NextResponse.json({
      success: true,
      strikeNumber: serverStrikes,
      isTerminated,
      terminationReason,
      recordedEvent: eventPayload,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid integrity event payload", details: error.flatten(), code: "INVALID_PAYLOAD" },
        { status: 422 },
      );
    }

    console.error("[INTEGRITY_API] Error:", error);
    return NextResponse.json(
      { error: "Internal server error processing integrity signal", code: "SERVER_ERROR" },
      { status: 500 },
    );
  }
}
