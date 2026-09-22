/**
 * Interview State Engine
 *
 * Derives a structured coverage map from the existing transcript on every
 * orchestrator turn. This means Gemini is handed a compact, pre-computed
 * "what has already been covered" summary instead of having to re-discover
 * interview state from the raw transcript on every call.
 *
 * Responsibilities:
 * - Track which technical topics have been discussed
 * - Count follow-up depth per topic
 * - Determine if the current phase has enough coverage to advance
 * - Produce a compact context string to inject into the orchestrator prompt
 *
 * This runs server-side per request; no persistence needed.
 */

export type TopicCoverage = {
  topic: string;
  /** How many candidate turns addressed this topic */
  candidateTurns: number;
  /** How many follow-up questions the AI asked on this topic */
  aiFollowUps: number;
};

export type CoverageMap = {
  topics: TopicCoverage[];
  totalCandidateTurns: number;
  totalAiTurns: number;
  /** Whether the technical phase has covered enough depth to wrap up */
  technicalSufficient: boolean;
};

type TranscriptEntry = {
  speaker: "user" | "ai";
  content: string;
};

// Keywords for topic detection — extend as needed
const TOPIC_KEYWORDS: Record<string, string[]> = {
  "Data Structures": [
    "array", "linked list", "tree", "graph", "stack", "queue", "hash",
    "heap", "trie", "binary", "bst",
  ],
  Algorithms: [
    "algorithm", "sort", "search", "complexity", "big o", "recursion",
    "dynamic programming", "greedy", "backtracking", "dfs", "bfs",
  ],
  "System Design": [
    "scale", "scalability", "distributed", "microservice", "api", "cache",
    "load balancer", "database design", "sharding", "replication",
    "message queue", "kafka", "redis",
  ],
  React: [
    "react", "component", "hook", "state", "props", "virtual dom",
    "useeffect", "usestate", "context", "redux",
  ],
  Databases: [
    "sql", "nosql", "postgres", "mongodb", "index", "transaction",
    "join", "query", "orm", "drizzle", "migration",
  ],
  "Node.js": [
    "node", "express", "event loop", "async", "promise", "stream",
    "middleware", "npm", "package",
  ],
  Projects: [
    "project", "built", "developed", "worked on", "implemented",
    "designed", "architected",
  ],
};

function detectTopics(text: string): string[] {
  const lower = text.toLowerCase();
  const detected: string[] = [];

  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      detected.push(topic);
    }
  }

  return detected;
}

/**
 * Build a CoverageMap from the raw transcript.
 */
export function buildCoverageMap(transcript: TranscriptEntry[]): CoverageMap {
  const topicMap = new Map<string, TopicCoverage>();
  let totalCandidateTurns = 0;
  let totalAiTurns = 0;

  for (const entry of transcript) {
    if (entry.speaker === "user") {
      totalCandidateTurns++;
      const topics = detectTopics(entry.content);
      for (const topic of topics) {
        const existing = topicMap.get(topic) ?? {
          topic,
          candidateTurns: 0,
          aiFollowUps: 0,
        };
        existing.candidateTurns++;
        topicMap.set(topic, existing);
      }
    } else {
      totalAiTurns++;
      const topics = detectTopics(entry.content);
      for (const topic of topics) {
        const existing = topicMap.get(topic) ?? {
          topic,
          candidateTurns: 0,
          aiFollowUps: 0,
        };
        existing.aiFollowUps++;
        topicMap.set(topic, existing);
      }
    }
  }

  const topics = Array.from(topicMap.values());

  // Technical phase is sufficient if: at least 3 distinct topics addressed
  // and at least 5 candidate turns total in the technical phase
  const technicalSufficient =
    topics.filter((t) => t.candidateTurns > 0).length >= 3 &&
    totalCandidateTurns >= 5;

  return {
    topics,
    totalCandidateTurns,
    totalAiTurns,
    technicalSufficient,
  };
}

/**
 * Serialize a CoverageMap into a compact string to inject into the
 * orchestrator's context prompt. This replaces the need for Gemini to
 * re-read the full transcript to understand interview state.
 */
export function formatCoverageForPrompt(coverage: CoverageMap): string {
  if (coverage.topics.length === 0) {
    return "Coverage: No topics discussed yet.";
  }

  const lines: string[] = [
    `Coverage Summary (${coverage.totalCandidateTurns} candidate turns, ${coverage.totalAiTurns} AI turns):`,
  ];

  for (const t of coverage.topics) {
    lines.push(
      `  • ${t.topic}: ${t.candidateTurns} candidate response(s), ${t.aiFollowUps} AI follow-up(s)`,
    );
  }

  if (coverage.technicalSufficient) {
    lines.push(
      "Technical coverage is sufficient — consider moving to wrapup if remaining objectives are met.",
    );
  }

  return lines.join("\n");
}
