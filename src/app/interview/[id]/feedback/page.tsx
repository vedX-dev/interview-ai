"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, AlertTriangle, Award, FileText, LayoutDashboard, RefreshCw } from "lucide-react";

type FeedbackData = {
  overallScore: number;
  summary: string;
  strengths: string[];
  areasForImprovement: string[];
  skillAssessments: Array<{
    skill: string;
    demonstrated: boolean;
    confidence: "high" | "medium" | "low";
    notes: string;
  }>;
  questionFeedback: Array<{
    question: string;
    focusArea: string;
    answerQuality: "excellent" | "good" | "fair" | "poor";
    strengths: string[];
    gaps: string[];
    suggestedImprovement: string;
  }>;
  recommendedFollowUp?: string;
  hiringRecommendation: "strong_hire" | "hire" | "consider" | "do_not_hire";
  interviewDuration: number;
};

type InterviewRecord = {
  id: string;
  jobRole: string;
  status: string;
  currentPhase: string;
  createdAt: string | Date | null;
  feedback: FeedbackData | null;
};

export default function InterviewFeedbackPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const interviewId = params.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [interview, setInterview] = useState<InterviewRecord | null>(null);
  const [feedback, setFeedback] = useState<FeedbackData | null>(null);
  const [totalQuestionsAnswered, setTotalQuestionsAnswered] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    if (!interviewId) return;

    async function loadFeedbackData() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/interviews/transcript?interviewId=${interviewId}`);
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "Failed to load interview feedback");
        }

        const data = await response.json();
        const interviewRec = data.interview as InterviewRecord;
        const chunks = data.chunks || [];

        setInterview(interviewRec);

        // Calculate answered questions count from user transcript chunks
        const userChunksCount = chunks.filter((c: any) => c.speaker === "user").length;
        setTotalQuestionsAnswered(userChunksCount);

        if (interviewRec.feedback) {
          setFeedback(interviewRec.feedback);
          setLoading(false);
        } else {
          // Trigger feedback generation if not yet saved
          await generateFeedbackReport();
        }
      } catch (err: any) {
        console.error("[FEEDBACK PAGE ERROR]", err);
        setError(err.message || "An error occurred while loading feedback");
        setLoading(false);
      }
    }

    async function generateFeedbackReport() {
      setIsGenerating(true);
      try {
        const res = await fetch(`/api/interviews/${interviewId}/feedback/generate`, {
          method: "POST",
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to generate feedback report");
        }

        setFeedback(data);
      } catch (err: any) {
        console.error("[FEEDBACK GENERATION ERROR]", err);
        setError(err.message || "Failed to generate feedback");
      } finally {
        setIsGenerating(false);
        setLoading(false);
      }
    }

    loadFeedbackData();
  }, [interviewId]);

  if (loading || isGenerating) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-black p-6 text-zinc-100">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="h-14 w-14 animate-spin rounded-full border-4 border-purple-500/30 border-t-purple-500" />
          <h2 className="text-xl font-bold text-white">Generating Your Feedback</h2>
          <p className="max-w-md text-sm text-zinc-400">
            Our AI is analyzing your interview responses and creating a detailed evaluation report...
          </p>
          <div className="mt-2 h-1.5 w-48 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full animate-pulse bg-gradient-to-r from-purple-500 to-sky-500" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !feedback) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-black p-6 text-zinc-100">
        <div className="max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/80 p-8 text-center space-y-4">
          <AlertTriangle className="mx-auto h-12 w-12 text-yellow-500" />
          <h2 className="text-xl font-bold text-white">Feedback Unavailable</h2>
          <p className="text-sm text-zinc-400">{error || "Could not load evaluation report."}</p>
          <div className="flex gap-3 justify-center pt-2">
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
            >
              <RefreshCw className="h-4 w-4" />
              Try Again
            </button>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500"
            >
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const getScoreColor = (score: number) => {
    if (score >= 85) return "text-emerald-400 stroke-emerald-400";
    if (score >= 70) return "text-green-400 stroke-green-400";
    if (score >= 55) return "text-yellow-400 stroke-yellow-400";
    return "text-red-400 stroke-red-400";
  };

  const getHiringBadge = (recommendation: string, totalAnswered: number) => {
    if (totalAnswered === 0 || feedback?.overallScore === 0) {
      return { label: "Incomplete — Insufficient Evidence", bg: "bg-amber-950/80 border-amber-800 text-amber-300" };
    }
    switch (recommendation) {
      case "strong_hire":
        return { label: "Strong Hire", bg: "bg-emerald-950/80 border-emerald-800 text-emerald-300" };
      case "hire":
        return { label: "Hire", bg: "bg-green-950/80 border-green-800 text-green-300" };
      case "consider":
        return { label: "Consider", bg: "bg-yellow-950/80 border-yellow-800 text-yellow-300" };
      default:
        return { label: "Do Not Hire", bg: "bg-red-950/80 border-red-800 text-red-300" };
    }
  };

  const hiringBadge = getHiringBadge(feedback.hiringRecommendation, totalQuestionsAnswered);
  const formattedDate = interview?.createdAt
    ? new Date(interview.createdAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Recently";

  return (
    <div className="min-h-screen bg-black text-zinc-100 pb-16">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-zinc-800 bg-black/80 px-6 py-4 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-600 text-white font-bold">
            AI
          </div>
          <div>
            <h1 className="text-base font-semibold text-white">InterviewAI</h1>
            <p className="text-xs text-zinc-500">Practice · Improve · Get Hired</p>
          </div>
        </div>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
      </header>

      <main className="mx-auto max-w-4xl px-6 pt-8 space-y-8">
        {/* Title Header */}
        <div className="space-y-1">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white mb-2"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Dashboard
          </Link>
          <h1 className="text-3xl font-bold text-white">Interview Feedback</h1>
          <p className="text-sm text-zinc-400">
            {interview?.jobRole || "Software Developer"} ·{" "}
            <span className="text-emerald-400 font-medium">Completed</span>
          </p>
        </div>

        {/* Score & Key Metrics Section */}
        <div className="grid gap-6 md:grid-cols-3">
          {/* Main Score & Recommendation Card */}
          <div className="md:col-span-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-6">
              <div className="relative flex h-28 w-28 shrink-0 items-center justify-center">
                <svg className="h-full w-full -rotate-90" viewBox="0 0 36 36">
                  <path
                    className="stroke-zinc-800"
                    strokeWidth="3"
                    fill="none"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                  <path
                    className={getScoreColor(feedback.overallScore)}
                    strokeDasharray={`${feedback.overallScore || 0}, 100`}
                    strokeWidth="3"
                    strokeLinecap="round"
                    fill="none"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                </svg>
                <div className="absolute text-center">
                  <span className="text-3xl font-extrabold text-white">
                    {totalQuestionsAnswered === 0 || feedback.overallScore === 0 ? "N/A" : feedback.overallScore}
                  </span>
                  <span className="block text-[10px] text-zinc-500 uppercase tracking-widest font-semibold">
                    {totalQuestionsAnswered === 0 || feedback.overallScore === 0 ? "Score" : "/ 100"}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                    Overall Score
                  </span>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${hiringBadge.bg}`}
                >
                  <Award className="h-3.5 w-3.5" />
                  {hiringBadge.label}
                </span>
                <p className="text-xs text-zinc-300 leading-relaxed max-w-sm">
                  {feedback.summary}
                </p>
              </div>
            </div>
          </div>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-1 gap-3">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <p className="text-xs font-medium text-zinc-500">Responses Completed</p>
              <p className="mt-1 text-2xl font-bold text-white">{totalQuestionsAnswered}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <p className="text-xs font-medium text-zinc-500">Duration</p>
              <p className="mt-1 text-2xl font-bold text-white">
                {feedback.interviewDuration || 1} min
              </p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <p className="text-xs font-medium text-zinc-500">Date Completed</p>
              <p className="mt-1 text-sm font-semibold text-zinc-300">{formattedDate}</p>
            </div>
          </div>
        </div>

        {/* Key Strengths & Areas for Improvement */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Key Strengths */}
          <div className="rounded-2xl border border-emerald-900/40 bg-emerald-950/10 p-6 space-y-4">
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="h-5 w-5" />
              <h2 className="text-base font-semibold">Key Strengths</h2>
            </div>
            {feedback.strengths && feedback.strengths.length > 0 ? (
              <ul className="space-y-2.5 text-sm text-zinc-300">
                {feedback.strengths.map((item, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">No specific strengths logged.</p>
            )}
          </div>

          {/* Areas for Improvement */}
          <div className="rounded-2xl border border-amber-900/40 bg-amber-950/10 p-6 space-y-4">
            <div className="flex items-center gap-2 text-amber-400">
              <AlertTriangle className="h-5 w-5" />
              <h2 className="text-base font-semibold">Areas for Improvement</h2>
            </div>
            {feedback.areasForImprovement && feedback.areasForImprovement.length > 0 ? (
              <ul className="space-y-2.5 text-sm text-zinc-300">
                {feedback.areasForImprovement.map((item, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">No areas for improvement logged.</p>
            )}
          </div>
        </div>

        {/* Skill Assessments */}
        {feedback.skillAssessments && feedback.skillAssessments.length > 0 && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 space-y-4">
            <h2 className="text-base font-semibold text-white">Skill Assessments</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {feedback.skillAssessments.map((skill, i) => (
                <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm text-white">{skill.skill}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        skill.confidence === "high"
                          ? "bg-emerald-950 border border-emerald-800 text-emerald-300"
                          : skill.confidence === "medium"
                          ? "bg-yellow-950 border border-yellow-800 text-yellow-300"
                          : "bg-red-950 border border-red-800 text-red-300"
                      }`}
                    >
                      {skill.confidence} confidence
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400">{skill.notes}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Question-by-Question Breakdown */}
        {feedback.questionFeedback && feedback.questionFeedback.length > 0 && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 space-y-6">
            <h2 className="text-base font-semibold text-white">Question-by-Question Evaluation</h2>
            <div className="space-y-4">
              {feedback.questionFeedback.map((item, i) => (
                <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5 space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs font-semibold uppercase tracking-wider text-purple-400">
                      {item.focusArea || `Question ${i + 1}`}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        item.answerQuality === "excellent"
                          ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                          : item.answerQuality === "good"
                          ? "bg-green-950 text-green-300 border border-green-800"
                          : item.answerQuality === "fair"
                          ? "bg-yellow-950 text-yellow-300 border border-yellow-800"
                          : "bg-red-950 text-red-300 border border-red-800"
                      }`}
                    >
                      {item.answerQuality}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-white">{item.question}</p>

                  {item.strengths && item.strengths.length > 0 && (
                    <div className="text-xs space-y-1">
                      <span className="font-semibold text-emerald-400">Strengths:</span>
                      <ul className="list-disc list-inside text-zinc-400 pl-1">
                        {item.strengths.map((s, j) => (
                          <li key={j}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {item.gaps && item.gaps.length > 0 && (
                    <div className="text-xs space-y-1">
                      <span className="font-semibold text-amber-400">Gaps:</span>
                      <ul className="list-disc list-inside text-zinc-400 pl-1">
                        {item.gaps.map((g, j) => (
                          <li key={j}>{g}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {item.suggestedImprovement && (
                    <div className="rounded-lg bg-zinc-900 p-3 text-xs text-zinc-300 border border-zinc-800">
                      <span className="font-semibold text-purple-300">Suggestion: </span>
                      {item.suggestedImprovement}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recommended Follow-up */}
        {feedback.recommendedFollowUp && (
          <div className="rounded-2xl border border-purple-900/40 bg-purple-950/20 p-6 space-y-2">
            <h2 className="text-sm font-semibold text-purple-300">Recommended Follow-Up Steps</h2>
            <p className="text-sm text-zinc-300 leading-relaxed">{feedback.recommendedFollowUp}</p>
          </div>
        )}

        {/* Bottom Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-zinc-800">
          <button
            onClick={() => window.print()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl border border-purple-800/60 bg-purple-950/40 px-6 py-3 text-sm font-semibold text-purple-300 hover:bg-purple-900/60 hover:text-white transition-colors"
          >
            <FileText className="h-4 w-4" />
            Download / Print Report
          </button>

          <Link
            href="/dashboard"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-black hover:bg-zinc-200 transition-colors"
          >
            <LayoutDashboard className="h-4 w-4" />
            Back to Dashboard
          </Link>
        </div>
      </main>
    </div>
  );
}
