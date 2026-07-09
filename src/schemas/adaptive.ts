import { z } from "zod";

export const AdaptiveDecisionSchema = z.object({
  action: z.enum(["follow_up", "next_question", "acknowledge_redirect"]),
  followUpText: z.string().optional(),
  reasoning: z.string().optional(),
  shouldContinue: z.boolean().optional(),
});

export type AdaptiveDecision = z.infer<typeof AdaptiveDecisionSchema>;

export const AdaptiveDecisionRequestSchema = z.object({
  interviewId: z.string().uuid(),
  currentQuestionIndex: z.number().min(0).max(4),
  followUpCount: z.number().min(0).max(2),
  totalTurns: z.number().min(0).max(15),
  currentQuestion: z.string(),
  userResponse: z.string(),
  remainingQuestions: z.array(z.string()),
});

export type AdaptiveDecisionRequest = z.infer<typeof AdaptiveDecisionRequestSchema>;
