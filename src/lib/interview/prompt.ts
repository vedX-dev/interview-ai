/**
 * Interview system prompt and per-turn context builder.
 *
 * Core design principle: the candidate's LATEST ANSWER is the PRIMARY source for the next question.
 * The LLM follows open threads extracted from that answer before consulting the coverage checklist.
 */

import type { ConversationState, AskedQuestion } from "@/src/schemas/brain";
import type { ExtractedResume } from "@/src/schemas/resume";
import type { AnswerSignals } from "@/src/lib/interview/state";

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
- "question_to_ai": Candidate asks a genuine question directed to you — either about the role/team/process OR a conversational permission request like "can I ask you something?", "can I ask a quick question?", "can I clarify something?" — treat ALL of these as conversational, NOT as failed technical answers. Respond naturally and then wait.
- "smalltalk": Casual greetings, pleasantries, or readiness statements (e.g., "I'm ready to begin").
- "offtopic": Off-topic remarks, jokes, or non-interview requests (e.g., "play a Hindi movie").
- "unprofessional": Abusive, crude, or mocking language.
- "garbled": Severe acoustic noise, speech-to-text corruption, or unintelligible gibberish.
- "stop": Candidate explicitly requests to end or exit the interview.

EVALUATION & SCORING RULES
- ONLY candidate responses with intent "answer" or "partial" are evaluated for technical substance and scored (0-10).
- Greetings, readiness confirmations, meta-comments, clarification requests, small talk, off-topic remarks, and unprofessional language MUST NEVER be given a numerical score or added to the scoring record. Set score to null for these turns.
- Never penalize a candidate for speaking Hindi or Hinglish. Evaluate the technical substance of their response regardless of language or speech-recognition quirks. Never mark clear text in another language or a meta-comment as "garbled".

ANSWER-GROUNDED FOLLOW-UP (MOST IMPORTANT RULE)
When the candidate provides a meaningful technical answer (intent = "answer" or "partial"), you MUST follow this process before generating your next question:

1. READ the "SIGNALS FROM LAST ANSWER" section in your context. These are concrete technologies, claims, decisions, and open threads the candidate just mentioned.
2. READ the "ACTIVE THREAD" section. If a thread is active, your default is to CONTINUE it unless it is exhausted or irrelevant.
3. Identify the STRONGEST open thread — a technology mentioned but not yet probed, a claim that needs validation, a decision without a reason, or an unclear reference.
4. Ask ONE focused question that probes THAT thread specifically.
5. ONLY consult the coverage checklist to pick a NEW topic when the current thread is fully explored, or when the candidate's answer introduces nothing new.

CORRECT EXAMPLE:
- Candidate: "I used pgvector with AWS in my interview system."
- Signals: technologies=[pgvector, aws], claims=["used pgvector with aws in interview system"]
- Active thread: pgvector usage in interview system
- CORRECT follow-up: "What role did pgvector play in your interview system?" or "How did you generate the embeddings stored in pgvector?"
- WRONG follow-up: "What motivated you to pursue software engineering?" (unrelated topic jump)

THREAD CONTINUATION RULE:
If the candidate provides NEW information in response to your follow-up (mentions another technology, gives a metric, explains a decision), the thread is STILL OPEN. Stay on it.
Transition to a new topic ONLY when:
- The candidate's last answer added nothing new to the thread (no new tech, claim, or detail), OR
- You have asked 2+ follow-ups on this thread and the candidate is repeating themselves, OR
- The thread depth counter reaches the maximum shown in context.

CONVERSATIONAL PRIORITY ORDER (enforce in this exact order):
1. Handle explicit conversational intent FIRST: question_to_ai → respond naturally, wait. meta → acknowledge, ask new question. repeat_request → rephrase previous question.
2. If intent is "answer" or "partial" AND signals/thread exist → stay anchored to the answer.
3. If the answer contains technologies or claims not yet explored → probe those.
4. If thread is exhausted or answer has no novel signals → advance to next coverage topic.
5. NEVER jump to an unrelated topic when the candidate just provided a meaningful answer.

