import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

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
} from "./metrics";
import { parseLatencyEvents } from "./collect-latency";
import { LatencyEvent } from "./logger";

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

export function generateVivaDoc(): void {
  const evalDir = path.join(process.cwd(), "eval-data");
  const docsDir = path.join(process.cwd(), "docs");

  if (!fs.existsSync(evalDir)) fs.mkdirSync(evalDir, { recursive: true });
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

  // Load fresh CSV data
  const turnsData: Array<Record<string, string>> = [];
  const questionsData: Array<Record<string, string>> = [];

  if (fs.existsSync(evalDir)) {
    const files = fs.readdirSync(evalDir);
    for (const file of files) {
      const fullPath = path.join(evalDir, file);
      if (file.startsWith("turns_") && file.endsWith(".csv")) {
        turnsData.push(...parseCsv(fs.readFileSync(fullPath, "utf-8")));
      } else if (file.startsWith("questions_") && file.endsWith(".csv")) {
        questionsData.push(...parseCsv(fs.readFileSync(fullPath, "utf-8")));
      }
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
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter((e): e is LatencyEvent => e !== null);
    const turnMap = parseLatencyEvents(rawEvents);
    latencyList = Object.values(turnMap);
  }

  const totalTurns = turnsData.length;
  const totalQuestions = questionsData.length;

  // Study Scope metrics
  const distinctInterviews = new Set(turnsData.map((t) => t.interview_id)).size;
  const distinctResumes = distinctInterviews; // Each interview session maps to a candidate profile
  const turnsWithAnyRating = turnsData.filter(
    (t) =>
      (t.reference_transcript || "").trim().length > 0 ||
      (t.human_decision || "").trim().length > 0 ||
      (t.human_score || "").trim().length > 0
  ).length;

  const evaluatorsSet = new Set<string>();
  turnsData.forEach((t) => { if (t.evaluator_id) evaluatorsSet.add(t.evaluator_id); });
  questionsData.forEach((q) => { if (q.evaluator_id) evaluatorsSet.add(q.evaluator_id); });
  const distinctEvaluators = evaluatorsSet.size || (turnsWithAnyRating > 0 ? 1 : 0);

  // 1. WER (Section 2)
  const refFilledRows = turnsData.filter((t) => (t.reference_transcript || "").trim().length > 0);
  const werPairs = turnsData.map((t) => ({
    reference: t.reference_transcript || "",
    hypothesis: t.ai_transcript || t.candidate_response || "",
  }));
  const werResult = calculateWER(werPairs);

  // 2. Question Relevance (Section 3)
  const ratedQuestions = questionsData.filter((q) => q.relevance_score && !isNaN(parseFloat(q.relevance_score)));
  const relevanceScores = questionsData.map((q) => (q.relevance_score ? parseFloat(q.relevance_score) : null));
  const relevanceResult = calculateRelevance(relevanceScores);

  // 3. Resume Relevance (Section 4)
  const resumeGroundedQuestions = questionsData.filter((q) => q.resume_relevance_score !== "N/A");
  const ratedResumeQuestions = questionsData.filter(
    (q) => q.resume_relevance_score && q.resume_relevance_score !== "N/A" && !isNaN(parseFloat(q.resume_relevance_score))
  );
  const resumePairs = questionsData.map((q) => ({
    score: q.resume_relevance_score ? parseFloat(q.resume_relevance_score) : null,
    isResumeGrounded: q.resume_relevance_score !== "N/A" && q.resume_relevance_score !== "",
  }));
  const resumeResult = calculateResumeRelevance(resumePairs);

  // 4. Precision / Recall / F1 (Section 5)
  const ratedDecisionTurns = turnsData.filter((t) => t.human_decision !== "" && t.human_decision !== undefined);
  const decisionPairs = turnsData.map((t) => ({
    aiDecision: (t.ai_decision || "").toLowerCase().includes("followup") || (t.ai_decision || "").toLowerCase() === "true",
    humanDecision:
      t.human_decision === "" || t.human_decision === undefined
        ? null
        : t.human_decision.toLowerCase() === "true" || t.human_decision === "1" || t.human_decision.toLowerCase().includes("followup"),
  }));
  const decisionResult = calculatePrecisionRecallF1(decisionPairs);

  // 5. Latency (Section 6)
  const latencyTurns = latencyList.filter((l) => l.L_total !== undefined);
  const avgSTT = latencyTurns.length > 0 ? latencyTurns.reduce((a, t) => a + (t.L_STT || 0), 0) / latencyTurns.length : null;
  const avgLLM = latencyTurns.length > 0 ? latencyTurns.reduce((a, t) => a + (t.L_LLM || 0), 0) / latencyTurns.length : null;
  const avgTTS = latencyTurns.length > 0 ? latencyTurns.reduce((a, t) => a + (t.L_TTS || 0), 0) / latencyTurns.length : null;
  const avgTotal = latencyTurns.length > 0 ? latencyTurns.reduce((a, t) => a + t.L_total, 0) / latencyTurns.length : null;

  // 6. AI vs Human Evaluation / MAE / Correlations (Section 7)
  const ratedScoreTurns = turnsData.filter((t) => t.human_score && t.ai_score);
  const maeResult = calculateMAE(
    turnsData.map((t) => ({
      humanScore: t.human_score ? parseFloat(t.human_score) : null,
      aiScore: t.ai_score ? parseFloat(t.ai_score) : null,
    }))
  );

  const humanScoresArr = ratedScoreTurns.map((t) => parseFloat(t.human_score));
  const aiScoresArr = ratedScoreTurns.map((t) => parseFloat(t.ai_score));
  const corrResult = calculateCorrelations(humanScoresArr, aiScoresArr);
  const qwkResult = calculateQWK(humanScoresArr, aiScoresArr, 0, 10);

  // Pre-format Table 7 strings (WITHOUT Target Benchmark column)
  const werSummary = werResult.value !== null ? `\`${(werResult.value * 100).toFixed(2)}% (n=${werResult.n})\`` : "`Not yet measured (n=0)`";
  const relevanceSummary = relevanceResult.value !== null ? `\`${relevanceResult.value.toFixed(1)}% (n=${relevanceResult.n})\`` : "`Not yet measured (n=0)`";
  const resumeSummary = resumeResult.value !== null ? `\`${resumeResult.value.toFixed(1)}% (n=${resumeResult.n})\`` : "`Not yet measured (n=0)`";
  const precSummary = decisionResult.value ? `\`${(decisionResult.value.precision * 100).toFixed(1)}% (n=${decisionResult.n})\`` : "`Not yet measured (n=0)`";
  const recSummary = decisionResult.value ? `\`${(decisionResult.value.recall * 100).toFixed(1)}% (n=${decisionResult.n})\`` : "`Not yet measured (n=0)`";
  const f1Summary = decisionResult.value ? `\`${(decisionResult.value.f1 * 100).toFixed(1)}% (n=${decisionResult.n})\`` : "`Not yet measured (n=0)`";
  const maeSummary = maeResult.value !== null ? `\`${maeResult.value.toFixed(2)} (n=${maeResult.n})\`` : "`Not yet measured (n=0)`";
  const pearsonSummary = corrResult.value ? `\`${corrResult.value.pearson.toFixed(3)} (n=${corrResult.n})\`` : "`Not yet measured (n=0)`";
  const spearmanSummary = corrResult.value ? `\`${corrResult.value.spearman.toFixed(3)} (n=${corrResult.n})\`` : "`Not yet measured (n=0)`";
  const qwkSummary = qwkResult.value !== null ? `\`${qwkResult.value.toFixed(3)} (n=${qwkResult.n})\`` : "`Not yet measured (n=0)`";
  const latSummary = avgTotal !== null ? `\`${avgTotal.toFixed(0)} ms (n=${latencyTurns.length})\`` : "`Not yet measured (n=0)`";

  const sttStr = avgSTT !== null ? `${avgSTT.toFixed(1)} ms` : "N/A";
  const llmStr = avgLLM !== null ? `${avgLLM.toFixed(1)} ms` : "N/A";
  const ttsStr = avgTTS !== null ? `${avgTTS.toFixed(1)} ms` : "N/A";
  const totStr = avgTotal !== null ? `${avgTotal.toFixed(1)} ms` : "N/A";

  // Check sample sizes for dynamic warning banner
  const maxN = Math.max(werResult.n, relevanceResult.n, decisionResult.n, maeResult.n, latencyTurns.length);
  const isSmallSample = maxN < 20;

  // Build Document Content
  const nowStr = new Date().toISOString();
  let doc = `# Viva AI Performance Evaluation and Quantitative Measurement Report

*System: InterviewAI Autonomous Technical Interviewer*  
*Generated on: ${nowStr}*  
*Data Sources: \`eval-data/turns_*.csv\`, \`eval-data/questions_*.csv\`, \`eval-data/latency_events.jsonl\`*

---
`;

  if (isSmallSample) {
    doc += `> [!WARNING]
> ⚠️ **Sample sizes in this report are currently very small (n=${maxN} max for rated metrics).**  
> These results should not be treated as statistically reliable or submission-ready until each metric's sample size reaches a reasonable benchmark (recommend 20+ per metric, more for correlation measures like Pearson/Spearman/QWK).

---
`;
  }

  doc += `
## 1. Overview & Study Scope

### Overview & Purpose
This document presents the empirical quantitative evaluation results for **InterviewAI**, executing the measurement methodology specified in the *Viva AI Performance Evaluation and Quantitative Measurement Guide*. All metrics reported herein are computed directly from real recorded session data and verified human evaluations.

### Study Scope (Empirical Data Summary)
- **Distinct Interview Sessions Analyzed:** \`${distinctInterviews}\`
- **Distinct Candidate Profiles / Resumes:** \`${distinctResumes}\`
- **Total Exported Turns:** \`${totalTurns}\`
- **Turns with Human Ratings:** \`${turnsWithAnyRating}\` of \`${totalTurns}\`
- **Distinct Human Evaluators:** \`${distinctEvaluators}\`

---

## 2. Speech Recognition Error (Word Error Rate - WER)

### Formula
$$WER = \\frac{S + D + I}{N}$$

Where $S$ is substitutions, $D$ is deletions, $I$ is insertions, and $N$ is total words in reference transcripts.

### Results
`;

  if (werResult.value !== null && refFilledRows.length > 0) {
    const details = werResult.details as any;
    doc += `**Overall Mean WER:** \`${(werResult.value * 100).toFixed(2)}%\` (Sample size $n=${werResult.n}$ turns)  
- **Substitutions ($S$):** ${details.substitutions}
- **Deletions ($D$):** ${details.deletions}
- **Insertions ($I$):** ${details.insertions}
- **Reference Words ($N$):** ${details.referenceWords}

| Session & Turn ID | Reference Transcript | AI Transcript (STT Output) | Per-Row WER % |
|:---|:---|:---|:---|
`;
    for (const t of refFilledRows) {
      const singleWer = calculateWER([{ reference: t.reference_transcript, hypothesis: t.ai_transcript || t.candidate_response }]);
      const rowWerPct = singleWer.value !== null ? (singleWer.value * 100).toFixed(1) + "%" : "N/A";
      const shortId = t.interview_id ? `${t.interview_id.slice(0, 8)}… / Turn ${t.turn_id}` : `Turn ${t.turn_id}`;
      doc += `| \`${shortId}\` | "${t.reference_transcript}" | "${t.ai_transcript || t.candidate_response}" | \`${rowWerPct}\` |\n`;
    }
  } else {
    doc += `Not yet measured — requires manually verified reference transcripts (see Section 2.1 of the guide). 0 of ${totalTurns} turns have a reference transcript filled in.\n`;
  }

  doc += `
---

## 3. Adaptive Questioning Quality (Question Relevance)

### Formula
$$Relevance\\% = \\frac{\\sum_{i=1}^{n} Relevance_i}{5 \\times n} \\times 100$$

### Results
`;

  if (relevanceResult.value !== null && ratedQuestions.length > 0) {
    doc += `**Overall Question Relevance:** \`${relevanceResult.value.toFixed(1)}%\` (Sample size $n=${relevanceResult.n}$ rated questions out of ${totalQuestions} exported questions)
- **Rated Questions:** ${ratedQuestions.length} of ${totalQuestions} exported questions are rated
`;
  } else {
    doc += `Not yet measured — requires human relevance ratings. 0 of ${totalQuestions} exported questions are rated.\n`;
  }

  doc += `
---

## 4. Resume-Aware Questioning

### Formula
$$ResumeRelevance\\% = \\frac{\\sum_{i=1}^{n_{resume}} Relevance_i}{5 \\times n_{resume}} \\times 100$$

### Results
`;

  if (resumeResult.value !== null && ratedResumeQuestions.length > 0) {
    doc += `**Resume-Grounded Question Relevance:** \`${resumeResult.value.toFixed(1)}%\` (Sample size $n=${resumeResult.n}$ rated resume questions out of ${resumeGroundedQuestions.length} resume-grounded questions)
- **Resume-Grounded Questions:** ${resumeGroundedQuestions.length} of ${totalQuestions} total questions were resume-grounded
`;
  } else {
    doc += `Not yet measured — requires human rating for resume-grounded questions. 0 of ${resumeGroundedQuestions.length} resume-grounded questions (out of ${totalQuestions} total) have a score filled in.\n`;
  }

  doc += `
---

## 5. Decision Policy Accuracy (Precision, Recall, F1)

### Formulas
$$\\text{Precision} = \\frac{TP}{TP + FP}, \\quad \\text{Recall} = \\frac{TP}{TP + FN}, \\quad F_1 = \\frac{2 \\cdot \\text{Precision} \\cdot \\text{Recall}}{\\text{Precision} + \\text{Recall}}$$

### Confusion Matrix & Results
`;

  if (decisionResult.value !== null && ratedDecisionTurns.length > 0) {
    const d = decisionResult.value;
    doc += `**Evaluated Turns ($n=${decisionResult.n}$):**

| | Human: Follow-up Needed | Human: Next Topic / Wrapup |
|:---|:---|:---|
| **AI: Follow-up** | TP = ${d.tp} | FP = ${d.fp} |
| **AI: Next Topic / Wrapup** | FN = ${d.fn} | TN = ${d.tn} |

- **Precision:** \`${(d.precision * 100).toFixed(1)}%\`
- **Recall:** \`${(d.recall * 100).toFixed(1)}%\`
- **F1 Score:** \`${(d.f1 * 100).toFixed(1)}%\`
`;
  } else {
    doc += `Not yet measured — requires human decision ratings. 0 of ${totalTurns} turns have human decision labels.\n`;
  }

  doc += `
---

## 6. Response Latency ($L_{total}$)

### Component Breakdown (Table 3 Layout)
- **Sessions Analyzed:** \`${new Set(latencyTurns.map((l) => l.interviewId)).size}\` session(s)
- **Total Turns Analyzed:** \`${latencyTurns.length}\` turn(s)

| Component Stage | Average Latency (ms) |
|:---|:---|
| **Speech recognition ($L_{STT}$)** | \`${sttStr}\` |
| **LLM reasoning & response ($L_{LLM}$)** | \`${llmStr}\` |
| **Speech synthesis ($L_{TTS}$)** | \`${ttsStr}\` |
| **Total End-to-End Latency ($L_{total}$)** | **\`${totStr}\`** |

---

## 7. AI vs Human Evaluation (Scoring MAE & Correlations)

### Formulas
$$\\text{MAE} = \\frac{1}{n} \\sum_{i=1}^{n} |S_{human, i} - S_{ai, i}|$$

### Results
`;

  if (maeResult.value !== null && ratedScoreTurns.length > 0) {
    doc += `**Sample Size ($n=${maeResult.n}$ scored turns):**
- **Mean Absolute Error (MAE):** \`${maeResult.value.toFixed(2)}\`
- **Pearson Correlation ($r$):** \`${corrResult.value ? corrResult.value.pearson.toFixed(3) : "N/A"}\`
- **Spearman Correlation ($\\rho$):** \`${corrResult.value ? corrResult.value.spearman.toFixed(3) : "N/A"}\`
- **Quadratic Weighted Kappa (QWK):** \`${qwkResult.value !== null ? qwkResult.value.toFixed(3) : "N/A"}\`
`;
  } else {
    doc += `Not yet measured — requires human evaluator scores. 0 of ${totalTurns} turns have human scores.\n`;
  }

  doc += `
---

## 9. Final Results Summary (Table 7 Layout)

| Performance Measure | Result |
|:---|:---|
| **Speech Recognition WER** | ${werSummary} |
| **Question Relevance (1-5)** | ${relevanceSummary} |
| **Resume Relevance (1-5)** | ${resumeSummary} |
| **Decision Policy Precision** | ${precSummary} |
| **Decision Policy Recall** | ${recSummary} |
| **Decision Policy F1 Score** | ${f1Summary} |
| **Scoring Accuracy MAE** | ${maeSummary} |
| **Pearson Correlation (r)** | ${pearsonSummary} |
| **Spearman Correlation (ρ)** | ${spearmanSummary} |
| **Quadratic Weighted Kappa (QWK)** | ${qwkSummary} |
| **Mean End-to-End Latency ($L_{total}$)** | ${latSummary} |

---

## 12. Data Collection & Evaluation Readiness Status Checklist
`;

  // Checklist Calculations
  const calcCheck = (count: number, total: number) => {
    if (total === 0) return { box: "[ ]", pct: "0.0%", status: "UNSTARTED (0%)" };
    const pct = (count / total) * 100;
    if (pct === 100) return { box: "[x]", pct: "100%", status: "COMPLETE (100%)" };
    if (count > 0) return { box: "[~]", pct: `${pct.toFixed(1)}%`, status: `PARTIAL (${pct.toFixed(1)}%)` };
    return { box: "[ ]", pct: "0.0%", status: "UNSTARTED (0%)" };
  };

  const werCheck = calcCheck(refFilledRows.length, totalTurns);
  const qRelCheck = calcCheck(ratedQuestions.length, totalQuestions);
  const resRelCheck = calcCheck(ratedResumeQuestions.length, resumeGroundedQuestions.length);
  const decCheck = calcCheck(ratedDecisionTurns.length, totalTurns);
  const latCheck = calcCheck(latencyTurns.length, totalTurns > 0 ? totalTurns : 1);
  const scoreCheck = calcCheck(ratedScoreTurns.length, totalTurns);

  const allItems = [werCheck, qRelCheck, resRelCheck, decCheck, latCheck, scoreCheck];
  const overallAvgPct = allItems.reduce((acc, c) => acc + (parseFloat(c.pct) || 0), 0) / allItems.length;

  doc += `**Overall Evaluation Data Collection Readiness:** \`${overallAvgPct.toFixed(1)}%\` complete across all data types combined.

- ${werCheck.box} **Reference Transcripts Prepared:** ${refFilledRows.length} of ${totalTurns} (${werCheck.pct}) — ${werCheck.status}
- ${qRelCheck.box} **Question Relevance Rated:** ${ratedQuestions.length} of ${totalQuestions} (${qRelCheck.pct}) — ${qRelCheck.status}
- ${resRelCheck.box} **Resume Relevance Rated:** ${ratedResumeQuestions.length} of ${resumeGroundedQuestions.length} (${resRelCheck.pct}) — ${resRelCheck.status}
- ${decCheck.box} **Decision Policy Decisions Labeled:** ${ratedDecisionTurns.length} of ${totalTurns} (${decCheck.pct}) — ${decCheck.status}
- ${latCheck.box} **Latency Events Recorded:** ${latencyTurns.length} turns recorded (${latCheck.pct}) — ${latCheck.status}
- ${scoreCheck.box} **Human Scores Rated:** ${ratedScoreTurns.length} of ${totalTurns} (${scoreCheck.pct}) — ${scoreCheck.status}

---

## Appendix: Proposed Target Benchmarks
*Note: Proposed targets below are for author reference only and are NOT sourced from the original guide.*
- **Speech Recognition WER:** &lt; 10.0%
- **Question Relevance (1-5):** &gt; 85.0%
- **Resume Relevance (1-5):** &gt; 80.0%
- **Decision Policy Precision / Recall / F1:** &gt; 80.0%
- **Scoring Accuracy MAE:** &lt; 1.0
- **Pearson / Spearman Correlation:** &gt; 0.80
- **Quadratic Weighted Kappa (QWK):** &gt; 0.75
- **Mean End-to-End Latency ($L_{total}$):** &lt; 2500 ms
`;

  const vivaDocPath = path.join(docsDir, "VIVA_AI_EVALUATION.md");
  fs.writeFileSync(vivaDocPath, doc);
  console.log(`[VIVA_DOC] Successfully generated: ${vivaDocPath}`);
}

if (require.main === module) {
  generateVivaDoc();
}
