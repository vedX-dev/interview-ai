import { z } from "zod";

export const SkillAssessmentSchema = z.object({
  skill: z.string(),
  demonstrated: z.boolean(),
  confidence: z.enum(["high", "medium", "low"]),
  notes: z.string(),
});

export const QuestionFeedbackSchema = z.object({
  question: z.string(),
  focusArea: z.string(),
  answerQuality: z.enum(["excellent", "good", "fair", "poor", "no_answer"]),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  suggestedImprovement: z.string(),
});

export const FeedbackReportSchema = z.object({
  overallScore: z.number().int().min(0).max(100),
  summary: z.string(),
  strengths: z.array(z.string()),
  areasForImprovement: z.array(z.string()),
  skillAssessments: z.array(SkillAssessmentSchema),
  questionFeedback: z.array(QuestionFeedbackSchema),
  recommendedFollowUp: z.string(),
  hiringRecommendation: z.enum(["strong_hire", "hire", "consider", "do_not_hire"]),
  interviewDuration: z.number(), // in minutes
});

export type SkillAssessment = z.infer<typeof SkillAssessmentSchema>;
export type QuestionFeedback = z.infer<typeof QuestionFeedbackSchema>;
export type FeedbackReport = z.infer<typeof FeedbackReportSchema>;
