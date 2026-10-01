import fs from "fs";
import path from "path";
import { LatencyEvent } from "./logger";

export interface TurnLatency {
  interviewId: string;
  turnId: string | number;
  t1?: number; // candidate_speech_end
  t2?: number; // turn_request_received
  t3?: number; // llm_completion
  t4_start?: number; // tts_start
  t4_finish?: number; // tts_finish
  t5?: number; // audio_playback_start
  L_STT?: number;
  L_LLM?: number;
  L_TTS?: number;
  L_total?: number;
}

export function parseLatencyEvents(events: LatencyEvent[], targetInterviewId?: string): Record<string, TurnLatency> {
  const turns: Record<string, TurnLatency> = {};

  for (const ev of events) {
    if (targetInterviewId && ev.interviewId !== targetInterviewId) continue;
    const key = `${ev.interviewId}_turn_${ev.turnId}`;
    if (!turns[key]) {
      turns[key] = {
        interviewId: ev.interviewId,
        turnId: ev.turnId,
      };
    }

    const t = turns[key];
    switch (ev.stage) {
      case "candidate_speech_end":
        t.t1 = ev.ts;
        break;
      case "turn_request_received":
        t.t2 = ev.ts;
        break;
      case "llm_completion":
        t.t3 = ev.ts;
        break;
      case "tts_start":
        t.t4_start = ev.ts;
        break;
      case "tts_finish":
        t.t4_finish = ev.ts;
        break;
      case "audio_playback_start":
        t.t5 = ev.ts;
        break;
    }
  }

  // Compute latencies per turn
  for (const key in turns) {
    const t = turns[key];
    if (t.t2 !== undefined && t.t1 !== undefined) {
      t.L_STT = Math.max(0, t.t2 - t.t1);
    }
    if (t.t3 !== undefined && t.t2 !== undefined) {
      t.L_LLM = Math.max(0, t.t3 - t.t2);
    }
    if (t.t4_finish !== undefined && t.t4_start !== undefined) {
      t.L_TTS = Math.max(0, t.t4_finish - t.t4_start);
    } else if (t.t5 !== undefined && t.t3 !== undefined) {
      t.L_TTS = Math.max(0, t.t5 - t.t3);
    }
    if (t.t5 !== undefined && t.t1 !== undefined) {
      t.L_total = Math.max(0, t.t5 - t.t1);
    } else if (t.t3 !== undefined && t.t1 !== undefined) {
      // Fallback if client T5 missing
      t.L_total = Math.max(0, (t.t4_finish ?? t.t3) - t.t1);
    }
  }

  return turns;
}

export function printLatencyReport(targetInterviewId?: string, logFilePath?: string): void {
  const events: LatencyEvent[] = [];

  // Read from latency_events.jsonl if available
  const defaultLogFile = path.join(process.cwd(), "eval-data", "latency_events.jsonl");
  const fileToRead = logFilePath || defaultLogFile;

  if (fs.existsSync(fileToRead)) {
    const content = fs.readFileSync(fileToRead, "utf-8");
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        if (trimmed.startsWith("{")) {
          events.push(JSON.parse(trimmed));
        } else if (trimmed.includes("[EVAL_LATENCY]")) {
          // Parse structured console log output line
          // e.g. [EVAL_LATENCY] interviewId=xyz turnId=1 stage=candidate_speech_end ts=1690000000000
          const matchId = trimmed.match(/interviewId=([^\s]+)/);
          const matchTurn = trimmed.match(/turnId=([^\s]+)/);
          const matchStage = trimmed.match(/stage=([^\s]+)/);
          const matchTs = trimmed.match(/ts=([0-9]+)/);

          if (matchId && matchTurn && matchStage && matchTs) {
            events.push({
              interviewId: matchId[1],
              turnId: matchTurn[1],
              stage: matchStage[1] as any,
              ts: parseInt(matchTs[1], 10),
            });
          }
        }
      } catch {
        // skip unparseable
      }
    }
  }

  if (events.length === 0) {
    console.log("\n=======================================================");
    console.log("             PER-TURN LATENCY REPORT                  ");
    console.log("=======================================================");
    console.log(`insufficient data: no latency events recorded yet in ${fileToRead}`);
    console.log("Enable RESEARCH_MODE=true and run an interview to record latencies.\n");
    return;
  }

  const turnMap = parseLatencyEvents(events, targetInterviewId);
  const turnList = Object.values(turnMap);

  console.log("\n=======================================================");
  console.log("             PER-TURN LATENCY REPORT                  ");
  console.log("=======================================================");
  console.log(`Target Session: ${targetInterviewId || "All recorded sessions"}`);
  console.log(`Total turns analyzed: ${turnList.length}\n`);

  console.log("| Turn ID | L_STT (ms) | L_LLM (ms) | L_TTS (ms) | L_total (ms) |");
  console.log("|---------|------------|------------|------------|--------------|");

  let sumSTT = 0, countSTT = 0;
  let sumLLM = 0, countLLM = 0;
  let sumTTS = 0, countTTS = 0;
  let sumTotal = 0, countTotal = 0;

  for (const t of turnList) {
    const stt = t.L_STT !== undefined ? `${t.L_STT}ms` : "-";
    const llm = t.L_LLM !== undefined ? `${t.L_LLM}ms` : "-";
    const tts = t.L_TTS !== undefined ? `${t.L_TTS}ms` : "-";
    const tot = t.L_total !== undefined ? `${t.L_total}ms` : "-";

    if (t.L_STT !== undefined) { sumSTT += t.L_STT; countSTT++; }
    if (t.L_LLM !== undefined) { sumLLM += t.L_LLM; countLLM++; }
    if (t.L_TTS !== undefined) { sumTTS += t.L_TTS; countTTS++; }
    if (t.L_total !== undefined) { sumTotal += t.L_total; countTotal++; }

    console.log(`| Turn ${String(t.turnId).padEnd(2)} | ${stt.padEnd(10)} | ${llm.padEnd(10)} | ${tts.padEnd(10)} | ${tot.padEnd(12)} |`);
  }

  console.log("|---------|------------|------------|------------|--------------|");
  const avgSTT = countSTT > 0 ? `${(sumSTT / countSTT).toFixed(1)}ms` : "-";
  const avgLLM = countLLM > 0 ? `${(sumLLM / countLLM).toFixed(1)}ms` : "-";
  const avgTTS = countTTS > 0 ? `${(sumTTS / countTTS).toFixed(1)}ms` : "-";
  const avgTotal = countTotal > 0 ? `${(sumTotal / countTotal).toFixed(1)}ms` : "-";

  console.log(`| MEAN    | ${avgSTT.padEnd(10)} | ${avgLLM.padEnd(10)} | ${avgTTS.padEnd(10)} | ${avgTotal.padEnd(12)} |`);
  console.log("=======================================================\n");
}

// CLI runner
if (require.main === module) {
  const args = process.argv.slice(2);
  const interviewIdArg = args[0];
  const filePathArg = args[1];
  printLatencyReport(interviewIdArg, filePathArg);
}
