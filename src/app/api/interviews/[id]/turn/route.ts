/**
 * POST /api/interviews/[id]/turn
 *
 * STEP 3: One structured LLM call per turn (evaluate + decide + speak).
 *
 * Flow:
 *  1. Auth + ownership check
 *  2. Load ConversationState from DB (interviews.plan) — client phase is IGNORED
 *  3. Apply code-level pre-checks (garble, length, caps)
 *  4. Build per-turn context + call LLM (Gemini → Groq, sequential, Zod-validated)
 *  5. Enforce decision policy in code (thresholds from brain-config)
 *  6. Duplicate-question guard (similarity check before returning say)
 *  7. Mutate state, persist to DB via after()
 *  8. Return TurnResponse
 */

import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/src/db/index";
import { interviews, transcriptChunks } from "@/src/db/schema";
import {
  TurnRequestSchema,
  LLMTurnResponseSchema,
  type ConversationState,
  type AskedQuestion,
  type TurnScore,
} from "@/src/schemas/brain";
import { ExtractedResumeSchema } from "@/src/schemas/resume";
import { generate, tryParseAndValidate } from "@/src/lib/llm/index";
import {
  loadState,
  saveState,
  isTooSimilar,
  isPhraseRepeated,
  enforceDecisionPolicy,
  activateNextTopic,
  closeActiveTopic,
  getFallbackUtterance,
  getSeedFallbackUtterance,
  generateCoverageTopics,
  extractSignalsFromAnswer,
  updateKScore,
  computeTargetDepth,
  computeAvgAnswerLength,
  getOpeningTemplate,
} from "@/src/lib/interview/state";
import { INTERVIEWER_SYSTEM_PROMPT, buildTurnContext } from "@/src/lib/interview/prompt";
import { BRAIN_CONFIG } from "@/src/lib/interview/brain-config";
import { checkTurnLimit, isReplayedRequest } from "@/src/lib/rate-limit";
import { getKBEntry } from "@/src/lib/interview/knowledge-base/index";

