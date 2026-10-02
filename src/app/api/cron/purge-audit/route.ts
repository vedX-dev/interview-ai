import { NextRequest, NextResponse } from "next/server";
import { lt } from "drizzle-orm";
import { db } from "@/src/db/index";
import { auditEvents } from "@/src/db/schema";

export async function POST(req: NextRequest) {
  return handlePurge(req);
}

export async function GET(req: NextRequest) {
  return handlePurge(req);
}

async function handlePurge(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.get("x-cron-secret") || req.headers.get("authorization");

    if (cronSecret) {
      const isAuthorized =
        authHeader === cronSecret ||
        authHeader === `Bearer ${cronSecret}`;
      if (!isAuthorized) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const NinetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const deleted = await db
      .delete(auditEvents)
      .where(lt(auditEvents.createdAt, NinetyDaysAgo))
      .returning({ id: auditEvents.id });

    console.log(`[PURGE-AUDIT] Successfully purged ${deleted.length} audit events older than 90 days.`);

    return NextResponse.json({
      success: true,
      purgedCount: deleted.length,
      cutoffDate: NinetyDaysAgo.toISOString(),
    });
  } catch (error) {
    console.error("[PURGE-AUDIT] Error during audit log purge:", error);
    return NextResponse.json(
      { error: "Failed to purge audit events", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
