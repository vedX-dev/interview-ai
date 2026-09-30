/**
 * K-Score adaptive difficulty configuration.
 *
 * K-Score is a rolling exponentially-weighted average of recent scored turns
 * that tracks candidate quality trend separately from per-turn scores.
 *
 * ALL weights and thresholds live here. Code enforces these values.
 * Prompts reference them but do NOT control them.
 */

export const KSCORE_CONFIG = {
  // --- Exponential Smoothing ------------------------------------------------
  /**
   * EWA smoothing factor (alpha).
   * Higher alpha = more weight on recent turns (more reactive).
   * Range: 0.1 (very smooth) to 0.9 (very reactive).
   * Formula: kScore = alpha * newScore + (1 - alpha) * kScore
   */
  alpha: 0.35,

  // --- K-Score starting value -----------------------------------------------
  /** Starting K-Score (neutral). Represents "unknown candidate". */
  initialKScore: 5.0,

  // --- Trend Detection -----------------------------------------------------
  /**
   * Score threshold to count a turn as "strong" for trend detection.
   * Turns scoring >= this value contribute to a rising trend signal.
   */
  strongTurnThreshold: 7,

  /**
   * Score threshold to count a turn as "weak" for trend detection.
   * Turns scoring <= this value contribute to a falling trend signal.
   */
  weakTurnThreshold: 4,

  /**
   * Number of consecutive strong turns required to flip trend to "rising".
   */
  risingRunLength: 2,

  /**
   * Number of consecutive weak turns required to flip trend to "falling".
   */
  fallingRunLength: 2,

  // --- Depth Target Thresholds ---------------------------------------------
  /**
   * kScore >= this ? targetDepth = "hard" (escalate probing).
   */
  hardDepthMinScore: 7.5,

  /**
   * kScore >= this ? targetDepth = "medium".
   * kScore < mediumDepthMinScore ? targetDepth = "easy".
   */
  mediumDepthMinScore: 4.5,

  /**
   * Trend boost: when kScoreTrend = "rising", lower the threshold for escalation by this amount.
   * Effectively escalates faster when candidate is on a roll.
   */
  risingTrendBoost: 0.5,

  /**
   * Trend dampener: when kScoreTrend = "falling", raise the threshold for escalation.
   * Never pile on difficulty when candidate is struggling.
   */
  fallingTrendDampener: 1.0,

  // --- Topic-specific depth cap ---------------------------------------------
  /**
   * Maximum turns on a single topic before forcing depth escalation or topic change.
   * Prevents the interviewer from spending too long on one area regardless of K-score.
   */
  maxTurnsBeforeEscalate: 3,

  // --- Answer length adaptation ---------------------------------------------
  /**
   * If the last N candidate answers averaged fewer than this many words,
   * the LLM is instructed to ask a more open, easier prompt.
   */
  shortAnswerWordThreshold: 30,

  /**
   * If the last N candidate answers averaged more than this many words,
   * the LLM is instructed to ask a sharper, more focused follow-up.
   */
  longAnswerWordThreshold: 100,

  /** Number of recent turns to average for length adaptation */
  lengthAdaptationWindow: 3,
} as const;

export type TargetDepth = "easy" | "medium" | "hard";
export type KScoreTrend = "rising" | "flat" | "falling";
