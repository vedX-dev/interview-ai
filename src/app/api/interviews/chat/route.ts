/**
 * Interview chat RAG route — uses shared LLM layer.
 * Returns JSON on every error path.
 */

import { auth } from "@clerk/nextjs/server";
import { and, eq, sql } from "drizzle-orm";
import { ZodError } from "zod";
import { db } from "@/src/db/index";
import { interviews } from "@/src/db/schema";
import { toPgVectorLiteral } from "@/src/db/vector";
import { embedText } from "@/src/lib/gemini-embeddings";
import { InterviewChatSchema } from "@/src/schemas/chat";
import { generate } from "@/src/lib/llm/index";

const RAG_SYSTEM = `You are an interview session assistant for Intervia.
Answer the user's question using ONLY the transcript context provided below.
If the context does not contain enough information, say so clearly.
Keep answers concise, factual, and grounded in what was actually said during the interview.`;

type RetrievedChunk = { content: string; speaker: string };

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized", code: "AUTH_REQUIRED" }, { status: 401 });
    }

    const body = InterviewChatSchema.parse(await request.json());

    const [interview] = await db
      .select({ id: interviews.id })
      .from(interviews)
      .where(and(eq(interviews.id, body.interviewId), eq(interviews.userId, userId)))
      .limit(1);

    if (!interview) {
      return Response.json({ error: "Interview not found", code: "NOT_FOUND" }, { status: 404 });
    }

    // Embed query and retrieve closest chunks
    let contextRows: RetrievedChunk[] = [];
    try {
      const queryEmbedding = await embedText(body.query);
      const queryVector = toPgVectorLiteral(queryEmbedding);
      const retrieved = await db.execute<RetrievedChunk>(sql`
        SELECT content, speaker
        FROM transcript_chunks
        WHERE interview_id = ${body.interviewId}
          AND embedding IS NOT NULL
        ORDER BY embedding <=> ${queryVector}::vector
        LIMIT 3
      `);
      contextRows = retrieved.rows;
    } catch (embedErr) {
      console.warn("[CHAT] Embedding failed, proceeding without RAG:", embedErr);
    }

    if (contextRows.length === 0) {
      return Response.json({
        answer: "No embedded transcript chunks found for this interview yet. Continue the conversation and try again.",
        sources: [],
      });
    }

    const contextBlock = contextRows
      .map((r, i) => `[${i + 1}] (${r.speaker}): ${r.content}`)
      .join("\n");

    const result = await generate({
      task: "heavy",
      system: RAG_SYSTEM,
      prompt: `Transcript context:\n${contextBlock}\n\nUser question:\n${body.query}`,
    });

    console.log(`[CHAT] provider=${result.provider} model=${result.model} latency=${result.latencyMs}ms`);

    return Response.json({ answer: result.text, sources: contextRows });
  } catch (error) {
    console.error("[CHAT] Error:", error);

    if (error instanceof ZodError) {
      return Response.json(
        { error: "Invalid chat payload", code: "VALIDATION_ERROR", details: error.flatten() },
        { status: 422 },
      );
    }

    return Response.json(
      { error: "Failed to generate AI answer", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}
