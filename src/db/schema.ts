import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  pgEnum,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { vector768 } from "./vector";

export const statusEnum = pgEnum("interview_status", [
  "ongoing",
  "completed",
  "failed",
]);

export const phaseEnum = pgEnum("interview_phase", [
  "greeting",
  "rapport",
  "technical",
  "wrapup",
  "closed",
]);

export const resumes = pgTable(
  "resumes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    fullName: text("full_name").notNull(),
    rawText: text("raw_text").notNull(),
    structuredData: jsonb("structured_data").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [index("resumes_user_id_idx").on(table.userId)],
);

export const interviews = pgTable(
  "interviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    resumeId: uuid("resume_id").references(() => resumes.id, {
      onDelete: "set null",
    }),
    jobRole: text("job_role").notNull(),
    jobDescription: text("job_description"),
    status: statusEnum("status").default("ongoing"),
    currentPhase: phaseEnum("current_phase").default("greeting"),
    score: integer("score"),
    feedback: jsonb("feedback"),
    createdAt: timestamp("created_at").defaultNow(),
    // Cost and runaway control tracking
    geminiCallsCount: integer("gemini_calls_count").default(0),
    totalTurns: integer("total_turns").default(0),
    adaptiveDecisionsCount: integer("adaptive_decisions_count").default(0),
  },
  (table) => [index("interviews_resume_id_idx").on(table.resumeId)],
);

export const transcriptChunks = pgTable(
  "transcript_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    interviewId: uuid("interview_id")
      .notNull()
      .references(() => interviews.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    speaker: text("speaker", { enum: ["user", "ai"] }).notNull(),
    embedding: vector768("embedding"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("transcript_chunks_interview_id_idx").on(table.interviewId),
  ],
);
