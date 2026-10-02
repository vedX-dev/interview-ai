"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  ShieldAlert,
  Award,
  TrendingUp,
  FileText,
  Clock,
  Sparkles,
  ChevronDown,
  ChevronUp,
  LayoutDashboard,
  HelpCircle,
  Download,
} from "lucide-react";
import { generateFeedbackPdf } from "@/src/lib/pdf-export";

interface FeedbackData {
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
    answerQuality: "excellent" | "good" | "fair" | "poor" | "no_answer";
    strengths: string[];
    gaps: string[];
    suggestedImprovement?: string;
  }>;
  recommendedFollowUp?: string;
  hiringRecommendation: "strong_hire" | "hire" | "consider" | "do_not_hire";
  interviewDuration: number;
  integrityEvents?: Array<{
    type: string;
    timestamp: number;
    details?: string;
    durationMs?: number;
  }>;
}

interface TranscriptChunk {
  id: string;
  speaker: "user" | "ai";
  content: string;
  createdAt?: string;
}

export default function InterviewFeedbackPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const interviewId = params.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackData | null>(null);
  const [jobRole, setJobRole] = useState("Software Engineering");
  const [transcript, setTranscript] = useState<TranscriptChunk[]>([]);
  const [showTranscriptDrawer, setShowTranscriptDrawer] = useState(false);
  const [expandedQuestions, setExpandedQuestions] = useState<Record<number, boolean>>({});
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const handleDownloadPdf = () => {
    if (!feedback) return;
    setIsExportingPdf(true);
    try {
      generateFeedbackPdf(feedback, jobRole, interviewId || "session", transcript);
    } catch (err) {
      console.error("[PDF_EXPORT_ERROR]", err);
    } finally {
      setIsExportingPdf(false);
    }
  };

  useEffect(() => {
    if (!interviewId) return;

    let isMounted = true;
    let pollInterval: NodeJS.Timeout | null = null;
    let attempts = 0;

    async function fetchFeedback() {
      try {
        const res = await fetch(`/api/interviews/${interviewId}/feedback`);
        if (!res.ok) {
          // If 404, trigger generate
          const genRes = await fetch(`/api/interviews/${interviewId}/feedback/generate`, {
            method: "POST",
          });
          if (genRes.ok) {
            const genData = await genRes.json();
            if (isMounted) {
              setFeedback(genData);
              setLoading(false);
            }
            return;
          }
          throw new Error(`Failed to load report (Status ${res.status})`);
        }

        const data = await res.json();
        if (data.feedback && data.feedback.overallScore !== undefined) {
          if (isMounted) {
            setFeedback(data.feedback);
            if (data.interview?.jobRole) setJobRole(data.interview.jobRole);
            setLoading(false);
          }
          if (pollInterval) clearInterval(pollInterval);
        } else {
          // Polling if still generating
          attempts++;
          if (attempts > 12) {
            if (isMounted) {
              setError("Report generation took longer than expected. Please refresh.");
              setLoading(false);
            }
            if (pollInterval) clearInterval(pollInterval);
          }
        }
      } catch (err: any) {
        console.error("[FEEDBACK_PAGE_ERROR]", err);
        if (isMounted && attempts >= 3) {
          setError(err.message || "Failed to load feedback report");
          setLoading(false);
        }
      }
    }

    fetchFeedback();
    pollInterval = setInterval(fetchFeedback, 2500);

    // Also fetch transcript for secondary drawer
    fetch(`/api/interviews/transcript?interviewId=${interviewId}`)
      .then((r) => r.json())
      .then((tData) => {
        if (isMounted && tData.chunks) {
          setTranscript(tData.chunks);
        }
      })
      .catch(() => { });

    return () => {
      isMounted = false;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [interviewId]);

  const toggleQuestion = (idx: number) => {
    setExpandedQuestions((prev) => ({
      ...prev,
      [idx]: !prev[idx],
    }));
  };

  const getScoreColor = (score: number) => {
    if (score >= 85) return "text-emerald-400 border-emerald-500/40 bg-emerald-950/20";
    if (score >= 70) return "text-green-400 border-green-500/40 bg-green-950/20";
    if (score >= 50) return "text-amber-400 border-amber-500/40 bg-amber-950/20";
    return "text-rose-400 border-rose-500/40 bg-rose-950/20";
  };

  const getRecommendationBadge = (rec: string) => {
    switch (rec) {
      case "strong_hire":
        return { label: "STRONG HIRE", bg: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" };
      case "hire":
        return { label: "HIRE", bg: "bg-green-500/20 text-green-300 border-green-500/40" };
      case "consider":
        return { label: "CONSIDER", bg: "bg-amber-500/20 text-amber-300 border-amber-500/40" };
      default:
        return { label: "DO NOT HIRE", bg: "bg-rose-500/20 text-rose-300 border-rose-500/40" };
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-zinc-100 flex flex-col items-center justify-center p-6 select-none">
        <div className="max-w-md w-full bg-zinc-900/90 border border-zinc-800 rounded-2xl p-8 text-center space-y-6 shadow-2xl backdrop-blur-md">
          <div className="relative mx-auto w-16 h-16 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border-4 border-purple-500/20 border-t-purple-500 animate-spin" />
            <Sparkles className="w-7 h-7 text-purple-400 animate-pulse" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-white tracking-tight">Generating Performance Report...</h2>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Synthesizing your technical responses, adaptive depth progression, and grounded citations across all covered topics.
            </p>
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
            <div className="bg-gradient-to-r from-purple-500 to-indigo-500 h-full w-2/3 animate-pulse" />
          </div>
          <p className="text-[11px] text-zinc-500 font-mono">Session ID: {interviewId?.slice(0, 8)}…</p>
        </div>
      </div>
    );
  }

  if (error || !feedback) {
    return (
      <div className="min-h-screen bg-black text-zinc-100 flex flex-col items-center justify-center p-6 select-none">
        <div className="max-w-md w-full bg-zinc-900 border border-rose-900/50 rounded-2xl p-8 text-center space-y-6 shadow-2xl">
          <div className="w-14 h-14 rounded-full bg-rose-950/60 border border-rose-800/50 flex items-center justify-center mx-auto text-rose-400">
            <AlertCircle size={28} />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-white">Report Generation Notice</h2>
            <p className="text-xs text-zinc-400">{error || "Could not retrieve feedback report."}</p>
          </div>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold transition-colors"
            >
              Retry
            </button>
            <Link
              href="/dashboard"
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-semibold transition-colors inline-flex items-center gap-1.5"
            >
              <LayoutDashboard size={14} />
              <span>Back to Dashboard</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const recBadge = getRecommendationBadge(feedback.hiringRecommendation);

  return (
    <div className="min-h-screen bg-black text-zinc-100 font-sans selection:bg-purple-500 selection:text-white">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800 px-4 sm:px-8 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-semibold text-zinc-300 hover:text-white hover:border-zinc-700 transition-colors"
          >
            <ArrowLeft size={14} />
            <span>Dashboard</span>
          </Link>
          <div className="h-4 w-[1px] bg-zinc-800 hidden sm:block" />
          <div className="hidden sm:block">
            <h1 className="text-xs font-semibold text-white uppercase tracking-wider">{jobRole}</h1>
            <p className="text-[10px] text-zinc-500 font-mono">Interview Evaluation Report</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleDownloadPdf}
            disabled={isExportingPdf}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-xs font-bold text-emerald-300 hover:bg-emerald-600/30 hover:border-emerald-500/60 transition-all shadow-sm disabled:opacity-50 cursor-pointer"
          >
            <Download size={14} className="text-emerald-400" />
            <span>{isExportingPdf ? "Exporting PDF..." : "Download PDF"}</span>
          </button>
          <button
            onClick={() => setShowTranscriptDrawer(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-medium text-zinc-300 hover:text-white hover:border-zinc-700 transition-colors"
          >
            <FileText size={14} className="text-purple-400" />
            <span>View Transcript ({transcript.length})</span>
          </button>
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-xs font-bold text-white shadow-lg shadow-purple-600/20 transition-all"
          >
            <LayoutDashboard size={14} />
            <span>Dashboard</span>
          </Link>
        </div>
      </header>

      {/* Main Report Container */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Hero Score & Recommendation Banner */}
        <section className="bg-gradient-to-b from-zinc-900/90 to-zinc-950 border border-zinc-800 rounded-2xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

          <div className="flex flex-col md:flex-row items-center justify-between gap-6 relative z-10">
            {/* Score Ring / Number */}
            <div className="flex items-center gap-6">
              <div
                className={`w-28 h-28 sm:w-32 sm:h-32 rounded-2xl border-2 flex flex-col items-center justify-center p-2 shadow-inner ${getScoreColor(
                  feedback.overallScore,
                )}`}
              >
                <span className="text-3xl sm:text-4xl font-extrabold tracking-tight">{feedback.overallScore}</span>
                <span className="text-[11px] font-semibold uppercase tracking-wider opacity-80 mt-0.5">out of 100</span>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 rounded-full text-xs font-bold tracking-wider border ${recBadge.bg}`}>
                    {recBadge.label}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-zinc-400 bg-zinc-900 px-2.5 py-1 rounded-full border border-zinc-800">
                    <Clock size={12} className="text-zinc-500" />
                    <span>{feedback.interviewDuration || 15} mins duration</span>
                  </span>
                </div>
                <h2 className="text-lg sm:text-xl font-bold text-white">{jobRole} Technical Assessment</h2>
                <p className="text-xs text-zinc-400 max-w-xl leading-relaxed">
                  Evaluated with adaptive depth ladders, grounded transcript citations, and objective scoring.
                </p>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="w-full md:w-auto flex flex-col sm:flex-row items-center gap-3">
              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={isExportingPdf}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-emerald-600/20 cursor-pointer disabled:opacity-50"
              >
                <Download size={16} />
                <span>{isExportingPdf ? "Generating PDF..." : "Download PDF Report"}</span>
              </button>
              <Link
                href="/dashboard"
                className="w-full sm:w-auto px-6 py-3 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 rounded-xl text-xs font-bold transition-all text-center shadow-md"
              >
                Dashboard
              </Link>
            </div>
          </div>
        </section>

        {/* Executive Summary */}
        <section className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Sparkles size={16} className="text-purple-400" />
            <h3>Executive Summary</h3>
          </div>
          <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">{feedback.summary}</p>
        </section>

        {/* Strengths & Areas for Improvement (2 Columns) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Strengths */}
          <section className="bg-zinc-900/50 border border-emerald-900/30 rounded-2xl p-6 space-y-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-bold text-emerald-400">
              <CheckCircle2 size={18} />
              <h3>Demonstrated Strengths</h3>
            </div>
            {feedback.strengths.length > 0 ? (
              <ul className="space-y-2.5">
                {feedback.strengths.map((str, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-xs text-zinc-300 leading-relaxed">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                    <span>{str}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-zinc-500 italic">No specific strengths recorded.</p>
            )}
          </section>

          {/* Areas for Improvement */}
          <section className="bg-zinc-900/50 border border-amber-900/30 rounded-2xl p-6 space-y-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-bold text-amber-400">
              <TrendingUp size={18} />
              <h3>Areas for Growth & Gaps</h3>
            </div>
            {feedback.areasForImprovement.length > 0 ? (
              <ul className="space-y-2.5">
                {feedback.areasForImprovement.map((gap, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-xs text-zinc-300 leading-relaxed">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                    <span>{gap}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-zinc-500 italic">No major gaps identified.</p>
            )}
          </section>
        </div>

        {/* Skill Assessments Breakdown */}
        {feedback.skillAssessments && feedback.skillAssessments.length > 0 && (
          <section className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Award size={18} className="text-purple-400" />
              <h3>Topic & Skill Proficiency Breakdown</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {feedback.skillAssessments.map((skill, i) => (
                <div key={i} className="bg-zinc-950/80 border border-zinc-800/80 rounded-xl p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-200">{skill.skill}</span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border ${skill.confidence === "high"
                          ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                          : skill.confidence === "medium"
                            ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                            : "bg-zinc-800 text-zinc-400 border-zinc-700"
                        }`}
                    >
                      {skill.confidence} Conf.
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">{skill.notes}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Question-by-Question Diagnostic */}
        {feedback.questionFeedback && feedback.questionFeedback.length > 0 && (
          <section className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <HelpCircle size={18} className="text-purple-400" />
                <h3>Question-by-Question Evaluation ({feedback.questionFeedback.length} Questions)</h3>
              </div>
              <span className="text-[11px] text-zinc-500 font-mono">Grounded Per-Turn Analysis</span>
            </div>

            <div className="space-y-3">
              {feedback.questionFeedback.map((q, idx) => {
                const isExpanded = expandedQuestions[idx] ?? false;
                const qualityColor =
                  q.answerQuality === "excellent"
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                    : q.answerQuality === "good"
                      ? "bg-green-500/20 text-green-300 border-green-500/30"
                      : q.answerQuality === "fair"
                        ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                        : "bg-rose-500/20 text-rose-300 border-rose-500/30";

                return (
                  <div key={idx} className="bg-zinc-950 border border-zinc-800/80 rounded-xl overflow-hidden transition-all">
                    <button
                      type="button"
                      onClick={() => toggleQuestion(idx)}
                      className="w-full text-left p-4 flex items-center justify-between gap-4 hover:bg-zinc-900/50 transition-colors"
                    >
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-purple-400 font-semibold uppercase px-2 py-0.5 rounded bg-purple-950/40 border border-purple-800/40">
                            {q.focusArea || `Topic ${idx + 1}`}
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border ${qualityColor}`}>
                            {q.answerQuality.replace("_", " ")}
                          </span>
                        </div>
                        <p className="text-xs font-medium text-zinc-200">{q.question}</p>
                      </div>
                      <div className="text-zinc-500">
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="p-4 pt-0 border-t border-zinc-800/60 space-y-3 bg-zinc-900/30">
                        {q.strengths && q.strengths.length > 0 && (
                          <div className="space-y-1">
                            <span className="text-[11px] font-bold text-emerald-400">Strengths:</span>
                            <ul className="space-y-1 pl-3">
                              {q.strengths.map((st, si) => (
                                <li key={si} className="text-[11px] text-zinc-300 list-disc">
                                  {st}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {q.gaps && q.gaps.length > 0 && (
                          <div className="space-y-1">
                            <span className="text-[11px] font-bold text-amber-400">Gaps & Observations:</span>
                            <ul className="space-y-1 pl-3">
                              {q.gaps.map((gp, gi) => (
                                <li key={gi} className="text-[11px] text-zinc-300 list-disc">
                                  {gp}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {q.suggestedImprovement && (
                          <div className="bg-purple-950/30 border border-purple-800/30 p-2.5 rounded-lg">
                            <span className="text-[10px] font-bold text-purple-300 uppercase">Suggested Growth:</span>
                            <p className="text-xs text-zinc-300 mt-0.5">{q.suggestedImprovement}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Integrity Signals Card */}
        <section className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <ShieldCheck size={18} className="text-purple-400" />
              <h3>Integrity & Proctoring Signals</h3>
            </div>
            <span className="text-[11px] text-zinc-500 font-mono">Advisory Context</span>
          </div>

          {feedback.integrityEvents && feedback.integrityEvents.length > 0 ? (
            <div className="space-y-2">
              <div className="bg-amber-950/20 border border-amber-800/40 p-3 rounded-xl flex items-center gap-2.5 text-xs text-amber-300">
                <ShieldAlert size={16} className="text-amber-400 shrink-0" />
                <span>
                  {feedback.integrityEvents.length} advisory proctoring event(s) logged during this session for human reviewer reference.
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {feedback.integrityEvents.map((ev, i) => (
                  <div key={i} className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800 text-[11px] flex justify-between items-center">
                    <span className="font-semibold text-zinc-300 uppercase tracking-wide">{ev.type.replace("_", " ")}</span>
                    <span className="text-zinc-500 font-mono">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-800/30 flex items-center gap-2 text-xs text-emerald-400 font-medium">
              <CheckCircle2 size={16} />
              <span>Clean Session: No proctoring anomalies were recorded.</span>
            </div>
          )}
        </section>

        {/* Bottom Navigation CTA */}
        <div className="pt-4 pb-12 flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={isExportingPdf}
            className="flex items-center gap-2 px-6 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-lg shadow-emerald-600/30 transition-all text-sm cursor-pointer disabled:opacity-50"
          >
            <Download size={18} />
            <span>{isExportingPdf ? "Generating PDF..." : "Download PDF Report"}</span>
          </button>
          <Link
            href="/dashboard"
            className="flex items-center gap-2 px-6 py-3.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold rounded-xl shadow-md border border-zinc-700 transition-all text-sm"
          >
            <LayoutDashboard size={18} />
            <span>Back to Dashboard</span>
          </Link>
        </div>
      </main>

      {/* Transcript Drawer Modal */}
      {showTranscriptDrawer && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-lg bg-zinc-900 border-l border-zinc-800 h-full flex flex-col p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <FileText size={18} className="text-purple-400" />
                <h3 className="text-sm font-bold text-white">Full Interview Transcript</h3>
              </div>
              <button
                onClick={() => setShowTranscriptDrawer(false)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 text-xs font-semibold"
              >
                ✕ Close
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-3">
              {transcript.map((chunk, i) => (
                <div
                  key={chunk.id || i}
                  className={`p-3 rounded-xl text-xs space-y-1 ${chunk.speaker === "ai"
                      ? "bg-purple-950/40 border border-purple-800/40 text-purple-100 mr-8"
                      : "bg-zinc-800/80 border border-zinc-700/60 text-zinc-100 ml-8"
                    }`}
                >
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block">
                    {chunk.speaker === "ai" ? "AI Interviewer" : "Candidate"}
                  </span>
                  <p className="leading-relaxed">{chunk.content}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
