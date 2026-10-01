/**
 * Evaluation Metrics Calculators
 * Pure functions with exact formulas per Viva AI Performance Evaluation Guide.
 */

export interface MetricResult<T = number> {
  value: T | null;
  n: number;
  skippedCount: number;
  skippedReason: string;
  insufficientReason?: string;
  details?: Record<string, unknown>;
}

// ── 1. Word Error Rate (WER) ──────────────────────────────────────────────────
export interface WERDetails {
  substitutions: number;
  deletions: number;
  insertions: number;
  referenceWords: number;
  wer: number;
}

/**
 * Computes Levenshtein distance alignment between reference and hypothesis words.
 */
function wordLevenshtein(refWords: string[], hypWords: string[]): { s: number; d: number; i: number } {
  const m = refWords.length;
  const n = hypWords.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (refWords[i - 1].toLowerCase() === hypWords[j - 1].toLowerCase()) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j - 1] + 1, // Substitution
          dp[i - 1][j] + 1,     // Deletion
          dp[i][j - 1] + 1      // Insertion
        );
      }
    }
  }

  // Backtrack to count exact S, D, I
  let i = m, j = n;
  let s = 0, d = 0, ins = 0;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && refWords[i - 1].toLowerCase() === hypWords[j - 1].toLowerCase()) {
      i--; j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      s++; i--; j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      d++; i--;
    } else {
      ins++; j--;
    }
  }

  return { s, d, i: ins };
}

export function calculateWER(
  pairs: Array<{ reference: string; hypothesis: string }>
): MetricResult<number> {
  let totalS = 0, totalD = 0, totalI = 0, totalRefWords = 0;
  let usableN = 0;
  let skipped = 0;

  for (const p of pairs) {
    const ref = (p.reference || "").trim();
    if (!ref) {
      skipped++;
      continue;
    }
    const refWords = ref.split(/\s+/).filter(Boolean);
    const hypWords = (p.hypothesis || "").trim().split(/\s+/).filter(Boolean);

    if (refWords.length === 0) {
      skipped++;
      continue;
    }

    const { s, d, i } = wordLevenshtein(refWords, hypWords);
    totalS += s;
    totalD += d;
    totalI += i;
    totalRefWords += refWords.length;
    usableN++;
  }

  if (usableN === 0 || totalRefWords === 0) {
    return {
      value: null,
      n: 0,
      skippedCount: skipped,
      skippedReason: "All reference_transcript entries are blank",
      insufficientReason: "insufficient data (n=0, needs human reference transcription)",
    };
  }

  const wer = (totalS + totalD + totalI) / totalRefWords;

  return {
    value: Math.min(1.0, wer),
    n: usableN,
    skippedCount: skipped,
    skippedReason: `${skipped} rows skipped due to blank reference_transcript`,
    details: {
      substitutions: totalS,
      deletions: totalD,
      insertions: totalI,
      referenceWords: totalRefWords,
      werPercentage: (wer * 100).toFixed(2) + "%",
    },
  };
}

// ── 2. Question Relevance Score ──────────────────────────────────────────────
export function calculateRelevance(scores: Array<number | null | undefined>): MetricResult<number> {
  const valid = scores.filter((s): s is number => typeof s === "number" && !isNaN(s) && s >= 1 && s <= 5);
  const skipped = scores.length - valid.length;

  if (valid.length === 0) {
    return {
      value: null,
      n: 0,
      skippedCount: skipped,
      skippedReason: "No human relevance ratings present",
      insufficientReason: "insufficient data (n=0, needs human rating)",
    };
  }

  const sum = valid.reduce((a, b) => a + b, 0);
  const percentage = (sum / (5 * valid.length)) * 100;

  return {
    value: percentage,
    n: valid.length,
    skippedCount: skipped,
    skippedReason: `${skipped} unrated or out-of-range rows skipped`,
  };
}

// ── 3. Resume Grounded Relevance Score ────────────────────────────────────────
export function calculateResumeRelevance(
  scores: Array<{ score: number | null | undefined; isResumeGrounded: boolean }>
): MetricResult<number> {
  const grounded = scores.filter(
    (s): s is { score: number; isResumeGrounded: boolean } =>
      s.isResumeGrounded && typeof s.score === "number" && !isNaN(s.score) && s.score >= 1 && s.score <= 5
  );
  const skipped = scores.length - grounded.length;

  if (grounded.length === 0) {
    return {
      value: null,
      n: 0,
      skippedCount: skipped,
      skippedReason: "No resume-grounded questions rated",
      insufficientReason: "insufficient data (n=0, needs human rating for resume-grounded questions)",
    };
  }

  const sum = grounded.reduce((a, b) => a + b.score, 0);
  const percentage = (sum / (5 * grounded.length)) * 100;

  return {
    value: percentage,
    n: grounded.length,
    skippedCount: skipped,
    skippedReason: `${skipped} non-resume or unrated rows skipped`,
  };
}

