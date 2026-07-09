import { z } from "zod";

export const InterviewQuestionSchema = z.object({
  id: z.number().int().min(1).max(5),
  type: z.enum(["technical", "coding"]),
  question: z.string().min(1),
  focusArea: z.string().min(1),
  expectedDurationMinutes: z.number().int().min(1).max(30),
});

export const InterviewPlanResponseSchema = z.object({
  interviewPlan: z
    .array(InterviewQuestionSchema)
    .length(5)
    .refine(
      (questions) => questions.some((q) => q.type === "technical"),
      "Plan must include at least one technical question",
    )
    .refine(
      (questions) => questions.some((q) => q.type === "coding"),
      "Plan must include at least one coding question",
    ),
});

export type InterviewQuestion = z.infer<typeof InterviewQuestionSchema>;
export type InterviewPlanResponse = z.infer<typeof InterviewPlanResponseSchema>;
