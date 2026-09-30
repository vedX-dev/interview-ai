/**
 * Knowledge Base type definitions.
 *
 * The knowledge base is NOT a question list — it's what a senior interviewer
 * would keep in mind when probing a topic. The LLM phrases actual questions live,
 * choosing which concept and which depth to probe based on context and K-score.
 */

export interface DepthLadder {
  /** Easy: broad, opener-level probing. Suitable for kScore <= 4 or struggling candidates. */
  easy: string;
  /** Medium: concrete implementation details, trade-offs, and decisions. kScore 5-7. */
  medium: string;
  /** Hard: architecture-level, failure modes, scalability, design critique. kScore >= 8. */
  hard: string;
}

export interface KnowledgeTopicEntry {
  /** Unique stable identifier (snake_case) */
  id: string;
  /** Human-readable label */
  label: string;
  /** Track this topic belongs to */
  track: KnowledgeTrack;
  /**
   * Sub-concepts to probe within this topic.
   * The LLM picks which to probe based on the candidate's answers and K-score.
   */
  concepts: string[];
  /**
   * Depth-specific guidance telling the LLM HOW to probe, not what to ask.
   * The LLM phrases the actual question live at the specified depth.
   */
  depthLadder: DepthLadder;
  /**
   * Signals that indicate strong knowledge in this topic.
   * Used by the K-score updater to detect rising trends.
   */
  signalsOfStrength: string[];
  /**
   * Signals that indicate weak or surface-level knowledge.
   * Used by the K-score updater to detect falling trends.
   */
  signalsOfWeakness: string[];
}

export type KnowledgeTrack =
  | "software_engineering"
  | "frontend"
  | "backend"
  | "data_science"
  | "system_design"
  | "behavioral"
  | "generic_hr";
