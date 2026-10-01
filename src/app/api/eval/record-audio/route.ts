import { NextRequest, NextResponse } from "next/server";
import { isResearchMode } from "@/src/eval/logger";
import fs from "fs";
import path from "path";

export async function POST(req: NextRequest) {
  if (!isResearchMode()) {
    return NextResponse.json(
      { error: "RESEARCH_MODE is off. Audio recording disabled." },
      { status: 403 }
    );
  }

  try {
    const formData = await req.formData();
    const interviewId = formData.get("interviewId") as string;
    const turnId = formData.get("turnId") as string;
    const aiTranscript = formData.get("aiTranscript") as string;
    const file = formData.get("audio") as File | null;

    if (!interviewId || !turnId || !file) {
      return NextResponse.json(
        { error: "Missing interviewId, turnId, or audio file" },
        { status: 400 }
      );
    }

    const evalDir = path.join(process.cwd(), "eval-data");
    const audioDir = path.join(evalDir, "audio");
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }

    const ext = file.type.includes("webm") ? "webm" : "wav";
    const filename = `turn_${interviewId}_t${turnId}.${ext}`;
    const filePath = path.join(audioDir, filename);

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(filePath, buffer);

    // Append to reference_transcript.csv manifest
    const manifestPath = path.join(evalDir, "reference_transcript.csv");
    const relativeAudioPath = path.relative(process.cwd(), filePath).replace(/\\/g, "/");

    if (!fs.existsSync(manifestPath)) {
      const header = "interview_id,turn_id,audio_file_path,ai_transcript,reference_transcript\n";
      fs.writeFileSync(manifestPath, header);
    }

    const escapeCsv = (str: string) => `"${(str || "").replace(/"/g, '""')}"`;
    const line = `${escapeCsv(interviewId)},${escapeCsv(turnId)},${escapeCsv(relativeAudioPath)},${escapeCsv(aiTranscript || "")},""\n`;
    fs.appendFileSync(manifestPath, line);

    console.log(`[RESEARCH_MODE] Saved candidate audio: ${relativeAudioPath}`);

    return NextResponse.json({
      success: true,
      filePath: relativeAudioPath,
    });
  } catch (err: any) {
    console.error("[RESEARCH_MODE] Save audio error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to save audio clip" },
      { status: 500 }
    );
  }
}
