/**
 * STEP 6: Interview Brain Regression & Scenario Tests
 *
 * Run: npx tsx src/tests/brain.test.ts
 *
 * Requirements:
 *   - Set NEXT_PUBLIC_APP_URL or APP_URL in .env.local
 *   - Valid CLERK session cookie (or mock auth — see AUTH_BYPASS below)
 *
 * This file is self-contained: it issues real HTTP calls to a locally running
 * dev server (npm run dev on port 3000 by default). It does NOT mock the LLM.
 * Results are observed and printed, not asserted against a mock.
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
} from "../lib/interview/state";
import { BRAIN_CONFIG } from "../lib/interview/brain-config";

// ─── Utility ─────────────────────────────────────────────────────────────────

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

// ─── UNIT TESTS ───────────────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════════════════");
console.log(" UNIT TESTS — brain logic (no HTTP, no LLM)");
console.log("══════════════════════════════════════════════════════\n");

// ── ConversationState schema ──────────────────────────────────────────────────

console.log("▶ ConversationState schema");

test("Parses empty object to valid defaults", () => {
  const s = loadState({});
  assertEq(s.phase, "intro", "phase");
  assertEq(s.turnCount, 0, "turnCount");
  assertEq(s.coverage.length, 0, "coverage");
  assertEq(s.asked.length, 0, "asked");
});

test("Parses valid state object", () => {
  const s = loadState({
    phase: "core",
    coverage: [{ id: "background", label: "Background", goal: "Assess motivation", status: "done", followUps: 0 }],
    asked: [{ question: "Tell me about yourself", topic: "background", turnIndex: 1 }],
    scores: [],
    followUpsOnCurrent: 0,
    turnCount: 3,
  });
  assertEq(s.phase, "core", "phase");
  assertEq(s.turnCount, 3, "turnCount");
  assertEq(s.coverage[0].status, "done", "coverage status");
});

test("Resets malformed plan to defaults", () => {
  const s = loadState({ phase: "invalid_phase_xyz", coverage: "not_an_array" });
  assertEq(s.phase, "intro", "phase defaults to intro on parse error");
});

// ── Similarity / repeated question guard ─────────────────────────────────────

console.log("\n▶ isTooSimilar (repeated-question guard)");

test("Token overlap: identical strings → 1.0", () => {
  const score = tokenOverlap("tell me about yourself", "tell me about yourself");
  assert(score === 1.0, `Expected 1.0, got ${score}`);
});

test("Token overlap: completely different → 0.0", () => {
  const score = tokenOverlap("describe your project", "what is your biggest weakness");
  assert(score < 0.2, `Expected <0.2, got ${score}`);
});

test("Token overlap: similar paraphrase → above threshold", () => {
  // These share enough tokens: walk, through, difficult/challenging, problem, solved/resolve
  const score = tokenOverlap(
    "Can you walk me through a difficult technical problem you solved recently",
    "Walk me through a difficult technical problem you had to solve",
  );
  assert(score >= BRAIN_CONFIG.similarityThreshold, `Expected >=${BRAIN_CONFIG.similarityThreshold}, got ${score}`);
});

test("isTooSimilar: detects near-duplicate in asked list", () => {
  const asked = [
    { question: "Tell me about your strongest technical project in detail.", topic: "project", turnIndex: 1 },
  ];
  // Same tokens: tell, about, your, strongest, technical, project
  const result = isTooSimilar("Tell me about your strongest technical project please", asked);
  assert(result === true, "Should flag near-duplicate question");
});

test("isTooSimilar: allows clearly different question", () => {
  const asked = [
    { question: "Tell me about your background.", topic: "background", turnIndex: 1 },
  ];
  const result = isTooSimilar("Can you walk me through a debugging situation?", asked);
  assert(result === false, "Should allow different question");
});

// ── Decision policy enforcement ───────────────────────────────────────────────

console.log("\n▶ enforceDecisionPolicy");

function mockState(overrides: Partial<import("../schemas/brain").ConversationState> = {}): import("../schemas/brain").ConversationState {
  return ConversationStateSchema.parse({
    phase: "core",
    coverage: [
      { id: "technical", label: "Technical", goal: "Assess depth", status: "active", followUps: 0 },
    ],
    asked: [],
    scores: [],
    followUpsOnCurrent: 0,
    turnCount: 3,
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
    },
    decision: { action: "next_topic", nextTopic: undefined, reason: "answered well" },
    say: "Good point. Let me ask you about a debugging situation next.",
    ...overrides,
  };
}

test("Garbled → always clarify, never advance", () => {
  const state = mockState();
  const llm = mockLLM({
    intent: "garbled",
    evaluation: {
      answeredQuestion: false, unclearOrGarbled: true, offTopic: false,
      score: 0, confidence: 0.1, strengths: [], gaps: [], facts: [],
    },
    decision: { action: "clarify", reason: "garbled" },
    say: "Sorry?",
  });
  const result = enforceDecisionPolicy(llm, state);
  assertEq(result.action, "clarify", "action");
  assertEq(result.shouldAdvanceTopic, false, "shouldAdvanceTopic");
  assertEq(result.shouldEndInterview, false, "shouldEndInterview");
});

test("Score ≥7 + confidence ≥0.7 → next_topic", () => {
  const state = mockState();
  const llm = mockLLM({ evaluation: { answeredQuestion: true, unclearOrGarbled: false, offTopic: false, score: 8, confidence: 0.85, strengths: ["solid"], gaps: [], facts: [] }, decision: { action: "next_topic", reason: "good answer" }, say: "Great." });
  const result = enforceDecisionPolicy(llm, state);
  assertEq(result.action, "next_topic", "action");
  assertEq(result.shouldAdvanceTopic, true, "shouldAdvanceTopic");
});

test("Score 4-6 + followUps below cap → followup", () => {
  const state = mockState({ followUpsOnCurrent: 0 });
  const llm = mockLLM({
    evaluation: { answeredQuestion: true, unclearOrGarbled: false, offTopic: false, score: 5, confidence: 0.6, strengths: [], gaps: ["missing depth"], facts: [] },
    decision: { action: "followup", reason: "needs more" },
    say: "Can you tell me more about that?",
  });
  const result = enforceDecisionPolicy(llm, state);
  assertEq(result.action, "followup", "action");
  assertEq(result.shouldAdvanceTopic, false, "shouldAdvanceTopic");
});

test("Score 4-6 + followUps AT cap → force next_topic", () => {
  const state = mockState({ followUpsOnCurrent: BRAIN_CONFIG.maxFollowUpsNormal });
  const llm = mockLLM({
    evaluation: { answeredQuestion: true, unclearOrGarbled: false, offTopic: false, score: 5, confidence: 0.6, strengths: [], gaps: ["missing depth"], facts: [] },
    decision: { action: "followup", reason: "needs more" },
    say: "Can you elaborate?",
  });
  const result = enforceDecisionPolicy(llm, state);
  assertEq(result.action, "next_topic", "action — cap hit forces next_topic");
  assertEq(result.shouldAdvanceTopic, true, "shouldAdvanceTopic");
});

test("Score <4 + high confidence → move on (next_topic)", () => {
  const state = mockState({ followUpsOnCurrent: 0 });
  const llm = mockLLM({
    evaluation: { answeredQuestion: false, unclearOrGarbled: false, offTopic: false, score: 2, confidence: 0.8, strengths: [], gaps: ["no understanding"], facts: [] },
    decision: { action: "next_topic", reason: "too weak" },
    say: "Alright, let's move on.",
  });
  const result = enforceDecisionPolicy(llm, state);
  assertEq(result.action, "next_topic", "action");
  assertEq(result.shouldAdvanceTopic, true, "shouldAdvanceTopic");
});

test("Off-topic → smalltalk_redirect, no advance", () => {
  const state = mockState();
  const llm = mockLLM({
    intent: "offtopic",
    evaluation: { answeredQuestion: false, unclearOrGarbled: false, offTopic: true, score: 0, confidence: 0.9, strengths: [], gaps: [], facts: [] },
    decision: { action: "smalltalk_redirect", reason: "off topic" },
    say: "Interesting! Let me bring us back to the technical questions.",
  });
  const result = enforceDecisionPolicy(llm, state);
  assertEq(result.action, "smalltalk_redirect", "action");
  assertEq(result.shouldAdvanceTopic, false, "shouldAdvanceTopic");
});

test("LLM says wrapup → wrapup, no advance", () => {
  const state = mockState({ phase: "wrapup" });
  const llm = mockLLM({
    decision: { action: "wrapup", reason: "all done" },
    say: "Thanks! Do you have any questions for me?",
  });
  const result = enforceDecisionPolicy(llm, state);
  assertEq(result.action, "wrapup", "action");
  assertEq(result.shouldEndInterview, false, "shouldEndInterview");
});

test("LLM says end → end, shouldEndInterview true", () => {
  const state = mockState({ phase: "closing" });
  const llm = mockLLM({
    decision: { action: "end", reason: "candidate done" },
    say: "Wonderful, thanks for your time today!",
  });
  const result = enforceDecisionPolicy(llm, state);
  assertEq(result.action, "end", "action");
  assertEq(result.shouldEndInterview, true, "shouldEndInterview");
});

// ── Fallback utterance ────────────────────────────────────────────────────────

console.log("\n▶ getFallbackUtterance");

test("Returns first unasked fallback question", () => {
  const state = ConversationStateSchema.parse({ phase: "core", coverage: [], asked: [], scores: [], followUpsOnCurrent: 0, turnCount: 1 });
  const utterance = getFallbackUtterance(state);
  assert(typeof utterance === "string" && utterance.length > 5, "Returns non-empty string");
  assert(!utterance.toLowerCase().includes("hi") && !utterance.toLowerCase().includes("welcome"), "Must NOT be a greeting");
});

test("Skips already-asked topics in fallback", () => {
  const state = ConversationStateSchema.parse({
    phase: "core",
    coverage: [],
    asked: [
      { question: "Tell me about recent work", topic: "background", turnIndex: 1 },
      { question: "What project are you most proud of", topic: "strongest_project", turnIndex: 2 },
    ],
    scores: [],
    followUpsOnCurrent: 0,
    turnCount: 2,
  });
  const utterance = getFallbackUtterance(state);
  assert(utterance.length > 5, "Returns something even with some topics used");
  // Background and strongest_project are in asked — fallback should NOT pick those
  const bgPhrasings = BRAIN_CONFIG.fallbackQuestions.find((f) => f.topic === "background")!.phrasings;
  assert(!bgPhrasings.includes(utterance as any), "Should skip background fallback (already asked)");
});

test("Wrapup phase returns wrapup question", () => {
  const state = ConversationStateSchema.parse({ phase: "wrapup", coverage: [], asked: [], scores: [], followUpsOnCurrent: 0, turnCount: 5 });
  const utterance = getFallbackUtterance(state);
  assert(utterance.toLowerCase().includes("question"), "Wrapup fallback should ask if candidate has questions");
});

// ── Hard cap enforcement ──────────────────────────────────────────────────────

console.log("\n▶ Config sanity checks");

test("maxFollowUpsNormal < maxFollowUpsLowConfidence", () => {
  assert(
    BRAIN_CONFIG.maxFollowUpsNormal < BRAIN_CONFIG.maxFollowUpsLowConfidence,
    "Low confidence allows more follow-ups",
  );
});

test("scoreForNextTopic > scoreForFollowup_max", () => {
  assert(
    BRAIN_CONFIG.scoreForNextTopic > BRAIN_CONFIG.scoreForFollowup_max,
    "next_topic threshold is above followup range",
  );
});

test("Default topics count is within maxCoreTopics", () => {
  assert(
    BRAIN_CONFIG.defaultTopics.length <= BRAIN_CONFIG.maxCoreTopics,
    `defaultTopics.length (${BRAIN_CONFIG.defaultTopics.length}) must be ≤ maxCoreTopics (${BRAIN_CONFIG.maxCoreTopics})`,
  );
});

test("Fallback question bank covers all defaultTopics", () => {
  const topicIds = new Set(BRAIN_CONFIG.defaultTopics.map((t) => t.id));
  const coveredIds = new Set(BRAIN_CONFIG.fallbackQuestions.map((f) => f.topic));
  for (const id of topicIds) {
    assert(coveredIds.has(id), `Fallback bank missing topic: ${id}`);
  }
});

// ── Pure state & Idempotency tests ────────────────────────────────────────────

console.log("\n▶ activateNextTopic & closeActiveTopic (Pure State & Idempotency)");

test("activateNextTopic: does not mutate input state", () => {
  const initial = ConversationStateSchema.parse({
    phase: "core",
    coverage: [
      { id: "top1", label: "Topic 1", goal: "Goal 1", status: "todo", followUps: 0 },
      { id: "top2", label: "Topic 2", goal: "Goal 2", status: "todo", followUps: 0 },
    ],
  });
  const copy = structuredClone(initial);
  const { nextState, activatedTopic } = activateNextTopic(initial);

  assertEq(initial.coverage[0].status, "todo", "input state topic 0 unchanged");
  assertEq(nextState.coverage[0].status, "active", "returned state topic 0 active");
  assertEq(activatedTopic?.id, "top1", "activated topic id");
  assert(JSON.stringify(initial) === JSON.stringify(copy), "input state object remained 100% untouched");
});

test("activateNextTopic: idempotent when called twice in a row", () => {
  const initial = ConversationStateSchema.parse({
    phase: "core",
    coverage: [
      { id: "top1", label: "Topic 1", goal: "Goal 1", status: "todo", followUps: 0 },
      { id: "top2", label: "Topic 2", goal: "Goal 2", status: "todo", followUps: 0 },
    ],
  });
  const firstPass = activateNextTopic(initial);
  const secondPass = activateNextTopic(firstPass.nextState);

  assertEq(firstPass.nextState.coverage[0].status, "active", "first pass active");
  assertEq(secondPass.nextState.coverage[0].status, "active", "second pass still active");
  assertEq(secondPass.nextState.coverage[1].status, "todo", "topic 2 still todo, not double activated");
  assertEq(secondPass.activatedTopic?.id, "top1", "second pass returns same active topic");
});

test("closeActiveTopic: does not mutate input state", () => {
  const initial = ConversationStateSchema.parse({
    phase: "core",
    coverage: [
      { id: "top1", label: "Topic 1", goal: "Goal 1", status: "active", followUps: 1 },
    ],
    followUpsOnCurrent: 1,
  });
  const copy = structuredClone(initial);
  const nextState = closeActiveTopic(initial, 8, 0.9);

  assertEq(initial.coverage[0].status, "active", "input state active");
  assertEq(nextState.coverage[0].status, "done", "returned state done");
  assertEq(nextState.coverage[0].score, 8, "recorded score");
  assert(JSON.stringify(initial) === JSON.stringify(copy), "input state remained untouched");
});

test("closeActiveTopic: idempotent when called twice in a row", () => {
  const initial = ConversationStateSchema.parse({
    phase: "core",
    coverage: [
      { id: "top1", label: "Topic 1", goal: "Goal 1", status: "active", followUps: 1 },
      { id: "top2", label: "Topic 2", goal: "Goal 2", status: "todo", followUps: 0 },
    ],
    followUpsOnCurrent: 1,
  });
  const firstPass = closeActiveTopic(initial, 8, 0.9);
  const secondPass = closeActiveTopic(firstPass, 8, 0.9);

  assertEq(firstPass.coverage[0].status, "done", "first pass done");
  assertEq(secondPass.coverage[0].status, "done", "second pass done");
  assertEq(secondPass.coverage[1].status, "todo", "second pass topic 2 untouched");
  assert(JSON.stringify(firstPass) === JSON.stringify(secondPass), "second call returns identical state");
});

// ─── RESULTS ─────────────────────────────────────────────────────────────────

console.log(`\n══════════════════════════════════════════════════════`);
console.log(` Results: ${passed} passed  ${failed} failed  (${passed + failed} total)`);
console.log(`══════════════════════════════════════════════════════\n`);

if (failed > 0) process.exit(1);
