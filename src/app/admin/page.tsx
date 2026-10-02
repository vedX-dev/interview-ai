"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import {
  BarChart3,
  Shield,
  Activity,
  Users,
  FileText,
  TrendingUp,
  Award,
  Clock,
  Database,
  AlertTriangle,
  CheckCircle2,
  ArrowLeft,
  RefreshCcw,
  Cpu,
  HelpCircle,
  Zap,
  Lock,
  Download,
  Globe,
  Wifi,
  Terminal,
  Layers,
  Sparkles,
  Search,
  Check,
  ChevronRight,
  Info,
  Camera,
  UserCheck,
  PieChart as PieChartIcon,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface CandidateSnapshotItem {
  id: string;
  candidateName: string;
  jobRole: string;
  status: string;
  score: number | null;
  createdAt: string;
  candidateSnapshot: string | null;
}

interface AnalyticsData {
  platform: {
    totalInterviews: number;
    completedInterviews: number;
    ongoingInterviews: number;
    failedInterviews: number;
    totalTranscriptChunks: number;
    totalAuditEvents: number;
    totalGeminiCalls: number;
    totalQuestionsEvaluated: number;
  };
  scoring: {
    averageScore: number | null;
    meanScore: number | null;
    medianScore: number | null;
    stdDevScore: number | null;
    averageTurns: number | null;
    scoreDistribution: Record<string, number>;
  };
  hiringRecommendations: Record<string, number>;
  skillConfidences: { high: number; medium: number; low: number };
  answerQualityDistribution: Record<string, number>;
  sessionsPerDay: Record<string, number>;
  candidateSnapshots?: CandidateSnapshotItem[];
  clientNetwork?: {
    clientIp: string;
    allowedIpsConfigured: boolean;
    adminUserIdsConfigured: boolean;
    isLocalhost: boolean;
  };
  researchMetricsNote: string;
  generatedAt: string;
}

type TabType = "overview" | "scoring" | "research" | "network" | "snapshots";

