import { pgTable, uuid, text, integer, timestamp, pgEnum, jsonb } from "drizzle-orm/pg-core";

// 1. Define our status options
export const statusEnum = pgEnum("interview_status", ["ongoing", "completed", "failed"]);

// 2. Define the Interviews table
export const interviews = pgTable("interviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(), // This will come from Clerk Auth later
  jobRole: text("job_role").notNull(),
  jobDescription: text("job_description"),
  status: statusEnum("status").default("ongoing"),
  score: integer("score"),
  feedback: jsonb("feedback"), // Our flexible AI report
  createdAt: timestamp("created_at").defaultNow(),
});

export const transcriptChunks = pgTable("transcript_chunks",{
    id: uuid("id").primaryKey().defaultRandom(),
    interviewId: uuid("interview_id").references(()=> interviews.id).notNull(),
    content: text("content").notNull(),
    speaker: text("speaker", {enum:["user", "ai"]}).notNull(),
    createdAt:timestamp("created_at").defaultNow(),
    });