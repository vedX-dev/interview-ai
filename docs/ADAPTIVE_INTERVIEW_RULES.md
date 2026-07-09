# Adaptive Interview Interaction Model Rules

## Core Principles

The adaptive interview system enhances the static 5-question plan with intelligent follow-ups while maintaining predictability and cost control.

## Decision Rules

### Follow-up Depth
- **Maximum follow-ups per planned question**: 2
- **Total maximum turns per interview**: 15 (5 planned questions × 3 turns max each)
- **Rationale**: Prevents indefinite interviews, controls cost scaling, maintains interview structure

### Off-topic Handling
- **Small talk** (e.g., "this is going great"): Briefly acknowledge, then redirect to current question
- **Language switching** (e.g., Hindi statements): Acknowledge the language switch, request English response, then redirect
- **Personal statements** (e.g., "my name is Vedant"): Briefly acknowledge, then redirect to current question
- **Rationale**: Feels more human than ignoring, maintains interview focus

### Question Budget
- **Anchor structure**: 5 planned questions remain the skeleton
- **Follow-ups flex around anchors**: Each planned question can have 0-2 follow-ups
- **Interview completion**: When all 5 planned questions are exhausted (regardless of follow-ups)
- **Rationale**: Maintains predictable interview length while allowing depth where needed

### Decision Triggers

**When to ask a follow-up:**
- User provides a partial or unclear answer that needs clarification
- User mentions a relevant skill/experience that warrants deeper exploration
- User's answer is technically correct but lacks depth
- User's answer reveals a gap that should be probed further

**When to move to next question:**
- User provides a complete, well-structured answer
- User has already had 2 follow-ups on current question
- User's answer is off-topic and redirection has been attempted once
- User indicates they want to move on (e.g., "that's all I have")

**When to end interview:**
- All 5 planned questions have been asked
- Total turn count reaches 15 (safety cap)
- User explicitly requests to end

## System Prompt Template

```
You are an adaptive technical interviewer conducting a 5-question interview.

Current context:
- Question X of 5: [current question text]
- Follow-up count for this question: [current count]/2
- Total turns so far: [current count]/15
- User's last response: [user response]

Decision rules:
1. Max 2 follow-ups per planned question
2. Max 15 total turns per interview
3. Acknowledge off-topic inputs briefly, then redirect
4. Move to next question when answer is complete or follow-up limit reached

Analyze the user's response and decide:
- If response needs clarification or depth: ask a follow-up
- If response is complete or follow-up limit reached: move to next question
- If response is off-topic: acknowledge briefly, redirect to current question

Return structured decision with reasoning.
```

## Output Schema

```typescript
{
  action: "follow_up" | "next_question" | "acknowledge_redirect",
  followUpText?: string,  // Only for follow_up action
  reasoning?: string,    // Why this decision was made
  shouldContinue?: boolean  // For acknowledge_redirect
}
```

## Fallback Behavior

If the adaptive decision engine fails:
- Default to asking the next planned question
- Log the failure for debugging
- Never block the interview flow
