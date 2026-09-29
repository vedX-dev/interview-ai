import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import "@/src/lib/config";

// In-Memory cache for synthesized audio (text -> base64 audio array)
const ttsCache = new Map<string, string[]>();

// Simple server-wide budget tracker
let totalCharsSynthesized = 0;
const MAX_SESSION_CHARS = 20000; // Budget cap: 20k characters

const TTSRequestSchema = z.object({
  text: z.string().min(1).max(2500),
  speaker: z.string().optional().default("aditya"),
});

// Helper to chunk text into < 250 char segments for optimal Sarvam Bulbul v3 synthesis
function chunkText(text: string, maxLen = 250): string[] {
  const sentences = text.split(/(?<=[.?!])\s+/);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if ((current + " " + sentence).trim().length <= maxLen) {
      current = (current + " " + sentence).trim();
    } else {
      if (current) chunks.push(current);
      if (sentence.length > maxLen) {
        // Sub-split very long sentences by space
        const words = sentence.split(" ");
        let wordChunk = "";
        for (const word of words) {
          if ((wordChunk + " " + word).trim().length <= maxLen) {
            wordChunk = (wordChunk + " " + word).trim();
          } else {
            if (wordChunk) chunks.push(wordChunk);
            wordChunk = word;
          }
        }
        if (wordChunk) current = wordChunk;
      } else {
        current = sentence;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [text];
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = TTSRequestSchema.parse(await req.json());
    const rawText = body.text.trim();
    const speaker = body.speaker || "aditya";
    const cacheKey = `${speaker}:${rawText.toLowerCase()}`;

    // 1. Check server LRU / in-memory cache
    if (ttsCache.has(cacheKey)) {
      console.log("[TTS PROXY] Cache HIT for:", rawText.slice(0, 40));
      return NextResponse.json({
        audios: ttsCache.get(cacheKey),
        cached: true,
        fallback: false,
      });
    }

    // 2. Check budget cap
    if (totalCharsSynthesized + rawText.length > MAX_SESSION_CHARS) {
      console.warn(
        `[TTS PROXY] Budget limit reached (${totalCharsSynthesized}/${MAX_SESSION_CHARS} chars). Signal client fallback.`
      );
      return NextResponse.json({
        fallback: true,
        reason: "TTS budget cap reached for session",
      });
    }

    const sarvamApiKey = process.env.SARVAM_API_KEY || process.env.NEXT_PUBLIC_SARVAM_API_KEY;
    if (!sarvamApiKey) {
      console.warn("[TTS PROXY] SARVAM_API_KEY missing. Fallback to browser TTS.");
      return NextResponse.json({
        fallback: true,
        reason: "SARVAM_API_KEY not configured",
      });
    }

    // 3. Split into optimal chunks
    const chunks = chunkText(rawText);
    console.log(`[TTS PROXY] Synthesizing ${chunks.length} chunk(s) via Sarvam Bulbul v3...`);

    const audioResults: string[] = [];

    for (const chunk of chunks) {
      const response = await fetch("https://api.sarvam.ai/text-to-speech", {
        method: "POST",
        headers: {
          "api-subscription-key": sarvamApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: [chunk],
          target_language_code: "en-IN",
          speaker,
          pitch: 0,
          pace: 1.05,
          loudness: 1.5,
          speech_sample_rate: 22050,
          enable_preprocessing: true,
          model: "bulbul:v3",
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`[TTS PROXY] Sarvam API returned status ${response.status}: ${errText}`);
        return NextResponse.json({
          fallback: true,
          reason: `Sarvam API error: ${response.status}`,
        });
      }

      const data = await response.json();
      if (data.audios && data.audios[0]) {
        audioResults.push(data.audios[0]);
      }
    }

    if (audioResults.length === 0) {
      return NextResponse.json({
        fallback: true,
        reason: "No audio generated",
      });
    }

    // Update character usage count
    totalCharsSynthesized += rawText.length;

    // Cache the result
    ttsCache.set(cacheKey, audioResults);
    if (ttsCache.size > 200) {
      // LRU eviction
      const firstKey = ttsCache.keys().next().value;
      if (firstKey) ttsCache.delete(firstKey);
    }

    return NextResponse.json({
      audios: audioResults,
      cached: false,
      fallback: false,
    });
  } catch (error: any) {
    console.error("[TTS PROXY] Unexpected error:", error);
    return NextResponse.json({
      fallback: true,
      reason: error.message || "Failed to process TTS request",
    });
  }
}
