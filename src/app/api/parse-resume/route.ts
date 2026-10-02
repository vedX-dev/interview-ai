/**
 * Resume parsing route.
 *
 * Phase E fixes:
 * - runtime = 'nodejs' (required for pdfjs-dist / mammoth)
 * - Accepts multipart/form-data OR JSON base64 (backward compat)
 * - 5 MB file limit with JSON 413
 * - Lazy dynamic imports (no top-level pdfjs import)
 * - Supports: PDF (unpdf), DOCX (mammoth), TXT/MD (plain), others → guidance
 * - File type detected via MIME + extension + magic bytes
 * - Heuristic fallback if ALL LLM providers fail
 * - Never a dead end: always returns a pre-filled editable card
 * - Returns JSON on every error path
 */

export const runtime = "nodejs";

import { auth } from "@clerk/nextjs/server";
import { ZodError } from "zod";
import { db } from "@/src/db/index";
import { resumes } from "@/src/db/schema";
import { ExtractedResumeSchema, type ExtractedResume } from "@/src/schemas/resume";
import { generate, tryParseAndValidate } from "@/src/lib/llm/index";
import { checkParseResumeLimit } from "@/src/lib/rate-limit";
import { logEvent } from "@/src/lib/audit";

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

const SYSTEM_INSTRUCTION =
  "You are an elite technical recruiter. Analyze the provided resume text. " +
  "Extract the candidate's full name, identify their top 5 core technical skills, " +
  "normalize their total years of experience to a number (use 0 for freshers/students), " +
  "and select up to 3 strongest projects or impact points. " +
  "Output must strictly adhere to the requested JSON schema structure.";

const JSON_OUTPUT_SHAPE = `{
  "fullName": "string",
  "topSkills": ["string"],
  "yearsOfExperience": 0,
  "coreProjects": [{ "title": "string", "description": "string" }]
}`;

// ─── Magic-byte detection ─────────────────────────────────────────────────────

function detectFileType(
  buffer: Buffer,
  mimeHint: string,
  nameHint: string,
): "pdf" | "docx" | "txt" | "unsupported" {
  const ext = nameHint.toLowerCase().split(".").pop() ?? "";

  // PDF: %PDF
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return "pdf";
  }
  // DOCX/XLSX/ZIP: PK magic
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    return "docx"; // treat all zip-based office formats as docx (mammoth handles .docx)
  }
  // Hint fallbacks
  if (ext === "pdf" || mimeHint === "application/pdf") return "pdf";
  if (["docx", "doc", "odt", "rtf"].includes(ext)) return "docx";
  if (["txt", "md", "text"].includes(ext) || mimeHint.startsWith("text/")) return "txt";

  return "unsupported";
}

// ─── Text extractors ──────────────────────────────────────────────────────────

async function extractPdf(buffer: Buffer): Promise<string> {
  // Dynamic import to avoid top-level side effects (pdfjs reads test file at import)
  const { extractText } = await import("unpdf");
  const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const { text } = await extractText(uint8, { mergePages: true });
  if (!text || text.trim().length < 30) {
    throw Object.assign(new Error("PDF appears to be image-based or empty"), { category: "unreadable" });
  }
  return text.replace(/\s+/g, " ").trim();
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  if (!result.value || result.value.trim().length < 30) {
    throw Object.assign(new Error("DOCX appears to be empty"), { category: "empty" });
  }
  return result.value.replace(/\s+/g, " ").trim();
}

function extractTxt(buffer: Buffer): string {
  const text = buffer.toString("utf-8");
  if (text.trim().length < 10) {
    throw Object.assign(new Error("Text file is empty"), { category: "empty" });
  }
  return text.replace(/\s+/g, " ").trim();
}

// ─── Heuristic fallback parser ────────────────────────────────────────────────