const IS_DEV = process.env.NODE_ENV !== "production";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const routeStart = Date.now();

  try {
    // ── 1. Auth ──────────────────────────────────────────────────────────────
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized", code: "AUTH_REQUIRED" }, { status: 401 });
    }

    const rl = checkTurnLimit(userId);
    if (!rl.allowed) {
      // Friendly 429 — never show "5 interviews per hour" during an interview
      return NextResponse.json(
        { error: "One moment — please try again shortly.", code: "RATE_LIMITED", retryAfterSec: rl.retryAfterSec ?? 5 },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 5) } },
      );
    }

    const { id: interviewId } = await params;
    const body = TurnRequestSchema.parse(await req.json());

    // ── 2. Load interview + server state ─────────────────────────────────────
    const [interview] = await db
      .select({
        id: interviews.id,
        userId: interviews.userId,
        jobRole: interviews.jobRole,
        status: interviews.status,
        feedback: interviews.feedback,
        plan: interviews.plan,
        totalTurns: interviews.totalTurns,
        createdAt: interviews.createdAt,
      })
      .from(interviews)
      .where(and(eq(interviews.id, interviewId), eq(interviews.userId, userId)))
      .limit(1);

    if (!interview) {
      return NextResponse.json({ error: "Interview not found", code: "NOT_FOUND" }, { status: 404 });
    }

    if (interview.status === "completed" || interview.status === "failed") {
      return NextResponse.json({ error: "Interview already ended", code: "ALREADY_ENDED" }, { status: 409 });
    }

    // Parse state (server-owned — never trust client phase)
    let state: ConversationState = loadState(interview.plan);

    // ── Idempotency Check ──────────────────────────────────────────────────
    // requestId uses interviewId + turnCount + short hash of content (no raw utterance text in logs)
    const utteranceHash = body.userUtterance.split('').reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0).toString(36).slice(-6);
    const requestId = body.clientRequestId || `${interviewId}_t${state.turnCount}_${utteranceHash}`;

    // If this is a pure replay, return cached and don't count against any limit
    if (isReplayedRequest(requestId) && state.lastRequestId === requestId && state.lastResponse) {
      console.log(`[TURN] Idempotent replay '${requestId}' — returning cached reply`);
      return NextResponse.json(state.lastResponse);
    }

    // Extract resume from feedback.candidateProfile (set during initialize)
    let resume = null;
    try {
      const feedbackObj = interview.feedback as Record<string, unknown> | null;
      if (feedbackObj?.candidateProfile) {
        const parsed = ExtractedResumeSchema.safeParse(feedbackObj.candidateProfile);
        if (parsed.success) resume = parsed.data;
      }
    } catch { }

    // ── 3. First-turn bootstrap ───────────────────────────────────────────────
    // If coverage is empty, generate topics now (once per interview)
    if (state.coverage.length === 0) {
      const seed = state.conversationSeed ?? 0;
      state.coverage = await generateCoverageTopics(interview.jobRole, resume, seed);
      console.log(`[TURN] Generated ${state.coverage.length} coverage topics (seed=${seed}) for ${interviewId}`);
    }

    // Phase: intro → warmup on first candidate utterance (unconditional)
    if (state.phase === "intro") {
      state.phase = "warmup";
      state.startedAt = Date.now();
      if (resume) {
        state.firstName = resume.fullName.split(" ")[0];
      }
    }

    // ── 4. Hard caps ─────────────────────────────────────────────────────────
    const elapsedMs = state.startedAt ? Date.now() - state.startedAt : 0;
    const remainingTurns = BRAIN_CONFIG.maxTotalTurns - state.turnCount;
    const remainingMs = BRAIN_CONFIG.timeBudgetMs - elapsedMs;
    const remainingMinutes = Math.max(0, Math.round(remainingMs / 60000));

    if (remainingTurns <= 0 || remainingMs <= 0) {
      // Hard kill: force wrapup
      const say = "We're coming up on time — do you have any questions for me before we close?";
      const nextState: ConversationState = { ...state, phase: "wrapup", turnCount: state.turnCount + 1 };
      after(() => saveState(interviewId, nextState, { currentPhase: "wrapup" }));
      return NextResponse.json({ say, phase: "wrapup", isComplete: false });
    }

    // ── 5. Pre-check: garble / empty string ───────────────────────────────────
    const utterance = body.userUtterance.trim();
    if (utterance.length < 2) {
      const say = state.clarifyCount >= 2
        ? BRAIN_CONFIG.clarifyLadder[2]
        : BRAIN_CONFIG.clarifyLadder[state.clarifyCount % BRAIN_CONFIG.clarifyLadder.length];
      const nextState = { ...state, clarifyCount: (state.clarifyCount || 0) + 1 };
      after(() => saveState(interviewId, nextState));
      return NextResponse.json({ say, phase: state.phase, isComplete: false });
    }

    let currentState = structuredClone(state);

    // ── 6. Activate first topic if nothing is active yet ─────────────────────
    const hasActiveTopic = currentState.coverage.some((t) => t.status === "active");
    if (!hasActiveTopic && currentState.phase === "warmup") {
      // warmup: no topic active yet — let LLM phrase the warmup question
    } else if (!hasActiveTopic && currentState.phase === "core") {
      const res = activateNextTopic(currentState);
      currentState = res.nextState;
    } else if (!hasActiveTopic && currentState.phase !== "wrapup" && currentState.phase !== "closing") {
      // warmup complete → enter core
      if (currentState.turnCount >= BRAIN_CONFIG.maxWarmupTurns) {
        currentState.phase = "core";
        const res = activateNextTopic(currentState);
        currentState = res.nextState;
      }
    }

    // ── 7. Extract answer signals for grounded follow-up ─────────────────────
    const signals = extractSignalsFromAnswer(utterance, currentState.facts ?? []);
    if (signals.technologies.length || signals.claims.length) {
      console.log(`[TURN] Signals: tech=[${signals.technologies.join(",")}] claims=${signals.claims.length} threads=${signals.openThreads.length}`);
    }

    // ── 8. LLM call (evaluate + decide + speak) ───────────────────────────────
    // Compute adaptive depth BEFORE the LLM call so it's injected into context
    const activeTopic = currentState.coverage.find((t) => t.status === "active");
    const recentScores = currentState.scores.map((s) => s.score);
    const turnsOnTopic = activeTopic?.followUps ?? 0;
    const targetDepth = computeTargetDepth(
      currentState.kScore ?? 5,
      currentState.kScoreTrend ?? "flat",
      turnsOnTopic,
    );
    const avgAnswerWords = computeAvgAnswerLength(body.recentTranscript);

    // Get KB entry for the active topic to pass depth ladder guidance
    const kbEntry = activeTopic ? getKBEntry(activeTopic.id) : undefined;
    const depthGuidance = kbEntry ? kbEntry.depthLadder[targetDepth] : undefined;

    // Get opening template for warmup first turn
    const isFirstWarmupTurn = currentState.phase === "warmup" && currentState.turnCount === 0;
    const openingTemplate = isFirstWarmupTurn
      ? getOpeningTemplate(currentState.conversationSeed ?? 0)
      : undefined;

    const contextBlock = buildTurnContext({
      jobRole: interview.jobRole,
      state: currentState,
      resume,
      recentTranscript: body.recentTranscript,
      userUtterance: utterance,
      remainingTurns,
      remainingMinutes,
      candidateLang: body.lang || currentState.candidateLang || "en-IN",
      sttConfidence: body.sttConfidence || 0.95,
      signals,
      targetDepth,
      depthGuidance,
      avgAnswerWords,
      openingTemplate,
    });

    let llmResponse = null;
    let provider = "fallback";
    let llmLatencyMs = 0;
    let attemptsList: any[] = [];

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
      attemptsList = result.attempts || [];

      const parsed = tryParseAndValidate(result.text, LLMTurnResponseSchema);
      if (parsed.ok) {
        llmResponse = parsed.data as import("@/src/schemas/brain").LLMTurnResponse;
      } else {
        console.warn("[TURN] LLM response schema invalid:", parsed.error, "Raw:", result.text.slice(0, 200));
      }
    } catch (llmErr: any) {
      console.error("[TURN] All LLM providers failed:", llmErr?.message);
    }

    // ── 8. Enforce decision policy ────────────────────────────────────────────
    let finalSay: string;
    let finalAction: string;
    let finalIntent = llmResponse?.intent ?? "garbled";
    let shouldAdvanceTopic = false;
    let shouldEndInterview = false;
    let evalSnapshot = llmResponse?.evaluation;
    let decisionSnapshot = llmResponse?.decision;

    if (llmResponse) {
      const enforced = enforceDecisionPolicy(llmResponse, currentState);
      finalSay = enforced.say;
      finalAction = enforced.action;
      shouldAdvanceTopic = enforced.shouldAdvanceTopic;
      shouldEndInterview = enforced.shouldEndInterview;
      if (enforced.updatedState) currentState = enforced.updatedState;

      // ── 9. Duplicate question & Phrase repeat guard ──────────────────────
      const isTooSimilarQuestion = (
        finalAction !== "clarify" &&
        finalAction !== "smalltalk_redirect" &&
        finalAction !== "nudge" &&
        finalAction !== "wrapup" &&
        finalAction !== "end" &&
        isTooSimilar(finalSay, currentState.asked)
      );

      const isPhraseRep = isPhraseRepeated(finalSay, currentState.spokenReplies);

      if (isTooSimilarQuestion || isPhraseRep) {
        console.warn("[TURN] Repeat guard triggered (similar question or phrase match), forcing alternative fallback phrasing");
        finalSay = getFallbackUtterance(currentState);
        if (isTooSimilarQuestion) {
          shouldAdvanceTopic = true;
          finalAction = "next_topic";
        }
      }
    } else {
      // All providers failed — use deterministic fallback (never greeting, never repeat)
      // Use seed-based fallback for variety across interviews
      finalSay = getSeedFallbackUtterance(currentState);
      finalAction = "fallback";
      console.warn("[TURN] Using deterministic fallback utterance");
    }

    // ── 10. State updates ─────────────────────────────────────────────────────
    const newState: ConversationState = structuredClone(currentState);

    // Record spoken reply in last-8 history
    newState.spokenReplies = [...(newState.spokenReplies || []), finalSay].slice(-BRAIN_CONFIG.historyRepeatWindow);

    // Update facts memory
    if (llmResponse?.evaluation?.facts?.length) {
      newState.facts = Array.from(new Set([...newState.facts, ...llmResponse.evaluation.facts]));
    }

    // Record asked question (for repeat guard)
    const currentActiveTopic = newState.coverage.find((t) => t.status === "active");
    if (
      finalSay &&
      finalAction !== "clarify" &&
      finalAction !== "smalltalk_redirect" &&
      finalAction !== "nudge"
    ) {
      const askedEntry: AskedQuestion = {
        question: finalSay,
        topic: currentActiveTopic?.id ?? newState.phase,
        turnIndex: newState.turnCount,
      };
      newState.asked = [...newState.asked, askedEntry];
    }

    // Record score ONLY for intent "answer" or "partial" (never for meta, smalltalk, clarify, etc.)
    const isScorableIntent = finalIntent === "answer" || finalIntent === "partial";
    const hasScoreValue = llmResponse?.evaluation?.score !== null && llmResponse?.evaluation?.score !== undefined;

    if (isScorableIntent && hasScoreValue && activeTopic && finalAction !== "clarify" && finalAction !== "nudge") {
      const score: TurnScore = {
        turnIndex: newState.turnCount,
        topic: activeTopic.id,
        score: llmResponse!.evaluation.score!,
        confidence: llmResponse!.evaluation.confidence,
        strengths: llmResponse!.evaluation.strengths || [],
        gaps: llmResponse!.evaluation.gaps || [],
      };
      newState.scores = [...newState.scores, score];

      // ── Phase 2: Update K-Score ────────────────────────────────────────────
      const prevScoreValues = newState.scores.slice(0, -1).map((s) => s.score);
      const { kScore, kScoreTrend } = updateKScore(
        newState.kScore ?? 5,
        score.score,
        prevScoreValues,
      );
      newState.kScore = kScore;
      newState.kScoreTrend = kScoreTrend;
      newState.targetDepth = computeTargetDepth(kScore, kScoreTrend, turnsOnTopic);

      console.log(
        `[TURN] kScore=${kScore.toFixed(2)} trend=${kScoreTrend} targetDepth=${newState.targetDepth} ` +
        `turnScore=${score.score} topic=${activeTopic.id}`,
      );
    }

    // Update follow-up counter
    if (finalAction === "followup") {
      newState.followUpsOnCurrent = newState.followUpsOnCurrent + 1;
      if (activeTopic) {
        const idx = newState.coverage.findIndex((t) => t.id === activeTopic.id);
        if (idx !== -1) newState.coverage[idx].followUps++;
      }
    }

    // ── Thread tracking (answer-grounded follow-up) ───────────────────────────
    // When following up on an answer, update the active thread from signals.
    // When advancing topic, clear the thread so the new topic starts fresh.
    const isAnswerIntent = finalIntent === "answer" || finalIntent === "partial";
    if (finalAction === "followup" && isAnswerIntent) {
      // Build a thread label from the strongest signal
      const topTech = signals.technologies[0];
      const topClaim = signals.claims[0];
      const newThread = topTech
        ? `${topTech}${topClaim ? ` — ${topClaim.slice(0, 60)}` : ""}`
        : topClaim
          ? topClaim.slice(0, 80)
          : newState.activeThread; // keep existing thread if no new signals
      if (newThread) {
        newState.activeThread = newThread;
        newState.threadDepth = (newState.threadDepth ?? 0) + 1;
      }
    } else if (finalAction === "next_topic" || shouldAdvanceTopic) {
      // Moving to a new topic — reset thread
      newState.activeThread = undefined;
      newState.threadDepth = 0;
    }

    // Advance topic (pure function)
    let stateAfterTopic = newState;
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

    // Phase transitions: warmup → core when warmup turns exhausted
    if (stateAfterTopic.phase === "warmup" && stateAfterTopic.turnCount + 1 >= BRAIN_CONFIG.maxWarmupTurns) {
      stateAfterTopic.phase = "core";
      if (!stateAfterTopic.coverage.some((t) => t.status === "active")) {
        const res = activateNextTopic(stateAfterTopic);
        stateAfterTopic = res.nextState;
      }
    }

    if (finalAction === "wrapup") stateAfterTopic.phase = "wrapup";
    if (finalAction === "end") stateAfterTopic.phase = "closing";

    stateAfterTopic.turnCount = stateAfterTopic.turnCount + 1;

    const isComplete = finalAction === "end" || shouldEndInterview;
    const currentPhaseMapped = mapPhaseToEnum(stateAfterTopic.phase);

    const totalLatencyMs = Date.now() - routeStart;
    console.log(
      `[TURN] interview=${interviewId} phase=${stateAfterTopic.phase} intent=${finalIntent} action=${finalAction} ` +
      `provider=${provider} llm_ms=${llmLatencyMs} total_ms=${totalLatencyMs}`,
    );

    const responsePayload = {
      say: finalSay,
      phase: stateAfterTopic.phase,
      isComplete,
      ...(IS_DEV
        ? {
          _dev: {
            intent: finalIntent,
            evaluation: evalSnapshot,
            decision: decisionSnapshot,
            provider,
            latencyMs: totalLatencyMs,
            action: finalAction,
            attempts: attemptsList,
          },
        }
        : {}),
    };

    // Store idempotency key & response payload in state
    stateAfterTopic.lastRequestId = requestId;
    stateAfterTopic.lastResponse = responsePayload;

    // ── 11. Persist state (non-blocking) ─────────────────────────────────────
    after(async () => {
      try {
        await saveState(interviewId, stateAfterTopic, {
          currentPhase: currentPhaseMapped,
          ...(isComplete ? { status: "completed" } : {}),
        });

        // Update DB counters
        await db
          .update(interviews)
          .set({
            totalTurns: (interview.totalTurns ?? 0) + 1,
          })
          .where(eq(interviews.id, interviewId));
      } catch (dbErr) {
        console.error("[TURN] after() DB save failed:", dbErr);
      }
    });

    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error("[TURN] Unexpected error:", error);

    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid turn payload", code: "VALIDATION_ERROR", details: error.flatten() },
        { status: 422 },
      );
    }

    return NextResponse.json(
      { error: "Turn processing error", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Map new 5-phase enum to the existing DB phaseEnum (4-phase + closed) */
function mapPhaseToEnum(phase: ConversationState["phase"]): string {
  const map: Record<ConversationState["phase"], string> = {
    intro: "greeting",
    warmup: "rapport",
    core: "technical",
    wrapup: "wrapup",
    closing: "closed",
  };
  return map[phase] ?? "rapport";
}
