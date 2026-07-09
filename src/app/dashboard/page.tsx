"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DUMMY_RESUME_ID } from "@/src/lib/default-interview-plan";

export default function Dashboard() {
  const router = useRouter();
  const [isLaunching, setIsLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLaunchInterview = async () => {
    if (isLaunching) return;

    setIsLaunching(true);
    setError(null);

    try {
      const response = await fetch("/api/interviews/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobRole: "Software Developer",
          resumeId: DUMMY_RESUME_ID,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "Failed to initialize interview");
        return;
      }

      router.push(`/interview/${data.id}/lobby`);
    } catch {
      setError("Network error while launching interview");
    } finally {
      setIsLaunching(false);
    }
  };

  return (
    <main className="min-h-screen bg-black px-6 py-16 text-zinc-100">
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="space-y-4">
          <h1 className="text-3xl font-bold text-white">Dashboard</h1>
          <p className="text-zinc-400">Start a new interview session</p>
        </div>

        <div className="border border-zinc-800 bg-zinc-900/50 rounded-xl p-8">
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-white mb-2">Software Developer Interview</h2>
              <p className="text-zinc-400 text-sm">
                Technical interview covering algorithms, data structures, and system design
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { label: "5 Questions", detail: "Technical + coding mix" },
                { label: "Live Transcript", detail: "Real-time conversation tracking" },
                { label: "AI Feedback", detail: "Automated performance analysis" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="border border-zinc-800 bg-zinc-900/50 rounded-lg px-4 py-3"
                >
                  <p className="text-sm font-medium text-zinc-200">{item.label}</p>
                  <p className="mt-1 text-xs text-zinc-500">{item.detail}</p>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={handleLaunchInterview}
              disabled={isLaunching}
              className="w-full rounded-lg bg-white px-8 py-4 text-base font-semibold text-black transition-all hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLaunching ? "Starting Interview..." : "Start Interview"}
            </button>

            {error && (
              <p role="alert" className="text-sm text-red-400">
                {error}
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
