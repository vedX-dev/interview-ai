import { GoogleGenAI } from "@google/genai";
import { EMBEDDING_DIMENSIONS } from "@/src/db/vector";

const EMBEDDING_MODEL = "gemini-embedding-001";

function getGenAIClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  return new GoogleGenAI({ apiKey });
}

export async function embedText(text: string): Promise<number[]> {
  const ai = getGenAIClient();

  const embeddingResponse = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: [{ parts: [{ text }] }],
    config: {
      outputDimensionality: EMBEDDING_DIMENSIONS, // Keep 768 dims to match existing pgvector column
    },
  });

  const values = embeddingResponse.embeddings?.[0]?.values;

  if (!values?.length) {
    throw new Error("Embedding API returned an empty vector");
  }

  if (values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Expected ${EMBEDDING_DIMENSIONS}-dim embedding, received ${values.length}`,
    );
  }

  return values;
}
