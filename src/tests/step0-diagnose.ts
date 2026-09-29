/**
 * STEP 0: Diagnostic script for failing conversation replay
 * Utterances:
 * 1. "no thank you we can start with the interview"
 * 2. "I am interested because please do not repeat the question"
 * 3. "please do not repeat the question"
 * 4. "why are you repeating"
 * 5. "play Hindi movie"
 *
 * Usage: npx tsx --env-file=.env.local src/tests/step0-diagnose.ts
 */

import { ConversationStateSchema, LLMTurnResponseSchema, type ConversationState } from "../schemas/brain";
import { MOCK_STRUCTURED_RESUME } from "../lib/default-interview-plan";
import { generateCoverageTopics, enforceDecisionPolicy, isTooSimilar, getFallbackUtterance, activateNextTopic, closeActiveTopic } from "../lib/interview/state";
import { buildTurnContext, INTERVIEWER_SYSTEM_PROMPT } from "../lib/interview/prompt";
import { generate, tryParseAndValidate } from "../lib/llm/index";
import { BRAIN_CONFIG } from "../lib/interview/brain-config";
import "../lib/config";

const REPLAY_TURNS = [
  "no thank you we can start with the interview",
  "I am interested because please do not repeat the question",
  "please do not repeat the question",
  "why are you repeating",
  "play Hindi movie",
];

async function runDiagnosis() {
  console.log("==========================================================");
  console.log(" STEP 0: DIAGNOSE THE FAILING CONVERSATION");
  console.log("==========================================================\n");

  const jobRole = "Senior Full-Stack Engineer";
  const candidateProfile = MOCK_STRUCTURED_RESUME;
  const firstName = candidateProfile.fullName.split(" ")[0];

  const greeting = `Hi ${firstName}, welcome! I'm glad you could make it today. Before we begin, is there anything you'd like to check on your end — audio, video, anything like that?`;

  const topics = await generateCoverageTopics(jobRole, candidateProfile);

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

  for (let i = 0; i < REPLAY_TURNS.length; i++) {
    const text = REPLAY_TURNS[i];
    console.log(`\n==========================================================`);
    console.log(`TURN ${i + 1}: CANDIDATE SAID: "${text}"`);
    recentTranscript.push({ speaker: "user", content: text });

    // Pre-check garble: only trigger if candidate input is completely empty or < 3 chars
    const isGarble = text.trim().length < 3;

    if (isGarble) {
      console.log(`[PRE-CHECK] Triggered pre-check garble guard (isTooShort=${isGarble})`);
      const say = "Sorry, I didn't quite catch that — could you say it again?";
      recentTranscript.push({ speaker: "ai", content: say });
      console.log(`BRANCH: Pre-check garble guard`);
      console.log(`PROVIDER: internal_precheck`);
      console.log(`SAY: "${say}"`);
      continue;
    }

    if (state.phase === "intro") {
      state.phase = "warmup";
      state.startedAt = Date.now();
    }

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
      userUtterance: text,
      remainingTurns: BRAIN_CONFIG.maxTotalTurns - currentState.turnCount,
      remainingMinutes: 15,
    });

    console.log(`\n--- EXACT PROMPT SENT ---`);
    console.log(contextBlock);
    console.log(`-------------------------\n`);

    let llmResponse = null;
    let provider = "fallback";
    let rawText = "";

    try {
      const result = await generate({
        task: "live",
        system: INTERVIEWER_SYSTEM_PROMPT,
        prompt: contextBlock,
        jsonSchema: LLMTurnResponseSchema,
      });
      provider = result.provider;
      rawText = result.text;

      const parsed = tryParseAndValidate(result.text, LLMTurnResponseSchema);
      if (parsed.ok) {
        llmResponse = parsed.data as import("../schemas/brain").LLMTurnResponse;
      } else {
        console.log(`[PARSE ERROR]:`, parsed.error);
      }
    } catch (err: any) {
      console.error("[LLM ERROR]:", err.message);
    }

    console.log(`RAW MODEL OUTPUT:\n${rawText}\n`);
    console.log(`PARSED EVALUATION:`, JSON.stringify(llmResponse?.evaluation ?? null, null, 2));
    console.log(`PARSED DECISION:`, JSON.stringify(llmResponse?.decision ?? null, null, 2));

    let finalSay: string;
    let finalAction: string;
    let branch: string;
    let shouldAdvanceTopic = false;

    if (llmResponse) {
      const enforced = enforceDecisionPolicy(llmResponse, currentState);
      finalSay = enforced.say;
      finalAction = enforced.action;
      shouldAdvanceTopic = enforced.shouldAdvanceTopic;

      if (enforced.action === "clarify") {
        branch = "Policy override: garbled / clarify";
      } else if (enforced.action === "smalltalk_redirect") {
        branch = "Policy override: smalltalk / off-topic";
      } else {
        branch = "LLM decision (enforced policy)";
      }

      if (
        finalAction !== "clarify" &&
        finalAction !== "smalltalk_redirect" &&
        finalAction !== "wrapup" &&
        finalAction !== "end" &&
        isTooSimilar(finalSay, currentState.asked)
      ) {
        shouldAdvanceTopic = true;
        finalAction = "next_topic";
        branch = "Policy override: duplicate question guard forced next_topic";
      }
    } else {
      finalSay = getFallbackUtterance(currentState);
      finalAction = "fallback";
      branch = "All providers failed / JSON parse failed fallback";
    }

    console.log(`CODE BRANCH: ${branch}`);
    console.log(`PROVIDER: ${provider}`);
    console.log(`FINAL SAY: "${finalSay}"`);

    recentTranscript.push({ speaker: "ai", content: finalSay });

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
  console.log(" DIAGNOSIS RUN COMPLETE");
  console.log("==========================================================\n");
}

runDiagnosis().catch((e) => {
  console.error("Diagnosis error:", e);
  process.exit(1);
});
