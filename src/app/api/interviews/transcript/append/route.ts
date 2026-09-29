/**
 * Transcript append route.
 *
 * Changes:
 * - Embedding computation moved to after() — never blocks the response.
 * - Missing GEMINI_API_KEY no longer returns 500; chunk is inserted without embedding.
 * - Returns JSON on every error path.
 */

import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { ZodError } from "zod";
import { after } from "next/server";
import { db } from "@/src/db/index";
import { interviews, transcriptChunks } from "@/src/db/schema";
import { embedText } from "@/src/lib/gemini-embeddings";
import { AppendTranscriptSchema } from "@/src/schemas/transcript";

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized", code: "AUTH_REQUIRED" }, { status: 401 });
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
      return Response.json({ error: "Interview not found", code: "NOT_FOUND" }, { status: 404 });
    }

    // Insert chunk WITHOUT embedding — fast path for the live turn
    const [chunk] = await db
      .insert(transcriptChunks)
      .values({
        interviewId: body.interviewId,
        content: body.content,
        speaker: body.speaker,
        // embedding will be backfilled asynchronously below
      })
      .returning();

    // Fire-and-forget: compute embedding and update the row after response is sent
    after(async () => {
      try {
        const values = await embedText(body.content);
        await db
          .update(transcriptChunks)
          .set({ embedding: values })
          .where(eq(transcriptChunks.id, chunk.id));
      } catch (embErr) {
        // Log but never surface — RAG will simply skip un-embedded chunks
        console.error(
          `[TRANSCRIPT] Embedding failed for chunk ${chunk.id}:`,
          embErr instanceof Error ? embErr.message : embErr,
        );
      }
    });

    return Response.json(chunk);
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        { error: "Invalid transcript payload", code: "VALIDATION_ERROR", details: error.flatten() },
        { status: 422 },
      );
    }

    console.error("[TRANSCRIPT APPEND] Error:", error);
    return Response.json(
      {
        error: "Failed to save transcript",
        code: "INTERNAL_ERROR",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
