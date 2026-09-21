import { z } from "zod";

export const ParameterScoresSchema = z.object({
  technicalCorrectness: z.number().min(0).max(100), // Weight 30%
  depthOfUnderstanding: z.number().min(0).max(100), // Weight 20%
  problemSolvingReasoning: z.number().min(0).max(100), // Weight 15%
  practicalEngineeringJudgment: z.number().min(0).max(100), // Weight 15%
  communication: z.number().min(0).max(100), // Weight 10%
  adaptabilityFollowUps: z.number().min(0).max(100), // Weight 10%
});

export const ProficiencyLevelEnum = z.enum([
  "Not Demonstrated",
  "Basic",
  "Working",
  "Proficient",
  "Advanced",
  "Expert",
]);

export const SkillAssessmentSchema = z.object({
  skill: z.string(),
  demonstrated: z.boolean(),
  proficiencyLevel: ProficiencyLevelEnum.optional(),
  confidence: z.enum(["high", "medium", "low"]),
  notes: z.string(),
  transcriptQuote: z.string().optional(),
});

export const QuestionFeedbackSchema = z.object({
  question: z.string(),
  focusArea: z.string(),
  answerQuality: z.enum(["excellent", "good", "fair", "poor", "no_answer"]),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  suggestedImprovement: z.string(),
  transcriptQuote: z.string().optional(),
  parameterScores: ParameterScoresSchema.optional(),
  questionScore: z.number().min(0).max(100).optional(),
});

export const EvidenceGateEnum = z.enum([
  "insufficient_evidence",
  "preliminary",
  "partial",
  "full",
]);

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
  evidenceGate: EvidenceGateEnum.optional(),
  evidenceGateLabel: z.string().optional(),
  categoryScores: ParameterScoresSchema.optional(),
});

export type ParameterScores = z.infer<typeof ParameterScoresSchema>;
export type ProficiencyLevel = z.infer<typeof ProficiencyLevelEnum>;
export type EvidenceGate = z.infer<typeof EvidenceGateEnum>;
export type SkillAssessment = z.infer<typeof SkillAssessmentSchema>;
export type QuestionFeedback = z.infer<typeof QuestionFeedbackSchema>;
export type FeedbackReport = z.infer<typeof FeedbackReportSchema>;
