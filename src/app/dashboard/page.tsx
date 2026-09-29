"use client";

import { ResumeUploadFlow } from "@/src/components/resume-upload-flow";

export default function Dashboard() {
  return (
    <main className="min-h-screen bg-black px-6 py-12 text-zinc-100 relative overflow-hidden">
      {/* Dynamic dark radial background gradients */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(139,92,246,0.12)_0%,_transparent_60%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_rgba(56,189,248,0.08)_0%,_transparent_50%)]" />

      <div className="relative z-10 mx-auto max-w-4xl space-y-8">
        <div className="space-y-2 text-center sm:text-left">
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-xs font-semibold text-violet-400">
            <span>InterviewAI Candidate Portal</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Start Technical Interview
          </h1>
          <p className="text-sm text-zinc-400 max-w-lg">
            Upload your resume or use our demo profile to customize your technical interview experience.
          </p>
        </div>

        {/* Resume Upload & Editable Confirmation Card Flow */}
        <ResumeUploadFlow />
      </div>
    </main>
  );
}
