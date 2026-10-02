/**
 * STEP 6: Interview Brain Regression & Scenario Tests
 *
 * Run: npx tsx --env-file=.env src/tests/brain.test.ts
 */

import { ConversationStateSchema } from "../schemas/brain";
import {
  loadState,
  isTooSimilar,
  tokenOverlap,
  enforceDecisionPolicy,
  getFallbackUtterance,
  activateNextTopic,
  closeActiveTopic,
  advancePhase,
} from "../lib/interview/state";
import { BRAIN_CONFIG } from "../lib/interview/brain-config";
import { buildTurnContext } from "../lib/interview/prompt";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (e: any) {
    console.error(`  ❌  ${name}\n     ${e.message}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertEq<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

console.log("\n══════════════════════════════════════════════════════");
console.log(" UNIT TESTS — brain logic (no HTTP, no LLM)");
console.log("══════════════════════════════════════════════════════\n");

// ── ConversationState schema ──────────────────────────────────────────────────

console.log("▶ ConversationState schema");

test("Parses empty object to valid defaults", () => {
  const s = loadState({});
  assertEq(s.phase, "intro", "phase");
  assertEq(s.turnCount, 0, "turnCount");
  assertEq(s.warmupTurns, 0, "warmupTurns");
  assertEq(s.coverage.length, 0, "coverage");
  assertEq(s.asked.length, 0, "asked");
});

test("Parses valid state object", () => {
  const s = loadState({
    phase: "core",
    warmupTurns: 3,
    coverage: [{ id: "background", label: "Background", goal: "Assess motivation", status: "done", followUps: 0 }],
    asked: [{ question: "Tell me about yourself", topic: "background", turnIndex: 1 }],
    scores: [],
    followUpsOnCurrent: 0,
    turnCount: 4,
  });
  assertEq(s.phase, "core", "phase");
  assertEq(s.warmupTurns, 3, "warmupTurns");
  assertEq(s.turnCount, 4, "turnCount");
  assertEq(s.coverage[0].status, "done", "coverage status");
});

// ── Warmup Phase & Transitions ───────────────────────────────────────────────

console.log("\n▶ Warmup Phase & Transitions (advancePhase)");

test("advancePhase: intro advances to warmup", () => {
  const state = ConversationStateSchema.parse({ phase: "intro", warmupTurns: 0 });
  const next = advancePhase(state);
  assertEq(next.phase, "warmup", "phase after intro");
  assertEq(next.warmupTurns, 0, "warmupTurns initialized");
});

test("Warmup lasts >= minWarmupTurns (3 turns)", () => {
  let state = ConversationStateSchema.parse({ phase: "warmup", warmupTurns: 1 });
  state = advancePhase(state);
  assertEq(state.phase, "warmup", "warmup turn 1 stays in warmup");

  state.warmupTurns = 2;
  state = advancePhase(state);
  assertEq(state.phase, "warmup", "warmup turn 2 stays in warmup");

  state.warmupTurns = 3;
  state = advancePhase(state);
  assertEq(state.phase, "core", "warmup turn 3 advances to core");
});

test("Warmup early exit allowed if candidate explicitly asks to start and warmupTurns >= 2", () => {
  let state = ConversationStateSchema.parse({ phase: "warmup", warmupTurns: 1 });
  state = advancePhase(state, { candidateAskedToStart: true });
  assertEq(state.phase, "warmup", "cannot early exit at 1 turn");

  state.warmupTurns = 2;
  state = advancePhase(state, { candidateAskedToStart: true });
  assertEq(state.phase, "core", "early exit allowed at 2 turns when candidate asks to start");
});

test("Warmup extended if candidate asks question to AI", () => {
  let state = ConversationStateSchema.parse({ phase: "warmup", warmupTurns: 3 });
  state = advancePhase(state, { lastIntent: "question_to_ai" });
  assertEq(state.phase, "warmup", "warmup extended by 1 turn on question_to_ai");

  state.warmupTurns = 4;
  state = advancePhase(state, { lastIntent: "question_to_ai" });
  assertEq(state.phase, "core", "warmup advances to core after extension");
});

test("First reply to greeting NEVER receives openingTemplate", () => {
  const state = ConversationStateSchema.parse({ phase: "warmup", warmupTurns: 1 });
  const isFirstCoreQuestion = false;
  const ctx = buildTurnContext({
    jobRole: "Frontend Engineer",
    state,
    resume: null,
    recentTranscript: [{ speaker: "ai", content: "Hi! Can you hear me clearly?" }],
    userUtterance: "Yes I can hear you!",
    remainingTurns: 25,
    remainingMinutes: 30,
    openingTemplate: isFirstCoreQuestion ? "DUMMY_TEMPLATE" : undefined,
  });

  assert(!ctx.includes("DUMMY_TEMPLATE"), "First reply must NOT contain opening template");
  assert(ctx.includes("=== WARMUP MODE ==="), "Context must contain Warmup Mode block");
});

// ── Decision policy enforcement ───────────────────────────────────────────────

console.log("\n▶ enforceDecisionPolicy");

function mockState(overrides: Partial<import("../schemas/brain").ConversationState> = {}): import("../schemas/brain").ConversationState {
  const followUps = overrides.followUpsOnCurrent ?? 0;
  return ConversationStateSchema.parse({
    phase: "core",
    coverage: [
      { id: "technical", label: "Technical", goal: "Assess depth", status: "active", followUps },
    ],
    asked: [],
    scores: [],
    followUpsOnCurrent: followUps,
    turnCount: 4,
    warmupTurns: 3,
    ...overrides,
  });
}

function mockLLM(overrides: Partial<import("../schemas/brain").LLMTurnResponse> = {}): import("../schemas/brain").LLMTurnResponse {
  return {
    intent: "answer",
    evaluation: {
      answeredQuestion: true,
      unclearOrGarbled: false,
      offTopic: false,
      score: 7,
      confidence: 0.8,
      strengths: ["clear explanation"],
      gaps: [],
      facts: [],
      openThread: null,
    },
    decision: { action: "next_topic", nextTopic: undefined, reason: "answered well" },
    say: "Good point. Let me ask you about a debugging situation next.",
    ...overrides,
  };
}

test("Smalltalk/question_to_ai in warmup is NOT redirected", () => {
  const warmupState = mockState({ phase: "warmup", warmupTurns: 1 });
  const llm = mockLLM({
    intent: "smalltalk",
    evaluation: { answeredQuestion: false, unclearOrGarbled: false, offTopic: false, score: null, confidence: 0.9, strengths: [], gaps: [], facts: [], openThread: null },
    decision: { action: "smalltalk_redirect", reason: "greeting" },
    say: "Great to connect with you today!",
  });

  const res = enforceDecisionPolicy(llm, warmupState);
  assertEq(res.action, "meta_acknowledge", "Warmup smalltalk becomes meta_acknowledge, never smalltalk_redirect");
  assertEq(res.shouldAdvanceTopic, false, "Does not advance topic");
});

test("Score >= 7 does NOT skip a topic before minTurnsPerTopic (2 turns)", () => {
  const state = mockState({
    phase: "core",
    followUpsOnCurrent: 0, // Turn 1 on topic (followUps = 0) -> turnsOnCurrentTopic = 1 (< minTurnsPerTopic 2)
  });
  const llm = mockLLM({
    evaluation: { answeredQuestion: true, unclearOrGarbled: false, offTopic: false, score: 9, confidence: 0.9, strengths: ["great answer"], gaps: [], facts: [], openThread: null },
    decision: { action: "next_topic", reason: "high score" },
    say: "Excellent answer. Moving on.",
  });

  const res = enforceDecisionPolicy(llm, state);
  assertEq(res.action, "followup", "Must ask follow-up because minTurnsPerTopic=2 is not met yet");
  assertEq(res.shouldAdvanceTopic, false, "Topic must not close before minTurnsPerTopic");
});

test("Score >= 7 advances topic when minTurnsPerTopic (2 turns) IS met", () => {
  const state = mockState({
    phase: "core",
    followUpsOnCurrent: 1, // Turn 2 on topic (followUps = 1) -> turnsOnCurrentTopic = 2 (>= minTurnsPerTopic 2)
  });
  const llm = mockLLM({
    evaluation: { answeredQuestion: true, unclearOrGarbled: false, offTopic: false, score: 9, confidence: 0.9, strengths: ["great answer"], gaps: [], facts: [], openThread: null },
    decision: { action: "next_topic", reason: "high score" },
    say: "Excellent answer. Moving on.",
  });

  const res = enforceDecisionPolicy(llm, state);
  assertEq(res.action, "next_topic", "Advances topic when minTurnsPerTopic is met");
  assertEq(res.shouldAdvanceTopic, true, "shouldAdvanceTopic is true");
});

test("Core smalltalk receives smalltalk_redirect ONLY after 2 consecutive turns", () => {
  const stateTurn1 = mockState({ phase: "core", consecutiveSmalltalkCount: 0 });
  const llm = mockLLM({
    intent: "smalltalk",
    evaluation: { answeredQuestion: false, unclearOrGarbled: false, offTopic: true, score: null, confidence: 0.9, strengths: [], gaps: [], facts: [], openThread: null },
    decision: { action: "smalltalk_redirect", reason: "smalltalk" },
    say: "That's nice!",
  });

  const res1 = enforceDecisionPolicy(llm, stateTurn1);
  assertEq(res1.action, "meta_acknowledge", "1st smalltalk turn responds naturally with meta_acknowledge");

  const stateTurn2 = mockState({ phase: "core", consecutiveSmalltalkCount: 1 });
  const res2 = enforceDecisionPolicy(llm, stateTurn2);
  assertEq(res2.action, "smalltalk_redirect", "2nd consecutive smalltalk turn triggers smalltalk_redirect");
});

// ── RESULTS ───────────────────────────────────────────────────────────────────

console.log(`\n══════════════════════════════════════════════════════`);
console.log(` Results: ${passed} passed  ${failed} failed  (${passed + failed} total)`);
console.log(`══════════════════════════════════════════════════════\n`);

if (failed > 0) process.exit(1);
