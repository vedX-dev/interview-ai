import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

function getAuthHeader(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.startsWith("Basic ") || trimmed.startsWith("Bearer ")) {
    return trimmed;
  }
  // D-ID API expects HTTP Basic Auth: base64(key + ":") or base64(username + ":" + password)
  if (trimmed.includes(":")) {
    const encoded = Buffer.from(trimmed).toString("base64");
    return `Basic ${encoded}`;
  }
  const encoded = Buffer.from(`${trimmed}:`).toString("base64");
  return `Basic ${encoded}`;
}

// POST /api/d-id/clip - Create a D-ID presenter clip video
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const apiKey = process.env.D_ID_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "D_ID_API_KEY is not configured on server (.env.local missing D_ID_API_KEY)" },
        { status: 503 },
      );
    }

    const body = await req.json();
    const { text, presenterId, voiceId } = body;

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Text script parameter is required" },
        { status: 400 },
      );
    }

    const presenter = presenterId || process.env.D_ID_AGENT_ID || "v2_agt_u7SXmJRa";
    const voice = voiceId || "en-US-JennyNeural";

    console.log(`[D-ID API] Creating clip with presenter: ${presenter}, voice: ${voice}`);

    const response = await fetch("https://api.d-id.com/clips", {
      method: "POST",
      headers: {
        "Authorization": getAuthHeader(apiKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        presenter_id: presenter,
        script: {
          type: "text",
          input: text,
          provider: {
            type: "microsoft",
            voice_id: voice,
          },
        },
        config: {
          result_format: "mp4",
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[D-ID API] Clip creation failed (${response.status}):`, errText);
      return NextResponse.json(
        { error: `D-ID API returned ${response.status}: ${errText}` },
        { status: response.status },
      );
    }

    const data = await response.json();
    console.log("[D-ID API] Clip created successfully:", data);
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("🔥 Error in D-ID clip POST route:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}

// GET /api/d-id/clip?id=clp_abc123 - Poll D-ID presenter clip status
export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const apiKey = process.env.D_ID_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "D_ID_API_KEY is not configured on server" },
        { status: 503 },
      );
    }

    const { searchParams } = new URL(req.url);
    const clipId = searchParams.get("id");

    if (!clipId) {
      return NextResponse.json(
        { error: "Clip ID parameter is required" },
        { status: 400 },
      );
    }

    const response = await fetch(`https://api.d-id.com/clips/${clipId}`, {
      method: "GET",
      headers: {
        "Authorization": getAuthHeader(apiKey),
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[D-ID API] Status check failed for ${clipId} (${response.status}):`, errText);
      return NextResponse.json(
        { error: `D-ID API returned ${response.status}: ${errText}` },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("🔥 Error in D-ID clip GET route:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