HUMAN CONVERSATION EXAMPLES:
- Candidate: "Can I ask you a simple yes/no question?" → You: "Of course, go ahead." (then WAIT — do NOT ask a new interview question)
- Candidate: "Can I ask something quickly?" → You: "Sure, what's on your mind?"
- Candidate: "Can we start?" → You: respond with the first warmup question
- Candidate: "I used pgvector with AWS" → You: "What role did pgvector play?"
- Candidate: "We used pgvector for similarity search on embeddings" → You: "How were those embeddings generated?"
- Candidate: "We used the OpenAI embeddings API" → You: "How did you handle the latency or cost of that?"
- Candidate: (repeats same info) → You: transition to next topic naturally

DECISION POLICY & ALLOWED ACTIONS
You must select an action ONLY from the ALLOWED_ACTIONS list provided in your per-turn context block:
1. "next_topic": Advance to the next interview topic when the thread is exhausted, the candidate score is high, or the topic coverage cap has been reached.
2. "followup": Ask a focused follow-up anchored to the ACTIVE THREAD or a signal from the last answer. Respect the follow-up cap on the current topic.
3. "clarify": Use the clarify ladder when an answer is genuinely garbled or unclear. Never clarify a meaningful answer just because it is short.
4. "meta_acknowledge": Acknowledge candidate meta-comments, permission requests, or questions briefly and wait. For question_to_ai, respond naturally and do NOT immediately ask a technical question.
5. "smalltalk_redirect": Acknowledge casual remarks briefly and steer back to the interview goal.
6. "nudge": Respond to unprofessional language with a single polite boundary statement and proceed with a new question.
7. "wrapup": Enter the final interview phase to invite candidate questions.
8. "end": Conclude the interview session warmly.

