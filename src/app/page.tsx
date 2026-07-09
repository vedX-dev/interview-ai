"use client";

import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-black px-6 py-16 text-zinc-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(139,92,246,0.1)_0%,_transparent_60%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_rgba(56,189,248,0.05)_0%,_transparent_50%)]" />

      <div className="relative z-10 w-full max-w-2xl space-y-8 text-center">
        <div className="space-y-4">
          <h1 className="text-5xl font-bold tracking-tight text-white">
            InterviewAI
          </h1>
          <p className="mx-auto max-w-lg text-base leading-relaxed text-zinc-400">
            AI-powered technical interviews with real-time feedback
          </p>
        </div>

        <div className="space-y-4">
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="inline-flex items-center gap-3 rounded-lg bg-white px-8 py-4 text-base font-semibold text-black transition-all hover:bg-zinc-200"
          >
            Start Interview
          </button>

          <div className="flex items-center gap-4 text-sm text-zinc-500">
            <span>or</span>
            <button
              type="button"
              onClick={() => router.push("/sign-in")}
              className="text-zinc-400 hover:text-white underline"
            >
              Sign In
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
