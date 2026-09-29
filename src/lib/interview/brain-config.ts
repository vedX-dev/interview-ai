/**
 * Interview brain configuration.
 * ALL thresholds, caps, and policy rules live here.
 * Enforced in code; prompts reference these values but do NOT control them.
 */

export const BRAIN_CONFIG = {
  // ─── Professionalism Nudge Flag ──────────────────────────────────────────
  PROFESSIONALISM_NUDGE: true,

  // ─── Phase turn caps ─────────────────────────────────────────────────────
  maxWarmupTurns: 2,     // candidate turns before entering core
  maxCoreTopics: 7,      // max distinct topics we'll cover
  maxTotalTurns: 22,     // hard kill-switch (incl. wrapup)
  timeBudgetMs: 35 * 60 * 1000,   // 35 minutes wall-clock

  // ─── Follow-up policy ────────────────────────────────────────────────────
  maxFollowUpsNormal: 1,           // per topic when confidence >= 0.6
  maxFollowUpsLowConfidence: 2,    // per topic when confidence < 0.6

  // ─── Decision thresholds (enforce in code) ───────────────────────────────
  scoreForNextTopic: 7,            // score >= this → next_topic
  confidenceForNextTopic: 0.7,     // confidence >= this → next_topic
  scoreForFollowup_min: 4,         // score 4-6 → followup
  scoreForFollowup_max: 6,
  minAnswerLength: 4,              // chars; shorter → treat as unclear

  // ─── Clarify Ladder (never repeat exact text) ─────────────────────────────
  clarifyLadder: [
    "Could you elaborate a bit more on that?",
    "Could you share a bit more detail specifically about your role or tech choices?",
    "Feel free to type your response in the text box below if that's easier.",
  ],

  // ─── Similarity check (repeated-question guard) ──────────────────────────
  similarityThreshold: 0.50,
  historyRepeatWindow: 8, // keep last 8 spoken replies in state

  // ─── Default topic mix (override per role/level) ─────────────────────────
  defaultTopics: [
    {
      id: "background",
      label: "Background & Motivation",
      goal: "Understand why the candidate is interested in this role and their career trajectory so far.",
    },
    {
      id: "strongest_project",
      label: "Strongest Project",
      goal: "Assess ownership, technical depth, and real impact on a project they led or contributed heavily to.",
    },
    {
      id: "technical_depth",
      label: "Technical Depth",
      goal: "Probe deep understanding of a core technology relevant to the role (not surface definitions).",
    },
    {
      id: "problem_solving",
      label: "Problem Solving / Debugging",
      goal: "Evaluate structured thinking when the candidate faced a hard bug or an ambiguous technical problem.",
    },
    {
      id: "teamwork",
      label: "Collaboration / Conflict",
      goal: "Understand how they work with others and handle disagreements or difficult team dynamics.",
    },
    {
      id: "learning",
      label: "Learning & Growth",
      goal: "Gauge intellectual curiosity, how they skill up, and what they are currently learning.",
    },
  ],

  // ─── Multi-phrasing fallback bank (used when ALL LLMs fail) ─────────────
  fallbackQuestions: [
    {
      topic: "background",
      phrasings: [
        "Tell me a bit about what you have been working on recently.",
        "Could you walk me through your recent engineering background?",
        "What motivated you to pursue software engineering and this role?",
      ],
    },
    {
      topic: "strongest_project",
      phrasings: [
        "What is a technical project you are most proud of, and why?",
        "Could you share details on a complex project you built or led?",
        "Tell me about a project where you made key architectural decisions.",
      ],
    },
    {
      topic: "technical_depth",
      phrasings: [
        "How would you describe your strongest technical skill or framework depth?",
        "What core technology do you feel most proficient with, and how do you use it?",
        "Can you walk me through a technical architecture choice you made recently?",
      ],
    },
    {
      topic: "problem_solving",
      phrasings: [
        "Can you walk me through a difficult technical bug or outage you debugged?",
        "Tell me about a time you had to solve an ambiguous technical problem.",
        "How do you systematically approach troubleshooting complex system issues?",
      ],
    },
    {
      topic: "teamwork",
      phrasings: [
        "How do you typically handle technical disagreements with teammates?",
        "Tell me about a time you collaborated across teams to deliver a critical feature.",
        "What is your approach to code reviews and technical feedback?",
      ],
    },
    {
      topic: "learning",
      phrasings: [
        "What is a new technology or tool you have been learning recently?",
        "How do you stay up to date with fast-moving industry practices?",
        "Tell me about a skill you picked up quickly to solve an immediate problem.",
      ],
    },
    {
      topic: "wrapup",
      phrasings: [
        "Do you have any questions for me about the role or team?",
        "Is there anything else you'd like to ask before we wrap up today?",
      ],
    },
  ],
} as const;
