"use client";

import { useRouter } from "next/navigation";
import { useState, useRef, DragEvent, ChangeEvent } from "react";
import {
  UploadCloud,
  FileText,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Plus,
  X,
  User,
  Briefcase,
  Award,
  Code2,
  ArrowRight,
  RefreshCw,
  Edit3,
  Loader2,
} from "lucide-react";
import { ExtractedResume } from "@/src/schemas/resume";
import { DUMMY_RESUME_ID, MOCK_STRUCTURED_RESUME } from "@/src/lib/default-interview-plan";

interface ResumeUploadFlowProps {
  onSuccess?: (interviewId: string) => void;
}

export function ResumeUploadFlow({ onSuccess }: ResumeUploadFlowProps) {
  const router = useRouter();

  // Step state: 'upload' | 'parsing' | 'confirm'
  const [step, setStep] = useState<"upload" | "parsing" | "confirm">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);

  // Resume data state
  const [resumeId, setResumeId] = useState<string>(DUMMY_RESUME_ID);
  const [jobRole, setJobRole] = useState("Software Developer");
  const [candidateProfile, setCandidateProfile] = useState<ExtractedResume>(MOCK_STRUCTURED_RESUME);

  // Skill input state
  const [skillInput, setSkillInput] = useState("");

  // New project state
  const [showAddProject, setShowAddProject] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [newProjectDesc, setNewProjectDesc] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = async (selectedFile: File) => {
    const ext = selectedFile.name.toLowerCase().split(".").pop();
    const validExts = ["pdf", "docx", "txt", "md"];
    if (!ext || !validExts.includes(ext)) {
      setError("Please upload a valid document (.pdf, .docx, .txt, or .md).");
      return;
    }

    if (selectedFile.size > 5 * 1024 * 1024) {
      setError("File size exceeds 5MB limit.");
      return;
    }

    setFile(selectedFile);
    setError(null);
    setStep("parsing");

    try {
      // Read file as base64
      const reader = new FileReader();
      const base64Data = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(selectedFile);
      });

      // Call parse-resume API
      const res = await fetch("/api/parse-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileData: base64Data,
          fileName: selectedFile.name,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to parse resume with AI");
      }

      setResumeId(data.id);
      if (data.structuredData) {
        setCandidateProfile(data.structuredData);
      }
      setStep("confirm");
    } catch (err: any) {
      console.error("Resume parse error:", err);
      setError(err.message || "An error occurred while analyzing your resume. You can manually edit your profile below.");
      // Fallback to confirm step with default profile so user isn't stuck
      setStep("confirm");
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  // Fast track / demo profile option
  const handleUseDemoProfile = () => {
    setFile(null);
    setResumeId(DUMMY_RESUME_ID);
    setCandidateProfile(MOCK_STRUCTURED_RESUME);
    setError(null);
    setStep("confirm");
  };

  // Tag management for top skills
  const handleAddSkill = () => {
    const trimmed = skillInput.trim();
    if (!trimmed) return;
    if (candidateProfile.topSkills.includes(trimmed)) {
      setSkillInput("");
      return;
    }
    if (candidateProfile.topSkills.length >= 5) {
      setError("Maximum 5 top skills allowed.");
      return;
    }

    setCandidateProfile({
      ...candidateProfile,
      topSkills: [...candidateProfile.topSkills, trimmed],
    });
    setSkillInput("");
    setError(null);
  };

  const handleRemoveSkill = (skillToRemove: string) => {
    if (candidateProfile.topSkills.length <= 1) {
      setError("At least 1 core skill is required.");
      return;
    }
    setCandidateProfile({
      ...candidateProfile,
      topSkills: candidateProfile.topSkills.filter((s) => s !== skillToRemove),
    });
    setError(null);
  };

  // Project management
  const handleAddProject = () => {
    if (!newProjectTitle.trim() || !newProjectDesc.trim()) return;
    if (candidateProfile.coreProjects.length >= 3) {
      setError("Maximum 3 core projects allowed.");
      return;
    }

    setCandidateProfile({
      ...candidateProfile,
      coreProjects: [
        ...candidateProfile.coreProjects,
        { title: newProjectTitle.trim(), description: newProjectDesc.trim() },
      ],
    });
    setNewProjectTitle("");
    setNewProjectDesc("");
    setShowAddProject(false);
    setError(null);
  };

  const handleRemoveProject = (index: number) => {
    setCandidateProfile({
      ...candidateProfile,
      coreProjects: candidateProfile.coreProjects.filter((_, i) => i !== index),
    });
  };

  // Initialize interview session with confirmed candidate profile
  const handleLaunchInterview = async () => {
    if (isLaunching) return;

    if (!candidateProfile.fullName.trim()) {
      setError("Candidate Full Name is required.");
      return;
    }
    if (!jobRole.trim()) {
      setError("Target Job Role is required.");
      return;
    }

    setIsLaunching(true);
    setError(null);

    try {
      const response = await fetch("/api/interviews/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobRole: jobRole.trim(),
          resumeId,
          customCandidateProfile: candidateProfile,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.detail || "Failed to initialize interview session.");
      }

      if (onSuccess) {
        onSuccess(data.id);
      } else {
        router.push(`/interview/${data.id}/lobby`);
      }
    } catch (err: any) {
      console.error("Initialize interview error:", err);
      setError(err.message || "Network error while launching interview session.");
      setIsLaunching(false);
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6">
      {/* Step Indicator Header */}
      <div className="flex items-center justify-between border-b border-zinc-800/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600/20 text-violet-400 border border-violet-500/30">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Interview Setup</h2>
            <p className="text-xs text-zinc-400">
              {step === "upload" && "Upload your resume to extract candidate details"}
              {step === "parsing" && "AI is analyzing your resume..."}
              {step === "confirm" && "Review & customize your interview profile"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-medium">
          <span
            className={`px-3 py-1 rounded-full border ${
              step === "upload"
                ? "bg-violet-500/10 text-violet-300 border-violet-500/30"
                : "bg-zinc-900 text-zinc-500 border-zinc-800"
            }`}
          >
            1. Upload
          </span>
          <span className="text-zinc-600">→</span>
          <span
            className={`px-3 py-1 rounded-full border ${
              step === "confirm"
                ? "bg-violet-500/10 text-violet-300 border-violet-500/30"
                : "bg-zinc-900 text-zinc-500 border-zinc-800"
            }`}
          >
            2. Review & Start
          </span>
        </div>
      </div>

      {/* ERROR BANNER */}
      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-300">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="flex-1">{error}</div>
          <button
            onClick={() => setError(null)}
            className="text-rose-400 hover:text-rose-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* STEP 1: UPLOAD ZONE */}
      {step === "upload" && (
        <div className="space-y-6">
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition-all cursor-pointer ${
              isDragOver
                ? "border-violet-500 bg-violet-500/10 shadow-lg shadow-violet-500/10 scale-[1.01]"
                : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 hover:bg-zinc-900/60"
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".pdf,.docx,.txt,.md"
              className="hidden"
            />

            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-800/80 text-violet-400 border border-zinc-700/50 shadow-inner">
              <UploadCloud className="h-7 w-7" />
            </div>

            <h3 className="text-base font-semibold text-white">
              Drop your resume here, or{" "}
              <span className="text-violet-400 underline decoration-violet-400/40 underline-offset-4">
                browse
              </span>
            </h3>
            <p className="mt-1 text-xs text-zinc-400 max-w-sm">
              Supports PDF, DOCX, TXT, or Markdown resumes (Max 5MB). AI will extract skills, experience, and key projects.
            </p>

            <div className="mt-6 flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/60 px-4 py-1.5 text-[11px] text-zinc-400">
              <Sparkles className="h-3.5 w-3.5 text-violet-400" />
              <span>Powered by Gemini 3.8 Flash Parser</span>
            </div>
          </div>

          <div className="relative flex items-center justify-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-zinc-800" />
            </div>
            <span className="relative bg-black px-4 text-xs text-zinc-500 uppercase tracking-widest font-medium">
              Or Skip Upload
            </span>
          </div>

          <button
            type="button"
            onClick={handleUseDemoProfile}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-3.5 text-xs font-medium text-zinc-300 transition-all hover:bg-zinc-800/60 hover:text-white"
          >
            <User className="h-4 w-4 text-zinc-400" />
            <span>Use Demo Software Engineer Profile (Fast Start)</span>
          </button>
        </div>
      )}

      {/* STEP 2: AI PARSING SPINNER */}
      {step === "parsing" && (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/30">
          <div className="relative flex items-center justify-center">
            <div className="h-16 w-16 rounded-full border-4 border-violet-500/20 border-t-violet-500 animate-spin" />
            <Sparkles className="absolute h-6 w-6 text-violet-400 animate-pulse" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-white">Analyzing Resume with AI</h3>
            <p className="text-xs text-zinc-400 max-w-xs mx-auto">
              Extracting candidate skills, experience years, and core project achievements from{" "}
              <span className="text-zinc-200 font-medium">{file?.name || "PDF"}</span>...
            </p>
          </div>
        </div>
      )}

      {/* STEP 3: EDITABLE CONFIRMATION CARD */}
      {step === "confirm" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/60 p-6 backdrop-blur-md space-y-6 shadow-2xl">
            {/* Header info */}
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-violet-400 uppercase tracking-wider">
                <CheckCircle2 className="h-4 w-4" />
                <span>Extracted Candidate Profile</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setStep("upload");
                  setError(null);
                }}
                className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Upload Different Resume</span>
              </button>
            </div>

            {/* Basic Info Fields */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
                  <User className="h-3.5 w-3.5 text-violet-400" />
                  Full Name
                </label>
                <input
                  type="text"
                  value={candidateProfile.fullName}
                  onChange={(e) =>
                    setCandidateProfile({
                      ...candidateProfile,
                      fullName: e.target.value,
                    })
                  }
                  placeholder="Candidate Name"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950/80 px-4 py-2.5 text-sm text-white focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
                  <Briefcase className="h-3.5 w-3.5 text-cyan-400" />
                  Target Job Role
                </label>
                <input
                  type="text"
                  value={jobRole}
                  onChange={(e) => setJobRole(e.target.value)}
                  placeholder="e.g. Full Stack Engineer"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950/80 px-4 py-2.5 text-sm text-white focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
              </div>
            </div>

            {/* Years of Experience */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
                <Award className="h-3.5 w-3.5 text-emerald-400" />
                Years of Relevant Experience
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="0"
                  max="30"
                  value={candidateProfile.yearsOfExperience}
                  onChange={(e) =>
                    setCandidateProfile({
                      ...candidateProfile,
                      yearsOfExperience: Math.max(0, parseInt(e.target.value) || 0),
                    })
                  }
                  className="w-24 rounded-xl border border-zinc-800 bg-zinc-950/80 px-4 py-2.5 text-sm font-semibold text-white focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
                <span className="text-xs text-zinc-400">
                  {candidateProfile.yearsOfExperience === 0
                    ? "Fresher / Student"
                    : candidateProfile.yearsOfExperience === 1
                    ? "1 Year Experience"
                    : `${candidateProfile.yearsOfExperience} Years Experience`}
                </span>
              </div>
            </div>

            {/* Top Skills Tag Cloud */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
                  <Code2 className="h-3.5 w-3.5 text-amber-400" />
                  Top Technical Skills (1–5)
                </label>
                <span className="text-[11px] text-zinc-500">
                  {candidateProfile.topSkills.length}/5 Skills
                </span>
              </div>

              {/* Skills Tags */}
              <div className="flex flex-wrap items-center gap-2">
                {candidateProfile.topSkills.map((skill) => (
                  <span
                    key={skill}
                    className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-300"
                  >
                    <span>{skill}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveSkill(skill)}
                      className="text-violet-400 hover:text-white transition-colors"
                      title="Remove skill"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>

              {/* Add Skill Input */}
              {candidateProfile.topSkills.length < 5 && (
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="text"
                    value={skillInput}
                    onChange={(e) => setSkillInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddSkill();
                      }
                    }}
                    placeholder="Add skill (e.g. React, Node.js, PostgreSQL)..."
                    className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950/80 px-3.5 py-2 text-xs text-white placeholder-zinc-500 focus:border-violet-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddSkill}
                    className="inline-flex items-center gap-1 rounded-xl bg-zinc-800 px-3.5 py-2 text-xs font-medium text-white hover:bg-zinc-700"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add</span>
                  </button>
                </div>
              )}
            </div>

            {/* Core Projects List */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
                  <FileText className="h-3.5 w-3.5 text-sky-400" />
                  Key Projects / Experience Highlights
                </label>
                {candidateProfile.coreProjects.length < 3 && !showAddProject && (
                  <button
                    type="button"
                    onClick={() => setShowAddProject(true)}
                    className="flex items-center gap-1 text-xs font-medium text-violet-400 hover:text-violet-300"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add Project</span>
                  </button>
                )}
              </div>

              <div className="space-y-2.5">
                {candidateProfile.coreProjects.map((proj, idx) => (
                  <div
                    key={idx}
                    className="group relative rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between font-semibold text-zinc-200">
                      <span>{proj.title}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveProject(idx)}
                        className="text-zinc-500 hover:text-rose-400 transition-colors opacity-0 group-hover:opacity-100"
                        title="Delete project"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p className="text-zinc-400 leading-relaxed">{proj.description}</p>
                  </div>
                ))}

                {/* Add Project Form */}
                {showAddProject && (
                  <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4 space-y-3">
                    <input
                      type="text"
                      placeholder="Project Title (e.g. Distributed Cache System)"
                      value={newProjectTitle}
                      onChange={(e) => setNewProjectTitle(e.target.value)}
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-violet-500 focus:outline-none"
                    />
                    <textarea
                      placeholder="Brief description & technologies used..."
                      rows={2}
                      value={newProjectDesc}
                      onChange={(e) => setNewProjectDesc(e.target.value)}
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-violet-500 focus:outline-none"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowAddProject(false)}
                        className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleAddProject}
                        className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500"
                      >
                        Save Project
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Launch Action Button */}
          <button
            type="button"
            onClick={handleLaunchInterview}
            disabled={isLaunching}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-violet-600/25 transition-all hover:from-violet-500 hover:to-indigo-500 hover:shadow-violet-600/40 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLaunching ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Generating Interview Plan...</span>
              </>
            ) : (
              <>
                <span>Confirm & Start Interview</span>
                <ArrowRight className="h-5 w-5" />
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
