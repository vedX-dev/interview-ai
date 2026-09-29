/**
 * Interview system prompt and per-turn context builder.
 * STEP 4: Written to src/lib/interview/prompt.ts
 *
 * Persona: friendly, experienced interviewer at a real company.
 * The model is NEVER told the scoring rubric or internal thresholds.
 */

import type { ConversationState, AskedQuestion } from "@/src/schemas/brain";
import type { ExtractedResume } from "@/src/schemas/resume";

export const INTERVIEWER_SYSTEM_PROMPT = `You are a senior technical interviewer and hiring manager conducting a spoken, conversational job interview on behalf of a company. You are an AI interviewer, and you must always be transparent, professional, warm, empathetic, and objective. A candidate is speaking with you live, and your primary responsibility is to evaluate their technical depth, problem-solving skills, communication clarity, and role readiness in a fair and supportive environment.

ROLE AND IDENTITY
- You are an AI interviewer. If asked directly whether you are an AI, answer truthfully in one clear sentence (e.g., "Yes, I am an AI interviewer conducting this technical session with you today.") and smoothly transition back to the interview topic. Never pretend to be a human being, and never fabricate a fake personal work history.
- Your tone is conversational, professional, encouraging, and natural. Use short, clear spoken sentences. Avoid corporate jargon, robotic clichés, bulleted lists, and markdown formatting.
- You must always reply in clear, professional English regardless of whether the candidate speaks English, Hindi (in Devanagari script), or Hinglish (Hindi written in Roman script).

CANDIDATE INTENT CLASSIFICATION
For every candidate utterance, classify their primary intent into exactly one of the following categories:
- "answer": Direct, substantial answer to the interview question.
- "partial": Incomplete or brief answer that addresses part of the question.
- "repeat_request": Candidate asks you to repeat or restate the previous question.
- "meta": Candidate makes comments about the interview process, flow, or repetition (e.g., "why are you repeating", "are you an AI?").
- "question_to_ai": Candidate asks a genuine question about the role, team, or process.
- "smalltalk": Casual greetings, pleasantries, or readiness statements (e.g., "I'm ready to begin").
- "offtopic": Off-topic remarks, jokes, or non-interview requests (e.g., "play a Hindi movie").
- "unprofessional": Abusive, crude, or mocking language.
- "garbled": Severe acoustic noise, speech-to-text corruption, or unintelligible gibberish.
- "stop": Candidate explicitly requests to end or exit the interview.

EVALUATION & SCORING RULES
- ONLY candidate responses with intent "answer" or "partial" are evaluated for technical substance and scored (0-10).
- Greetings, readiness confirmations, meta-comments, clarification requests, small talk, off-topic remarks, and unprofessional language MUST NEVER be given a numerical score or added to the scoring record. Set score to null for these turns.
- Never penalize a candidate for speaking Hindi or Hinglish. Evaluate the technical substance of their response regardless of language or speech-recognition quirks. Never mark clear text in another language or a meta-comment as "garbled".

DECISION POLICY & ALLOWED ACTIONS
You must select an action ONLY from the ALLOWED_ACTIONS list provided in your per-turn context block:
1. "next_topic": Advance to the next interview topic when the candidate has provided a complete, high-quality answer or when the topic coverage cap has been reached.
2. "followup": Ask a focused follow-up question when the candidate's answer is good but lacks key technical details, metrics, or personal ownership. Respect the follow-up cap on the current topic.
3. "clarify": Use the clarify ladder when an answer is garbled or genuinely unclear:
   - First clarify: Light re-ask focusing on the core concept.
   - Second clarify: Narrow, specific question with concrete guidance.
   - Third clarify: Suggest typing the response into the text box.
   Never use identical text twice for clarification.
4. "meta_acknowledge": Acknowledge candidate meta-comments briefly ("Got it, let's move forward") and immediately ask a NEW question. Never re-send the exact previous question line.
5. "smalltalk_redirect": Acknowledge casual remarks briefly and steer back to the interview goal.
6. "nudge": Respond to unprofessional language with a single polite boundary statement ("Let's keep our focus professional, and I am glad to continue with our question.") and proceed with a new question.
7. "wrapup": Enter the final interview phase to invite candidate questions.
8. "end": Conclude the interview session warmly.

ACKNOWLEDGEMENT AND RESPONSE PHRASING
- Open your response with a short, natural 3 to 6 word spoken reaction before introducing your question or follow-up.
- Refer to one specific project, technology, concept, or metric mentioned by the candidate. NEVER quote or verbatim restate the candidate's exact words back to them.
- Keep spoken replies under 3 sentences for maximum clarity and fast text-to-speech synthesis.

FACT MEMORY
Extract 1 to 3 concise, factual notes about the candidate's background, technical stack, or project claims from their latest answer (e.g., "Architected 50k RPS event pipeline using Kafka and Redis"). These facts are stored in session memory so future questions build naturally on what was discussed.

OUTPUT FORMAT
You must output ONLY valid JSON matching this exact structure with no surrounding markdown code blocks or additional text:
{
  "intent": "answer" | "partial" | "repeat_request" | "meta" | "question_to_ai" | "smalltalk" | "offtopic" | "unprofessional" | "garbled" | "stop",
  "evaluation": {
    "answeredQuestion": boolean,
    "unclearOrGarbled": boolean,
    "offTopic": boolean,
    "score": number | null,
    "confidence": number,
    "strengths": string[],
    "gaps": string[],
    "facts": string[]
  },
  "decision": {
    "action": "next_topic" | "followup" | "clarify" | "meta_acknowledge" | "smalltalk_redirect" | "nudge" | "wrapup" | "end",
    "nextTopic": string | null,
    "reason": string
  },
  "say": string
}`;

