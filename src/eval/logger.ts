import fs from "fs";
import path from "path";

export type LatencyStage =
  | "candidate_speech_end"    // T1
  | "turn_request_received"  // T2
  | "llm_completion"         // T3
  | "tts_start"              // T4_start
  | "tts_finish"             // T4_finish
  | "audio_playback_start";  // T5

export interface LatencyEvent {
  interviewId: string;
  turnId: number | string;
  stage: LatencyStage;
  ts: number; // epoch ms
  extra?: Record<string, unknown>;
}

export function isResearchMode(): boolean {
  return (
    process.env.RESEARCH_MODE === "true" ||
    process.env.NEXT_PUBLIC_RESEARCH_MODE === "true"
  );
}

export function logEvalLatency(event: LatencyEvent): void {
  if (!isResearchMode()) return;

  const line = `[EVAL_LATENCY] interviewId=${event.interviewId} turnId=${event.turnId} stage=${event.stage} ts=${event.ts}${
    event.extra ? ` extra=${JSON.stringify(event.extra)}` : ""
  }`;

  console.log(line);

  // Synchronously/safely record to eval-data/latency_events.jsonl on server side
  if (typeof window === "undefined") {
    try {
      const evalDir = path.join(process.cwd(), "eval-data");
      if (!fs.existsSync(evalDir)) {
        fs.mkdirSync(evalDir, { recursive: true });
      }
      fs.appendFileSync(
        path.join(evalDir, "latency_events.jsonl"),
        JSON.stringify(event) + "\n",
      );
    } catch (err) {
      console.error("[EVAL_LATENCY] File write error:", err);
    }
  }
}