// ── 4. Decision Policy Precision / Recall / F1 ────────────────────────────────
export interface PrecisionRecallF1 {
  precision: number;
  recall: number;
  f1: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

export function calculatePrecisionRecallF1(
  pairs: Array<{ aiDecision: boolean; humanDecision: boolean | null | undefined }>
): MetricResult<PrecisionRecallF1> {
  const valid = pairs.filter(
    (p): p is { aiDecision: boolean; humanDecision: boolean } =>
      typeof p.humanDecision === "boolean"
  );
  const skipped = pairs.length - valid.length;

  if (valid.length === 0) {
    return {
      value: null,
      n: 0,
      skippedCount: skipped,
      skippedReason: "No human_decision labels provided",
      insufficientReason: "insufficient data (n=0, needs human decision ratings)",
    };
  }

  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const p of valid) {
    if (p.aiDecision && p.humanDecision) tp++;
    else if (p.aiDecision && !p.humanDecision) fp++;
    else if (!p.aiDecision && p.humanDecision) fn++;
    else tn++;
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    value: { precision, recall, f1, tp, fp, fn, tn },
    n: valid.length,
    skippedCount: skipped,
    skippedReason: `${skipped} unlabelled decision rows skipped`,
  };
}

// ── 5. Mean Absolute Error (MAE) ──────────────────────────────────────────────
export function calculateMAE(
  pairs: Array<{ humanScore: number | null | undefined; aiScore: number | null | undefined }>
): MetricResult<number> {
  const valid = pairs.filter(
    (p): p is { humanScore: number; aiScore: number } =>
      typeof p.humanScore === "number" &&
      typeof p.aiScore === "number" &&
      !isNaN(p.humanScore) &&
      !isNaN(p.aiScore)
  );
  const skipped = pairs.length - valid.length;

  if (valid.length === 0) {
    return {
      value: null,
      n: 0,
      skippedCount: skipped,
      skippedReason: "No pairs with both humanScore and aiScore",
      insufficientReason: "insufficient data (n=0, needs human evaluator scores)",
    };
  }

  const sumError = valid.reduce((acc, p) => acc + Math.abs(p.humanScore - p.aiScore), 0);
  const mae = sumError / valid.length;

  return {
    value: mae,
    n: valid.length,
    skippedCount: skipped,
    skippedReason: `${skipped} incomplete score pairs skipped`,
  };
}

// ── 6. Pearson & Spearman Correlation ────────────────────────────────────────
export function calculateCorrelations(
  x: number[],
  y: number[]
): MetricResult<{ pearson: number; spearman: number }> {
  if (x.length !== y.length || x.length < 2) {
    return {
      value: null,
      n: Math.min(x.length, y.length),
      skippedCount: 0,
      skippedReason: "Sample size < 2",
      insufficientReason: "insufficient data (n < 2, needs at least 2 paired scores)",
    };
  }

  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const pearson = denX > 0 && denY > 0 ? num / Math.sqrt(denX * denY) : 0;

  // Spearman rank calculation
  const getRanks = (arr: number[]) => {
    const sorted = arr.map((val, idx) => ({ val, idx })).sort((a, b) => a.val - b.val);
    const ranks = new Array(arr.length);
    for (let i = 0; i < sorted.length; i++) {
      ranks[sorted[i].idx] = i + 1;
    }
    return ranks;
  };

  const rankX = getRanks(x);
  const rankY = getRanks(y);
  let dSquareSum = 0;
  for (let i = 0; i < n; i++) {
    const d = rankX[i] - rankY[i];
    dSquareSum += d * d;
  }

  const spearman = 1 - (6 * dSquareSum) / (n * (n * n - 1));

  return {
    value: { pearson, spearman },
    n,
    skippedCount: 0,
    skippedReason: "",
  };
}