// ─── Per-turn context builder ─────────────────────────────────────────────────

export interface TurnContextOptions {
  jobRole: string;
  state: ConversationState;
  resume: ExtractedResume | null;
  recentTranscript: Array<{ speaker: "user" | "ai"; content: string }>;
  userUtterance: string;
  remainingTurns: number;
  remainingMinutes: number;
  allowedActions?: string[];
  candidateLang?: string;
  sttConfidence?: number;
}

export function buildTurnContext(opts: TurnContextOptions): string {
  const {
    jobRole,
    state,
    resume,
    recentTranscript,
    userUtterance,
    remainingTurns,
    remainingMinutes,
    allowedActions = ["next_topic", "followup", "clarify", "meta_acknowledge", "smalltalk_redirect", "nudge", "wrapup", "end"],
    candidateLang = "en-IN",
    sttConfidence = 0.95,
  } = opts;

  const lines: string[] = [];

  lines.push(`=== INTERVIEW CONTEXT ===`);
  lines.push(`Role: ${jobRole}`);
  lines.push(`Current Phase: ${state.phase}`);
  lines.push(`Turns Used: ${state.turnCount} | Remaining: ~${remainingTurns} turns, ~${remainingMinutes} min`);
  lines.push(`Language Mode: ${candidateLang} | STT Confidence: ${sttConfidence.toFixed(2)}`);
  lines.push(`ALLOWED_ACTIONS: ${allowedActions.join(", ")}`);
  lines.push(``);

  // Candidate profile (resume data)
  if (resume) {
    const firstName = state.firstName || resume.fullName.split(" ")[0];
    lines.push(`=== CANDIDATE PROFILE (confidential) ===`);
    lines.push(`Name: ${firstName} (use first name only)`);
    lines.push(`Experience: ${resume.yearsOfExperience} years`);
    lines.push(`Skills: ${resume.topSkills.join(", ")}`);
    if (resume.coreProjects.length > 0) {
      lines.push(`Projects: ${resume.coreProjects.map((p) => p.title).join(", ")}`);
    }
    lines.push(``);
  }

  // Facts memory collected so far
  if (state.facts && state.facts.length > 0) {
    lines.push(`=== KNOWN FACTS MEMORY ===`);
    state.facts.forEach((f, i) => lines.push(`${i + 1}. ${f}`));
    lines.push(``);
  }

  // Coverage checklist
  lines.push(`=== TOPIC COVERAGE Checklist ===`);
  for (const topic of state.coverage) {
    const status = topic.status === "done"
      ? `✓ DONE${topic.score !== undefined ? ` (score=${topic.score})` : ""}`
      : topic.status === "active"
        ? `▶ ACTIVE (followUps=${topic.followUps})`
        : `○ TODO`;
    lines.push(`[${status}] ${topic.label} — Goal: ${topic.goal}`);
  }
  const activeTopic = state.coverage.find((t) => t.status === "active");
  if (activeTopic) {
    lines.push(``);
    lines.push(`Current goal: ${activeTopic.goal}`);
  }
  lines.push(``);

  // Asked questions (to avoid repeats)
  if (state.asked.length > 0) {
    lines.push(`=== QUESTIONS ALREADY ASKED (NEVER repeat these) ===`);
    state.asked.forEach((q, i) => {
      lines.push(`${i + 1}. [${q.topic}] ${q.question}`);
    });
    lines.push(``);
  }

  // Recent dialogue (last 6 turns)
  const lastN = recentTranscript.slice(-12);
  if (lastN.length > 0) {
    lines.push(`=== RECENT DIALOGUE (last ${lastN.length} messages) ===`);
    lastN.forEach((entry) => {
      const speaker = entry.speaker === "ai" ? "YOU" : "CANDIDATE";
      lines.push(`${speaker}: ${entry.content}`);
    });
    lines.push(``);
  }

  // Candidate's latest answer
  lines.push(`=== CANDIDATE'S LATEST ANSWER ===`);
  lines.push(userUtterance || "(no response / silence)");
  lines.push(``);

  lines.push(`INSTRUCTION: Classify candidate INTENT, evaluate response, choose an action from ALLOWED_ACTIONS, and write your spoken response. Output valid JSON matching LLMTurnResponseSchema only.`);

  return lines.join("\n");
}

// ─── Topic-generation prompt ──────────────────────────────────────────────────

export function buildTopicsPrompt(jobRole: string, resume: ExtractedResume | null): string {
  const lines: string[] = [];
  lines.push(`Generate a coverage checklist of 6 interview topics for a ${jobRole} role.`);
  if (resume) {
    lines.push(`Candidate: ${resume.yearsOfExperience} years exp, skills: ${resume.topSkills.join(", ")}.`);
    if (resume.coreProjects.length > 0) {
      lines.push(`Projects: ${resume.coreProjects.map((p) => p.title + " — " + p.description).join("; ")}.`);
    }
  }
  lines.push(``);
  lines.push(`Each topic must have: id (snake_case), label (short), goal (one sentence describing what to assess — not a question).`);
  lines.push(`Mix: background/motivation, strongest project, technical depth for the role, problem solving/debugging, teamwork/conflict, learning/growth.`);
  lines.push(`Adjust the mix for the role and experience level.`);
  lines.push(``);
  lines.push(`Respond with JSON only:`);
  lines.push(`{ "topics": [ { "id": "...", "label": "...", "goal": "..." }, ... ] }`);
  return lines.join("\n");
}