ACKNOWLEDGEMENT AND RESPONSE PHRASING
- Open your response with a short, natural 3 to 6 word spoken reaction before introducing your question or follow-up.
- Reference something ACTUALLY PRESENT in the latest answer (specific technology, project name, metric, decision) when generating a follow-up. NEVER invent or assume details not present.
- NEVER quote or verbatim restate the candidate's exact words back to them.
- Keep spoken replies under 3 sentences for maximum clarity and fast text-to-speech synthesis.
- Ask ONE question per turn only. Never stack multiple questions.

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
  /** Answer signals extracted from the latest utterance (tech, claims, open threads) */
  signals?: AnswerSignals;
  /**
   * Adaptive difficulty target for this turn (from K-Score engine).
   * Injected into context so the LLM probes at the correct depth.
   */
  targetDepth?: "easy" | "medium" | "hard";
  /**
   * Depth ladder guidance text from the knowledge base for the active topic.
   * Tells the LLM HOW to probe, not what to ask.
   */
  depthGuidance?: string;
  /**
   * Average word count of the candidate's recent answers (for length adaptation).
   * Used to adjust expected response length hint.
   */
  avgAnswerWords?: number;
  /**
   * Opening line template instruction (Phase 1 variation seed).
   * Only passed on the first warmup turn. Tells the LLM which opening structure to use.
   */
  openingTemplate?: string;
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
    signals,
    targetDepth,
    depthGuidance,
    avgAnswerWords,
    openingTemplate,
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

  // ── ACTIVE THREAD (answer-grounding) ──────────────────────────────────────
  // This is the most important section for answer-grounded follow-ups.
  if (state.activeThread) {
    lines.push(`=== ACTIVE CONVERSATION THREAD ===`);
    lines.push(`Thread: ${state.activeThread}`);
    lines.push(`Thread depth: ${state.threadDepth ?? 0} turn(s) on this thread`);
    lines.push(`Max thread depth before topic change: ${3}`);
    lines.push(`INSTRUCTION: Your default is to stay on this thread with a focused follow-up UNLESS the thread is exhausted or the candidate introduced nothing new.`);
    lines.push(``);
  }

  // ── SIGNALS FROM LAST ANSWER ───────────────────────────────────────────────
  // If signals were extracted, surface them prominently for the LLM.
  if (signals && (signals.technologies.length > 0 || signals.claims.length > 0)) {
    lines.push(`=== SIGNALS FROM LAST ANSWER ===`);
    if (signals.technologies.length > 0) {
      lines.push(`Technologies mentioned: ${signals.technologies.join(", ")}`);
    }
    if (signals.claims.length > 0) {
      lines.push(`Concrete claims/decisions:`);
      signals.claims.forEach((c) => lines.push(`  - ${c}`));
    }
    if (signals.openThreads.length > 0) {
      lines.push(`Brief mentions needing follow-up:`);
      signals.openThreads.forEach((t) => lines.push(`  - ${t}`));
    }
    lines.push(`INSTRUCTION: Probe the STRONGEST signal above unless the active thread already covers it. Do NOT jump to an unrelated topic.`);
    lines.push(``);
  } else if (userUtterance && userUtterance.length > 8) {
    // Still surface the answer even if no structured signals were extracted
    lines.push(`=== SIGNALS FROM LAST ANSWER ===`);
    lines.push(`(No specific technologies detected. Probe the substance of the candidate's answer before changing topics.)`);
    lines.push(``);
  }

  // Coverage checklist
  lines.push(`=== TOPIC COVERAGE Checklist ===`);
  for (const topic of state.coverage) {
    const status = topic.status === "done"
      ? `\u2713 DONE${topic.score !== undefined ? ` (score=${topic.score})` : ""}`
      : topic.status === "active"
        ? `\u25b6 ACTIVE (followUps=${topic.followUps})`
        : `\u25cb TODO`;
    lines.push(`[${status}] ${topic.label} \u2014 Goal: ${topic.goal}`);
  }
  const activeTopic = state.coverage.find((t) => t.status === "active");
  if (activeTopic) {
    lines.push(``);
    lines.push(`Current goal: ${activeTopic.goal}`);
    lines.push(`NOTE: The active topic goal is a GUIDE. Stay anchored to the candidate's actual answer first.`);
  }
  lines.push(``);

  // ── Phase 2: Adaptive Difficulty Block ──────────────────────────────────────
  if (targetDepth) {
    lines.push(`=== ADAPTIVE DIFFICULTY ===`);
    lines.push(`K-Score (candidate performance): ${state.kScore?.toFixed(1) ?? "5.0"}/10 | Trend: ${state.kScoreTrend ?? "flat"}`);
    lines.push(`TARGET DEPTH THIS TURN: ${targetDepth.toUpperCase()}`);
    if (depthGuidance) {
      lines.push(`Depth guidance: ${depthGuidance}`);
    } else {
      const depthHints: Record<string, string> = {
        easy: "Ask a broad, story-based opener. Give the candidate room to anchor the conversation.",
        medium: "Probe implementation details, trade-offs, and decisions. Ask for specifics.",
        hard: "Push on architecture-level, failure modes, scalability, or design critique. Ask what they would change.",
      };
      lines.push(`Depth guidance: ${depthHints[targetDepth] ?? ""}`);
    }
    // Length adaptation
    if (avgAnswerWords !== undefined && avgAnswerWords > 0) {
      if (avgAnswerWords < 30) {
        lines.push(`ANSWER LENGTH SIGNAL: Candidate's recent answers are SHORT (avg ~${Math.round(avgAnswerWords)} words). Ask a more open, easier-to-answer prompt to draw them out.`);
      } else if (avgAnswerWords > 100) {
        lines.push(`ANSWER LENGTH SIGNAL: Candidate's recent answers are DETAILED (avg ~${Math.round(avgAnswerWords)} words). Ask a sharper, more focused follow-up.`);
      }
    }
    lines.push(``);
  }

  // ── Phase 1: Opening Template (first warmup turn only) ───────────────────────
  if (openingTemplate) {
    lines.push(`=== OPENING QUESTION INSTRUCTION ===`);
    lines.push(`This is the FIRST question of the interview. Use this specific structure:`);
    lines.push(openingTemplate);
    lines.push(`Fill in resume-specific details from the CANDIDATE PROFILE above. Make it specific, not generic.`);
    lines.push(``);
  }

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

  // Candidate's latest answer (always last — highest attention weight)
  lines.push(`=== CANDIDATE'S LATEST ANSWER ===`);
  lines.push(userUtterance || "(no response / silence)");
  lines.push(``);

  lines.push(`INSTRUCTION: (1) Classify INTENT. (2) If intent is "answer" or "partial", check SIGNALS and ACTIVE THREAD first — your follow-up MUST reference something the candidate just said. (3) Choose action from ALLOWED_ACTIONS. (4) Output valid JSON only.`);

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
