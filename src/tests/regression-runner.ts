/**
 * REGRESSION TEST: Replay candidate turns against real LLM layer (Gemini/Groq)
 *
 * Usage: npx tsx --env-file=.env.local src/tests/regression-runner.ts
 */

import { db } from "../db/index";
import { interviews, transcriptChunks } from "../db/schema";
import { ConversationStateSchema, LLMTurnResponseSchema, type ConversationState, type AskedQuestion, type TurnScore } from "../schemas/brain";
import { MOCK_STRUCTURED_RESUME } from "../lib/default-interview-plan";
import { generateCoverageTopics, loadState, saveState, enforceDecisionPolicy, isTooSimilar, getFallbackUtterance, activateNextTopic, closeActiveTopic } from "../lib/interview/state";
import { buildTurnContext, INTERVIEWER_SYSTEM_PROMPT } from "../lib/interview/prompt";
import { generate, tryParseAndValidate } from "../lib/llm/index";
import { BRAIN_CONFIG } from "../lib/interview/brain-config";
import "../lib/config";

const TEST_UTTERANCES = [
  { label: "1. Warmup / Ready", text: "ok I am ready we can" },
  { label: "2. Passive / Low contribution", text: "I am not contributing" },
  { label: "3. Vague one-liner", text: "I write code and build apps for work." },
  { label: "4. Garbled reply", text: "asdfghjk qwerty" },
  { label: "5. Hindi / Hinglish reply", text: "haan main backend developer hu aur Node.js pe kaam karta hu" },
  { label: "6. Detailed strong answer", text: "In my previous role, I architected a distributed event-driven microservices system handling 50,000 requests per second. We used Kafka for streaming event queues, PostgreSQL with partitioned indexes, and Redis for sub-millisecond caching, which reduced our overall P99 latency by 45% and handled peak Black Friday traffic without a single dropped packet." },
];