// ── 7. Quadratic Weighted Kappa (QWK) ─────────────────────────────────────────
export function calculateQWK(
  raterA: number[],
  raterB: number[],
  minScore = 0,
  maxScore = 10
): MetricResult<number> {
  if (raterA.length !== raterB.length || raterA.length === 0) {
    return {
      value: null,
      n: raterA.length,
      skippedCount: 0,
      skippedReason: "Empty or mismatched rating lists",
      insufficientReason: "insufficient data (n=0, needs rating pairs)",
    };
  }

  const numCategories = maxScore - minScore + 1;
  const O = Array.from({ length: numCategories }, () => Array(numCategories).fill(0));
  const W = Array.from({ length: numCategories }, () => Array(numCategories).fill(0));

  const countA = Array(numCategories).fill(0);
  const countB = Array(numCategories).fill(0);
  const N = raterA.length;

  for (let i = 0; i < numCategories; i++) {
    for (let j = 0; j < numCategories; j++) {
      W[i][j] = Math.pow(i - j, 2) / Math.pow(numCategories - 1, 2);
    }
  }

  for (let k = 0; k < N; k++) {
    const a = Math.max(minScore, Math.min(maxScore, Math.round(raterA[k]))) - minScore;
    const b = Math.max(minScore, Math.min(maxScore, Math.round(raterB[k]))) - minScore;
    O[a][b] += 1;
    countA[a] += 1;
    countB[b] += 1;
  }

  const E = Array.from({ length: numCategories }, () => Array(numCategories).fill(0));
  for (let i = 0; i < numCategories; i++) {
    for (let j = 0; j < numCategories; j++) {
      E[i][j] = (countA[i] * countB[j]) / N;
    }
  }

  let numSum = 0;
  let denSum = 0;
  for (let i = 0; i < numCategories; i++) {
    for (let j = 0; j < numCategories; j++) {
      numSum += W[i][j] * O[i][j];
      denSum += W[i][j] * E[i][j];
    }
  }

  const qwk = denSum === 0 ? 1 : 1 - numSum / denSum;

  return {
    value: qwk,
    n: N,
    skippedCount: 0,
    skippedReason: "",
  };
}

// ── 8. Cohen's Kappa for Categorical / Rating Agreement ──────────────────────
export function calculateCohensKappa(
  raterA: (string | number)[],
  raterB: (string | number)[]
): MetricResult<number> {
  if (raterA.length !== raterB.length || raterA.length === 0) {
    return {
      value: null,
      n: 0,
      skippedCount: 0,
      skippedReason: "Empty rating list",
      insufficientReason: "insufficient data (n=0, needs paired rater scores)",
    };
  }

  const N = raterA.length;
  const categories = Array.from(new Set([...raterA, ...raterB]));

  let observedAgree = 0;
  const countA: Record<string, number> = {};
  const countB: Record<string, number> = {};

  for (const cat of categories) {
    countA[String(cat)] = 0;
    countB[String(cat)] = 0;
  }

  for (let i = 0; i < N; i++) {
    const a = String(raterA[i]);
    const b = String(raterB[i]);
    if (a === b) observedAgree++;
    countA[a] = (countA[a] || 0) + 1;
    countB[b] = (countB[b] || 0) + 1;
  }

  const Po = observedAgree / N;
  let Pe = 0;
  for (const cat of categories) {
    const sCat = String(cat);
    Pe += ((countA[sCat] || 0) / N) * ((countB[sCat] || 0) / N);
  }

  const kappa = Pe === 1 ? 1 : (Po - Pe) / (1 - Pe);

  return {
    value: kappa,
    n: N,
    skippedCount: 0,
    skippedReason: "",
  };
}

// ── 9. Paired T-Test & Cohen's d ─────────────────────────────────────────────
export function calculatePairedTTest(
  pre: number[],
  post: number[]
): MetricResult<{ meanDifference: number; tStatistic: number; cohensD: number }> {
  if (pre.length !== post.length || pre.length < 2) {
    return {
      value: null,
      n: pre.length,
      skippedCount: 0,
      skippedReason: "Sample size < 2",
      insufficientReason: "insufficient data (n < 2 for paired t-test)",
    };
  }

  const n = pre.length;
  const diffs = post.map((v, i) => v - pre[i]);
  const meanDiff = diffs.reduce((a, b) => a + b, 0) / n;

  const variance = diffs.reduce((acc, d) => acc + Math.pow(d - meanDiff, 2), 0) / (n - 1);
  const sd = Math.sqrt(variance);

  const tStat = sd > 0 ? (meanDiff * Math.sqrt(n)) / sd : 0;
  const cohensD = sd > 0 ? meanDiff / sd : 0;

  return {
    value: { meanDifference: meanDiff, tStatistic: tStat, cohensD },
    n,
    skippedCount: 0,
    skippedReason: "",
  };
}