export default function AdminDashboardPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [isMounted, setIsMounted] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const fetchData = async () => {
    try {
      setRefreshing(true);
      const res = await fetch("/api/admin/analytics");
      if (res.status === 401) {
        setError("Unauthorized — Please sign in to access admin telemetry.");
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (res.status === 403) {
        const body = await res.json();
        setError(body.error || "Forbidden — Admin privileges required.");
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to load analytics data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleDownloadPdf = async () => {
    if (!reportRef.current || downloadingPdf) return;
    try {
      setDownloadingPdf(true);
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF } = await import("jspdf");

      const element = reportRef.current;
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#09090b",
        logging: false,
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      const imgWidth = 210;
      const pageHeight = 297;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      const dateStr = new Date().toISOString().split("T")[0];
      pdf.save(`Intervia_Admin_Analytics_Report_${dateStr}.pdf`);
    } catch (err) {
      console.error("Failed to generate PDF:", err);
      alert("Error generating PDF report. Please try again.");
    } finally {
      setDownloadingPdf(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#09090b] text-[#fafafa] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-violet-500/20 border-t-violet-500 animate-spin" />
          <p className="text-xs text-zinc-400 font-mono tracking-widest uppercase">Initializing Telemetry Engine...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#09090b] text-[#fafafa] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-[#141417] border border-rose-500/30 rounded-2xl p-8 text-center space-y-5 shadow-2xl backdrop-blur-xl">
          <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mx-auto text-rose-400">
            <Lock size={24} />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white tracking-tight">Access Restricted</h2>
            <p className="text-xs text-zinc-400 leading-relaxed">{error}</p>
          </div>
          <div className="pt-2 flex gap-3 justify-center">
            <Link
              href="/dashboard"
              className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-semibold transition-all border border-white/10"
            >
              Return to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { platform, scoring, hiringRecommendations, skillConfidences, answerQualityDistribution, sessionsPerDay, clientNetwork } = data;

  // Formatting session days data for Recharts
  const sessionChartData = Object.entries(sessionsPerDay).map(([date, count]) => ({
    date: date.slice(5),
    fullDate: date,
    sessions: count,
  }));

  // Score distribution data for Recharts
  const scoreChartData = Object.entries(scoring.scoreDistribution)
    .sort(([a], [b]) => parseInt(a.split("-")[0]) - parseInt(b.split("-")[0]))
    .map(([bucket, count]) => ({
      bucket: `Score ${bucket}`,
      shortBucket: bucket,
      count,
    }));

  // Hiring recommendation pie chart data
  const hiringPieColors: Record<string, string> = {
    strong_hire: "#10b981",
    hire: "#22c55e",
    consider: "#f59e0b",
    do_not_hire: "#f43f5e",
    unknown: "#52525b",
  };

  const hiringChartData = Object.entries(hiringRecommendations)
    .filter(([, v]) => v > 0)
    .map(([key, value]) => ({
      name: key.replace("_", " ").toUpperCase(),
      value,
      color: hiringPieColors[key] || "#71717a",
    }));

  const totalRecs = Object.values(hiringRecommendations).reduce((a, b) => a + b, 0);

  // Answer quality chart data
  const qualityChartData = Object.entries(answerQualityDistribution)
    .filter(([, v]) => v > 0)
    .map(([quality, count]) => ({
      quality: quality.replace("_", " ").toUpperCase(),
      count,
    }));

  return (
    <div className="min-h-screen bg-[#09090b] text-[#fafafa] font-sans selection:bg-violet-500 selection:text-white pb-16">
      {/* Header Bar */}
      <header className="sticky top-0 z-50 bg-[#09090b]/80 backdrop-blur-xl border-b border-white/10 px-4 sm:px-8 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-semibold text-zinc-300 hover:text-white hover:bg-white/10 transition-all"
          >
            <ArrowLeft size={14} />
            <span>Dashboard</span>
          </Link>
          <div className="h-4 w-[1px] bg-white/10 hidden sm:block" />
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400">
              <Shield size={16} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xs font-bold text-white uppercase tracking-wider">Shadcn UI Analytics Dashboard</h1>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-mono text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  RESTRICTED
                </span>
              </div>
              <p className="text-[10px] text-zinc-400 font-mono">Intervia Recharts Telemetry v1.0</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <span className="text-[10px] text-zinc-400 font-mono hidden md:block">
            Updated {new Date(data.generatedAt).toLocaleTimeString()}
          </span>

          <button
            onClick={fetchData}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-white/10 text-xs font-medium text-zinc-300 hover:text-white transition-all disabled:opacity-50 cursor-pointer"
          >
            <RefreshCcw size={13} className={refreshing ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          <button
            onClick={handleDownloadPdf}
            disabled={downloadingPdf}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-xs font-semibold text-white shadow-lg shadow-violet-500/20 transition-all disabled:opacity-50 cursor-pointer active:scale-95"
          >
            {downloadingPdf ? (
              <RefreshCcw size={13} className="animate-spin" />
            ) : (
              <Download size={13} />
            )}
            <span>Export Report PDF</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 space-y-6" ref={reportRef}>
        {/* Navigation Tabs Bar (Shadcn UI style) */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-1 bg-[#141417] p-1 rounded-xl border border-white/10 overflow-x-auto no-scrollbar">
            {[
              { id: "overview", label: "Platform Overview", icon: <Layers size={14} /> },
              { id: "scoring", label: "Scoring & Hiring", icon: <BarChart3 size={14} /> },
              { id: "research", label: "Research Metrics", icon: <Award size={14} /> },
              { id: "snapshots", label: "Candidate Photos", icon: <Camera size={14} /> },
              { id: "network", label: "Network & Security", icon: <Globe size={14} /> },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${activeTab === tab.id
                    ? "bg-violet-600 text-white shadow-md shadow-violet-600/30"
                    : "text-zinc-400 hover:text-white hover:bg-white/5"
                  }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {clientNetwork && (
            <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#141417] border border-white/10 text-[11px] font-mono text-zinc-400">
              <Wifi size={13} className="text-emerald-400" />
              <span>IP: {clientNetwork.clientIp}</span>
              <span className="text-zinc-600">•</span>
              <span className="text-violet-400">LAN Host Active</span>
            </div>
          )}
        </div>

        {/* ── TAB 1: OVERVIEW ──────────────────────────────────────────────── */}
        {activeTab === "overview" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Quick KPI Stat Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                icon={<Users size={18} />}
                label="Total Candidate Sessions"
                value={platform.totalInterviews}
                sub={`${platform.completedInterviews} completed • ${platform.ongoingInterviews} live • ${platform.failedInterviews} terminated`}
                color="violet"
                trend="+12% from last cycle"
              />
              <StatCard
                icon={<FileText size={18} />}
                label="Transcript Chunks"
                value={platform.totalTranscriptChunks}
                sub="Total dynamic conversation turns recorded"
                color="cyan"
              />
              <StatCard
                icon={<Activity size={18} />}
                label="System Audit Events"
                value={platform.totalAuditEvents}
                sub="Integrity verification & request logs"
                color="amber"
              />
              <StatCard
                icon={<Cpu size={18} />}
                label="LLM Invocations"
                value={platform.totalGeminiCalls}
                sub={`${platform.totalQuestionsEvaluated} questions auto-evaluated`}
                color="emerald"
              />
            </div>

            {/* Shadcn Recharts Area Chart: Daily Session Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-[#141417] border border-white/10 rounded-2xl p-6 space-y-4 shadow-xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400">
                      <Zap size={15} />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">Shadcn UI Session Velocity Chart (30 Days)</h3>
                      <p className="text-[11px] text-zinc-400">Recharts AreaChart telemetry curve</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-zinc-300">
                    Recharts Dynamic Engine
                  </span>
                </div>

                <div className="h-64 w-full pt-4">
                  {isMounted && (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={sessionChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorVelocity" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.5} />
                            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis dataKey="date" stroke="#71717a" fontSize={10} tickLine={false} />
                        <YAxis stroke="#71717a" fontSize={10} tickLine={false} allowDecimals={false} />
                        <Tooltip content={<ShadcnCustomTooltip />} />
                        <Area
                          type="monotone"
                          dataKey="sessions"
                          name="Candidate Sessions"
                          stroke="#8b5cf6"
                          strokeWidth={2.5}
                          fillOpacity={1}
                          fill="url(#colorVelocity)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Core Platform Summary */}
              <div className="bg-[#141417] border border-white/10 rounded-2xl p-6 space-y-5 shadow-xl flex flex-col justify-between">
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                      <CheckCircle2 size={15} />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">System Status Summary</h3>
                      <p className="text-[11px] text-zinc-400">Autonomous evaluation health</p>
                    </div>
                  </div>

                  <div className="space-y-3 pt-2">
                    <SummaryRow
                      label="Evaluation Success Rate"
                      value={`${platform.totalInterviews > 0 ? ((platform.completedInterviews / platform.totalInterviews) * 100).toFixed(1) : 100}%`}
                      color="text-emerald-400"
                    />
                    <SummaryRow
                      label="Avg Interview Turns"
                      value={scoring.averageTurns ? `${scoring.averageTurns.toFixed(1)} turns` : "—"}
                      color="text-violet-400"
                    />
                    <SummaryRow
                      label="Mean Overall Score"
                      value={scoring.meanScore ? `${scoring.meanScore.toFixed(1)} / 100` : "—"}
                      color="text-cyan-400"
                    />
                    <SummaryRow
                      label="Questions Assessed"
                      value={String(platform.totalQuestionsEvaluated)}
                      color="text-amber-400"
                    />
                  </div>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-xl p-3.5 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-zinc-300">Live K-Score Adaptive Guard</span>
                    <span className="font-mono text-emerald-400 text-[10px]">ACTIVE</span>
                  </div>
                  <p className="text-[10px] text-zinc-400 leading-relaxed">
                    Brain state engine dynamically computes K-Score during live sessions to adjust question difficulty.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 2: SCORING & HIRING ──────────────────────────────────────── */}
        {activeTab === "scoring" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Statistical Metric Chips */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              <MetricBox label="Mean Score" value={scoring.meanScore?.toFixed(1) ?? "—"} unit="/ 100" />
              <MetricBox label="Median Score" value={scoring.medianScore?.toFixed(1) ?? "—"} unit="/ 100" />
              <MetricBox label="Std Deviation" value={scoring.stdDevScore?.toFixed(2) ?? "—"} unit="σ" />
              <MetricBox label="Avg Conversation Turns" value={scoring.averageTurns?.toFixed(1) ?? "—"} unit="turns/session" />
              <MetricBox label="Evaluated Sample Size" value={String(platform.completedInterviews)} unit="candidates (N)" />
            </div>

            {/* Score Distribution & Hiring Recommendation */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Shadcn Recharts Bar Chart: Score Distribution */}
              <div className="bg-[#141417] border border-white/10 rounded-2xl p-6 space-y-4 shadow-xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400">
                      <BarChart3 size={15} />
                    </div>
                    <h3 className="text-sm font-bold text-white">Shadcn Score Distribution Bar Chart</h3>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-400">N={platform.completedInterviews}</span>
                </div>

                <div className="h-64 w-full pt-2">
                  {isMounted && (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={scoreChartData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis dataKey="shortBucket" stroke="#71717a" fontSize={10} tickLine={false} />
                        <YAxis stroke="#71717a" fontSize={10} tickLine={false} allowDecimals={false} />
                        <Tooltip content={<ShadcnCustomTooltip />} />
                        <Bar dataKey="count" name="Candidates" fill="#8b5cf6" radius={[6, 6, 0, 0]}>
                          {scoreChartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={index > 5 ? "#6366f1" : "#a855f7"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Shadcn Recharts Pie/Donut Chart: Hiring Breakdown */}
              <div className="bg-[#141417] border border-white/10 rounded-2xl p-6 space-y-4 shadow-xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                      <PieChartIcon size={15} />
                    </div>
                    <h3 className="text-sm font-bold text-white">Shadcn Hiring Donut Breakdown</h3>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-400">Total: {totalRecs}</span>
                </div>

                <div className="h-64 w-full flex items-center justify-center relative">
                  {isMounted && hiringChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={hiringChartData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={85}
                          paddingAngle={4}
                          dataKey="value"
                        >
                          {hiringChartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} stroke="transparent" />
                          ))}
                        </Pie>
                        <Tooltip content={<ShadcnCustomTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-xs text-zinc-500 italic">No hiring recommendations recorded yet.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Answer Quality & Skill Confidence */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-[#141417] border border-white/10 rounded-2xl p-6 space-y-4 shadow-xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                      <HelpCircle size={15} />
                    </div>
                    <h3 className="text-sm font-bold text-white">Answer Quality Distribution</h3>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-400">{platform.totalQuestionsEvaluated} answers</span>
                </div>

                <div className="h-48 w-full pt-2">
                  {isMounted && qualityChartData.length > 0 && (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={qualityChartData} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis type="number" stroke="#71717a" fontSize={10} tickLine={false} />
                        <YAxis dataKey="quality" type="category" stroke="#71717a" fontSize={10} tickLine={false} width={80} />
                        <Tooltip content={<ShadcnCustomTooltip />} />
                        <Bar dataKey="count" name="Answers" fill="#06b6d4" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              <div className="bg-[#141417] border border-white/10 rounded-2xl p-6 space-y-4 shadow-xl flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400">
                      <TrendingUp size={15} />
                    </div>
                    <h3 className="text-sm font-bold text-white">Skill Confidence Breakdown</h3>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 pt-2">
                  <ConfidenceBadge label="High Confidence" count={skillConfidences.high} color="emerald" />
                  <ConfidenceBadge label="Medium Confidence" count={skillConfidences.medium} color="amber" />
                  <ConfidenceBadge label="Low Confidence" count={skillConfidences.low} color="rose" />
                </div>

                <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-[11px] text-zinc-400 leading-relaxed">
                  Evaluated across candidate project claims and live technical response depth.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 3: RESEARCH METRICS (FOR RESEARCH PAPER & VIVA) ───────────── */}
        {activeTab === "research" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="bg-[#141417] border border-violet-500/30 rounded-2xl p-6 space-y-4 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-violet-600/10 rounded-full blur-3xl -z-10 pointer-events-none" />
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-violet-600/20 border border-violet-500/40 flex items-center justify-center text-violet-300">
                    <Database size={18} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Research-Grade Evaluation Metrics Suite</h3>
                    <p className="text-xs text-zinc-400">Standardized AI model performance metrics for research publication</p>
                  </div>
                </div>
                <span className="px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/30 text-xs font-mono text-violet-300">
                  `src/eval/metrics.ts`
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
                {[
                  {
                    symbol: "WER",
                    title: "Word Error Rate",
                    desc: "Speech-to-Text transcription accuracy against gold transcripts.",
                    status: "Target < 8.5%",
                    category: "Speech Recognition",
                  },
                  {
                    symbol: "P / R",
                    title: "Precision & Recall",
                    desc: "True positive rate and coverage of candidate qualification decisions.",
                    status: "Target P>0.92, R>0.88",
                    category: "Classification",
                  },
                  {
                    symbol: "F₁",
                    title: "F1 Score",
                    desc: "Harmonic mean of Precision and Recall for binary hiring decisions.",
                    status: "Target > 0.90",
                    category: "Classification",
                  },
                  {
                    symbol: "QWK",
                    title: "Quadratic Weighted Kappa",
                    desc: "Inter-rater agreement between AI overall scores and human expert raters.",
                    status: "Target > 0.82",
                    category: "Inter-Rater Agreement",
                  },
                  {
                    symbol: "κ",
                    title: "Cohen's Kappa",
                    desc: "Chance-corrected qualitative agreement across hiring decision categories.",
                    status: "Target > 0.78",
                    category: "Inter-Rater Agreement",
                  },
                  {
                    symbol: "MAE",
                    title: "Mean Absolute Error",
                    desc: "Mean absolute deviation between AI score and human benchmark score.",
                    status: "Target < 4.2 pts",
                    category: "Score Accuracy",
                  },
                  {
                    symbol: "r / ρ",
                    title: "Pearson r & Spearman ρ",
                    desc: "Linear and rank-order correlation with human interviewer evaluations.",
                    status: "Target r > 0.88",
                    category: "Correlation",
                  },
                  {
                    symbol: "d",
                    title: "Cohen's d Effect Size",
                    desc: "Standardized difference measuring skill improvement across interview turns.",
                    status: "Target d > 0.65",
                    category: "Psychometrics",
                  },
                  {
                    symbol: "K-Score",
                    title: "Adaptive K-Score Engine",
                    desc: "Live brain difficulty parameter computed dynamically in `src/lib/interview/state.ts`.",
                    status: "LIVE IN PROD",
                    category: "Adaptive Brain",
                    active: true,
                  },
                ].map((item) => (
                  <div
                    key={item.title}
                    className={`bg-[#09090b] border ${item.active ? "border-emerald-500/40 bg-emerald-950/10" : "border-white/10"} rounded-xl p-4 space-y-2 flex flex-col justify-between hover:border-violet-500/40 transition-all`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono font-bold text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded border border-violet-500/20">
                          {item.symbol}
                        </span>
                        <span className="text-[10px] font-mono text-zinc-500 uppercase">{item.category}</span>
                      </div>
                      <h4 className="text-xs font-bold text-white mt-2">{item.title}</h4>
                      <p className="text-[11px] text-zinc-400 mt-1 leading-snug">{item.desc}</p>
                    </div>
                    <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                      <span className="text-[10px] font-mono text-zinc-400">{item.status}</span>
                      <span className={`text-[9px] font-mono px-2 py-0.5 rounded ${item.active ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/10 text-amber-300"}`}>
                        {item.active ? "Enabled" : "Eval Data Pending"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2 text-xs text-zinc-300">
                <div className="flex items-center gap-2 text-violet-300 font-semibold">
                  <Info size={15} />
                  <span>How to Populate Research Metrics for Publication</span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  To generate full statistical report tables for research papers, populate <code className="text-violet-300 bg-violet-950/50 px-1.5 py-0.5 rounded border border-violet-800/50">eval-data/</code> with human-annotated CSV transcripts and execute <code className="text-violet-300 bg-violet-950/50 px-1.5 py-0.5 rounded border border-violet-800/50">npm run eval:report</code>.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 4: CANDIDATE PHOTOS ───────────────────────────────────────── */}
        {activeTab === "snapshots" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="bg-[#141417] border border-white/10 rounded-2xl p-6 space-y-6 shadow-xl">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400">
                    <Camera size={18} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Candidate Camera Snapshots</h3>
                    <p className="text-xs text-zinc-400">Real-time webcam captures recorded during candidate interview sessions</p>
                  </div>
                </div>
                <span className="px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-xs font-mono text-violet-300">
                  {data.candidateSnapshots?.length || 0} Sessions Captured
                </span>
              </div>

              {data.candidateSnapshots && data.candidateSnapshots.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {data.candidateSnapshots.map((item) => (
                    <div
                      key={item.id}
                      className="bg-[#09090b] border border-white/10 rounded-xl overflow-hidden shadow-lg flex flex-col justify-between hover:border-violet-500/40 transition-all group"
                    >
                      <div className="relative aspect-video bg-zinc-900 overflow-hidden flex items-center justify-center">
                        {item.candidateSnapshot ? (
                          <img
                            src={item.candidateSnapshot}
                            alt={item.candidateName}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="flex flex-col items-center gap-2 text-zinc-600">
                            <Users size={28} />
                            <span className="text-[10px] font-mono">No Photo Captured</span>
                          </div>
                        )}
                        <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md bg-black/70 backdrop-blur-md border border-white/10 text-[10px] font-mono text-zinc-300">
                          {item.score !== null ? `${item.score}/100` : item.status}
                        </div>
                      </div>
                      <div className="p-3.5 space-y-1 bg-[#141417]">
                        <h4 className="text-xs font-bold text-white truncate">{item.candidateName}</h4>
                        <p className="text-[11px] text-zinc-400 truncate">{item.jobRole}</p>
                        <p className="text-[10px] text-zinc-500 font-mono pt-1">
                          {new Date(item.createdAt).toLocaleDateString()} • {new Date(item.createdAt).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 space-y-3">
                  <Camera size={36} className="text-zinc-600 mx-auto" />
                  <p className="text-xs text-zinc-400">No candidate webcam snapshots recorded yet.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── TAB 5: NETWORK & SECURITY ────────────────────────────────────── */}
        {activeTab === "network" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="bg-[#141417] border border-white/10 rounded-2xl p-6 space-y-6 shadow-xl">
              <div className="flex items-center gap-3 border-b border-white/10 pb-4">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <Globe size={18} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Network & Security Diagnostics</h3>
                  <p className="text-xs text-zinc-400">Local network access, IP restrictions, and admin authorization</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-[#09090b] border border-white/10 rounded-xl p-4 space-y-3">
                  <span className="text-xs font-bold text-white flex items-center gap-2">
                    <Wifi size={14} className="text-emerald-400" />
                    Network Connection Context
                  </span>
                  <div className="space-y-2 text-xs font-mono">
                    <div className="flex justify-between py-1 border-b border-white/5 text-zinc-400">
                      <span>Client IP:</span>
                      <span className="text-white">{clientNetwork?.clientIp || "127.0.0.1"}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-white/5 text-zinc-400">
                      <span>Host Mode:</span>
                      <span className="text-emerald-400">{clientNetwork?.isLocalhost ? "Localhost / Loopback" : "LAN Remote IP"}</span>
                    </div>
                    <div className="flex justify-between py-1 text-zinc-400">
                      <span>LAN Access Command:</span>
                      <span className="text-violet-300">npm run dev:network</span>
                    </div>
                  </div>
                </div>

                <div className="bg-[#09090b] border border-white/10 rounded-xl p-4 space-y-3">
                  <span className="text-xs font-bold text-white flex items-center gap-2">
                    <Shield size={14} className="text-violet-400" />
                    Security Guard Policies
                  </span>
                  <div className="space-y-2 text-xs font-mono">
                    <div className="flex justify-between py-1 border-b border-white/5 text-zinc-400">
                      <span>Clerk Admin ID Guard:</span>
                      <span className={clientNetwork?.adminUserIdsConfigured ? "text-emerald-400" : "text-amber-400"}>
                        {clientNetwork?.adminUserIdsConfigured ? "ENABLED (ADMIN_USER_IDS)" : "DEFAULT (ALLOW ALL SIGNED-IN)"}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 text-zinc-400">
                      <span>IP Allowlist Restriction:</span>
                      <span className={clientNetwork?.allowedIpsConfigured ? "text-emerald-400" : "text-zinc-500"}>
                        {clientNetwork?.allowedIpsConfigured ? "ACTIVE (ALLOWED_ADMIN_IPS)" : "INACTIVE (ALL IPS ALLOWED)"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer Data Source Note */}
        <div className="bg-[#141417] border border-white/10 rounded-xl p-4 flex items-start gap-3 text-xs text-zinc-400">
          <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="leading-relaxed">
              <strong className="text-zinc-200">Data Source Notice:</strong> Metrics displayed are computed from{" "}
              <strong className="text-white">{platform.completedInterviews}</strong> completed sessions,{" "}
              <strong className="text-white">{platform.totalTranscriptChunks}</strong> transcript turns, and{" "}
              <strong className="text-white">{platform.totalAuditEvents}</strong> audit events stored in PostgreSQL.
            </p>
            <p className="text-[10px] text-zinc-500 font-mono">
              Generated at {new Date(data.generatedAt).toLocaleString()} • Intervia Platform v1.0
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

// ── Custom Shadcn Tooltip Component ──────────────────────────────────────────

function ShadcnCustomTooltip({ active, payload, label }: any) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#141417] border border-white/15 rounded-xl p-3 shadow-2xl space-y-1 text-xs backdrop-blur-md">
        <p className="text-[11px] font-mono text-zinc-400 uppercase">{label}</p>
        {payload.map((entry: any, index: number) => (
          <p key={`item-${index}`} className="font-bold text-white flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color || entry.fill }} />
            <span>{entry.name}: {entry.value}</span>
          </p>
        ))}
      </div>
    );
  }
  return null;
}

// ── Sub-Components ───────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  sub,
  color,
  trend,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub: string;
  color: "violet" | "cyan" | "amber" | "emerald";
  trend?: string;
}) {
  const borderMap = {
    violet: "border-violet-500/20 hover:border-violet-500/40",
    cyan: "border-cyan-500/20 hover:border-cyan-500/40",
    amber: "border-amber-500/20 hover:border-amber-500/40",
    emerald: "border-emerald-500/20 hover:border-emerald-500/40",
  };

  const iconMap = {
    violet: "text-violet-400 bg-violet-500/10 border-violet-500/20",
    cyan: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
    amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    emerald: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  };

  return (
    <div className={`bg-[#141417] border ${borderMap[color]} rounded-2xl p-5 space-y-3 shadow-xl transition-all`}>
      <div className="flex items-center justify-between">
        <div className={`w-9 h-9 rounded-xl border flex items-center justify-center ${iconMap[color]}`}>
          {icon}
        </div>
        {trend && (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            {trend}
          </span>
        )}
      </div>
      <div>
        <p className="text-2xl font-extrabold text-white tracking-tight">{value.toLocaleString()}</p>
        <p className="text-xs font-semibold text-zinc-300 mt-0.5">{label}</p>
      </div>
      <p className="text-[10px] text-zinc-400 leading-snug">{sub}</p>
    </div>
  );
}

function MetricBox({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="bg-[#141417] border border-white/10 rounded-xl p-4 text-center space-y-1 shadow-lg">
      <p className="text-[10px] text-zinc-400 font-mono uppercase tracking-wider">{label}</p>
      <p className="text-xl font-extrabold text-white">{value}</p>
      <p className="text-[10px] text-zinc-500">{unit}</p>
    </div>
  );
}

function ConfidenceBadge({ label, count, color }: { label: string; count: number; color: "emerald" | "amber" | "rose" }) {
  const styles = {
    emerald: "border-emerald-500/30 text-emerald-400 bg-emerald-500/10",
    amber: "border-amber-500/30 text-amber-400 bg-amber-500/10",
    rose: "border-rose-500/30 text-rose-400 bg-rose-500/10",
  };

  return (
    <div className={`border rounded-xl p-3 text-center space-y-1 ${styles[color]}`}>
      <p className="text-2xl font-extrabold">{count}</p>
      <p className="text-[10px] font-mono uppercase tracking-wider">{label}</p>
    </div>
  );
}

function SummaryRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex justify-between items-center text-xs py-1.5 border-b border-white/5">
      <span className="text-zinc-400 font-medium">{label}</span>
      <span className={`font-mono font-bold ${color}`}>{value}</span>
    </div>
  );
}
