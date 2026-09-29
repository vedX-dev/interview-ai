import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { devClearUserLimits } from "@/src/lib/rate-limit";

export async function POST(_req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Dev-only endpoint" }, { status: 403 });
  }

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  devClearUserLimits(userId);
  return NextResponse.json({ ok: true, message: `All rate limit counters cleared for user ${userId}` });
}
