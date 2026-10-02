"use client";

import { ResumeUploadFlow } from "@/src/components/resume-upload-flow";
import { InterviewHistory } from "@/src/components/interview-history";

export default function Dashboard() {
  return (
    <main className="min-h-screen bg-[#09090b] px-6 pt-28 pb-16 text-[#fafafa] relative overflow-hidden">
      {/* Subtle monochrome ambient glow */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(255,255,255,0.04)_0%,_transparent_60%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_rgba(255,255,255,0.02)_0%,_transparent_50%)]" />

      <div className="relative z-10 mx-auto max-w-4xl space-y-10">
        <div className="space-y-2 text-center sm:text-left">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-mono tracking-wider text-zinc-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>INTERVIA CANDIDATE PORTAL</span>
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

        {/* Candidate Past Interview History & Performance Reports */}
        <InterviewHistory />
      </div>
    </main>
  );
}
