import { NextRequest, NextResponse } from "next/server";
import pdf from "pdf-parse";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // 1. Convert File to ArrayBuffer, then to Buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // 2. Parse the PDF
    const data = await pdf(buffer);
    const rawText = data.text;

    // 3. Simple JS Cleaning (The "Broom")
    const cleanText = rawText
      .replace(/\s+/g, " ") // Replace multiple spaces/newlines with a single space
      .trim();

    return NextResponse.json({ text: cleanText });
  } catch (error) {
    console.error("Parsing Error:", error);
    return NextResponse.json({ error: "Failed to parse PDF" }, { status: 500 });
  }
}