import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import fs from "fs";
import path from "path";

export async function exportQuestionsCSV(interviewId?: string): Promise<string> {
  const { db } = await import("@/src/db/index");
  const { interviews, transcriptChunks } = await import("@/src/db/schema");
  const { eq, asc } = await import("drizzle-orm");

  const evalDir = path.join(process.cwd(), "eval-data");
  if (!fs.existsSync(evalDir)) {
    fs.mkdirSync(evalDir, { recursive: true });
  }

  let targetInterviews: Array<{ id: string; plan: any }> = [];
  if (interviewId) {
    const rows = await db
      .select({ id: interviews.id, plan: interviews.plan })
      .from(interviews)
      .where(eq(interviews.id, interviewId));
    targetInterviews = rows;
  } else {
    const rows = await db
      .select({ id: interviews.id, plan: interviews.plan })
      .from(interviews);
    targetInterviews = rows;
  }

  if (targetInterviews.length === 0) {
    console.log(`[EXPORT_QUESTIONS] No interviews found in DB.`);
    return "";
  }

  const exportId = interviewId || "all";
  const outputPath = path.join(evalDir, `questions_${exportId}.csv`);

  const csvRows: string[] = [];
  // Table 6 columns plus evaluator_id:
  // candidate_response, generated_question, relevance_score, resume_relevance_score, evaluator_id
  const header = "candidate_response,generated_question,relevance_score,resume_relevance_score,evaluator_id";
  csvRows.push(header);

  let totalQuestionsExported = 0;

  for (const target of targetInterviews) {
    const chunks = await db
      .select()
      .from(transcriptChunks)
      .where(eq(transcriptChunks.interviewId, target.id))
      .orderBy(asc(transcriptChunks.createdAt));

    const userChunks = chunks.filter((c) => c.speaker === "user");
    const aiChunks = chunks.filter((c) => c.speaker === "ai");

    const plan = target.plan as any;
    const asked = plan?.asked || [];

    for (let i = 0; i < aiChunks.length; i++) {
      const generatedQuestion = aiChunks[i].content || "";
      const previousCandidateResponse = i > 0 && userChunks[i - 1] ? userChunks[i - 1].content : "";
      
      const askedObj = asked.find((a: any) => a.question === generatedQuestion);
      const isResumeGrounded = askedObj?.topic === "warmup" || plan?.phase === "warmup" || askedObj?.topic?.includes("resume");

      const escapeCsv = (str: string) => `"${(str || "").replace(/"/g, '""')}"`;

      const row = [
        escapeCsv(previousCandidateResponse),
        escapeCsv(generatedQuestion),
        "", // relevance_score (BLANK 1-5 for human rating)
        isResumeGrounded ? "" : "N/A", // resume_relevance_score (BLANK 1-5 if resume-grounded, else N/A)
        "evaluator_1", // evaluator_id
      ].join(",");

      csvRows.push(row);
      totalQuestionsExported++;
    }
  }

  fs.writeFileSync(outputPath, csvRows.join("\n"));

  console.log("\n=======================================================");
  console.log("          EXPORT QUESTIONS CSV (Table 6)              ");
  console.log("=======================================================");
  console.log(`Exported file: ${outputPath}`);
  console.log(`Total questions exported: ${totalQuestionsExported}`);
  console.log("Columns needing manual human input:");
  console.log("  - relevance_score (Rate 1-5 for question relevance)");
  console.log("  - resume_relevance_score (Rate 1-5 for resume-grounded questions)");
  console.log("=======================================================\n");

  return outputPath;
}

if (require.main === module) {
  const targetId = process.argv[2];
  exportQuestionsCSV(targetId).catch((err) => console.error("Export error:", err));
}
