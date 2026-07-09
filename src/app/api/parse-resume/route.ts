import { GoogleGenAI } from "@google/genai";
import { auth } from "@clerk/nextjs/server";
import * as pdfjsLib from "pdfjs-dist";
import { ZodError } from "zod";
import { db } from "@/src/db/index";
import { resumes } from "@/src/db/schema";
import { ExtractedResumeSchema } from "@/src/schemas/resume";
import "@/src/lib/config";

// Configure pdfjs worker for Node.js environment
// Use CDN worker for pdfjs-dist v6+
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

const SYSTEM_INSTRUCTION =
  "You are an elite technical recruiter for top Indian startups. Analyze the provided resume text. Extract the candidate's full name, identify their top 5 core technical skills, normalize their total years of experience to a number (use 0 for freshers/students), and select up to 3 strongest projects or impact points. Your output must strictly adhere to the requested JSON schema structure.";

const JSON_OUTPUT_SHAPE = `{
  "fullName": "string",
  "topSkills": ["string"],
  "yearsOfExperience": 0,
  "coreProjects": [{ "title": "string", "description": "string" }]
}`;

async function extractTextFromPdf(data: Uint8Array): Promise<string> {
  try {
    console.log("Starting PDF extraction, data size:", data.length);
    
    // Load the PDF document
    const loadingTask = pdfjsLib.getDocument({ data });
    const pdf = await loadingTask.promise;
    
    console.log("PDF loaded successfully, pages:", pdf.numPages);
    
    let fullText = "";
    let pagesWithText = 0;
    
    // Extract text from all pages
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(" ");
      
      if (pageText.trim().length > 0) {
        pagesWithText++;
        fullText += pageText + " ";
      }
    }
    
    console.log("Extracted text from", pagesWithText, "pages out of", pdf.numPages);
    console.log("Total text length:", fullText.length);
    
    // Check if we got any meaningful text
    if (fullText.trim().length < 50) {
      throw new Error(
        "PDF appears to be image-based or scanned. Please upload a text-based PDF (export from Word/Google Docs)."
      );
    }
    
    // Clean up the text
    return fullText.replace(/\s+/g, " ").trim();
  } catch (error) {
    console.error("PDF extraction error:", error);
    
    if (error instanceof Error) {
      // Re-throw with more context
      throw new Error(`Failed to extract text from PDF: ${error.message}`);
    }
    
    throw new Error("Failed to extract text from PDF");
  }
}

export async function POST(request: Request) {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      console.error(
        "❌ CRITICAL: GEMINI_API_KEY is missing from environment variables",
      );
      return Response.json(
        {
          error:
            "GEMINI_API_KEY is missing from environment variables. Configure it before parsing resumes.",
        },
        { status: 500 },
      );
    }

    const { userId } = await auth();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { fileData, fileName } = (await request.json()) as {
      fileData?: string;
      fileName?: string;
    };

    if (!fileData || typeof fileData !== "string") {
      console.error("❌ ERROR: No fileData found in JSON payload");
      return Response.json(
        { error: "No fileData found in JSON payload" },
        { status: 400 },
      );
    }

    if (!fileName || !fileName.toLowerCase().endsWith(".pdf")) {
      return Response.json(
        { error: "Only PDF files are supported" },
        { status: 400 },
      );
    }

    const base64Payload = fileData.includes(",")
      ? fileData.split(",")[1]
      : fileData;

    if (!base64Payload) {
      console.error("❌ ERROR: Invalid base64 fileData in JSON payload");
      return Response.json(
        { error: "Invalid base64 fileData in JSON payload" },
        { status: 400 },
      );
    }

    console.log("Converting base64 to buffer, base64 length:", base64Payload.length);
    const fileBuffer = Buffer.from(base64Payload, "base64");
    console.log("Buffer created successfully, size:", fileBuffer.length);
    
    // Convert Buffer to Uint8Array for pdfjs-dist compatibility
    const uint8Array = new Uint8Array(fileBuffer.buffer, fileBuffer.byteOffset, fileBuffer.byteLength);
    console.log("Converted to Uint8Array, size:", uint8Array.length);

    const cleanText = await extractTextFromPdf(uint8Array);

    if (!cleanText) {
      return Response.json(
        { error: "No readable text found in the PDF" },
        { status: 400 },
      );
    }

    const ai = new GoogleGenAI({ apiKey: geminiApiKey });
    const geminiResult = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: `Resume text:\n\n${cleanText}\n\nReturn JSON with exactly this shape:\n${JSON_OUTPUT_SHAPE}`,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
      },
    });

    const rawJson = geminiResult.text;
    if (!rawJson) {
      return Response.json(
        { error: "AI returned an empty response" },
        { status: 502 },
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawJson);
    } catch {
      return Response.json(
        { error: "AI returned invalid JSON" },
        { status: 502 },
      );
    }

    const extractedResume = ExtractedResumeSchema.parse(parsedJson);

    const [savedResume] = await db
      .insert(resumes)
      .values({
        userId,
        fullName: extractedResume.fullName,
        rawText: cleanText,
        structuredData: extractedResume,
      })
      .returning();

    return Response.json(savedResume);
  } catch (error) {
    console.error("🔥 FULL_ROUTE_CRASH_TRACE:", error);

    if (error instanceof ZodError) {
      return Response.json(
        {
          error: "AI response did not match the expected resume schema",
          details: error.flatten(),
        },
        { status: 422 },
      );
    }

    const message =
      error instanceof Error ? error.message : "Unknown server error";

    return Response.json(
      {
        error: "Failed to parse and analyze resume",
        detail: message,
      },
      { status: 500 },
    );
  }
}
