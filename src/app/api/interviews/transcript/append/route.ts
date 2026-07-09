import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { ZodError } from "zod";
import { db } from "@/src/db/index";
import { interviews, transcriptChunks } from "@/src/db/schema";
import { embedText } from "@/src/lib/gemini-embeddings";
import { AppendTranscriptSchema } from "@/src/schemas/transcript";
import "@/src/lib/config";

export async function POST(request: Request) {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      console.error(
        "❌ CRITICAL: GEMINI_API_KEY is missing from environment variables",
      );
      return Response.json(
        { error: "GEMINI_API_KEY is missing from environment variables" },
        { status: 500 },
      );
    }

    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = AppendTranscriptSchema.parse(await request.json());

    const [interview] = await db
      .select({ id: interviews.id })
      .from(interviews)
      .where(
        and(eq(interviews.id, body.interviewId), eq(interviews.userId, userId)),
      )
      .limit(1);

    if (!interview) {
      return Response.json({ error: "Interview not found" }, { status: 404 });
    }

    const embeddingValues = await embedText(body.content);

    const [chunk] = await db
      .insert(transcriptChunks)
      .values({
        interviewId: body.interviewId,
        content: body.content,
        speaker: body.speaker,
        embedding: embeddingValues,
      })
      .returning();

    return Response.json(chunk);
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        {
          error: "Invalid transcript payload",
          details: error.flatten(),
        },
        { status: 422 },
      );
    }

    if (
      error instanceof Error &&
      error.message === "GEMINI_API_KEY is not configured"
    ) {
      return Response.json(
        { error: "Embedding service is not configured" },
        { status: 503 },
      );
    }

    console.error("Append transcript error:", error);
    return Response.json(
      { 
        error: "Failed to save your response to the transcript",
        detail: error instanceof Error ? error.message : "Unknown error occurred while saving transcript"
      },
      { status: 500 },
    );
  }
}
