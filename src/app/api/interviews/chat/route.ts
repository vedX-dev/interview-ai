import { GoogleGenAI } from "@google/genai";
import { auth } from "@clerk/nextjs/server";
import { and, eq, sql } from "drizzle-orm";
import { ZodError } from "zod";
import { db } from "@/src/db/index";
import { interviews } from "@/src/db/schema";
import { toPgVectorLiteral } from "@/src/db/vector";
import { embedText } from "@/src/lib/gemini-embeddings";
import { InterviewChatSchema } from "@/src/schemas/chat";
import "@/src/lib/config";

const RAG_SYSTEM_INSTRUCTION = `You are an interview session assistant for InterviewAI.
Answer the user's question using ONLY the transcript context provided below.
If the context does not contain enough information, say so clearly.
Keep answers concise, factual, and grounded in what was actually said during the interview.`;

type RetrievedChunk = {
  content: string;
  speaker: string;
};

export async function POST(request: Request) {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      return Response.json(
        { error: "GEMINI_API_KEY is missing from environment variables" },
        { status: 500 },
      );
    }

    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = InterviewChatSchema.parse(await request.json());

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

    const contextRows = retrieved.rows;

    if (contextRows.length === 0) {
      return Response.json({
        answer:
          "No embedded transcript chunks were found for this interview yet. Continue the conversation and try again.",
        sources: [],
      });
    }

    const contextBlock = contextRows
      .map(
        (row, index) =>
          `[${index + 1}] (${row.speaker}): ${row.content}`,
      )
      .join("\n");

    const ai = new GoogleGenAI({ apiKey: geminiApiKey });
    const geminiResult = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: `Transcript context:\n${contextBlock}\n\nUser question:\n${body.query}`,
      config: {
        systemInstruction: RAG_SYSTEM_INSTRUCTION,
      },
    });

    const answer = geminiResult.text;
    if (!answer) {
      return Response.json(
        { error: "AI returned an empty response" },
        { status: 502 },
      );
    }

    return Response.json({
      answer,
      sources: contextRows,
    });
  } catch (error) {
    console.error("🔥 Interview chat RAG error:", error);

    if (error instanceof ZodError) {
      return Response.json(
        {
          error: "Invalid chat payload",
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
        { error: "RAG chat service is not configured" },
        { status: 503 },
      );
    }

    const message =
      error instanceof Error ? error.message : "Unknown server error";

    return Response.json(
      {
        error: "Failed to generate AI answer for your question",
        detail: message,
      },
      { status: 500 },
    );
  }
}
