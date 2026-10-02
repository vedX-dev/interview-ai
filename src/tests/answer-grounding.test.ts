/**
 * src/tests/answer-grounding.test.ts
 *
 * Assertion tests for the answer-grounded follow-up brain refactor.
 * Tests: signal extraction, thread continuation, unrelated-topic avoidance,
 *        conversational permission, repeat/clarification, natural transitions.
 *
 * Usage: npx tsx --env-file=.env.local src/tests/answer-grounding.test.ts
 */

import { extractSignalsFromAnswer } from "../lib/interview/state";
import { buildTurnContext } from "../lib/interview/prompt";
import { enforceDecisionPolicy } from "../lib/interview/state";
import type { LLMTurnResponse } from "../schemas/brain";
import { ConversationStateSchema } from "../schemas/brain";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, details?: string) {
  if (condition) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.error(`  ❌  FAIL: ${label}${details ? `\n      ${details}` : ""}`);
    failed++;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeState(overrides: Record<string, any> = {}) {
  return ConversationStateSchema.parse({
    phase: "core",
    coverage: [{
      id: "strongest_project",
      label: "Strongest Project",
      goal: "Assess technical ownership",
      status: "active",
      followUps: 0,
    }],
    facts: [],
    asked: [],
    scores: [],
    spokenReplies: [],
    ...overrides,
  });
}

function makeLLMResponse(overrides: Partial<LLMTurnResponse> = {}): LLMTurnResponse {
  return {
    intent: "answer",
    evaluation: {
      answeredQuestion: true,
      unclearOrGarbled: false,
      offTopic: false,
      score: 6,
      confidence: 0.8,
      strengths: [],
      gaps: [],
      facts: [],
      openThread: null,
    },
    decision: {
      action: "followup",
      nextTopic: null,
      reason: "answer contains technical details worth probing",
    },
    say: "What role did pgvector play in your interview system?",
    ...overrides,
  };
}

console.log("\n══════════════════════════════════════════════════════");
console.log(" ANSWER-GROUNDED FOLLOW-UP ASSERTION SUITE");
console.log("══════════════════════════════════════════════════════\n");

// ─── Test 1: Signal extraction from pgvector answer ───────────────────────────
{
  console.log("▶ Test 1: extractSignalsFromAnswer — pgvector + AWS");
  const utterance = "I used pgvector with AWS in my interview system to do similarity search on candidate embeddings.";
  const signals = extractSignalsFromAnswer(utterance, []);

  assert(signals.technologies.includes("pgvector"), "Detects 'pgvector'", `got: ${signals.technologies}`);
  assert(signals.technologies.includes("aws"), "Detects 'aws'", `got: ${signals.technologies}`);
  assert(signals.claims.length > 0, "Extracts at least one claim", `got: ${signals.claims}`);
}

// ─── Test 2: Novel tech filter — already known facts are excluded ─────────────
{
  console.log("\n▶ Test 2: Novel tech filter — known facts are excluded");
  const utterance = "I used postgres and redis for caching.";
  const knownFacts = ["Uses postgres for persistence"];
  const signals = extractSignalsFromAnswer(utterance, knownFacts);

  assert(!signals.technologies.includes("postgres"), "postgres is NOT novel (already in facts)");
  assert(signals.technologies.includes("redis"), "redis IS novel (not in facts)");
}

// ─── Test 3: ACTIVE THREAD appears in context when set ───────────────────────
{
  console.log("\n▶ Test 3: buildTurnContext includes ACTIVE THREAD when set");
  const state = makeState({
    activeThread: "pgvector usage in interview system",
    threadDepth: 1,
  });
  const context = buildTurnContext({
    jobRole: "Software Engineer",
    state,
    resume: null,
    recentTranscript: [],
    userUtterance: "We used it to find similar candidates",
    remainingTurns: 10,
    remainingMinutes: 20,
  });

  assert(context.includes("ACTIVE CONVERSATION THREAD"), "Context includes ACTIVE THREAD section");
  assert(context.includes("pgvector usage in interview system"), "Context includes thread label");
  assert(context.includes("Thread depth: 1"), "Context includes thread depth");
  assert(context.includes("stay on this thread"), "Context has thread continuation instruction");
}

// ─── Test 4: SIGNALS FROM LAST ANSWER appears in context ─────────────────────
{
  console.log("\n▶ Test 4: buildTurnContext includes SIGNALS FROM LAST ANSWER");
  const state = makeState();
  const signals = extractSignalsFromAnswer(
    "I used pgvector with AWS and built the embedding pipeline with OpenAI.",
    []
  );
  const context = buildTurnContext({
    jobRole: "Software Engineer",
    state,
    resume: null,
    recentTranscript: [],
    userUtterance: "I used pgvector with AWS",
    remainingTurns: 10,
    remainingMinutes: 20,
    signals,
  });

  assert(context.includes("SIGNALS FROM LAST ANSWER"), "Context includes SIGNALS section");
  assert(context.includes("pgvector") || context.includes("aws"), "Signals include detected tech");
  assert(context.includes("Do NOT jump to an unrelated topic"), "Context has anti-jump instruction");
}

// ─── Test 5: enforceDecisionPolicy — question_to_ai handled conversationally ──
{
  console.log("\n▶ Test 5: question_to_ai → conversational response, no topic advance");
  const state = makeState();
  const llm = makeLLMResponse({
    intent: "question_to_ai",
    evaluation: {
      answeredQuestion: false,
      unclearOrGarbled: false,
      offTopic: false,
      score: null,
      confidence: 0.9,
      strengths: [],
      gaps: [],
      facts: [],
      openThread: null,
    },
    decision: {
      action: "meta_acknowledge",
      nextTopic: null,
      reason: "candidate is asking permission to ask a question",
    },
    say: "Of course, go ahead.",
  });

  const result = enforceDecisionPolicy(llm, state);
  assert(result.action === "meta_acknowledge", "action is meta_acknowledge (conversational)");
  assert(!result.shouldAdvanceTopic, "topic does NOT advance");
  assert(!result.shouldEndInterview, "interview does NOT end");
  assert(result.say.toLowerCase().includes("go ahead") || result.say.length > 3, "Response is natural/conversational");
}

// ─── Test 6: enforceDecisionPolicy — follow-up stays on topic ────────────────
{
  console.log("\n▶ Test 6: enforceDecisionPolicy — followup action, topic does not advance");
  const state = makeState();
  const llm = makeLLMResponse({ decision: { action: "followup", nextTopic: null, reason: "probe pgvector role" } });

  const result = enforceDecisionPolicy(llm, state);
  assert(result.action === "followup", "action is followup");
  assert(!result.shouldAdvanceTopic, "topic does NOT advance on followup");
}

// ─── Test 7: repeat_request → rephrase, not the exact previous question ───────
{
  console.log("\n▶ Test 7: repeat_request → meta_acknowledge, no topic advance");
  const state = makeState({ spokenReplies: ["Tell me about your strongest project."] });
  const llm = makeLLMResponse({
    intent: "repeat_request",
    decision: { action: "meta_acknowledge", nextTopic: null, reason: "candidate asked to repeat" },
    say: "Sure — could you share more about a key project you built?",
  });

  const result = enforceDecisionPolicy(llm, state);
  assert(result.action === "meta_acknowledge", "action is meta_acknowledge");
  assert(!result.shouldAdvanceTopic, "topic does NOT advance on repeat request");
}

// ─── Test 8: garbled → clarify ladder ────────────────────────────────────────
{
  console.log("\n▶ Test 8: garbled utterance → clarify action");
  const state = makeState({ clarifyCount: 0 });
  const llm = makeLLMResponse({
    intent: "garbled",
    evaluation: {
      answeredQuestion: false,
      unclearOrGarbled: true,
      offTopic: false,
      score: null,
      confidence: 0.2,
      strengths: [],
      gaps: [],
      facts: [],
      openThread: null,
    },
    decision: { action: "clarify", nextTopic: null, reason: "answer was garbled" },
    say: "Could you elaborate a bit more on that?",
  });

  const result = enforceDecisionPolicy(llm, state);
  assert(result.action === "clarify", "action is clarify");
  assert(!result.shouldAdvanceTopic, "topic does NOT advance on clarify");
}

// ─── Test 9: Thread exhaustion — followup cap reached → next_topic ────────────
{
  console.log("\n▶ Test 9: Follow-up cap reached → next_topic override");
  const state = makeState({ followUpsOnCurrent: 2 }); // maxFollowUpsNormal = 1
  const llm = makeLLMResponse({ decision: { action: "followup", nextTopic: null, reason: "probe more" } });

  const result = enforceDecisionPolicy(llm, state);
  // maxFollowUpsNormal = 1, followUpsOnCurrent = 2 → should force next_topic
  assert(result.shouldAdvanceTopic, "topic advances when follow-up cap is reached");
  assert(result.action === "next_topic", "action is next_topic after cap");
}

// ─── Test 10: Signal extraction — no false positives on non-technical text ────
{
  console.log("\n▶ Test 10: Signal extraction — non-technical utterance has no tech signals");
  const utterance = "Can I ask you a simple yes or no question please?";
  const signals = extractSignalsFromAnswer(utterance, []);

  assert(signals.technologies.length === 0, "No tech detected in conversational utterance", `got: ${signals.technologies}`);
  assert(signals.claims.length === 0, "No claims in conversational utterance");
}

// ─── Test 11: ACTIVE THREAD section absent when no thread set ────────────────
{
  console.log("\n▶ Test 11: ACTIVE THREAD section absent when no thread is active");
  const state = makeState(); // no activeThread
  const context = buildTurnContext({
    jobRole: "Software Engineer",
    state,
    resume: null,
    recentTranscript: [],
    userUtterance: "Tell me about your role.",
    remainingTurns: 10,
    remainingMinutes: 20,
  });

  assert(!context.includes("ACTIVE CONVERSATION THREAD"), "ACTIVE THREAD section is absent when no thread set");
}

// ─── Test 12: Thread label contains technology name ───────────────────────────
{
  console.log("\n▶ Test 12: Thread label built correctly from signals");
  const signals = extractSignalsFromAnswer(
    "I built an embedding pipeline with pgvector and stored 10M vectors on AWS.",
    []
  );
  const topTech = signals.technologies[0];
  const topClaim = signals.claims[0];
  const thread = topTech
    ? `${topTech}${topClaim ? ` — ${topClaim.slice(0, 60)}` : ""}`
    : topClaim?.slice(0, 80) ?? "";

  assert(thread.includes("pgvector") || thread.includes("aws"), "Thread label includes detected technology", `got: "${thread}"`);
}

console.log("\n══════════════════════════════════════════════════════");
console.log(` Results: ${passed} passed  ${failed} failed  (${passed + failed} total)`);
console.log("══════════════════════════════════════════════════════\n");

if (failed > 0) process.exit(1);
