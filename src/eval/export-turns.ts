import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import fs from "fs";
import path from "path";
import { parseLatencyEvents } from "./collect-latency";
import { LatencyEvent } from "./logger";

export async function exportTurnsCSV(interviewId?: string): Promise<string> {
  const { db } = await import("@/src/db/index");
  const { interviews, transcriptChunks } = await import("@/src/db/schema");
  const { eq, asc } = await import("drizzle-orm");

  const evalDir = path.join(process.cwd(), "eval-data");
  if (!fs.existsSync(evalDir)) {
    fs.mkdirSync(evalDir, { recursive: true });
  }

  // Fetch interviews to export
  let targetInterviews: Array<{ id: string; plan: any }> = [];
  if (interviewId) {
    const rows = await db
      .select({ id: interviews.id, plan: interviews.plan })
      .from(interviews)
      .where(eq(interviews.id, interviewId));
    targetInterviews = rows;
  } else {
    const rows = await db
      .select({ id: interviews.id, plan: interviews.plan })
      .from(interviews);
    targetInterviews = rows;
  }

  if (targetInterviews.length === 0) {
    console.log(`[EXPORT_TURNS] No interviews found in DB${interviewId ? ` for id=${interviewId}` : ""}.`);
    return "";
  }

  // Read latency events log if present
  let latencyMap: Record<string, any> = {};
  const latFile = path.join(evalDir, "latency_events.jsonl");
  if (fs.existsSync(latFile)) {
    const lines = fs.readFileSync(latFile, "utf-8").split("\n");
    const events: LatencyEvent[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        if (line.startsWith("{")) events.push(JSON.parse(line));
      } catch {}
    }
    latencyMap = parseLatencyEvents(events);
  }

  const exportId = interviewId || "all";
  const outputPath = path.join(evalDir, `turns_${exportId}.csv`);

  const csvRows: string[] = [];
  // Table 5 columns per PDF specification plus evaluator_id:
  // interview_id, turn_id, candidate_response, reference_transcript, ai_transcript, ai_decision, human_decision, ai_score, human_score, evaluator_id, t1, t2, t3, t4, t5
  const header = "interview_id,turn_id,candidate_response,reference_transcript,ai_transcript,ai_decision,human_decision,ai_score,human_score,evaluator_id,t1,t2,t3,t4,t5";
  csvRows.push(header);

  let totalTurnsExported = 0;

  for (const target of targetInterviews) {
    const chunks = await db
      .select()
      .from(transcriptChunks)
      .where(eq(transcriptChunks.interviewId, target.id))
      .orderBy(asc(transcriptChunks.createdAt));

    // Group user/ai transcript turns sequentially
    const userChunks = chunks.filter((c) => c.speaker === "user");
    const aiChunks = chunks.filter((c) => c.speaker === "ai");

    const plan = target.plan as any;
    const scores = plan?.scores || [];
    const asked = plan?.asked || [];

    for (let i = 0; i < userChunks.length; i++) {
      const userChunk = userChunks[i];
      const turnNum = i + 1;

      const userText = userChunk.content || "";
      const aiTranscriptText = userText; // AI STT hypothesis
      const scoreObj = scores.find((s: any) => s.turnIndex === turnNum - 1 || s.turnIndex === turnNum);
      const askedObj = asked.find((a: any) => a.turnIndex === turnNum - 1 || a.turnIndex === turnNum);

      // Determine AI decision action: check lastResponse _dev action or topic change
      const aiDecisionAction =
        plan?.lastResponse?._dev?.action ||
        (askedObj?.topic === "warmup" ? "next_topic" : i > 1 ? "followup" : "next_topic");

      const aiScoreVal = scoreObj?.score !== undefined ? String(scoreObj.score) : "";

      const latKey = `${target.id}_turn_${turnNum}`;
      const lat = latencyMap[latKey] || {};

      const escapeCsv = (str: string) => `"${(str || "").replace(/"/g, '""')}"`;

      const row = [
        escapeCsv(target.id),
        turnNum,
        escapeCsv(userText),
        "", // reference_transcript (BLANK for human input)
        escapeCsv(aiTranscriptText),
        escapeCsv(aiDecisionAction),
        "", // human_decision (BLANK for human input)
        aiScoreVal, // ai_score
        "", // human_score (BLANK for human input)
        "evaluator_1", // evaluator_id
        lat.t1 || "",
        lat.t2 || "",
        lat.t3 || "",
        lat.t4_finish || lat.t4_start || "",
        lat.t5 || "",
      ].join(",");

      csvRows.push(row);
      totalTurnsExported++;
    }
  }

  fs.writeFileSync(outputPath, csvRows.join("\n"));

  console.log("\n=======================================================");
  console.log("             EXPORT TURNS CSV (Table 5)               ");
  console.log("=======================================================");
  console.log(`Exported file: ${outputPath}`);
  console.log(`Total turn rows exported: ${totalTurnsExported}`);
  console.log("Columns needing manual human input:");
  console.log("  - reference_transcript (exact reference text for WER)");
  console.log("  - human_decision (boolean/label for decision policy accuracy)");
  console.log("  - human_score (1-5 or 0-10 rating for scoring accuracy MAE/QWK)");
  console.log("=======================================================\n");

  return outputPath;
}

if (require.main === module) {
  const targetId = process.argv[2];
  exportTurnsCSV(targetId).catch((err) => console.error("Export error:", err));
}
