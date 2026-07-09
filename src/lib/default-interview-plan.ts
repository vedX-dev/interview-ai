import type { InterviewPlanResponse } from "@/src/schemas/interview";
import type { ExtractedResume } from "@/src/schemas/resume";

export const MOCK_STRUCTURED_RESUME: ExtractedResume = {
  fullName: "Dev Candidate",
  topSkills: ["React", "Node.js", "PostgreSQL", "Java"],
  yearsOfExperience: 3,
  coreProjects: [],
};

export const DUMMY_RESUME_ID = "00000000-0000-0000-0000-000000000000";

export const DEFAULT_INTERVIEW_PLAN: InterviewPlanResponse = {
  interviewPlan: [
    {
      id: 1,
      type: "technical",
      question:
        "Explain the architectural difference between an SQL index and a full-table scan.",
      focusArea: "Databases",
      expectedDurationMinutes: 5,
    },
    {
      id: 2,
      type: "technical",
      question:
        "How does the virtual DOM reconcile state changes in React 19?",
      focusArea: "React",
      expectedDurationMinutes: 5,
    },
    {
      id: 3,
      type: "coding",
      question:
        "[Coding] Write a function to detect a cycle inside a linked list.",
      focusArea: "Data Structures",
      expectedDurationMinutes: 8,
    },
    {
      id: 4,
      type: "technical",
      question:
        "How would you design connection pooling for a high-traffic Node.js API backed by PostgreSQL?",
      focusArea: "System Design",
      expectedDurationMinutes: 6,
    },
    {
      id: 5,
      type: "coding",
      question:
        "[Coding] Implement an LRU cache with O(1) get and put operations.",
      focusArea: "Algorithms",
      expectedDurationMinutes: 10,
    },
  ],
};
