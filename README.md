# INTERVIEWER AI — Under Build

> **MAIN GOAL:** Build a low-latency, highly realistic technical interview experience that feels as close as possible to a real human-to-human interview conversation.

The core InterviewAI platform is functional across authentication, dashboard, lobby, live voice interview, transcript storage, AI orchestration, interview termination, feedback evaluation, and real-time D-ID avatar integration.

> **Development Principle:** No new technology stack is required for the current development. The core InterviewAI architecture and integrations are already established. Continue using the existing stack and patterns. Current work focuses on completing the system, reducing latency, improving conversational realism, refining UX, strengthening reliability, and preparing the application for production — not replacing or introducing a new architecture unless a clearly documented requirement makes it necessary.

---

## Commands in Use

| Command | Action | Use as per requirement |
|---|---|---|
| `impeccable shape [feature]` | Plan a new UX/UI feature or flow before writing code | When planning a new UX/UI feature |
| `impeccable document` | Generate `DESIGN.md` from the current codebase | When a design document needs to be created/updated |
| `impeccable audit` | Run technical checks for responsiveness, performance & accessibility | During technical/UX audits |
| `impeccable polish` | Improve visual hierarchy and micro-interactions | During UI refinement |
| `impeccable bolder` | Make safe or subtle UI elements stand out more | When stronger visual emphasis is needed |
| `impeccable animate` | Add smooth, purposeful micro-animations | When animation improves the UX |

---

## Current Development Status

**INTERVIEWER AI — Under Build**

### Current Phase

**Phase 4 — Real-Time Interview Latency Refinement**

### Current Development Objective

The current development is focused on making InterviewAI feel more like a **real-time human technical interview**, with the lowest practical conversational latency while preserving the intelligence, adaptability, transcript accuracy, and existing interview flow.

The goal is to minimize the waiting time between: Keep the browser responsible for realtime capture/rendering and move prediction, interview state, candidate-question pooling, caching, and final selection into the existing backend. Optimize latency through parallelism and pre-generation, not through CORS changes.

```text
Candidate finishes speaking
        ↓
AI understands response
        ↓
AI decides next direction
        ↓
AI responds
        ↓
D-ID avatar speaks

while allowing as much processing as possible to happen before the candidate finishes speaking.

Full Optimized Interview Architecture
PRE-INTERVIEW INTELLIGENCE
Questionnaire + JD + Rules
          ↓
    Interview Planner
          ↓
 Structured Interview Blueprint
          ↓
      Redis / Database

The planner prepares the interview strategy before the candidate begins so that the real-time system does not repeatedly rediscover interview requirements during every turn.

REAL-TIME CANDIDATE TURN
                 CANDIDATE TURN

                    Candidate speaks
                           │
                           ▼
                    Streaming STT
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
     Transcript       Prediction        State Engine
      Updates            Worker         Tracks coverage
                           │
                         Groq
                           │
                           ▼
                Question Candidate Pool
                     ┌─────┼─────┐
                     ▼     ▼     ▼
                    Q1    Q2    Q3
                           │
                           │
                 Candidate finishes
                           │
                           ▼
                    Final Transcript
                           │
                           ▼
                    Local Validation
                           │
             ┌─────────────┴─────────────┐
             │                           │
        Good Match                  No Good Match
             │                           │
             ▼                           ▼
        Use Cached Q                 Gemini Generates
             │                           │
             └─────────────┬─────────────┘
                           ▼
                          D-ID
                           ↓
                    Avatar Speaks
                           ↓
                    Candidate Turn
Latency Strategy
During the candidate's answer

Instead of waiting for the candidate to finish before starting all processing:

Candidate is speaking
        ↓
STT is already running
        ↓
Prediction worker is already preparing possibilities
        ↓
State engine is already tracking interview progress
        ↓
Candidate question pool is already being prepared

This allows a large portion of the processing to happen while the candidate is still speaking.

Immediately after the candidate finishes
Traditional flow
Final Answer
    ↓
LLM starts thinking
    ↓
Generate question
    ↓
TTS
    ↓
Avatar
InterviewAI target flow
Final Answer
    ↓
Local validation / selection
    ↓
Prepared question already available
    ↓
D-ID

If a valid prepared question exists, the system should avoid unnecessary additional LLM waiting.

Question Candidate Pool

The prediction worker should maintain a small pool of likely next questions instead of generating only one possible question.

Example:

Current Topic: Projects

Candidate Pool

├── Follow-up: Technical Decision
├── Follow-up: Problem Solving
└── Scenario: Scalability

The pool is generated dynamically from:

Candidate Context
        +
Interview Blueprint
        +
Current Topic
        +
Previous Answers
        +
Remaining Objectives

When the candidate finishes speaking, the system determines which prepared question best matches the actual final answer.

Example:

Candidate discusses scalability
        ↓
State Engine
        ↓
Matching question already prepared
        ↓
Use cached question
        ↓
D-ID responds immediately

This avoids unnecessary question generation after every turn.

Key Architectural Separation

The system responsibilities remain clearly separated:

Interview Planner
= What must this interview cover?

State Engine
= What has already been covered?

Prediction Worker
= What are we likely to explore next?

Candidate Pool
= What questions are already prepared?

Local Decision Engine
= Which prepared question best fits?

Gemini
= Final AI authority when preparation is insufficient

D-ID
= Human-like visual + vocal presentation

Gemini should not repeatedly rediscover the entire interview state on every turn.

Final InterviewAI Architecture
                    PRE-INTERVIEW

                         │
              Questionnaire / JD / Resume
                         │
                         ▼
                ┌─────────────────┐
                │ Interview       │
                │ Planner         │
                └────────┬────────┘
                         │
                 Interview Blueprint
                         │
                         ▼
                 Redis / PostgreSQL
                         │
═════════════════════════╪═════════════════════════
                         │
                    LIVE INTERVIEW
                         │
                 Candidate speaks
                         │
                         ▼
                  Streaming STT
                         │
          ┌──────────────┼──────────────┐
          │              │              │
          ▼              ▼              ▼
      Transcript     Prediction      State Engine
       Stream          Worker
                         │
                       Groq
                         │
                         ▼
                Candidate Question Pool
                         │
                         │
                Candidate stops speaking
                         │
                         ▼
                  Final Transcript
                         │
                         ▼
                Local Decision Engine
                    /          \
                   /            \
             Pool Hit          No Fit
                ↓                 ↓
             Cached Q           Gemini
                \                 /
                 \               /
                  └──────┬──────┘
                         ▼
                        D-ID
                         ▼
                AI Speaks Instantly
                         │
                         ▼
                Next Candidate Turn
Core Optimization Principle

InterviewAI is optimizing both sides of every conversational turn.

DURING ANSWER
→ Streaming transcription
→ Prediction
→ State tracking
→ Candidate question pool preparation
AFTER ANSWER
→ Final transcript
→ Local selection
→ Minimal / no LLM wait
→ D-ID response

The objective is:

Less waiting
+
More parallel processing
+
Better context awareness
+
More natural conversation
=
More realistic real-time interview
Development Rule

Every new phase should continue from the existing implementation:

Current Working System
        ↓
Inspect Existing Implementation
        ↓
Identify the Next Required Improvement
        ↓
Implement Using Existing Stack
        ↓
Test End-to-End
        ↓
Measure / Verify
        ↓
Update README
        ↓
Move to Next Phase

The project should evolve incrementally toward the main goal: low-latency, natural, human-like technical interview conversations, while preserving the existing architecture and working systems.