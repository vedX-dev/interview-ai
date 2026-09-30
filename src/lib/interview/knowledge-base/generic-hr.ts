import type { KnowledgeTopicEntry } from "./types";

export const GENERIC_HR_KB: KnowledgeTopicEntry[] = [
  {
    id: "career_trajectory_and_motivation",
    label: "Career Trajectory & Role Motivation",
    track: "generic_hr",
    concepts: [
      "career progression rationale",
      "motivation for this specific role and domain",
      "long-term professional goals",
      "ideal team environment and leadership style",
    ],
    depthLadder: {
      easy: "Ask about what drove their key career transitions and what excites them about moving into this specific role.",
      medium: "Probe into how this role fits into their 2-3 year progression plan and what specific impact they want to make in their first 90 days.",
      hard: "Explore how they balance personal career growth with organizational shifts or unexpected constraints, and what trade-offs they made in past role choices.",
    },
    signalsOfStrength: [
      "Clear intentionality behind career moves",
      "Crisp articulation of why this role and company fit their goals",
      "Realistic expectations of 30-60-90 day impact",
    ],
    signalsOfWeakness: [
      "Vague or opportunistic reasons for past transitions",
      "Generic praise for the company with no specific substance",
      "Unclear career direction or purely compensation-driven answers",
    ],
  },
  {
    id: "workplace_adaptability_and_resilience",
    label: "Workplace Adaptability & Resilience",
    track: "generic_hr",
    concepts: [
      "handling shifting priorities and ambiguity",
      "resilience during project setbacks or crunch times",
      "managing competing stakeholder demands",
      "work-life balance and burnout prevention",
    ],
    depthLadder: {
      easy: "Ask about a time project priorities changed mid-stream and how they adapted their daily workflow.",
      medium: "Probe for a concrete example where a major milestone was missed or blocked; ask what actions they took to recover and communicate with stakeholders.",
      hard: "Ask how they manage sustained ambiguity or conflicting demands from multiple senior stakeholders without burning out their team or themselves.",
    },
    signalsOfStrength: [
      "Proactive communication when priorities pivot",
      "Constructive, solutions-oriented response to setbacks",
      "Mature boundaries and prioritization techniques under pressure",
    ],
    signalsOfWeakness: [
      "Blaming management or peers for changing requirements",
      "Paralysis when requirements are not 100% defined",
      "Inability to describe a real setback or pretending everything always went smoothly",
    ],
  },
  {
    id: "ownership_and_initiative",
    label: "Ownership & Continuous Learning",
    track: "generic_hr",
    concepts: [
      "taking responsibility outside strict job description",
      "self-directed skill acquisition and upskilling",
      "mentorship and knowledge sharing",
      "identifying and fixing operational or process gaps",
    ],
    depthLadder: {
      easy: "Ask how they stay up to date with new tools or methodologies in their field.",
      medium: "Probe for a time they noticed a gap in team documentation, process, or tooling and proactively resolved it without being asked.",
      hard: "Ask how they champion new practices or culture shifts across reluctant team members and measure the lasting impact of their initiatives.",
    },
    signalsOfStrength: [
      "Demonstrated bias for action and fixing unowned problems",
      "Consistent habits of learning and sharing knowledge with peers",
      "Empathetic influence without formal authority",
    ],
    signalsOfWeakness: [
      "'Not my job' mentality",
      "Passive approach to learning (waiting for formal company training)",
      "Cannot recall any initiative taken beyond assigned tasks",
    ],
  },
];
