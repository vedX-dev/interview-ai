import { z } from "zod";

export const InterviewChatSchema = z.object({
  interviewId: z.string().uuid(),
  query: z.string().min(1).max(2000),
});

export type InterviewChatInput = z.infer<typeof InterviewChatSchema>;
