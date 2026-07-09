import { z } from "zod";

export const OrchestratorDecisionSchema = z.object({
  phase: z.enum(["greeting", "rapport", "technical", "wrapup", "closed"]),
  aiUtterance: z.string(),
  phaseComplete: z.boolean(),
  reasoning: z.string().optional(),
});

export type OrchestratorDecision = z.infer<typeof OrchestratorDecisionSchema>;

export const OrchestratorRequestSchema = z.object({
  interviewId: z.string().uuid(),
  currentPhase: z.enum(["greeting", "rapport", "technical", "wrapup", "closed"]),
  transcript: z.array(z.object({
    speaker: z.enum(["user", "ai"]),
    content: z.string(),
    timestamp: z.string().optional(),
  })),
  resumeData: z.object({
    fullName: z.string(),
    topSkills: z.array(z.string()),
    yearsOfExperience: z.number(),
    coreProjects: z.array(z.object({
      title: z.string(),
      description: z.string(),
    })),
  }).optional(),
  jobRole: z.string(),
  geminiCallsCount: z.number(),
  totalTurns: z.number(),
  adaptiveDecisionsCount: z.number(),
});

export type OrchestratorRequest = z.infer<typeof OrchestratorRequestSchema>;
