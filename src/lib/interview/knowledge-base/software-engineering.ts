/**
 * Knowledge Base: Software Engineering track.
 * Covers generic SE topics applicable across roles.
 */
import type { KnowledgeTopicEntry } from "./types";

export const SOFTWARE_ENGINEERING_KB: KnowledgeTopicEntry[] = [
  {
    id: "background_motivation",
    label: "Background & Motivation",
    track: "software_engineering",
    concepts: [
      "career trajectory and pivots",
      "reasons for current job search",
      "alignment with the role/company mission",
      "most recent or defining work",
      "professional identity",
    ],
    depthLadder: {
      easy: "Ask an open, story-based opener about their background. Prefer resume specifics over generic openers. Use one of: (a) ask about their most recent project role, (b) ask what brought them to this specific role, (c) ask about the transition point in their career that led here.",
      medium: "Probe why they chose a particular technology or team in their history. Ask about a specific decision or turning point they mentioned.",
      hard: "Probe for self-awareness: what would they do differently in their career path, or what do they see as the gap between where they are and where they want to be?",
    },
    signalsOfStrength: [
      "specific metrics or outcomes from past work",
      "clear articulation of career goals",
      "ownership language (I decided, I led, I designed)",
      "unprompted reflection on trade-offs",
    ],
    signalsOfWeakness: [
      "vague or generic answers (just wanted a new challenge)",
      "inability to describe a specific project or contribution",
      "passive framing (I was part of a team that)",
    ],
  },
  {
    id: "strongest_project",
    label: "Strongest Project",
    track: "software_engineering",
    concepts: [
      "project scope and ownership",
      "architectural decisions made",
      "technical challenges encountered",
      "measurable impact or outcomes",
      "what would be done differently",
    ],
    depthLadder: {
      easy: "Ask for a project story: which project they are most proud of, what their role was, and what they shipped.",
      medium: "Probe the architectural or technical decisions: why did they choose a particular approach, what alternatives were considered, what trade-offs were made?",
      hard: "Ask about failure modes, what broke at scale, or what the candidate would redesign with hindsight. Push for specifics on performance numbers, failure scenarios, or production incidents.",
    },
    signalsOfStrength: [
      "concrete metrics (latency reduced by X, throughput N RPS)",
      "discussion of alternatives considered",
      "honest account of what went wrong and lessons learned",
      "clear technical ownership statements",
    ],
    signalsOfWeakness: [
      "inability to explain architectural choices",
      "no metrics or outcomes",
      "blaming external factors for all failures",
      "surface-level description without depth",
    ],
  },
  {
    id: "problem_solving",
    label: "Problem Solving & Debugging",
    track: "software_engineering",
    concepts: [
      "systematic debugging approach",
      "handling ambiguous or incomplete specifications",
      "root cause analysis",
      "communication during incidents",
      "post-mortem and learning",
    ],
    depthLadder: {
      easy: "Ask for a story: a hard bug they debugged, how they found it, and how long it took. Focus on the narrative.",
      medium: "Probe the diagnostic process: what tools did they use, how did they narrow the search space, what hypotheses did they form and test?",
      hard: "Ask about systemic issues: was this a one-off or a class of bugs? What did they change in processes or code structure to prevent recurrence? What monitoring would have caught it earlier?",
    },
    signalsOfStrength: [
      "structured hypothesis-driven debugging",
      "specific tools named (profilers, tracing, logging)",
      "mentions post-mortem, systemic fix, or alerting improvement",
      "clear timeline and ownership of the fix",
    ],
    signalsOfWeakness: [
      "cannot describe a concrete debugging story",
      "describes trial-and-error without structure",
      "no mention of root cause analysis",
    ],
  },
  {
    id: "teamwork_conflict",
    label: "Collaboration & Conflict",
    track: "software_engineering",
    concepts: [
      "cross-functional collaboration",
      "handling disagreements on technical decisions",
      "code review culture and giving feedback",
      "communication with non-engineers",
      "difficult team dynamics",
    ],
    depthLadder: {
      easy: "Ask for a story about working with others: how they collaborated on a recent feature, or a time they had to align multiple stakeholders.",
      medium: "Probe a specific conflict or disagreement: how did they handle a technical dispute with a colleague, what was the outcome, and what did they learn?",
      hard: "Ask about systemic collaboration challenges: how do they handle repeated disagreements with a teammate, or working in a team with very different working styles? How do they escalate?",
    },
    signalsOfStrength: [
      "specific conflict described with resolution and learning",
      "mentions listening, understanding the other perspective",
      "describes outcome that was good for the team even if not their preference",
      "discusses code review or design review culture",
    ],
    signalsOfWeakness: [
      "cannot describe a specific conflict",
      "blames others without nuance",
      "describes avoidance instead of resolution",
    ],
  },
  {
    id: "learning_growth",
    label: "Learning & Growth",
    track: "software_engineering",
    concepts: [
      "self-directed learning habits",
      "picking up a new technology under pressure",
      "staying current with industry trends",
      "knowledge sharing and mentoring",
      "skill gaps and how they address them",
    ],
    depthLadder: {
      easy: "Ask what they are learning right now or what they are curious about professionally.",
      medium: "Probe a specific example: a technology or skill they picked up quickly to solve a problem. How long did it take, what was the learning approach?",
      hard: "Ask how they identify their own skill gaps and what is their current plan for addressing the most important one. Push for specifics about timelines or outcomes.",
    },
    signalsOfStrength: [
      "specific technology or concept currently being learned",
      "structured learning approach (courses, projects, community)",
      "mentions teaching or sharing knowledge with others",
      "honest about gaps and has a plan",
    ],
    signalsOfWeakness: [
      "vague answer (I just google things, I learn on the job)",
      "cannot name a specific recent learning",
      "no awareness of skill gaps",
    ],
  },
];
