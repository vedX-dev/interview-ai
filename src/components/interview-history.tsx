"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock, ArrowRight, History } from "lucide-react";

interface InterviewSummary {
  id: string;
  jobRole: string;
  status: "ongoing" | "completed" | "failed" | string;
  score: number | null;
  currentPhase: string;
  totalTurns: number | null;
  createdAt: string;
  feedback?: {
    overallScore?: number;
    hiringRecommendation?: string;
    summary?: string;
  };
}

export function InterviewHistory() {
  const [interviews, setInterviews] = useState<InterviewSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/interviews")
      .then((res) => res.json())
      .then((data) => {
        if (data.interviews && Array.isArray(data.interviews)) {
          setInterviews(data.interviews);
        }
      })
      .catch((err) => {
        console.warn("[INTERVIEW_HISTORY] Could not load history:", err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="glass-card rounded-2xl p-6 animate-pulse">
        <div className="h-5 bg-white/10 rounded w-48 mb-4" />
        <div className="space-y-3">
          <div className="h-16 bg-white/5 rounded-xl" />
          <div className="h-16 bg-white/5 rounded-xl" />
        </div>
      </div>
    );
  }

  if (interviews.length === 0) {
    return null;
  }

  return (
    <div className="glass-card rounded-2xl p-6 space-y-4 shadow-xl border border-white/10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-zinc-400" />
          <h2 className="text-base font-semibold text-white">Recent Interview Sessions</h2>
        </div>
        <span className="text-xs text-zinc-500 font-mono">Latest Activity</span>
      </div>

      <div className="space-y-3">
        {interviews.map((item) => {
          const score = item.feedback?.overallScore ?? item.score;
          const isCompleted = item.status === "completed" || item.currentPhase === "closed" || score !== null;
          const rec = item.feedback?.hiringRecommendation;

          return (
            <div
              key={item.id}
              className="bg-[#141417]/80 border border-white/10 hover:border-white/20 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all group"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-zinc-100 group-hover:text-white transition-colors">
                    {item.jobRole}
                  </h3>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-full uppercase border ${
                      isCompleted
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                        : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                    }`}
                  >
                    {isCompleted ? "Completed" : "In Progress"}
                  </span>
                  {rec && (
                    <span className="text-[10px] font-mono text-zinc-400 bg-white/5 px-2 py-0.5 rounded border border-white/10">
                      {rec.replace("_", " ").toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-zinc-400">
                  <span className="flex items-center gap-1 text-[11px] text-zinc-500">
                    <Clock size={12} />
                    {new Date(item.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                  <span className="text-zinc-600">•</span>
                  <span className="text-[11px] text-zinc-500 font-mono">ID: {item.id.slice(0, 8)}…</span>
                </div>
              </div>

              <div className="flex items-center gap-4">
                {score !== null && score !== undefined && (
                  <div className="text-right">
                    <div className="text-xs text-zinc-400 font-medium">Score</div>
                    <div className="text-lg font-bold text-[#2b66f6]">
                      {score}/100
                    </div>
                  </div>
                )}

                <Link
                  href={isCompleted ? `/interview/${item.id}/feedback` : `/interview/${item.id}`}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all shadow-sm ${
                    isCompleted
                      ? "bg-[#2b66f6] hover:bg-[#1f52d4] text-white shadow-[0_0_15px_rgba(43,102,246,0.3)]"
                      : "bg-[#12151e] border border-[#232633] hover:bg-[#191d2a] text-zinc-200"
                  }`}
                >
                  <span>{isCompleted ? "View Report" : "Resume Interview"}</span>
                  <ArrowRight size={13} />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
