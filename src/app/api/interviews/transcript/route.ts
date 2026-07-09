import { auth } from "@clerk/nextjs/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/src/db/index";
import { interviews, transcriptChunks } from "@/src/db/schema";

export async function GET(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const interviewId = new URL(request.url).searchParams.get("interviewId");
    if (!interviewId) {
      return Response.json(
        { error: "interviewId query parameter is required" },
        { status: 400 },
      );
    }

    const [interview] = await db
      .select()
      .from(interviews)
      .where(and(eq(interviews.id, interviewId), eq(interviews.userId, userId)))
      .limit(1);

    if (!interview) {
      return Response.json({ error: "Interview not found" }, { status: 404 });
    }

    const chunks = await db
      .select()
      .from(transcriptChunks)
      .where(eq(transcriptChunks.interviewId, interviewId))
      .orderBy(asc(transcriptChunks.createdAt));

    return Response.json({ chunks, interview });
  } catch (error) {
    console.error("Fetch transcript error:", error);
    return Response.json(
      { 
        error: "Failed to load interview transcript",
        detail: error instanceof Error ? error.message : "Unknown error occurred while loading transcript"
      },
      { status: 500 },
    );
  }
}
