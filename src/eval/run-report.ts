import fs from "fs";
import path from "path";
import {
  calculateWER,
  calculateRelevance,
  calculateResumeRelevance,
  calculatePrecisionRecallF1,
  calculateMAE,
  calculateCorrelations,
  calculateQWK,
  calculateCohensKappa,
  calculatePairedTTest,
} from "./metrics";
import { parseLatencyEvents } from "./collect-latency";

function parseCsv(content: string): Array<Record<string, string>> {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const headers = parseCsvRow(lines[0]);
  const result: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvRow(lines[i]);
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h.trim()] = (values[idx] || "").trim();
    });
    result.push(obj);
  }

  return result;
}

function parseCsvRow(rowStr: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < rowStr.length; i++) {
    const char = rowStr[i];
    if (char === '"' && (i === 0 || rowStr[i - 1] !== "\\")) {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.replace(/^"|"$/g, ""));
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.replace(/^"|"$/g, ""));
  return result;
}

export function runFullReport(): void {
  const evalDir = path.join(process.cwd(), "eval-data");
  const docsDir = path.join(process.cwd(), "docs");

  if (!fs.existsSync(evalDir)) {
    fs.mkdirSync(evalDir, { recursive: true });
  }
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  // Load turns CSVs
  const turnsData: Array<Record<string, string>> = [];
  const questionsData: Array<Record<string, string>> = [];

  const evalFiles = fs.readdirSync(evalDir);
  for (const file of evalFiles) {
    const fullPath = path.join(evalDir, file);
    if (file.startsWith("turns_") && file.endsWith(".csv")) {
      turnsData.push(...parseCsv(fs.readFileSync(fullPath, "utf-8")));
    } else if (file.startsWith("questions_") && file.endsWith(".csv")) {
      questionsData.push(...parseCsv(fs.readFileSync(fullPath, "utf-8")));
    }
  }

  // Latency parsing
  let latencyList: any[] = [];
  const latFile = path.join(evalDir, "latency_events.jsonl");
  if (fs.existsSync(latFile)) {
    const lines = fs.readFileSync(latFile, "utf-8").split("\n");
    const rawEvents = lines
      .filter((l) => l.trim().startsWith("{"))
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const turnMap = parseLatencyEvents(rawEvents);
    latencyList = Object.values(turnMap);
  }

  // Compute metrics
  // 1. WER
  const werPairs = turnsData.map((t) => ({
    reference: t.reference_transcript || "",
    hypothesis: t.ai_transcript || t.candidate_response || "",
  }));
  const werResult = calculateWER(werPairs);

  // 2. Relevance
  const relevanceScores = questionsData.map((q) =>
    q.relevance_score ? parseFloat(q.relevance_score) : null
  );
  const relevanceResult = calculateRelevance(relevanceScores);

  // 3. Resume Relevance
  const resumePairs = questionsData.map((q) => ({
    score: q.resume_relevance_score ? parseFloat(q.resume_relevance_score) : null,
    isResumeGrounded: q.resume_relevance_score !== "N/A" && q.resume_relevance_score !== "",
  }));
  const resumeResult = calculateResumeRelevance(resumePairs);

  // 4. Decision Precision/Recall/F1
  const decisionPairs = turnsData.map((t) => ({
    aiDecision: (t.ai_decision || "").toLowerCase().includes("followup"),
    humanDecision:
      t.human_decision === "" || t.human_decision === undefined
        ? null
        : t.human_decision.toLowerCase() === "true" || t.human_decision === "1",
  }));
  const decisionResult = calculatePrecisionRecallF1(decisionPairs);

  // 5. MAE & Correlations & QWK
  const scorePairs = turnsData
    .filter((t) => t.human_score && t.ai_score)
    .map((t) => ({
      human: parseFloat(t.human_score),
      ai: parseFloat(t.ai_score),
    }));

  const maeResult = calculateMAE(
    turnsData.map((t) => ({
      humanScore: t.human_score ? parseFloat(t.human_score) : null,
      aiScore: t.ai_score ? parseFloat(t.ai_score) : null,
    }))
  );

  const humanScoresArr = scorePairs.map((s) => s.human);
  const aiScoresArr = scorePairs.map((s) => s.ai);

  const corrResult = calculateCorrelations(humanScoresArr, aiScoresArr);
  const qwkResult = calculateQWK(humanScoresArr, aiScoresArr, 0, 10);

  // Latency calculation
  const totalTurnsWithLatency = latencyList.filter((l) => l.L_total !== undefined);
  const avgLatencyVal =
    totalTurnsWithLatency.length > 0
      ? totalTurnsWithLatency.reduce((acc, t) => acc + t.L_total, 0) / totalTurnsWithLatency.length
      : null;

  // Format table output helper
  const fmtResult = (val: string | number | null, reason?: string) => {
    if (val === null || val === undefined) {
      return reason || "insufficient data (n=0, needs human rating)";
    }
    return typeof val === "number" ? val.toFixed(2) : val;
  };

  const tableRows = [
    { measure: "Speech Recognition WER", result: werResult.value !== null ? `${(werResult.value * 100).toFixed(2)}% (n=${werResult.n})` : fmtResult(null, werResult.insufficientReason) },
    { measure: "Question Relevance (1-5)", result: relevanceResult.value !== null ? `${relevanceResult.value.toFixed(1)}% (n=${relevanceResult.n})` : fmtResult(null, relevanceResult.insufficientReason) },
    { measure: "Resume Relevance (1-5)", result: resumeResult.value !== null ? `${resumeResult.value.toFixed(1)}% (n=${resumeResult.n})` : fmtResult(null, resumeResult.insufficientReason) },
    { measure: "Decision Policy Precision", result: decisionResult.value ? `${(decisionResult.value.precision * 100).toFixed(1)}% (n=${decisionResult.n})` : fmtResult(null, decisionResult.insufficientReason) },
    { measure: "Decision Policy Recall", result: decisionResult.value ? `${(decisionResult.value.recall * 100).toFixed(1)}% (n=${decisionResult.n})` : fmtResult(null, decisionResult.insufficientReason) },
    { measure: "Decision Policy F1 Score", result: decisionResult.value ? `${(decisionResult.value.f1 * 100).toFixed(1)}% (n=${decisionResult.n})` : fmtResult(null, decisionResult.insufficientReason) },
    { measure: "Scoring Accuracy MAE", result: maeResult.value !== null ? `${maeResult.value.toFixed(2)} (n=${maeResult.n})` : fmtResult(null, maeResult.insufficientReason) },
    { measure: "Pearson Correlation (r)", result: corrResult.value ? `${corrResult.value.pearson.toFixed(3)} (n=${corrResult.n})` : fmtResult(null, corrResult.insufficientReason) },
    { measure: "Spearman Correlation (ρ)", result: corrResult.value ? `${corrResult.value.spearman.toFixed(3)} (n=${corrResult.n})` : fmtResult(null, corrResult.insufficientReason) },
    { measure: "Quadratic Weighted Kappa (QWK)", result: qwkResult.value !== null ? `${qwkResult.value.toFixed(3)} (n=${qwkResult.n})` : fmtResult(null, qwkResult.insufficientReason) },
    { measure: "Mean End-to-End Latency (L_avg)", result: avgLatencyVal !== null ? `${avgLatencyVal.toFixed(0)} ms (n=${totalTurnsWithLatency.length})` : "insufficient data (n=0, needs recorded latency turns)" },
  ];

  // Print Terminal Output
  console.log("\n=======================================================");
  console.log("    INTERVIEWAI AGGREGATE EVALUATION REPORT (TABLE 7)   ");
  console.log("=======================================================");
  console.log("| Performance Measure             | Result                                                  |");
  console.log("|---------------------------------|---------------------------------------------------------|");
  for (const r of tableRows) {
    console.log(`| ${r.measure.padEnd(31)} | ${r.result.padEnd(55)} |`);
  }
  console.log("=======================================================\n");

  // Write STATISTICS.md
  const statsMdPath = path.join(docsDir, "STATISTICS.md");
  let mdContent = `# InterviewAI Evaluation & Performance Statistics Report

*Generated on ${new Date().toISOString()}*

---

## 📊 Summary Performance Metrics (Table 7)

| Performance Measure | Result |
|:---|:---|
`;

  for (const r of tableRows) {
    mdContent += `| **${r.measure}** | \`${r.result}\` |\n`;
  }

  mdContent += `
---

## 🔬 Methodology & Evaluation Setup (Section 10)

- **Total Exported Interview Sessions Analyzed:** \`${turnsData.length ? new Set(turnsData.map(t => t.interview_id)).size : 0}\`
- **Total Individual Turns Processed:** \`${turnsData.length}\`
- **Total Questions Evaluated:** \`${questionsData.length}\`
- **Recorded Latency Turns:** \`${totalTurnsWithLatency.length}\`
- **Evaluator Process:** Standardized blind comparison between candidate transcripts/audio recordings and AI turn decisions, scores, and speech outputs.

---

## 📈 Raw Data Appendix & Traceability (Section 11)

Every reported percentage and metric in this document is computed from empirical observation data stored in \`eval-data/\`.

### 1. Per-Turn Latency Observations
${
  totalTurnsWithLatency.length > 0
    ? totalTurnsWithLatency
        .map((t) => `- **Interview ${t.interviewId} / Turn ${t.turnId}:** L_STT=${t.L_STT ?? "-"}ms, L_LLM=${t.L_LLM ?? "-"}ms, L_TTS=${t.L_TTS ?? "-"}ms, L_total=${t.L_total ?? "-"}ms`)
        .join("\n")
    : "*No latency observations recorded yet. Run interviews in RESEARCH_MODE=true.*"
}

### 2. Human vs AI Score Observations
${
  scorePairs.length > 0
    ? scorePairs
        .map((s, idx) => `- Pair ${idx + 1}: Human Score = ${s.human}, AI Score = ${s.ai}, |Diff| = ${Math.abs(s.human - s.ai)}`)
        .join("\n")
    : "*No human score pairs populated yet. Fill in human_score column in eval-data/turns_*.csv to calculate.*"
}

### 3. Word Error Rate (WER) Observations
${
  werPairs.filter((w) => w.reference.trim().length > 0).length > 0
    ? werPairs
        .filter((w) => w.reference.trim().length > 0)
        .map((w, idx) => `- Pair ${idx + 1}: Ref = "${w.reference}", Hyp = "${w.hypothesis}"`)
        .join("\n")
    : "*No reference transcripts provided yet. Fill in reference_transcript column in eval-data/turns_*.csv to calculate WER.*"
}
`;

  fs.writeFileSync(statsMdPath, mdContent);
  console.log(`[REPORT] Wrote comprehensive statistics to: ${statsMdPath}\n`);
}

if (require.main === module) {
  runFullReport();
}
