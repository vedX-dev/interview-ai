/**
 * Knowledge Base index.
 *
 * Exports:
 *  - ALL_KB_TOPICS: flat array of every KnowledgeTopicEntry across all tracks
 *  - selectKBTopics(): picks the most relevant topics for a given resume/role
 *  - getKBEntry(): look up a topic by id
 */

import type { KnowledgeTopicEntry, KnowledgeTrack } from "./types";
import { SOFTWARE_ENGINEERING_KB } from "./software-engineering";
import { BACKEND_KB } from "./backend";
import { FRONTEND_KB } from "./frontend";
import { SYSTEM_DESIGN_KB } from "./system-design";
import { BEHAVIORAL_KB } from "./behavioral";
import { DATA_SCIENCE_KB } from "./data-science";
import { GENERIC_HR_KB } from "./generic-hr";
import type { ExtractedResume } from "@/src/schemas/resume";

export type { KnowledgeTopicEntry, KnowledgeTrack };

/** All knowledge base entries merged from every track */
export const ALL_KB_TOPICS: KnowledgeTopicEntry[] = [
  ...SOFTWARE_ENGINEERING_KB,
  ...BACKEND_KB,
  ...FRONTEND_KB,
  ...SYSTEM_DESIGN_KB,
  ...BEHAVIORAL_KB,
  ...DATA_SCIENCE_KB,
  ...GENERIC_HR_KB,
];

/** Look up a KB entry by id */
export function getKBEntry(id: string): KnowledgeTopicEntry | undefined {
  return ALL_KB_TOPICS.find((t) => t.id === id);
}

/**
 * Select the most relevant knowledge base topics for a given role and resume.
 * Uses keyword matching against topic concepts, labels, and role name.
 * Returns 5-7 entries, always including at least one behavioral/HR topic.
 *
 * @param jobRole - The target job role string (e.g. "Senior Backend Engineer")
 * @param resume - Extracted resume (or null for mock sessions)
 * @param seed - Conversation seed for tie-breaking and shuffle variation
 */
export function selectKBTopics(
  jobRole: string,
  resume: ExtractedResume | null,
  seed: number = 0,
): KnowledgeTopicEntry[] {
  const roleTokens = tokenize(jobRole.toLowerCase());
  const skillTokens = resume
    ? new Set(resume.topSkills.map((s) => s.toLowerCase()))
    : new Set<string>();
  const projectText = resume
    ? resume.coreProjects.map((p) => `${p.title} ${p.description}`).join(" ").toLowerCase()
    : "";

  // Score each topic by relevance
  const scored = ALL_KB_TOPICS.map((entry) => {
    let score = 0;

    // Role name tokens in concepts or label
    const conceptText = entry.concepts.join(" ").toLowerCase() + " " + entry.label.toLowerCase();
    for (const tok of roleTokens) {
      if (conceptText.includes(tok)) score += 2;
    }

    // Skill match in concepts
    for (const skill of skillTokens) {
      if (conceptText.includes(skill)) score += 3;
    }

    // Project description match
    if (projectText) {
      for (const concept of entry.concepts) {
        if (projectText.includes(concept.split(" ")[0])) score += 1;
      }
    }

    // Track boost: if role mentions backend/frontend/data/system/hr, boost matching track
    if (
      (roleTokens.has("backend") || roleTokens.has("server") || roleTokens.has("api")) &&
      entry.track === "backend"
    ) score += 5;
    if (
      (roleTokens.has("frontend") || roleTokens.has("ui") || roleTokens.has("react")) &&
      entry.track === "frontend"
    ) score += 5;
    if (
      (roleTokens.has("data") || roleTokens.has("ml") || roleTokens.has("machine")) &&
      entry.track === "data_science"
    ) score += 5;
    if (
      (roleTokens.has("architect") || roleTokens.has("platform") || roleTokens.has("infrastructure")) &&
      entry.track === "system_design"
    ) score += 5;
    if (
      (roleTokens.has("hr") || roleTokens.has("human") || roleTokens.has("recruiter") || roleTokens.has("general")) &&
      entry.track === "generic_hr"
    ) score += 5;

    // Tiebreak with seed-based shuffle
    const tieBreak = (entry.id.charCodeAt(0) + seed) % 7;
    return { entry, score: score + tieBreak * 0.01 };
  });

  scored.sort((a, b) => b.score - a.score);

  const selected: KnowledgeTopicEntry[] = [];
  let behavioralIncluded = false;

  for (const { entry } of scored) {
    if (selected.length >= 7) break;
    if (entry.track === "behavioral" || entry.track === "generic_hr") behavioralIncluded = true;
    selected.push(entry);
  }

  // Always include at least one behavioral/HR topic
  if (!behavioralIncluded) {
    const behavioral = ALL_KB_TOPICS.filter((t) => t.track === "behavioral" || t.track === "generic_hr");
    if (behavioral.length > 0) {
      // Replace last non-behavioral entry if we are at cap
      if (selected.length >= 7) {
        selected[selected.length - 1] = behavioral[seed % behavioral.length];
      } else {
        selected.push(behavioral[seed % behavioral.length]);
      }
    }
  }

  return selected.slice(0, 7);
}

/** Simple tokenizer for keyword matching */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}