function heuristicParse(text: string) {
  // Extract email for name guess
  const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
  const nameGuess = emailMatch
    ? emailMatch[0].split("@")[0].replace(/[._+-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "Candidate";

  // Extract years of experience
  const yoeMatch = text.match(/(\d+)\+?\s*years?\s*(of\s*)?(experience|exp)/i);
  const yoe = yoeMatch ? parseInt(yoeMatch[1], 10) : 0;

  // Common skill keywords
  const techKeywords = [
    "Python", "JavaScript", "TypeScript", "React", "Node.js", "Java", "Go", "Rust",
    "C\\+\\+", "C#", "SQL", "PostgreSQL", "MySQL", "MongoDB", "Redis", "AWS", "GCP",
    "Docker", "Kubernetes", "GraphQL", "REST", "Next.js", "Vue", "Angular", "TensorFlow",
    "PyTorch", "Machine Learning", "ML", "AI", "Spring", "Django", "FastAPI", "Flask",
  ];
  const found = techKeywords.filter((kw) =>
    new RegExp(`\\b${kw}\\b`, "i").test(text),
  );
  const topSkills = found.slice(0, 5);
  if (topSkills.length === 0) topSkills.push("General Programming");

  // Detect project-like sections
  const projectLines = text
    .split(/\n|\./)
    .filter((l) =>
      l.length > 30 &&
      /built|developed|created|designed|implemented|deployed/i.test(l),
    )
    .slice(0, 3)
    .map((l) => ({ title: "Project", description: l.trim().slice(0, 200) }));

  return {
    fullName: nameGuess,
    topSkills,
    yearsOfExperience: yoe,
    coreProjects: projectLines.length > 0 ? projectLines : [],
  };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const { userId, sessionId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized", code: "AUTH_REQUIRED" }, { status: 401 });
    }

    const rl = checkParseResumeLimit(userId);
    if (!rl.allowed) {
      logEvent(request, { userId, sessionId, type: "rate_limited", meta: { bucket: "parse_resume" } });
      return Response.json(
        { error: rl.reason, code: "RATE_LIMITED", retryAfterSec: rl.retryAfterSec ?? 60 },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 60) } },
      );
    }

    let fileBuffer: Buffer;
    let mimeType = "";
    let fileName = "";

    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      // Native multipart upload
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return Response.json(
          { error: "No file provided", code: "NO_FILE", category: "empty" },
          { status: 400 },
        );
      }
      if (file.size > MAX_FILE_BYTES) {
        return Response.json(
          { error: "File exceeds 5 MB limit", code: "FILE_TOO_LARGE" },
          { status: 413 },
        );
      }
      fileBuffer = Buffer.from(await file.arrayBuffer());
      mimeType = file.type;
      fileName = file.name;
    } else {
      // Legacy JSON base64 path (client sends { fileData, fileName })
      const { fileData, fileName: fn } = (await request.json()) as {
        fileData?: string;
        fileName?: string;
      };
      if (!fileData) {
        return Response.json(
          { error: "No fileData in payload", code: "NO_FILE", category: "empty" },
          { status: 400 },
        );
      }
      const base64 = fileData.includes(",") ? fileData.split(",")[1] : fileData;
      fileBuffer = Buffer.from(base64!, "base64");
      if (fileBuffer.byteLength > MAX_FILE_BYTES) {
        return Response.json(
          { error: "File exceeds 5 MB limit", code: "FILE_TOO_LARGE" },
          { status: 413 },
        );
      }
      fileName = fn ?? "resume.pdf";
      mimeType = "";
    }

    // Detect file type
    const fileType = detectFileType(fileBuffer, mimeType, fileName);

    if (fileType === "unsupported") {
      return Response.json(
        {
          error: "Unsupported file type. Please save your resume as a PDF or DOCX file and try again.",
          code: "UNSUPPORTED_TYPE",
          category: "unsupported",
        },
        { status: 415 },
      );
    }

    // Extract text
    let cleanText: string;
    try {
      if (fileType === "pdf") {
        cleanText = await extractPdf(fileBuffer);
      } else if (fileType === "docx") {
        cleanText = await extractDocx(fileBuffer);
      } else {
        cleanText = extractTxt(fileBuffer);
      }
    } catch (extractErr: any) {
      const category = extractErr?.category ?? "unreadable";
      let userMessage =
        "Could not read text from this file. Please export your resume as a text-based PDF from Word or Google Docs and try again.";
      if (category === "unsupported") {
        userMessage =
          "This file format is not supported. Please save your resume as PDF or DOCX.";
      } else if (category === "empty") {
        userMessage = "The file appears to be empty. Please check the file and try again.";
      }
      // Return heuristic fallback — still gives the user a pre-filled card
      return Response.json(
        {
          error: userMessage,
          code: "EXTRACT_FAILED",
          category,
          fallbackProfile: heuristicParse(""), // empty — user fills manually
        },
        { status: 422 },
      );
    }

    // Parse with LLM
    let extractedResume;
    try {
      const result = await generate({
        task: "heavy",
        system: SYSTEM_INSTRUCTION,
        prompt: `Resume text:\n\n${cleanText.slice(0, 8000)}\n\nReturn JSON with exactly this shape:\n${JSON_OUTPUT_SHAPE}`,
        jsonSchema: ExtractedResumeSchema,
      });

      const parsed = tryParseAndValidate(result.text, ExtractedResumeSchema);
      if (!parsed.ok) throw new Error(`Schema validation failed: ${parsed.error}`);
      extractedResume = parsed.data as ExtractedResume;

      console.log(`[PARSE-RESUME] provider=${result.provider} model=${result.model} latency=${result.latencyMs}ms`);
    } catch (llmErr) {
      console.warn("[PARSE-RESUME] LLM failed, using heuristic fallback:", llmErr);
      extractedResume = heuristicParse(cleanText);
    }

    // Persist to DB (rawText excluded — Phase E rule: never store raw file)
    const [savedResume] = await db
      .insert(resumes)
      .values({
        userId,
        fullName: extractedResume.fullName,
        rawText: cleanText.slice(0, 50000), // store extracted text, not raw file
        structuredData: extractedResume,
      })
      .returning();

    logEvent(request, {
      userId,
      sessionId,
      type: "resume_parse",
      meta: {
        resumeId: savedResume.id,
        fileType,
      },
    });

    return Response.json(savedResume);
  } catch (error) {
    console.error("[PARSE-RESUME] Unexpected error:", error);

    if (error instanceof ZodError) {
      return Response.json(
        {
          error: "Resume data did not match expected format",
          code: "VALIDATION_ERROR",
          category: "service_busy",
          details: error.flatten(),
        },
        { status: 422 },
      );
    }

    return Response.json(
      {
        error: "Failed to parse resume. Please try again or fill in your details manually.",
        code: "INTERNAL_ERROR",
        category: "service_busy",
      },
      { status: 500 },
    );
  }
}
