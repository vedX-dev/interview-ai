/**
 * TTS proxy route (Sarvam Bulbul v3).
 *
 * Phase C improvements:
 * - Strip markdown, code blocks, URLs, emojis before synthesis
 * - Hash-based cache key (sha256 of text+voice) — safe for large inputs
 * - Per-user daily character budget (tracked in memory, reset midnight UTC)
 * - Global daily character budget cap
 * - Fallback to browser SpeechSynthesis with { fallback: true } signal
 * - Returns JSON on every error path
 */

import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "crypto";

// ─── Constants ────────────────────────────────────────────────────────────────

const SARVAM_API = "https://api.sarvam.ai/text-to-speech";
const MAX_CHUNK_CHARS = 400;         // Sarvam Bulbul v3 safe limit
const MAX_TEXT_CHARS = 2000;         // Per-request input cap
const GLOBAL_DAILY_CHARS = 200_000; // ~400 interview turns/day globally
const USER_DAILY_CHARS = 5_000;     // Per-user daily budget
const CACHE_MAX_ENTRIES = 500;

// ─── Zod schema ───────────────────────────────────────────────────────────────

const TTSRequestSchema = z.object({
  text: z.string().min(1).max(MAX_TEXT_CHARS),
  speaker: z.string().optional().default("aditya"),
});

// ─── In-memory cache (hash → base64 audio chunks) ────────────────────────────

const ttsCache = new Map<string, string[]>();

function cacheKey(text: string, speaker: string): string {
  return createHash("sha256")
    .update(`${speaker}:${text}`)
    .digest("hex");
}

// ─── Per-user and global daily budget ────────────────────────────────────────

interface DailyBudget {
  chars: number;
  date: string; // YYYY-MM-DD UTC
}

const userBudgets = new Map<string, DailyBudget>();
let globalBudget: DailyBudget = { chars: 0, date: todayUTC() };

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function checkAndDeductBudget(userId: string, charCount: number): boolean {
  const today = todayUTC();

  // Reset global budget on new day
  if (globalBudget.date !== today) {
    globalBudget = { chars: 0, date: today };
  }
  if (globalBudget.chars + charCount > GLOBAL_DAILY_CHARS) return false;

  // Reset per-user budget on new day
  const ub = userBudgets.get(userId) ?? { chars: 0, date: today };
  if (ub.date !== today) { ub.chars = 0; ub.date = today; }
  if (ub.chars + charCount > USER_DAILY_CHARS) return false;

  // Deduct
  globalBudget.chars += charCount;
  ub.chars += charCount;
  userBudgets.set(userId, ub);
  return true;
}

// ─── Text preprocessing ───────────────────────────────────────────────────────

function stripForTTS(raw: string): string {
  return raw
    // Code fences
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    // Markdown headings
    .replace(/^#{1,6}\s+/gm, "")
    // Bold/italic
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    .replace(/_{1,3}([^_]+)_{1,3}/g, "$1")
    // URLs
    .replace(/https?:\/\/\S+/g, "")
    // Markdown links
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Emojis (basic Unicode ranges)
    .replace(/[\u{1F300}-\u{1FFFF}]/gu, "")
    .replace(/[\u{2600}-\u{27BF}]/gu, "")
    // Bullet points
    .replace(/^[-*+]\s+/gm, "")
    // Multiple whitespace/newlines
    .replace(/\n{2,}/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ─── Chunking ─────────────────────────────────────────────────────────────────

function chunkText(text: string, maxLen = MAX_CHUNK_CHARS): string[] {
  const sentences = text.split(/(?<=[.?!])\s+/);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if ((current + " " + sentence).trim().length <= maxLen) {
      current = (current + " " + sentence).trim();
    } else {
      if (current) chunks.push(current);
      if (sentence.length > maxLen) {
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

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized", code: "AUTH_REQUIRED" }, { status: 401 });
    }

    const body = TTSRequestSchema.parse(await req.json());
    const speaker = body.speaker ?? "aditya";

    // Strip markdown / emoji / code before TTS
    const cleanText = stripForTTS(body.text);
    if (!cleanText) {
      return NextResponse.json({ fallback: true, reason: "Text empty after preprocessing" });
    }

    const key = cacheKey(cleanText, speaker);

    // Cache hit
    if (ttsCache.has(key)) {
      console.log(`[TTS] Cache HIT speaker=${speaker} len=${cleanText.length}`);
      return NextResponse.json({ audios: ttsCache.get(key), cached: true, fallback: false });
    }

    // Budget check
    if (!checkAndDeductBudget(userId, cleanText.length)) {
      console.warn(`[TTS] Budget exceeded for user=${userId} len=${cleanText.length}`);
      return NextResponse.json({ fallback: true, reason: "Daily TTS character budget reached" });
    }

    const sarvamKey = process.env.SARVAM_API_KEY;
    if (!sarvamKey) {
      console.warn("[TTS] SARVAM_API_KEY not configured");
      return NextResponse.json({ fallback: true, reason: "TTS service not configured" });
    }

    const chunks = chunkText(cleanText);
    console.log(`[TTS] Synthesizing ${chunks.length} chunk(s) speaker=${speaker} totalChars=${cleanText.length}`);

    const audioResults: string[] = [];

    for (const chunk of chunks) {
      const resp = await fetch(SARVAM_API, {
        method: "POST",
        headers: {
          "api-subscription-key": sarvamKey,
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

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        console.warn(`[TTS] Sarvam returned ${resp.status}: ${errText.slice(0, 120)}`);
        return NextResponse.json({
          fallback: true,
          reason: `Sarvam API error ${resp.status}`,
        });
      }

      const data = await resp.json();
      if (data.audios?.[0]) {
        audioResults.push(data.audios[0]);
      }
    }

    if (audioResults.length === 0) {
      return NextResponse.json({ fallback: true, reason: "No audio generated" });
    }

    // Store in cache with LRU eviction
    ttsCache.set(key, audioResults);
    if (ttsCache.size > CACHE_MAX_ENTRIES) {
      const firstKey = ttsCache.keys().next().value;
      if (firstKey) ttsCache.delete(firstKey);
    }

    return NextResponse.json({ audios: audioResults, cached: false, fallback: false });
  } catch (error: any) {
    console.error("[TTS] Unexpected error:", error?.message);
    return NextResponse.json({
      fallback: true,
      reason: error?.message ?? "Unexpected TTS error",
    });
  }
}
