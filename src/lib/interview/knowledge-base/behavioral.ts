/**
 * Knowledge Base: Behavioral / generic HR track.
 */
import type { KnowledgeTopicEntry } from "./types";

export const BEHAVIORAL_KB: KnowledgeTopicEntry[] = [
  {
    id: "leadership_influence",
    label: "Leadership & Influence",
    track: "behavioral",
    concepts: [
      "technical leadership without authority",
      "driving consensus on technical decisions",
      "mentoring and growing junior engineers",
      "handling scope creep or changing requirements",
      "stakeholder management",
    ],
    depthLadder: {
      easy: "Ask about a time they took initiative on a project or led something beyond their formal role.",
      medium: "Probe for influence: how did they get others to adopt their idea or approach when they had no authority? What resistance did they face?",
      hard: "Ask about a leadership failure: a decision they made that the team disagreed with, or a time their direction turned out to be wrong. How did they recover?",
    },
    signalsOfStrength: [
      "specific story with outcome and learning",
      "mentions coalition-building or data-driven persuasion",
      "acknowledges their own mistakes",
      "mentoring or growing others described",
    ],
    signalsOfWeakness: [
      "no specific story, only hypotheticals",
      "no examples of overcoming resistance",
      "no self-critical reflection",
    ],
  },
  {
    id: "adaptability_pressure",
    label: "Adaptability Under Pressure",
    track: "behavioral",
    concepts: [
      "handling ambiguity",
      "working under tight deadlines",
      "pivoting when plans change",
      "maintaining quality under pressure",
    ],
    depthLadder: {
      easy: "Ask about a time they had to work under a tight deadline or with incomplete information.",
      medium: "Probe how they prioritized: what did they cut, what did they keep, and how did they decide?",
      hard: "Ask about a time when they had to ship something they were not fully happy with. How did they manage the technical debt? What would they do differently?",
    },
    signalsOfStrength: [
      "deliberate prioritization story",
      "communicated trade-offs to stakeholders",
      "tracked and addressed technical debt afterwards",
    ],
    signalsOfWeakness: [
      "always works under pressure but cannot give a specific example",
      "shipped bad quality without reflecting on it",
    ],
  },
];
