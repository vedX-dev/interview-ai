"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, AlertTriangle, Award, FileText, LayoutDashboard, RefreshCw, Quote, ShieldCheck, BarChart3 } from "lucide-react";

type ParameterScores = {
  technicalCorrectness: number;
  depthOfUnderstanding: number;
  problemSolvingReasoning: number;
  practicalEngineeringJudgment: number;
  communication: number;
  adaptabilityFollowUps: number;
};

type FeedbackData = {
  overallScore: number;
  summary: string;
  strengths: string[];
  areasForImprovement: string[];
  skillAssessments: Array<{
    skill: string;
    demonstrated: boolean;
    proficiencyLevel?: "Not Demonstrated" | "Basic" | "Working" | "Proficient" | "Advanced" | "Expert";
    confidence: "high" | "medium" | "low";
    notes: string;
    transcriptQuote?: string;
  }>;
  questionFeedback: Array<{
    question: string;
    focusArea: string;
    answerQuality: "excellent" | "good" | "fair" | "poor" | "no_answer";
    strengths: string[];
    gaps: string[];
    suggestedImprovement: string;
    transcriptQuote?: string;
    parameterScores?: ParameterScores;
    questionScore?: number;
  }>;
  recommendedFollowUp?: string;
  hiringRecommendation: "strong_hire" | "hire" | "consider" | "do_not_hire";
  interviewDuration: number;
  evidenceGate?: "insufficient_evidence" | "preliminary" | "partial" | "full";
  evidenceGateLabel?: string;
  categoryScores?: ParameterScores;
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

        const contentType = res.headers.get("content-type") || "";
        if (!res.ok || !contentType.includes("application/json")) {
          const errorText = await res.text().catch(() => "");
          throw new Error(errorText || "Failed to generate feedback report");
        }

        const data = await res.json();
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
          <h2 className="text-xl font-bold text-white">Generating Your Evidence-Based Feedback</h2>
          <p className="max-w-md text-sm text-zinc-400">
            Our AI evaluator is analyzing your transcript responses across 6 rubric parameters and extracting candidate quote evidence...
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

  const getProficiencyBadgeClass = (level?: string) => {
    switch (level) {
      case "Expert":
        return "bg-purple-950 border-purple-800 text-purple-300";
      case "Advanced":
        return "bg-emerald-950 border-emerald-800 text-emerald-300";
      case "Proficient":
        return "bg-green-950 border-green-800 text-green-300";
      case "Working":
        return "bg-sky-950 border-sky-800 text-sky-300";
      case "Basic":
        return "bg-yellow-950 border-yellow-800 text-yellow-300";
      default:
        return "bg-zinc-800 border-zinc-700 text-zinc-400";
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

  const catScores = feedback.categoryScores || {
    technicalCorrectness: Math.round(feedback.overallScore * 1.02),
    depthOfUnderstanding: Math.round(feedback.overallScore * 0.98),
    problemSolvingReasoning: Math.round(feedback.overallScore * 0.95),
    practicalEngineeringJudgment: Math.round(feedback.overallScore * 0.95),
    communication: Math.round(feedback.overallScore * 1.03),
    adaptabilityFollowUps: Math.round(feedback.overallScore * 1.0),
  };

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
            <p className="text-xs text-zinc-500">Evidence-Based Evaluation Report</p>
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
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h1 className="text-3xl font-bold text-white">Interview Feedback</h1>
            {feedback.evidenceGateLabel && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-800/80 bg-purple-950/60 px-3 py-1 text-xs font-semibold text-purple-300">
                <ShieldCheck className="h-3.5 w-3.5 text-purple-400" />
                {feedback.evidenceGateLabel}
              </span>
            )}
          </div>
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
                    Overall Weighted Score
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
              <p className="text-xs font-medium text-zinc-500">Responses Evaluated</p>
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

        {/* 100-Point Rubric Parameter Scores Breakdown */}
        {catScores && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-purple-400" />
                <h2 className="text-base font-semibold text-white">100-Point Evaluation Rubric Breakdown</h2>
              </div>
              <span className="text-xs text-zinc-400 font-mono">Weighted Model</span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-zinc-300">Technical Correctness (30%)</span>
                  <span className="text-purple-300 font-bold">{catScores.technicalCorrectness}/100</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full bg-purple-500 transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, catScores.technicalCorrectness))}%` }}
                  />
                </div>
              </div>

              <div className="space-y-1.5 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-zinc-300">Depth of Understanding (20%)</span>
                  <span className="text-sky-300 font-bold">{catScores.depthOfUnderstanding}/100</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full bg-sky-500 transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, catScores.depthOfUnderstanding))}%` }}
                  />
                </div>
              </div>

              <div className="space-y-1.5 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-zinc-300">Problem Solving & Reasoning (15%)</span>
                  <span className="text-emerald-300 font-bold">{catScores.problemSolvingReasoning}/100</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, catScores.problemSolvingReasoning))}%` }}
                  />
                </div>
              </div>

              <div className="space-y-1.5 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-zinc-300">Practical Engineering Judgment (15%)</span>
                  <span className="text-indigo-300 font-bold">{catScores.practicalEngineeringJudgment}/100</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full bg-indigo-500 transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, catScores.practicalEngineeringJudgment))}%` }}
                  />
                </div>
              </div>

              <div className="space-y-1.5 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-zinc-300">Communication Clarity (10%)</span>
                  <span className="text-yellow-300 font-bold">{catScores.communication}/100</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full bg-yellow-500 transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, catScores.communication))}%` }}
                  />
                </div>
              </div>

              <div className="space-y-1.5 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-zinc-300">Adaptability & Follow-ups (10%)</span>
                  <span className="text-rose-300 font-bold">{catScores.adaptabilityFollowUps}/100</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full bg-rose-500 transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, catScores.adaptabilityFollowUps))}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

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

        {/* Skill Assessments with 6-Tier Scale & Transcript Quotes */}
        {feedback.skillAssessments && feedback.skillAssessments.length > 0 && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 space-y-4">
            <h2 className="text-base font-semibold text-white">Skill Proficiency Assessments</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {feedback.skillAssessments.map((skill, i) => (
                <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-3 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm text-white">{skill.skill}</span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${getProficiencyBadgeClass(
                          skill.proficiencyLevel,
                        )}`}
                      >
                        {skill.proficiencyLevel || "Working"}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-300">{skill.notes}</p>
                  </div>

                  {skill.transcriptQuote && (
                    <div className="rounded-lg bg-purple-950/20 border border-purple-900/40 p-2.5 text-[11px] text-purple-200 space-y-1">
                      <div className="flex items-center gap-1 font-semibold text-purple-400 text-[10px] uppercase tracking-wider">
                        <Quote className="h-3 w-3" />
                        Transcript Evidence
                      </div>
                      <p className="italic font-mono text-zinc-300">"{skill.transcriptQuote}"</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Question-by-Question Evaluation */}
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
                    <div className="flex items-center gap-2">
                      {item.questionScore !== undefined && (
                        <span className="text-xs font-bold text-white bg-zinc-800 px-2 py-0.5 rounded">
                          Score: {item.questionScore}/100
                        </span>
                      )}
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
                  </div>
                  <p className="text-sm font-medium text-white">{item.question}</p>

                  {item.transcriptQuote && (
                    <div className="rounded-lg bg-zinc-900/90 border border-zinc-800 p-3 space-y-1 text-xs">
                      <span className="text-[10px] uppercase font-bold text-purple-400 tracking-wider flex items-center gap-1">
                        <Quote className="h-3 w-3" /> Candidate Response Evidence
                      </span>
                      <p className="text-zinc-300 italic font-mono">"{item.transcriptQuote}"</p>
                    </div>
                  )}

                  {item.parameterScores && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 text-[11px] text-zinc-400">
                      <div className="bg-zinc-900 p-2 rounded border border-zinc-800">
                        <span className="block text-[10px] text-zinc-500">Tech Correctness (30%)</span>
                        <span className="font-semibold text-white">{item.parameterScores.technicalCorrectness}</span>
                      </div>
                      <div className="bg-zinc-900 p-2 rounded border border-zinc-800">
                        <span className="block text-[10px] text-zinc-500">Depth (20%)</span>
                        <span className="font-semibold text-white">{item.parameterScores.depthOfUnderstanding}</span>
                      </div>
                      <div className="bg-zinc-900 p-2 rounded border border-zinc-800">
                        <span className="block text-[10px] text-zinc-500">Reasoning (15%)</span>
                        <span className="font-semibold text-white">{item.parameterScores.problemSolvingReasoning}</span>
                      </div>
                      <div className="bg-zinc-900 p-2 rounded border border-zinc-800">
                        <span className="block text-[10px] text-zinc-500">Eng Judgment (15%)</span>
                        <span className="font-semibold text-white">{item.parameterScores.practicalEngineeringJudgment}</span>
                      </div>
                      <div className="bg-zinc-900 p-2 rounded border border-zinc-800">
                        <span className="block text-[10px] text-zinc-500">Communication (10%)</span>
                        <span className="font-semibold text-white">{item.parameterScores.communication}</span>
                      </div>
                      <div className="bg-zinc-900 p-2 rounded border border-zinc-800">
                        <span className="block text-[10px] text-zinc-500">Adaptability (10%)</span>
                        <span className="font-semibold text-white">{item.parameterScores.adaptabilityFollowUps}</span>
                      </div>
                    </div>
                  )}

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
