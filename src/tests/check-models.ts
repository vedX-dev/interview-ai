import "../lib/config";

async function checkModels() {
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  console.log("=== GROQ MODELS CHECK ===");
  if (groqKey) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { Authorization: `Bearer ${groqKey}` },
      });
      const data = await res.json();
      if (data.data) {
        console.log("Available Groq models:", data.data.map((m: any) => m.id));
      } else {
        console.log("Groq models response:", data);
      }
    } catch (e: any) {
      console.error("Groq models error:", e.message);
    }
  } else {
    console.log("GROQ_API_KEY missing");
  }

  console.log("\n=== GEMINI MODELS CHECK ===");
  if (geminiKey) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`);
      const data = await res.json();
      if (data.models) {
        const supported = data.models
          .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
          .map((m: any) => m.name.replace("models/", ""));
        console.log("Available Gemini models:", supported);
      } else {
        console.log("Gemini models response:", data);
      }
    } catch (e: any) {
      console.error("Gemini models error:", e.message);
    }
  } else {
    console.log("GEMINI_API_KEY missing");
  }
}

checkModels();
