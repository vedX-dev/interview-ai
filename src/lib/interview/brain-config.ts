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
  // 4-5 STRUCTURALLY DIFFERENT phrasings per topic (not paraphrases).
  // story-based / hypothetical / direct / comparative / scenario-based.
  // Rotation: seed + turnCount % phrasings.length → never repeats same phrasing twice.
  fallbackQuestions: [
    {
      topic: "background",
      phrasings: [
        // story-based
        "Could you walk me through the project you are most excited about from the past year?",
        // direct role motivation
        "What specifically about this role or company made you apply?",
        // comparative / reflective
        "If you had to pick one technical decision from the past year you would make differently, what would it be?",
        // scenario — most recent work
        "Tell me what a typical week looked like in your most recent role.",
        // hypothetical self-description
        "How would your last engineering manager describe you in two or three sentences?",
      ],
    },
    {
      topic: "strongest_project",
      phrasings: [
        // story-based ownership
        "Walk me through a project where you personally owned the architecture from scratch.",
        // hypothetical design question
        "If you had to re-implement your most recent project with twice the traffic in mind, what would you change first?",
        // direct impact
        "What is the project you shipped that had the most measurable impact on the business or users?",
        // comparative difficulty
        "Tell me about a time a project turned out to be far harder than you initially expected — what happened?",
        // scenario: debugging under pressure
        "Describe a production incident on one of your projects. How did you diagnose and resolve it?",
      ],
    },
    {
      topic: "technical_depth",
      phrasings: [
        // direct proficiency
        "Which technology in your stack do you feel you understand the deepest, and what do you know about it that most engineers don't?",
        // story-based depth
        "Tell me about a time your understanding of a core technology saved a project from a serious problem.",
        // comparative trade-off
        "When would you choose one data storage technology over another — give me a real example from your work.",
        // hypothetical: explain to non-engineer
        "Explain the most complex system you have worked on as if I were a product manager who has no engineering background.",
        // scenario-based: teach it
        "If you were onboarding a junior engineer to the most complex part of your stack, what would you cover first and why?",
      ],
    },
    {
      topic: "problem_solving",
      phrasings: [
        // story-based debugging
        "Take me through the hardest bug you have ever had to find. How long did it take and how did you track it down?",
        // hypothetical diagnostic
        "Production is responding 10x slower than usual. There are no obvious errors. Walk me through your investigation.",
        // scenario: ambiguous spec
        "Tell me about a time you had to build something where the requirements were genuinely unclear. How did you proceed?",
        // direct: tools and process
        "What tools or techniques do you rely on when debugging something you have never seen before?",
        // comparative: before and after
        "Describe a bug fix that also led you to improve how you monitor or test that area of the codebase.",
      ],
    },
    {
      topic: "teamwork",
      phrasings: [
        // story-based conflict
        "Tell me about a technical disagreement with a teammate where you were both convinced you were right. How did it resolve?",
        // hypothetical cross-team
        "You need to make a breaking API change that affects three other teams. Walk me through how you manage it.",
        // direct: code review culture
        "How do you give critical feedback in a code review without damaging the relationship?",
        // comparative: difficult colleague
        "Tell me about the hardest person you have worked with technically, and what you learned from that experience.",
        // scenario: missed deadline
        "Your team is going to miss a deadline. How do you handle the conversation with your manager and the other teams depending on you?",
      ],
    },
    {
      topic: "learning",
      phrasings: [
        // direct: current learning
        "What is the most interesting technical concept you have been digging into in the past few months?",
        // story-based: fast ramp
        "Tell me about a time you had to pick up a technology you had never used before in order to ship something. How did you approach it?",
        // hypothetical: gap identification
        "Looking at where you are now versus where you want to be in two years, what is the biggest skill gap you are working on?",
        // comparative: learning styles
        "Do you learn better from reading documentation, building toy projects, or working on real problems? Give me an example of each working for you.",
        // scenario: staying current
        "How do you decide what to spend your limited learning time on when there are always more things to learn than hours in the day?",
      ],
    },
    {
      topic: "wrapup",
      phrasings: [
        "Do you have any questions for me about the role or the team?",
        "Is there anything about your background or this role you would like to add before we finish?",
      ],
    },
  ],

  // ─── Opening line templates (Phase 1 variation) ───────────────────────────
  // These are STRUCTURAL TEMPLATES filled in by the LLM with resume-specific detail.
  // 6 structurally different templates — not synonyms of each other.
  // Template is selected by: seed % openingTemplates.length
  openingTemplates: [
    // Template 0: open with most recent project (JUMP START)
    `Start with their most recent project or role visible in context. Ask a specific, concrete question about what they built or their role on that project. Do NOT open with "tell me about yourself." Do NOT ask a generic motivation question. Example structure: "I see you worked on [PROJECT/ROLE] — what was your specific contribution there, and what part of it are you most proud of?"`,

    // Template 1: open with role-relevant scenario (SCENARIO OPENER)
    `Open with a short, hypothetical technical scenario directly relevant to the job role. Make it concrete, grounded, and solvable without expert knowledge. Example structure: "Imagine you just joined our team and [SHORT RELEVANT SCENARIO]. How would you start approaching that?" Then invite their answer.`,

    // Template 2: open with career background (BACKGROUND OPENER — but seeded variation)
    `Open with a career story question that avoids the generic "tell me about yourself." Ask specifically about a transition, turning point, or decision in their career. Example structure: "What was the decision that most shaped the direction your engineering career has taken — and would you make the same decision again?"`,

    // Template 3: open with a direct expertise probe (EXPERTISE FIRST)
    `Open by identifying their most relevant technical skill from context and probing it directly. Skip the background — go straight to their depth. Example structure: "Given your experience with [SKILL FROM RESUME], let me start there. Can you walk me through how you have used it in a production environment and what you know about it that most engineers don't?"`,

    // Template 4: open with a failure/learning story (GROWTH OPENER)
    `Open with a learning or failure question that reveals self-awareness. Avoid making it sound negative. Example structure: "Before we get into the technical details — what is one thing you have gotten noticeably better at as an engineer in the past year, and what drove that growth?"`,

    // Template 5: open with impact and outcomes (IMPACT OPENER)
    `Open by asking directly about measurable impact. Skip motivation, skip background — ask what they shipped and what it changed. Example structure: "Let's start with outcomes: what is the most impactful thing you have shipped in the past year, and how did you measure that impact?"`,
  ],
} as const;
