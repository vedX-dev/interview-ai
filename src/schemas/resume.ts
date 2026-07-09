import { z } from "zod";

export const ExtractedResumeSchema = z.object({
  fullName: z.string().min(1),
  topSkills: z.array(z.string().min(1)).min(1).max(5),
  yearsOfExperience: z.number().min(0),
  coreProjects: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string().min(1),
      }),
    )
    .max(3),
});

export type ExtractedResume = z.infer<typeof ExtractedResumeSchema>;
