import crypto from "crypto";
import { after } from "next/server";
import { db } from "@/src/db/index";
import { auditEvents } from "@/src/db/schema";

export interface LogEventOptions {
  userId: string;
  sessionId?: string | null;
  interviewId?: string | null;
  type: string;
  meta?: Record<string, any> | null;
}

export function hashIp(ip: string): string {
  if (!ip) return "";
  const salt = process.env.LOG_SALT || "intervia-audit-default-salt";
  return crypto.createHmac("sha256", salt).update(ip).digest("hex");
}

export function logEvent(req: Request, options: LogEventOptions): void {
  try {
    const rawIpHeader = req.headers.get("x-forwarded-for") || "";
    const firstIp = rawIpHeader.split(",")[0]?.trim() || "";
    const ipHash = firstIp ? hashIp(firstIp) : null;

    const rawUa = req.headers.get("user-agent") || "";
    const userAgent = rawUa ? rawUa.slice(0, 300) : null;

    const { userId, sessionId, interviewId, type, meta } = options;

    after(async () => {
      try {
        await db.insert(auditEvents).values({
          userId,
          clerkSessionId: sessionId || null,
          interviewId: interviewId || null,
          type,
          ipHash,
          userAgent,
          meta: meta ?? null,
        });
      } catch (dbErr) {
        console.error("[AUDIT] Failed to insert audit event:", dbErr);
      }
    });
  } catch (err) {
    console.error("[AUDIT] Failed to schedule audit event:", err);
  }
}
