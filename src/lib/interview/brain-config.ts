/**
 * Interview brain configuration.
 * ALL thresholds, caps, and policy rules live here.
 * Enforced in code; prompts reference these values but do NOT control them.
 */

export const BRAIN_CONFIG = {
  // ─── Professionalism Nudge Flag ──────────────────────────────────────────
  PROFESSIONALISM_NUDGE: true,

  // ─── Phase turn caps & pacing ─────────────────────────────────────────────
  minWarmupTurns: 3,             // min candidate turns in warmup before entering core
  maxWarmupTurns: 5,             // max candidate turns in warmup before forced transition
  minWarmupTurnsEarlyExit: 2,     // early exit if candidate explicitly asks to start
  maxCoreTopics: 5,              // max distinct core topics
  maxTotalTurns: 28,             // hard kill-switch (incl. wrapup)
  timeBudgetMs: 35 * 60 * 1000,   // 35 minutes wall-clock

  // ─── Topic & Follow-up pacing ─────────────────────────────────────────────
  minTurnsPerTopic: 2,           // min turns per topic (1 main + 1 follow-up) before closing
  maxFollowUpsNormal: 2,         // per topic when confidence >= 0.6
  maxFollowUpsLowConfidence: 2,  // per topic when confidence < 0.6
  maxThreadDepth: 3,             // max follow-ups on single activeThread before changing topic

  // ─── Decision thresholds (enforce in code) ───────────────────────────────
  scoreForNextTopic: 7,            // score >= this → next_topic (if minTurnsPerTopic met)
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
  ],

  // ─── Multi-phrasing fallback bank (used when ALL LLMs fail) ─────────────
  fallbackQuestions: [
    {
      topic: "background",
      phrasings: [
        "Could you walk me through the project you are most excited about from the past year?",
        "What specifically about this role or company made you apply?",
        "If you had to pick one technical decision from the past year you would make differently, what would it be?",
        "Tell me what a typical week looked like in your most recent role.",
        "How would your last engineering manager describe you in two or three sentences?",
      ],
    },
    {
      topic: "strongest_project",
      phrasings: [
        "Walk me through a project where you personally owned the architecture from scratch.",
        "If you had to re-implement your most recent project with twice the traffic in mind, what would you change first?",
        "What is the project you shipped that had the most measurable impact on the business or users?",
        "Tell me about a time a project turned out to be far harder than you initially expected — what happened?",
        "Describe a production incident on one of your projects. How did you diagnose and resolve it?",
      ],
    },
    {
      topic: "technical_depth",
      phrasings: [
        "Which technology in your stack do you feel you understand the deepest, and what do you know about it that most engineers don't?",
        "Tell me about a time your understanding of a core technology saved a project from a serious problem.",
        "When would you choose one data storage technology over another — give me a real example from your work.",
        "Explain the most complex system you have worked on as if I were a product manager who has no engineering background.",
        "If you were onboarding a junior engineer to the most complex part of your stack, what would you cover first and why?",
      ],
    },
    {
      topic: "problem_solving",
      phrasings: [
        "Take me through the hardest bug you have ever had to find. How long did it take and how did you track it down?",
        "Production is responding 10x slower than usual. There are no obvious errors. Walk me through your investigation.",
        "Tell me about a time you had to build something where the requirements were genuinely unclear. How did you proceed?",
        "What tools or techniques do you rely on when debugging something you have never seen before?",
        "Describe a bug fix that also led you to improve how you monitor or test that area of the codebase.",
      ],
    },
    {
      topic: "teamwork",
      phrasings: [
        "Tell me about a technical disagreement with a teammate where you were both convinced you were right. How did it resolve?",
        "You need to make a breaking API change that affects three other teams. Walk me through how you manage it.",
        "How do you give critical feedback in a code review without damaging the relationship?",
        "Tell me about the hardest person you have worked with technically, and what you learned from that experience.",
        "Your team is going to miss a deadline. How do you handle the conversation with your manager and the other teams depending on you?",
      ],
    },
    {
      topic: "learning",
      phrasings: [
        "What is the most interesting technical concept you have been digging into in the past few months?",
        "Tell me about a time you had to pick up a technology you had never used before in order to ship something. How did you approach it?",
        "Looking at where you are now versus where you want to be in two years, what is the biggest skill gap you are working on?",
        "Do you learn better from reading documentation, building toy projects, or working on real problems?",
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

  // ─── Opening line templates (Bridge Turn variation) ───────────────────────
  // Structural templates used ONLY for the first core question (the bridge turn).
  // References warmup or resume background; none instructs to skip background or motivation.
  openingTemplates: [
    // Template 0: Bridge from warmup/resume to background & role motivation
    `Open the core technical section by connecting what you learned during warmup or their resume to their background and motivation. Example structure: "Building on what we discussed, I see on your resume that you worked on [PROJECT/ROLE] — what drew you to that work, and what was your specific contribution there?"`,

    // Template 1: Bridge from warmup into a role-relevant scenario
    `Bridge from warmup into a role-relevant scenario based on their background. Make it concrete, grounded, and inviting. Example structure: "Now that we've warmed up, imagine you just joined our team working on [AREA FROM RESUME/WARMUP]. How would you start approaching [RELEVANT SCENARIO]?"`,

    // Template 2: Bridge into career decision
    `Bridge into their career trajectory by referencing a key transition visible on their resume or from warmup. Example structure: "Looking at your experience with [SKILL/ROLE], what was the decision that most shaped your engineering career path — and what motivated that choice?"`,

    // Template 3: Bridge into core technical depth
    `Bridge from warmup into their core technical expertise. Reference their background or recent project. Example structure: "Transitioning to your technical background, given your experience with [SKILL FROM RESUME], can you walk me through how you used it in production and what you learned from it?"`,

    // Template 4: Bridge into growth and learning
    `Bridge from warmup into a growth and learning question tied to their background. Example structure: "To kick off our technical discussion — reflecting on your background, what is one technical area where you've grown the most in the past year, and what drove that growth?"`,

    // Template 5: Bridge into impactful outcomes
    `Bridge from warmup into measurable outcomes from their past work. Example structure: "Now moving into your engineering experience, what is the most impactful project you've shipped recently, and what was your role in achieving those outcomes?"`,
  ],
} as const;