async function runRegressionTest() {
  console.log("==========================================================");
  console.log(" STARTING BRAIN REGRESSION TEST (REAL LLM LAYER)");
  console.log("==========================================================\n");

  const jobRole = "Senior Full-Stack Engineer";
  const candidateProfile = MOCK_STRUCTURED_RESUME;
  const firstName = candidateProfile.fullName.split(" ")[0];

  // 1. Initial greeting
  const greeting = `Hi ${firstName}, welcome! I'm glad you could make it today. Before we begin, is there anything you'd like to check on your end — audio, video, anything like that?`;
  console.log(`[GREETING] Stored at initialize (fixed server text, 0 LLM calls):`);
  console.log(`  "${greeting}"\n`);

  // 2. Generate topics
  console.log("[INIT] Generating coverage topics...");
  const topics = await generateCoverageTopics(jobRole, candidateProfile);
  console.log(`[INIT] Generated ${topics.length} topics:`, topics.map((t) => t.id).join(", "));

  // 3. Create initial state
  let state: ConversationState = ConversationStateSchema.parse({
    phase: "intro",
    coverage: topics,
    asked: [{ question: greeting, topic: "greeting", turnIndex: 0 }],
    scores: [],
    followUpsOnCurrent: 0,
    turnCount: 0,
    firstName,
  });

  const recentTranscript: Array<{ speaker: "user" | "ai"; content: string }> = [
    { speaker: "ai", content: greeting },
  ];

  // 4. Replay turns
  for (let i = 0; i < TEST_UTTERANCES.length; i++) {
    const item = TEST_UTTERANCES[i];
    console.log(`\n──────────────────────────────────────────────────────────`);
    console.log(`TURN ${i + 1}: ${item.label}`);
    console.log(`CANDIDATE: "${item.text}"`);

    const turnStart = Date.now();
    recentTranscript.push({ speaker: "user", content: item.text });

    // Pre-check garble
    const isGarble = item.text.trim().length < 2;

    if (isGarble) {
      const say = "Could you elaborate a bit more on that?";
      recentTranscript.push({ speaker: "ai", content: say });
      console.log(`EVALUATION: { garbled: true }`);
      console.log(`DECISION: action="clarify", reason="input too short or garbled"`);
      console.log(`SAY: "${say}"`);
      console.log(`PROVIDER: internal_guard`);
      console.log(`LATENCY: 0 ms`);
      continue;
    }

    // Phase: intro -> warmup
    if (state.phase === "intro") {
      state.phase = "warmup";
      state.startedAt = Date.now();
    }

    // Activate topic if needed
    let currentState = structuredClone(state);
    const hasActive = currentState.coverage.some((t) => t.status === "active");
    if (!hasActive && currentState.phase === "core") {
      const res = activateNextTopic(currentState);
      currentState = res.nextState;
    } else if (!hasActive && currentState.turnCount >= BRAIN_CONFIG.maxWarmupTurns) {
      currentState.phase = "core";
      const res = activateNextTopic(currentState);
      currentState = res.nextState;
    }

    const contextBlock = buildTurnContext({
      jobRole,
      state: currentState,
      resume: candidateProfile,
      recentTranscript: recentTranscript.slice(-12),
      userUtterance: item.text,
      remainingTurns: BRAIN_CONFIG.maxTotalTurns - currentState.turnCount,
      remainingMinutes: 15,
    });

    let llmResponse = null;
    let provider = "fallback";
    let llmLatencyMs = 0;

    try {
      const llmStart = Date.now();
      const result = await generate({
        task: "live",
        system: INTERVIEWER_SYSTEM_PROMPT,
        prompt: contextBlock,
        jsonSchema: LLMTurnResponseSchema,
      });
      llmLatencyMs = Date.now() - llmStart;
      provider = result.provider;

      const parsed = tryParseAndValidate(result.text, LLMTurnResponseSchema);
      if (parsed.ok) {
        llmResponse = parsed.data as import("../schemas/brain").LLMTurnResponse;
      } else {
        console.warn("[RETRY/PARSE FAIL] Raw output was:", result.text);
      }
    } catch (err: any) {
      console.error("LLM execution error:", err.message);
    }

    let finalSay: string;
    let finalAction: string;
    let shouldAdvanceTopic = false;

    if (llmResponse) {
      const enforced = enforceDecisionPolicy(llmResponse, currentState);
      finalSay = enforced.say;
      finalAction = enforced.action;
      shouldAdvanceTopic = enforced.shouldAdvanceTopic;

      if (
        finalAction !== "clarify" &&
        finalAction !== "smalltalk_redirect" &&
        finalAction !== "wrapup" &&
        finalAction !== "end" &&
        isTooSimilar(finalSay, currentState.asked)
      ) {
        shouldAdvanceTopic = true;
        finalAction = "next_topic";
      }
    } else {
      finalSay = getFallbackUtterance(currentState);
      finalAction = "fallback";
    }

    // Print evaluation JSON, decision, say, provider, latency
    console.log(`EVALUATION:`, JSON.stringify(llmResponse?.evaluation ?? {}, null, 2));
    console.log(`DECISION:`, JSON.stringify(llmResponse?.decision ?? { action: finalAction }, null, 2));
    console.log(`SAY: "${finalSay}"`);
    console.log(`PROVIDER: ${provider}`);
    console.log(`LATENCY: ${llmLatencyMs} ms`);

    recentTranscript.push({ speaker: "ai", content: finalSay });

    // Update state
    let stateAfterTopic = structuredClone(currentState);
    const activeTopic = stateAfterTopic.coverage.find((t) => t.status === "active");

    if (finalSay && finalAction !== "clarify" && finalAction !== "smalltalk_redirect") {
      stateAfterTopic.asked.push({
        question: finalSay,
        topic: activeTopic?.id ?? stateAfterTopic.phase,
        turnIndex: stateAfterTopic.turnCount,
      });
    }

    if (shouldAdvanceTopic && activeTopic) {
      const stateClosed = closeActiveTopic(
        stateAfterTopic,
        llmResponse?.evaluation.score ?? 5,
        llmResponse?.evaluation.confidence ?? 0.5,
      );
      const res = activateNextTopic(stateClosed);
      stateAfterTopic = res.nextState;
      if (!res.activatedTopic) {
        stateAfterTopic.phase = "wrapup";
      }
    }

    if (stateAfterTopic.phase === "warmup" && stateAfterTopic.turnCount + 1 >= BRAIN_CONFIG.maxWarmupTurns) {
      stateAfterTopic.phase = "core";
      if (!stateAfterTopic.coverage.some((t) => t.status === "active")) {
        const res = activateNextTopic(stateAfterTopic);
        stateAfterTopic = res.nextState;
      }
    }

    stateAfterTopic.turnCount++;
    state = stateAfterTopic;
  }

  console.log("\n==========================================================");
  console.log(" REGRESSION TEST COMPLETED SUCCESSFULLY");
  console.log("==========================================================\n");
  process.exit(0);
}

runRegressionTest().catch((e) => {
  console.error("Regression test error:", e);
  process.exit(1);
});
