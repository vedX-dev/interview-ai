"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { IntegrityDetector } from "@/src/lib/integrity/detector";
import { INTEGRITY_CONFIG } from "@/src/lib/integrity/config";
import type { IntegrityEvent } from "@/src/schemas/integrity";
import { MOCK_STRUCTURED_RESUME } from "@/src/lib/default-interview-plan";

type TurnState = "idle" | "ai_speaking" | "user_turn" | "processing";

// Speech Recognition types
type SpeechRecognitionEvent = {
  resultIndex: number;
  results: SpeechRecognitionResultList;
};

type SpeechRecognitionErrorEvent = {
  error: string;
  message: string;
};

type TranscriptEntry = {
  id: string;
  speaker: "ai" | "user";
  text: string;
  timestamp: Date;
};

type TranscriptChunkRecord = {
  id: string;
  interviewId: string;
  content: string;
  speaker: "user" | "ai";
  createdAt: string | Date | null;
};

type InterviewRecord = {
  id: string;
  jobRole: string;
  status: string;
  currentPhase: string;
  feedback: {
    candidateProfile?: {
      fullName: string;
      topSkills: string[];
      yearsOfExperience: number;
      coreProjects: Array<{ title: string; description: string }>;
    };
  };
};

type TurnResponse = {
  say: string;
  phase: "intro" | "warmup" | "core" | "wrapup" | "closing";
  isComplete: boolean;
  _dev?: {
    evaluation?: Record<string, unknown>;
    decision?: Record<string, unknown>;
    provider: string;
    latencyMs: number;
    action: string;
  };
};

// Phase display mapping (server 5-phase → UI label)
const PHASE_LABELS: Record<string, string> = {
  intro: "Getting Started",
  warmup: "Getting to Know You",
  core: "Technical Round",
  wrapup: "Wrapping Up",
  closing: "Complete",
  // legacy DB phases (if loaded from old rows)
  greeting: "Getting Started",
  rapport: "Getting to Know You",
  technical: "Technical Round",
  closed: "Complete",
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

const AI_SPEAKING_MS = 3000;

function mapChunkToEntry(chunk: TranscriptChunkRecord): TranscriptEntry {
  return {
    id: chunk.id,
    speaker: chunk.speaker,
    text: chunk.content,
    timestamp: chunk.createdAt ? new Date(chunk.createdAt) : new Date(),
  };
}

function getPhaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    greeting: "Getting Started",
    rapport: "Getting to Know You",
    technical: "Technical Round",
    wrapup: "Wrapping Up",
    closed: "Complete",
  };
  return labels[phase] || phase;
}

export default function InterviewRoomPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const interviewId = params.id;

  const [turnState, setTurnState] = useState<TurnState>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [userInput, setUserInput] = useState("");
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [isGeneratingFeedback, setIsGeneratingFeedback] = useState(false);
  const [feedback, setFeedback] = useState<any>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  
  // Speech recognition state
  const [supportsSpeechRecognition, setSupportsSpeechRecognition] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [useFallbackInput, setUseFallbackInput] = useState(false);
  
  // Interview brain state (server-owned: phase, turns)
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [aiProvider, setAiProvider] = useState<string>("gemini");
  const [ttsProvider, setTtsProvider] = useState<"browser" | "sarvam">("sarvam");
  const [currentPhase, setCurrentPhase] = useState<string>("intro");
  const [candidateProfile, setCandidateProfile] = useState<any>(null);
  
  const recognitionRef = useRef<any>(null);
  const synthesisRef = useRef<SpeechSynthesis | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showTranscriptPanel, setShowTranscriptPanel] = useState(true);
  const [showEndModal, setShowEndModal] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [showSilenceHint, setShowSilenceHint] = useState(false);
  const [jobRole, setJobRole] = useState("Software Developer");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [ragQuery, setRagQuery] = useState("");
  const [isQueryingRag, setIsQueryingRag] = useState(false);

  // Integrity monitoring state
  const [integrityStrikes, setIntegrityStrikes] = useState(0);
  const [integrityWarning, setIntegrityWarning] = useState<string | null>(null);
  const [isTerminatedByIntegrity, setIsTerminatedByIntegrity] = useState(false);
  const [showDevOverlay, setShowDevOverlay] = useState(false);
  const [integrityDebug, setIntegrityDebug] = useState<{ yaw: number; pitch: number; gazeAway: boolean; faceCount: number; detectedObjects: string[] } | null>(null);
  const integrityDetectorRef = useRef<IntegrityDetector | null>(null);

  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const isAttemptingOrchestratorRef = useRef(false);

  // Elapsed timer effect
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // ── Camera: acquire stream once on mount ────────────────────────────────────
  useEffect(() => {
    let isMounted = true;
    let acquiredStream: MediaStream | null = null;

    const startWebcam = async () => {
      try {
        setCameraError(null);
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        acquiredStream = stream;
        setMediaStream(stream);
        // srcObject is set in the dedicated effect below
      } catch (err: any) {
        if (!isMounted) return;
        console.warn("[WEBCAM] getUserMedia error:", err);
        let msg = "Camera access denied";
        if (err?.name === "NotAllowedError") msg = "Camera permission denied. Click the camera icon in your browser's address bar to allow access.";
        else if (err?.name === "NotFoundError") msg = "No camera found. Please connect a camera and refresh.";
        else if (err?.name === "NotReadableError") msg = "Camera is in use by another application. Please close it and try again.";
        setCameraError(msg);
        setIsCameraOn(false);
      }
    };

    startWebcam();

    return () => {
      isMounted = false;
      if (acquiredStream) {
        acquiredStream.getTracks().forEach((t) => t.stop());
      }
    };
  // Only run once on mount — not when isCameraOn toggles
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Camera: attach srcObject AFTER the video element mounts ─────────────────
  const snapshotCapturedRef = useRef(false);
  const captureCandidateSnapshot = useCallback(() => {
    if (!videoRef.current || !interviewId) return;
    const video = videoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    try {
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(video.videoWidth, 640);
      canvas.height = Math.min(video.videoHeight, 480);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        fetch(`/api/interviews/${interviewId}/snapshot`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ snapshot: dataUrl }),
        }).catch((err) => console.warn("[SNAPSHOT] Upload error:", err));
      }
    } catch (e) {
      console.warn("[SNAPSHOT] Capture failed:", e);
    }
  }, [interviewId]);

  useEffect(() => {
    if (videoRef.current && mediaStream) {
      videoRef.current.srcObject = mediaStream;
      videoRef.current.play().catch((e) =>
        console.warn("[WEBCAM] play() failed:", e),
      );

      if (!snapshotCapturedRef.current) {
        const timer = setTimeout(() => {
          captureCandidateSnapshot();
          snapshotCapturedRef.current = true;
        }, 2500);
        return () => clearTimeout(timer);
      }
    }
  }, [mediaStream, captureCandidateSnapshot]);

  // ── Integrity Monitoring: Start detector ────────────────────────────────────
  useEffect(() => {
    if (!videoRef.current || !mediaStream || !interviewId) return;

    let detector: IntegrityDetector | null = null;

    const startDetector = async () => {
      detector = new IntegrityDetector({
        onViolation: async (event: IntegrityEvent) => {
          console.warn("[INTEGRITY_VIOLATION]", event);
          try {
            // Client-side dedup: suppress same event type within 2s
            const dedupKey = `integrity_dedup_${event.type}`;
            const lastSent = parseInt(sessionStorage.getItem(dedupKey) ?? "0", 10);
            if (Date.now() - lastSent < 2000) {
              console.log("[INTEGRITY] Client dedup suppressed:", event.type);
              return;
            }
            sessionStorage.setItem(dedupKey, String(Date.now()));

            // Queue to sessionStorage for resilience across retries
            const queueKey = `integrity_queue_${interviewId}`;
            const queue: IntegrityEvent[] = JSON.parse(sessionStorage.getItem(queueKey) ?? "[]");
            queue.push(event);
            sessionStorage.setItem(queueKey, JSON.stringify(queue));

            // Retry loop: up to 3 attempts with exponential backoff
            let res: Response | null = null;
            for (let attempt = 0; attempt < 3; attempt++) {
              if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * attempt));
              try {
                res = await fetch(`/api/interviews/${interviewId}/integrity`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(event),
                });
                if (res.status === 429) {
                  const rd = await res.json().catch(() => ({})) as { retryAfterSec?: number };
                  const wait = (rd.retryAfterSec ?? 10) * 1000;
                  console.warn(`[INTEGRITY] 429, backing off ${wait}ms`);
                  await new Promise((r) => setTimeout(r, wait));
                  continue;
                }
                break;
              } catch {
                continue; // network error — retry
              }
            }

            if (res?.ok) {
              // Remove from queue on success
              const remaining: IntegrityEvent[] = JSON.parse(sessionStorage.getItem(queueKey) ?? "[]")
                .filter((e: IntegrityEvent) => !(e.type === event.type && e.timestamp === event.timestamp));
              sessionStorage.setItem(queueKey, JSON.stringify(remaining));

              const data = await res.json();
              if (data.success && !data.deduplicated) {
                setIntegrityStrikes(data.strikeNumber);
                setIntegrityWarning(
                  `⚠️ Integrity Warning: Sustained ${event.type.replace("_", " ").toUpperCase()} detected (${data.strikeNumber}/${INTEGRITY_CONFIG.maxStrikes} strikes)`
                );
                if (typeof window !== "undefined" && window.speechSynthesis) {
                  const warnAudio = new SpeechSynthesisUtterance("Notice: Please keep your eyes on the screen during the interview.");
                  window.speechSynthesis.speak(warnAudio);
                }
                if (data.isTerminated) {
                  setIsTerminatedByIntegrity(true);
                  setCurrentPhase("closed");
                  setTimeout(() => { void endInterviewSession("integrity"); }, 3000);
                } else {
                  setTimeout(() => { setIntegrityWarning(null); }, 6000);
                }
              }
            } else {
              console.warn("[INTEGRITY] Event queued (will retry on next violation):", event.type);
            }
          } catch (err) {
            console.error("[INTEGRITY_API_ERROR]", err);
          }
        },
        onDebugFrame: (data) => {
          setIntegrityDebug(data);
        },
      });

      const initialized = await detector.initialize();
      if (initialized && videoRef.current) {
        const calStr = localStorage.getItem(`integrity_calibration_${interviewId}`);
        if (calStr) {
          try {
            detector.setBaseline(JSON.parse(calStr));
          } catch (e) {}
        }
        detector.start(videoRef.current);
        integrityDetectorRef.current = detector;
      }
    };

    startDetector();

    return () => {
      detector?.stop();
      detector?.close();
    };
  }, [interviewId, mediaStream, router]);

  useEffect(() => {
    integrityDetectorRef.current?.setAiSpeaking(turnState === "ai_speaking");
  }, [turnState]);

  // Prevent accidental navigation/refresh mid-interview
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (currentPhase !== "closed" && currentPhase !== "closing") {
        e.preventDefault();
        e.returnValue = "An interview is currently in progress. Are you sure you want to leave?";
        return e.returnValue;
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [currentPhase]);

  // ── Camera: toggle tracks enabled without stopping (instant on/off) ──────────
  useEffect(() => {
    if (!mediaStream) return;
    mediaStream.getVideoTracks().forEach((t) => {
      t.enabled = isCameraOn;
    });
  }, [isCameraOn, mediaStream]);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript, isAiThinking, interimTranscript]);

  // Keyboard shortcut for mic (M key) — uses refs to avoid hoisting issue
  const isListeningRef = useRef(false);
  const turnStateRef = useRef<TurnState>("idle");
  const startListeningRef = useRef<() => void>(() => {});
  const stopListeningRef = useRef<() => void>(() => {});

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    turnStateRef.current = turnState;
  }, [turnState]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        if (isListeningRef.current) {
          stopListeningRef.current();
        } else if (turnStateRef.current === "user_turn") {
          startListeningRef.current();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const isAiSpeaking = turnState === "ai_speaking";

  // Latency eval helper (gated behind NEXT_PUBLIC_RESEARCH_MODE === "true")
  const sendClientLatencyLog = useCallback((stage: "candidate_speech_end" | "audio_playback_start", turnNum?: number) => {
    if (process.env.NEXT_PUBLIC_RESEARCH_MODE !== "true") return;
    const ts = Date.now();
    console.log(`[EVAL_LATENCY] stage=${stage} ts=${ts}`);
    fetch("/api/eval/latency", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        interviewId,
        turnId: turnNum ?? transcript.length + 1,
        stage,
        ts,
      }),
    }).catch(() => {});
  }, [interviewId, transcript.length]);

  // Stop all active AI speech immediately (Barge-in / Interruption)
  const stopAiSpeech = useCallback(() => {
    if (activeAudioRef.current) {
      try {
        activeAudioRef.current.pause();
        activeAudioRef.current.currentTime = 0;
      } catch (e) {}
      activeAudioRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {}
    }
  }, []);

  // Silence detection effect for candidate turn
  useEffect(() => {
    if (turnState === "user_turn") {
      setShowSilenceHint(false);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

      silenceTimerRef.current = setTimeout(() => {
        console.log("[SILENCE DETECT] Candidate silent for > 12s, showing nudge hint");
        setShowSilenceHint(true);
      }, 12000);
    } else {
      setShowSilenceHint(false);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    }

    return () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    };
  }, [turnState, userInput]);

  const appendTranscript = useCallback(
    async (content: string, speaker: "user" | "ai") => {
      if (!interviewId) {
        throw new Error("Missing interview session id");
      }

      const payload = { interviewId, content, speaker };
      console.log("[TRANSCRIPT APPEND] Payload:", payload);

      const response = await fetch("/api/interviews/transcript/append", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      console.log("[TRANSCRIPT APPEND] Response:", data);

      if (!response.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "Failed to persist transcript",
        );
      }

      const entry = mapChunkToEntry(data as TranscriptChunkRecord);
      setTranscript((prev) => [...prev, entry]);
      return entry;
    },
    [interviewId],
  );

  const speakAiQuestion = useCallback(
    async (questionText: string) => {
      console.log("[SPEAK AI] Question text:", questionText);
      if (!questionText || questionText.trim().length === 0) {
        console.error("[SPEAK AI] Empty question text provided");
        throw new Error("Cannot speak empty question");
      }

      setTurnState("ai_speaking");
      await appendTranscript(questionText, "ai");
      
      // Try Sarvam TTS first if enabled
      if (ttsProvider === "sarvam") {
        try {
          await speakWithSarvam(questionText);
          setTurnState("user_turn");
          return;
        } catch (error) {
          console.warn("[SPEAK AI] Sarvam TTS failed, falling back to browser TTS:", error);
          setTtsProvider("browser");
        }
      }

      // Fallback to browser TTS
      await speakWithBrowserTTS(questionText);
      setTurnState("user_turn");
    },
    [ttsProvider, appendTranscript],
  );

  const speakWithSarvam = async (text: string) => {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, speaker: "ritu" }),
    });

    if (!response.ok) {
      throw new Error(`TTS proxy endpoint returned status ${response.status}`);
    }

    const data = await response.json();
    if (data.fallback || !data.audios || data.audios.length === 0) {
      throw new Error(data.reason || "TTS proxy requested fallback to browser TTS");
    }

    // Sequentially play audio chunks with barge-in support
    for (const audioBase64 of data.audios) {
      const audioBytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
      const audioBlob = new Blob([audioBytes], { type: "audio/wav" });
      const audioUrl = URL.createObjectURL(audioBlob);

      const audio = new Audio(audioUrl);
      activeAudioRef.current = audio;

      await new Promise<void>((resolve, reject) => {
        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          if (activeAudioRef.current === audio) {
            activeAudioRef.current = null;
          }
          resolve();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(audioUrl);
          if (activeAudioRef.current === audio) {
            activeAudioRef.current = null;
          }
          reject(new Error("Audio playback failed"));
        };
        audio.oncanplaythrough = () => {
          if (activeAudioRef.current === audio) {
            sendClientLatencyLog("audio_playback_start");
            audio.play().catch(reject);
          }
        };
      });
    }
  };

  const speakWithBrowserTTS = async (text: string) => {
    // Use real TTS if available
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1;
      utterance.pitch = 0.9; // Slightly lower pitch for male voice
      
      // Get voices - handle async loading in some browsers
      let voices = window.speechSynthesis.getVoices();
      if (voices.length === 0) {
        // Voices might not be loaded yet, wait for them
        await new Promise<void>((resolve) => {
          const loadVoices = () => {
            voices = window.speechSynthesis.getVoices();
            if (voices.length > 0) {
              window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
              resolve();
            }
          };
          window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
          // Fallback timeout
          setTimeout(() => {
            window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
            resolve();
          }, 1000);
        });
      }
      
      // Try to find a male English voice
      const maleVoice = voices.find(voice => 
        voice.lang.startsWith('en') && 
        (voice.name.toLowerCase().includes('male') || 
         voice.name.toLowerCase().includes('david') ||
         voice.name.toLowerCase().includes('mark') ||
         voice.name.toLowerCase().includes('james') ||
         voice.name.toLowerCase().includes('daniel'))
      ) || voices.find(voice => voice.lang.startsWith('en'));
      
      if (maleVoice) {
        utterance.voice = maleVoice;
      }
      
      await new Promise<void>((resolve, reject) => {
        utterance.onend = () => resolve();
        utterance.onerror = (e) => reject(new Error("Browser TTS failed"));
        window.speechSynthesis.speak(utterance);
      });
    } else {
      throw new Error("Browser TTS not supported");
    }
  };

  /**
   * callTurn: post the user's latest utterance + last-N transcript to /api/interviews/[id]/turn.
   * Receives explicit `userUtterance` + `updatedTranscript` to avoid stale closure bugs.
   */
  const callTurn = useCallback(async (
    userUtterance: string,
    updatedTranscript: TranscriptEntry[],
    customRequestId?: string,
  ) => {
    if (!interviewId) return;
    if (isAttemptingOrchestratorRef.current) {
      console.log("[TURN] Already in flight, skipping duplicate");
      return;
    }

    isAttemptingOrchestratorRef.current = true;
    setIsAiThinking(true);

    // Safe requestId: interviewId + transcript length + short djb2 hash (no raw utterance in logs)
    const h = userUtterance.split('').reduce((acc, c) => (Math.imul(31, acc) + c.charCodeAt(0)) | 0, 0).toString(36).replace('-','').slice(-6);
    const clientRequestId = customRequestId || `${interviewId}_t${updatedTranscript.length}_${h}`;

    // Build last-6-turns for context (explicit, not from stale state)
    const recentTranscript = updatedTranscript.slice(-12).map((e) => ({
      speaker: e.speaker,
      content: e.text,
    }));

    const payload = { userUtterance, recentTranscript, clientRequestId };
    console.log("[TURN] Calling /turn, reqId:", clientRequestId, "utterance:", userUtterance.slice(0, 80));

    // Helper: single fetch attempt
    const attemptFetch = async () => fetch(`/api/interviews/${interviewId}/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    try {
      let response = await attemptFetch();
      console.log("[TURN] Response status:", response.status);

      // If we get a 429, wait Retry-After and retry ONCE — never discard the answer
      if (response.status === 429) {
        const data = await response.json().catch(() => ({})) as { retryAfterSec?: number; error?: string };
        const waitSec = data.retryAfterSec ?? 5;
        console.warn(`[TURN] 429 — retrying in ${waitSec}s (answer preserved)`);
        setTranscriptError(`One moment — retrying in ${waitSec}s…`);
        await new Promise((r) => setTimeout(r, waitSec * 1000));
        setTranscriptError(null);
        response = await attemptFetch();
        console.log("[TURN] Retry response status:", response.status);
      }

      if (response.status === 409) {
        console.log("[TURN] Interview already ended on server (409). Navigating to feedback report.");
        setIsAiThinking(false);
        setCurrentPhase("closing");
        await generateFeedback();
        return;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Turn failed: ${response.status} — ${errorText}`);
      }

      const turnResp = await response.json() as TurnResponse;
      console.log("[TURN] Response:", turnResp);

      // Update UI phase from server truth
      setCurrentPhase(turnResp.phase);
      if (turnResp._dev?.provider) setAiProvider(turnResp._dev.provider);

      setIsAiThinking(false);

      if (turnResp.isComplete) {
        await generateFeedback();
      } else {
        await speakAiQuestion(turnResp.say);
      }
    } catch (error) {
      console.error("[TURN] Error:", error);
      setIsAiThinking(false);
      // Preserve the candidate's answer in the transcript — it's already appended
      setTranscriptError("Couldn't reach the AI — your answer was saved. Tap to retry.");
      setTurnState("user_turn");
    } finally {
      isAttemptingOrchestratorRef.current = false;
    }
  }, [interviewId, speakAiQuestion]);

  // Check for speech recognition support on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      setSupportsSpeechRecognition(!!SpeechRecognition);
      
      // Load voices for TTS
      if ('speechSynthesis' in window) {
        window.speechSynthesis.getVoices();
      }
    }
  }, []);

  const hasPlayedInitialGreetingRef = useRef(false);

  useEffect(() => {
    if (!interviewId) return;

    // Validate interview ID format (UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(interviewId)) {
      console.error("[LOAD SESSION] Invalid interview ID format:", interviewId);
      setTranscriptError("Invalid interview ID. Please start a new interview from the home page.");
      setTurnState("idle");
      setTimeout(() => {
        router.push("/");
      }, 3000);
      return;
    }

    let cancelled = false;

    async function loadSession() {
      setTurnState("processing");
      setTranscriptError(null);

      console.log("[LOAD SESSION] Loading interview:", interviewId);

      try {
        const response = await fetch(
          `/api/interviews/transcript?interviewId=${interviewId}`,
        );
        
        console.log("[LOAD SESSION] Response status:", response.status);
        
        if (response.status === 404) {
          throw new Error("Interview not found. Please start a new interview from the home page.");
        }

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            typeof data.error === "string"
              ? data.error
              : "Failed to load interview session",
          );
        }

        if (cancelled) return;

        const interview = data.interview as InterviewRecord;
        const chunks = (data.chunks ?? []) as TranscriptChunkRecord[];

        console.log("[LOAD SESSION] Loaded interview:", interview.id, "Phase:", interview.currentPhase);

        setJobRole(interview?.jobRole ?? "Software Developer");
        setCurrentPhase((interview?.currentPhase as any) || "greeting");
        setCandidateProfile(interview?.feedback?.candidateProfile || null);

        const entries = chunks.map(mapChunkToEntry);
        setTranscript(entries);

        // Derive state strictly from saved transcript data
        if (entries.length === 0) {
          // Empty transcript -> play greeting & wait for candidate
          const firstName = interview?.feedback?.candidateProfile?.fullName?.split(" ")[0] || "there";
          const defaultGreeting = `Hi ${firstName}, welcome! I'm glad you could make it today. Before we begin, is there anything you'd like to check on your end — audio, video, anything like that?`;
          if (!hasPlayedInitialGreetingRef.current) {
            hasPlayedInitialGreetingRef.current = true;
            await speakAiQuestion(defaultGreeting);
          } else {
            setTurnState("user_turn");
          }
          return;
        }

        const lastEntry = entries[entries.length - 1];
        if (lastEntry.speaker === "ai") {
          // Last entry is AI -> wait for candidate turn
          setTurnState("user_turn");
          // Play initial greeting audio on first load if it's entry 1 and hasn't played yet
          if (entries.length === 1 && !hasPlayedInitialGreetingRef.current) {
            hasPlayedInitialGreetingRef.current = true;
            // Speak without re-appending to transcript since it's already in DB
            if (ttsProvider === "sarvam") {
              try {
                await speakWithSarvam(lastEntry.text);
              } catch {
                await speakWithBrowserTTS(lastEntry.text);
              }
            } else {
              await speakWithBrowserTTS(lastEntry.text);
            }
          }
        } else {
          // Last entry is user -> generate reply once using idempotency key
          setTurnState("processing");
          const lastUserUtterance = lastEntry.text;
          const resumeReqId = `${interviewId}_resume_${entries.length}`;
          void callTurn(lastUserUtterance, entries, resumeReqId);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("[LOAD SESSION] Error:", error);
          setTranscriptError(
            error instanceof Error 
              ? `Failed to load interview session: ${error.message}. Please refresh the page or try starting a new interview.`
              : "Failed to load interview session. Please refresh the page or try starting a new interview.",
          );
          setTurnState("idle");
        }
      }
    }

    void loadSession();

    return () => {
      cancelled = true;
    };
  }, [interviewId, router, callTurn, speakAiQuestion, ttsProvider]);

  // NOTE: callTurn is now called DIRECTLY from handleSpeak with explicit args.
  // No effects fire the AI turn — this eliminates the stale-closure and re-greeting bugs.

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, isQueryingRag]);

  const startListening = () => {
    if (!supportsSpeechRecognition || isListening) return;
    
    // Barge-in: Stop active AI speech when user starts listening/speaking
    stopAiSpeech();
    
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    
    recognition.onstart = () => {
      setIsListening(true);
      setInterimTranscript("");
    };
    
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const { resultIndex, results } = event;
      const currentResult = results[resultIndex];
      
      if (currentResult.isFinal) {
        const finalText = currentResult[0].transcript;
        setUserInput(finalText);
        setInterimTranscript("");
        setIsListening(false);
        void handleSpeak(finalText);
      } else {
        setInterimTranscript(currentResult[0].transcript);
      }
    };
    
    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
      setInterimTranscript("");
      
      switch (event.error) {
        case 'not-allowed':
          setTranscriptError('Microphone permission denied. Using text input fallback.');
          setUseFallbackInput(true);
          break;
        case 'no-speech':
          setTranscriptError('No speech detected. Please try again or use text input.');
          break;
        case 'aborted':
          // User stopped or interrupted - normal, no error needed
          break;
        case 'network':
          setTranscriptError('Network error during speech recognition. Using text input fallback.');
          setUseFallbackInput(true);
          break;
        case 'audio-capture':
          setTranscriptError('Microphone not available. Using text input fallback.');
          setUseFallbackInput(true);
          break;
        default:
          setTranscriptError(`Speech recognition error: ${event.error}. Using text input fallback.`);
          setUseFallbackInput(true);
      }
    };
    
    recognition.onend = () => {
      setIsListening(false);
    };
    
    recognitionRef.current = recognition;
    recognition.start();
  };
  
  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  };

  // Wire refs for keyboard shortcut (avoids hoisting issues)
  startListeningRef.current = startListening;
  stopListeningRef.current = stopListening;

  const handleSpeak = async (text?: string) => {
    const finalText = (text || userInput).trim();
    if (!finalText || turnState !== "user_turn") return;

    sendClientLatencyLog("candidate_speech_end");

    setUserInput("");
    setInterimTranscript("");
    setTranscriptError(null);
    setTurnState("processing");

    try {
      // 1. Persist user utterance and get the updated entry back
      const newEntry = await appendTranscript(finalText, "user");
      // 2. Build updated transcript array with the NEW entry included
      //    (React state hasn't re-rendered yet — this is the fix for the stale closure bug)
      const updatedTranscript = [...transcript, newEntry];
      // 3. Call /turn with the user's utterance + fresh transcript — no stale state
      await callTurn(finalText, updatedTranscript);
    } catch (error) {
      setTranscriptError(
        error instanceof Error
          ? `Failed to send your response: ${error.message}. Please try again or use text input.`
          : "Failed to send your response. Please try again or use text input.",
      );
      setTurnState("user_turn");
    }
  };

  const isEndingRef = useRef(false);

  /**
   * Unified End-Interview Handler (Phase 6)
   * Triggered by: manual end, natural completion, integrity termination, or turn/time cap.
   */
  const endInterviewSession = useCallback(async (reason: "manual" | "natural" | "integrity" | "cap_reached") => {
    if (isEndingRef.current) return;
    isEndingRef.current = true;
    console.log(`[END_SESSION] Terminating interview session (${reason}) for ${interviewId}`);

    // 1. Immediately stop all active audio playback
    stopAiSpeech();

    // 2. Immediately stop speech recognition
    stopListening();

    // 3. Immediately stop integrity detectors
    if (integrityDetectorRef.current) {
      try {
        integrityDetectorRef.current.stop();
      } catch (e) {}
    }

    // 4. Immediately stop camera stream and release media tracks
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      setMediaStream(null);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    // 5. Update UI state to feedback transition
    setIsGeneratingFeedback(true);
    setTurnState("idle");
    setCurrentPhase("closed");

    // 6. Trigger server-side feedback generation (fire-and-forget / non-blocking)
    try {
      fetch(`/api/interviews/${interviewId}/feedback/generate`, {
        method: "POST",
      }).catch((e) => console.warn("[END_SESSION] Feedback trigger error (non-critical):", e));
    } catch {}

    // 7. Route to feedback report page (which displays full report and handles polling/fallbacks)
    router.push(`/interview/${interviewId}/feedback`);
  }, [interviewId, mediaStream, stopAiSpeech, stopListening, router]);

  const generateFeedback = async () => {
    await endInterviewSession("natural");
  };

  const handleRagQuery = async () => {
    const queryText = ragQuery.trim();
    if (!queryText || isQueryingRag || !interviewId) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: queryText,
    };

    setChatHistory((prev) => [...prev, userMessage]);
    setRagQuery("");
    setIsQueryingRag(true);

    try {
      const response = await fetch("/api/interviews/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interviewId, query: queryText }),
      });

      const data = (await response.json()) as { answer?: string; error?: string };

      if (!response.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "Failed to query interview insights",
        );
      }

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        text:
          typeof data.answer === "string" && data.answer.trim().length > 0
            ? data.answer
            : "No grounded answer was returned.",
      };

      setChatHistory((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const assistantMessage: ChatMessage = {
        id: `assistant-error-${Date.now()}`,
        role: "assistant",
        text:
          error instanceof Error
            ? error.message
            : "Failed to query interview insights",
      };

      setChatHistory((prev) => [...prev, assistantMessage]);
    } finally {
      setIsQueryingRag(false);
    }
  };

  const turnLabel: Record<TurnState, string> = {
    idle: "Initializing",
    ai_speaking: "AI Speaking",
    user_turn: "Your Turn",
    processing: "Processing",
  };

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="h-dvh w-full overflow-hidden flex flex-col bg-zinc-950 text-zinc-100 font-sans select-none">
      {/* Top Bar */}
      <header className="h-14 shrink-0 px-4 border-b border-zinc-800 bg-zinc-900/90 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-600/20 text-purple-400 font-bold text-sm">
            AI
          </div>
          <div>
            <h1 className="text-sm font-semibold text-zinc-200 leading-none">
              {jobRole}
            </h1>
            <p className="text-[11px] text-zinc-500 font-mono mt-0.5">
              ID: {interviewId?.slice(0, 8)}…
            </p>
          </div>
        </div>

        {/* Center Timer & Progress */}
        <div className="flex items-center gap-4 bg-zinc-950/60 border border-zinc-800/80 rounded-full px-4 py-1.5 text-xs">
          <div className="flex items-center gap-1.5 text-zinc-300 font-mono">
            <svg className="w-3.5 h-3.5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{formatTimer(elapsedSeconds)}</span>
          </div>
          <div className="h-3 w-[1px] bg-zinc-800" />
          <div className="font-semibold text-purple-400">
            {PHASE_LABELS[currentPhase] ?? currentPhase}
          </div>
        </div>

        {/* Right Status Pill & Provider */}
        <div className="flex items-center gap-2">
          {/* Unobtrusive Integrity Indicator */}
          <span
            onClick={() => setShowDevOverlay((prev) => !prev)}
            className={`cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
              integrityStrikes > 0
                ? "bg-amber-950/40 border-amber-500/50 text-amber-300"
                : "bg-emerald-950/30 border-emerald-500/30 text-emerald-400"
            }`}
            title="Click to toggle dev-only vision overlay"
          >
            <span className={`h-2 w-2 rounded-full ${integrityStrikes > 0 ? "bg-amber-400 animate-ping" : "bg-emerald-400 animate-pulse"}`} />
            {integrityStrikes > 0 ? `⚠️ Integrity (${integrityStrikes}/${INTEGRITY_CONFIG.maxStrikes})` : "● Integrity Active"}
          </span>

          <span className="hidden sm:inline-flex text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/50">
            {aiProvider}
          </span>
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold border ${
              isAiThinking
                ? "bg-amber-950/40 border-amber-500/50 text-amber-300 animate-pulse"
                : isAiSpeaking
                ? "bg-purple-950/40 border-purple-500/50 text-purple-300"
                : turnState === "user_turn"
                ? "bg-emerald-950/40 border-emerald-500/50 text-emerald-300"
                : "bg-zinc-900 border-zinc-800 text-zinc-400"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                isAiThinking
                  ? "bg-amber-400 animate-ping"
                  : isAiSpeaking
                  ? "bg-purple-400 animate-ping"
                  : turnState === "user_turn"
                  ? "bg-emerald-400 animate-pulse"
                  : "bg-zinc-500"
              }`}
            />
            {isAiThinking
              ? "AI Thinking"
              : isAiSpeaking
              ? "AI Speaking"
              : turnState === "user_turn"
              ? "Listening"
              : "Idle"}
          </span>
        </div>
      </header>

      {/* Integrity Warning Banner */}
      {integrityWarning && (
        <div className="bg-amber-500/20 border-b border-amber-500/40 px-4 py-2 text-xs text-amber-200 flex items-center justify-between z-20 shadow-md">
          <div className="flex items-center gap-2">
            <ShieldAlert size={16} className="text-amber-400 shrink-0" />
            <span className="font-semibold">{integrityWarning}</span>
          </div>
          <button onClick={() => setIntegrityWarning(null)} className="text-amber-400 hover:text-amber-200 text-xs font-medium">
            Dismiss
          </button>
        </div>
      )}

      {/* Dev-Only Vision Overlay */}
      {showDevOverlay && integrityDebug && (
        <div className="fixed bottom-16 left-4 z-50 bg-black/90 border border-purple-500/50 p-3 rounded-xl backdrop-blur-md text-[11px] font-mono text-zinc-300 space-y-1 shadow-2xl">
          <div className="font-bold text-purple-400 border-b border-zinc-800 pb-1 flex justify-between gap-4">
            <span>Dev Vision Overlay</span>
            <button onClick={() => setShowDevOverlay(false)} className="text-zinc-500 hover:text-zinc-300">✕</button>
          </div>
          <div>Head Yaw: <span className="text-white">{integrityDebug.yaw}°</span> (Max: {INTEGRITY_CONFIG.thresholds.yawMaxDegrees}°)</div>
          <div>Head Pitch: <span className="text-white">{integrityDebug.pitch}°</span> (Max: {INTEGRITY_CONFIG.thresholds.pitchMaxDegrees}°)</div>
          <div>Gaze Away: <span className={integrityDebug.gazeAway ? "text-amber-400 font-bold" : "text-emerald-400"}>{integrityDebug.gazeAway ? "YES" : "NO"}</span></div>
          <div>Faces Count: <span className="text-white">{integrityDebug.faceCount}</span></div>
          <div>Strikes Recorded: <span className="text-amber-400 font-bold">{integrityStrikes} / {INTEGRITY_CONFIG.maxStrikes}</span></div>
        </div>
      )}

      {/* Integrity Termination Modal */}
      {isTerminatedByIntegrity && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 select-none">
          <div className="max-w-md w-full bg-zinc-900 border border-rose-500/40 rounded-2xl p-6 text-center space-y-4 shadow-2xl">
            <div className="h-12 w-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto border border-rose-500/30">
              <ShieldAlert size={28} />
            </div>
            <h2 className="text-xl font-bold text-white">Interview Session Ended</h2>
            <p className="text-xs text-zinc-300">
              Integrity warnings were recorded during this session. The interview has been ended gracefully. Your answers provided so far have been saved and evaluated.
            </p>
            <div className="pt-2 text-xs text-purple-400 animate-pulse font-medium">Redirecting to report overview…</div>
          </div>
        </div>
      )}

      {transcriptError && (
        <div
          role="alert"
          className="border-b border-red-900/50 bg-red-950/40 px-4 py-2 text-xs text-red-300 shrink-0"
        >
          {transcriptError}
        </div>
      )}

      {/* Main Content (Tiles + Collapsible Transcript) */}
      <div className="flex-1 min-h-0 flex overflow-hidden p-3 gap-3">
        {/* Tiles Grid */}
        <div className="flex-1 min-h-0 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* AI Interviewer Tile */}
          <div
            className={`relative min-h-0 rounded-2xl bg-zinc-900/90 border border-zinc-800/90 overflow-hidden flex flex-col items-center justify-center p-4 transition-all duration-300 ${
              isAiSpeaking
                ? "ring-2 ring-purple-500/80 shadow-[0_0_25px_rgba(168,85,247,0.3)]"
                : isAiThinking
                ? "ring-2 ring-amber-500/50"
                : ""
            }`}
          >
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(139,92,246,0.15)_0%,_transparent_70%)]" />

            <div className="relative flex flex-col items-center gap-4 z-10">
              <div
                className={`relative flex h-28 w-28 sm:h-36 sm:w-36 items-center justify-center rounded-full border-2 bg-purple-950/70 transition-all ${
                  isAiSpeaking
                    ? "border-purple-300/80 shadow-[0_0_40px_rgba(168,85,247,0.4)] scale-105"
                    : "border-purple-500/40"
                }`}
              >
                {isAiSpeaking && (
                  <>
                    <div className="absolute inset-0 animate-ping rounded-full bg-purple-500/20" />
                    <div className="absolute -inset-3 animate-pulse rounded-full border border-purple-500/30" />
                  </>
                )}
                <svg
                  viewBox="0 0 64 64"
                  className="relative h-14 w-14 sm:h-16 sm:w-16 text-purple-200"
                  fill="currentColor"
                >
                  <circle cx="32" cy="22" r="12" opacity="0.9" />
                  <path d="M12 58c0-11 9-20 20-20s20 9 20 20" opacity="0.7" />
                </svg>
              </div>

              {/* Waveform / Visualizer */}
              <div className="flex h-6 items-end gap-1" aria-label="AI speech activity">
                {Array.from({ length: 12 }).map((_, i) => (
                  <span
                    key={i}
                    className={`w-1 rounded-full transition-all ${
                      isAiSpeaking
                        ? "bg-purple-300"
                        : isAiThinking
                        ? "bg-amber-400/60"
                        : "bg-purple-900/40"
                    }`}
                    style={{
                      height: isAiSpeaking
                        ? `${10 + (i % 6) * 4}px`
                        : isAiThinking
                        ? `${6 + (i % 4) * 3}px`
                        : "6px",
                      animation: isAiSpeaking
                        ? `speechBar ${0.4 + (i % 4) * 0.15}s ease-in-out infinite alternate`
                        : isAiThinking
                        ? `speechBar 0.8s ease-in-out infinite alternate`
                        : undefined,
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Label Badge */}
            <div className="absolute bottom-3 left-3 z-20 flex items-center gap-2 rounded-lg bg-zinc-950/80 backdrop-blur-md px-3 py-1.5 border border-zinc-800">
              <span className={`h-2 w-2 rounded-full ${isAiSpeaking ? "bg-purple-400 animate-pulse" : "bg-zinc-500"}`} />
              <span className="text-xs font-semibold text-zinc-200">AI Interviewer</span>
            </div>
          </div>

          {/* Candidate Tile */}
          <div
            className={`relative min-h-0 rounded-2xl bg-zinc-900/90 border border-zinc-800/90 overflow-hidden flex flex-col items-center justify-center p-4 transition-all duration-300 ${
              turnState === "user_turn" && isListening
                ? "ring-2 ring-emerald-500/80 shadow-[0_0_25px_rgba(16,185,129,0.3)]"
                : ""
            }`}
          >
            {/* Always-mounted video element — visibility toggled to avoid srcObject race */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`absolute inset-0 h-full w-full object-cover transform -scale-x-100 rounded-2xl z-0 transition-opacity duration-300 ${
                isCameraOn && mediaStream ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
            />

            {/* Gradient overlay when webcam is active */}
            {isCameraOn && mediaStream && (
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/80 via-transparent to-zinc-950/20 z-10 pointer-events-none" />
            )}

            {/* Background gradient when camera is off */}
            {(!isCameraOn || !mediaStream) && (
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(14,165,233,0.15)_0%,_transparent_70%)]" />
            )}

            {/* Avatar Placeholder when Camera is Off */}
            {(!isCameraOn || !mediaStream) && (
              <div className="relative flex flex-col items-center gap-4 z-10">
                <div
                  className={`relative flex h-28 w-28 sm:h-36 sm:w-36 items-center justify-center rounded-full border-2 bg-emerald-950/70 transition-all ${
                    turnState === "user_turn" && isListening
                      ? "border-emerald-300/80 shadow-[0_0_40px_rgba(16,185,129,0.4)] scale-105"
                      : "border-emerald-500/40"
                  }`}
                >
                  {turnState === "user_turn" && isListening && (
                    <>
                      <div className="absolute inset-0 animate-ping rounded-full bg-emerald-500/20" />
                      <div className="absolute -inset-3 animate-pulse rounded-full border border-emerald-500/30" />
                    </>
                  )}
                  <svg
                    viewBox="0 0 64 64"
                    className="relative h-14 w-14 sm:h-16 sm:w-16 text-emerald-200"
                    fill="currentColor"
                  >
                    <circle cx="32" cy="22" r="12" opacity="0.9" />
                    <path d="M12 58c0-11 9-20 20-20s20 9 20 20" opacity="0.7" />
                  </svg>
                </div>

                {/* Speech visualizer */}
                <div className="flex h-6 items-end gap-1" aria-label="Candidate speech activity">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <span
                      key={i}
                      className={`w-1 rounded-full transition-all ${
                        isListening ? "bg-emerald-300" : "bg-emerald-900/40"
                      }`}
                      style={{
                        height: isListening ? `${10 + (i % 6) * 4}px` : "6px",
                        animation: isListening
                          ? `speechBar ${0.4 + (i % 4) * 0.15}s ease-in-out infinite alternate`
                          : undefined,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Floating Speech Visualizer Overlay when Camera is On */}
            {isCameraOn && mediaStream && (
              <div className="absolute bottom-12 left-3 z-20 flex h-6 items-end gap-1 bg-zinc-950/70 backdrop-blur-md px-2.5 py-1 rounded-lg border border-zinc-800/80">
                {Array.from({ length: 8 }).map((_, i) => (
                  <span
                    key={i}
                    className={`w-1 rounded-full transition-all ${
                      isListening ? "bg-emerald-400" : "bg-zinc-600"
                    }`}
                    style={{
                      height: isListening ? `${8 + (i % 5) * 3}px` : "4px",
                      animation: isListening
                        ? `speechBar ${0.4 + (i % 3) * 0.15}s ease-in-out infinite alternate`
                        : undefined,
                    }}
                  />
                ))}
              </div>
            )}

            {/* Silence Nudge Badge when Candidate is Silent */}
            {showSilenceHint && turnState === "user_turn" && (
              <div className="absolute top-3 left-3 z-20 flex items-center gap-2 rounded-lg bg-amber-950/80 border border-amber-500/40 px-3 py-1.5 text-xs text-amber-200 backdrop-blur-md animate-bounce">
                <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
                <span>Listening... Take your time! Feel free to answer or ask for a hint.</span>
              </div>
            )}

            {/* Label Badge */}
            <div className="absolute bottom-3 left-3 z-20 flex items-center gap-2 rounded-lg bg-zinc-950/80 backdrop-blur-md px-3 py-1.5 border border-zinc-800">
              <span
                className={`h-2 w-2 rounded-full ${
                  isCameraOn && mediaStream
                    ? "bg-emerald-400 animate-pulse"
                    : isListening
                    ? "bg-emerald-400 animate-pulse"
                    : "bg-amber-400"
                }`}
              />
              <span className="text-xs font-semibold text-zinc-200">
                You (Candidate) {isCameraOn && mediaStream ? "" : "• Cam Off"}
              </span>
            </div>

            {/* Camera error toast / notice */}
            {cameraError && (
              <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 rounded-lg bg-rose-950/80 border border-rose-800/80 px-2.5 py-1 text-[11px] text-rose-300 backdrop-blur-md">
                <span>Camera unavailable</span>
              </div>
            )}
          </div>
        </div>

        {/* Collapsible Transcript Panel */}
        {showTranscriptPanel && (
          <aside className="w-80 lg:w-96 shrink-0 flex flex-col min-h-0 rounded-2xl bg-zinc-900/95 border border-zinc-800 overflow-hidden shadow-2xl z-20">
            <div className="h-11 shrink-0 border-b border-zinc-800 px-4 flex items-center justify-between bg-zinc-900/90">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                  Live Transcript
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowTranscriptPanel(false)}
                className="text-zinc-500 hover:text-zinc-300 p-1 rounded-md hover:bg-zinc-800 transition-colors"
                title="Hide Transcript"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Scrollable messages */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
              {transcript.length === 0 ? (
                <div className="h-full flex items-center justify-center text-center p-6 text-zinc-500 text-xs">
                  {turnState === "processing"
                    ? "Initializing session..."
                    : isAiThinking
                    ? "AI is thinking..."
                    : "Transcript will appear here in real-time."}
                </div>
              ) : (
                transcript.map((entry) => (
                  <div
                    key={entry.id}
                    className={`flex flex-col gap-1 ${entry.speaker === "user" ? "items-end" : "items-start"}`}
                  >
                    <span className="text-[10px] font-semibold text-zinc-500 px-1">
                      {entry.speaker === "ai" ? "AI Interviewer" : "Candidate"}
                    </span>
                    <div
                      className={`max-w-[90%] rounded-xl px-3.5 py-2 text-xs leading-relaxed ${
                        entry.speaker === "ai"
                          ? "bg-purple-950/50 text-purple-100 border border-purple-800/40"
                          : "bg-emerald-950/50 text-emerald-100 border border-emerald-800/40"
                      }`}
                    >
                      {entry.text}
                    </div>
                  </div>
                ))
              )}

              {isAiThinking && (
                <div className="flex flex-col gap-1 items-start">
                  <span className="text-[10px] font-semibold text-zinc-500 px-1">AI Interviewer</span>
                  <div className="rounded-xl bg-purple-950/30 border border-purple-800/30 px-3 py-2 text-xs text-purple-300 flex items-center gap-2">
                    <span className="animate-bounce">•</span>
                    <span className="animate-bounce" style={{ animationDelay: "0.15s" }}>•</span>
                    <span className="animate-bounce" style={{ animationDelay: "0.3s" }}>•</span>
                    <span className="text-zinc-400">Processing answer...</span>
                  </div>
                </div>
              )}
              <div ref={transcriptEndRef} />
            </div>

            {/* Input Footer */}
            <div className="shrink-0 border-t border-zinc-800 bg-zinc-950/80 p-3">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleSpeak();
                    }
                  }}
                  disabled={turnState !== "user_turn"}
                  placeholder={
                    turnState === "user_turn"
                      ? "Type answer or press [M] to speak..."
                      : "Waiting for AI..."
                  }
                  className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 outline-none focus:border-purple-500/50 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => void handleSpeak()}
                  disabled={!userInput.trim() || turnState !== "user_turn"}
                  className="rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-500 disabled:opacity-40 transition-colors"
                >
                  Send
                </button>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Bottom Control Bar */}
      <footer className="h-16 shrink-0 bg-zinc-900/95 border-t border-zinc-800 px-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono text-[10px] border border-zinc-700">M</kbd>
          <span className="hidden sm:inline">Press M to toggle mic</span>
        </div>

        {/* Center Controls */}
        <div className="flex items-center gap-3">
          {/* Mic Button */}
          <button
            type="button"
            onClick={isListening ? stopListening : startListening}
            disabled={turnState !== "user_turn"}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              isListening
                ? "bg-red-600 hover:bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)]"
                : turnState === "user_turn"
                ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
            }`}
            title="Toggle Mic (Key M)"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
            <span>{isListening ? "Mute Mic" : "Unmute Mic"}</span>
          </button>

          {/* Camera Button Placeholder */}
          <button
            type="button"
            onClick={() => setIsCameraOn(!isCameraOn)}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
              isCameraOn
                ? "bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700"
                : "bg-red-950/40 border-red-800/40 text-red-300"
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <span className="hidden sm:inline">{isCameraOn ? "Cam On" : "Cam Off"}</span>
          </button>

          {/* Captions / Transcript Toggle */}
          <button
            type="button"
            onClick={() => setShowTranscriptPanel(!showTranscriptPanel)}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
              showTranscriptPanel
                ? "bg-purple-950/50 border-purple-700 text-purple-300"
                : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700"
            }`}
            title="Toggle Transcript Drawer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <span className="hidden sm:inline">Transcript</span>
          </button>

          {/* End Interview */}
          <button
            type="button"
            onClick={() => setShowEndModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-500 text-white transition-all shadow-[0_0_15px_rgba(239,68,68,0.3)]"
          >
            <span>End Call</span>
          </button>
        </div>

        <div className="text-xs text-zinc-500">
          <span className="hidden sm:inline">Zoom Style Call</span>
        </div>
      </footer>

      {/* End Confirmation Modal */}
      {showEndModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-zinc-900 border border-zinc-800 p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-zinc-100">End Interview?</h3>
            <p className="text-xs text-zinc-400 mt-2">
              Are you sure you want to exit? Your transcript will be saved and AI feedback will be generated.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowEndModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowEndModal(false);
                  void generateFeedback();
                }}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-500"
              >
                End & Get Feedback
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Feedback Modal */}
      {showFeedback && feedback && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-zinc-900 border border-zinc-800 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Interview Feedback</h2>
              <button
                onClick={() => setShowFeedback(false)}
                className="text-zinc-400 hover:text-white"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Overall Score */}
            <div className="mb-6 rounded-xl bg-zinc-800 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-400">Overall Score</span>
                <span className={`text-3xl font-bold ${
                  feedback.overallScore >= 90 ? 'text-emerald-400' :
                  feedback.overallScore >= 75 ? 'text-green-400' :
                  feedback.overallScore >= 60 ? 'text-yellow-400' : 'text-red-400'
                }`}>
                  {feedback.overallScore}/100
                </span>
              </div>
              <div className="mt-2 text-sm text-zinc-300">{feedback.summary}</div>
            </div>

            {/* Hiring Recommendation */}
            <div className="mb-6 rounded-xl bg-zinc-800 p-4">
              <span className="text-sm font-medium text-zinc-400">Hiring Recommendation</span>
              <div className={`mt-2 inline-flex rounded-full px-3 py-1 text-sm font-medium ${
                feedback.hiringRecommendation === 'strong_hire' ? 'bg-emerald-900/50 text-emerald-300' :
                feedback.hiringRecommendation === 'hire' ? 'bg-green-900/50 text-green-300' :
                feedback.hiringRecommendation === 'consider' ? 'bg-yellow-900/50 text-yellow-300' :
                'bg-red-900/50 text-red-300'
              }`}>
                {feedback.hiringRecommendation.replace('_', ' ').toUpperCase()}
              </div>
            </div>

            {/* Strengths */}
            {feedback.strengths.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-zinc-300 mb-3">Strengths</h3>
                <ul className="space-y-2">
                  {feedback.strengths.map((strength: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-zinc-400">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                      {strength}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Areas for Improvement */}
            {feedback.areasForImprovement.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-zinc-300 mb-3">Areas for Improvement</h3>
                <ul className="space-y-2">
                  {feedback.areasForImprovement.map((gap: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-zinc-400">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-yellow-400 flex-shrink-0" />
                      {gap}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Skill Assessments */}
            {feedback.skillAssessments.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-zinc-300 mb-3">Skill Assessments</h3>
                <div className="space-y-3">
                  {feedback.skillAssessments.map((skill: any, i: number) => (
                    <div key={i} className="rounded-lg bg-zinc-800 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-zinc-200">{skill.skill}</span>
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          skill.confidence === 'high' ? 'bg-emerald-900/50 text-emerald-300' :
                          skill.confidence === 'medium' ? 'bg-yellow-900/50 text-yellow-300' :
                          'bg-red-900/50 text-red-300'
                        }`}>
                          {skill.confidence}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400">{skill.notes}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Question Feedback */}
            {feedback.questionFeedback.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-zinc-300 mb-3">Question-by-Question Feedback</h3>
                <div className="space-y-4">
                  {feedback.questionFeedback.map((qf: any, i: number) => (
                    <div key={i} className="rounded-lg bg-zinc-800 p-4">
                      <div className="mb-2">
                        <span className="text-xs text-zinc-500">{qf.focusArea}</span>
                        <p className="text-sm font-medium text-zinc-200 mt-1">{qf.question}</p>
                      </div>
                      <div className="mb-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          qf.answerQuality === 'excellent' ? 'bg-emerald-900/50 text-emerald-300' :
                          qf.answerQuality === 'good' ? 'bg-green-900/50 text-green-300' :
                          qf.answerQuality === 'fair' ? 'bg-yellow-900/50 text-yellow-300' :
                          'bg-red-900/50 text-red-300'
                        }`}>
                          {qf.answerQuality}
                        </span>
                      </div>
                      {qf.strengths.length > 0 && (
                        <div className="mb-2">
                          <span className="text-xs text-zinc-500">Strengths:</span>
                          <ul className="mt-1 space-y-1">
                            {qf.strengths.map((s: string, j: number) => (
                              <li key={j} className="text-xs text-zinc-400">• {s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {qf.gaps.length > 0 && (
                        <div className="mb-2">
                          <span className="text-xs text-zinc-500">Gaps:</span>
                          <ul className="mt-1 space-y-1">
                            {qf.gaps.map((g: string, j: number) => (
                              <li key={j} className="text-xs text-zinc-400">• {g}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {qf.suggestedImprovement && (
                        <div className="mt-2 p-2 rounded bg-zinc-900/50">
                          <span className="text-xs text-zinc-500">Suggestion:</span>
                          <p className="text-xs text-zinc-300 mt-1">{qf.suggestedImprovement}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Integrity Signals (Advisory for Reviewer) */}
            <div className="mb-6 rounded-xl bg-zinc-800/90 border border-zinc-700/60 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={18} className="text-purple-400" />
                  <h3 className="text-sm font-semibold text-zinc-200">Integrity Signals for Reviewer</h3>
                </div>
                <span className="text-[11px] px-2 py-0.5 rounded bg-zinc-700 text-zinc-300 font-mono">
                  {feedback.integrityEvents?.length || 0} Events Logged
                </span>
              </div>

              <div className="mb-3 p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800 text-[11px] text-zinc-400">
                ℹ️ <span className="font-semibold text-zinc-300">Advisory Notice:</span> These integrity signals are local vision events recorded during the live session. They are advisory metrics intended for human reviewer context.
              </div>

              {feedback.integrityEvents && feedback.integrityEvents.length > 0 ? (
                <div className="space-y-2">
                  {feedback.integrityEvents.map((evt: any, i: number) => (
                    <div key={i} className="flex items-start justify-between bg-zinc-900 p-2.5 rounded-lg border border-zinc-800/80 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                        <div>
                          <span className="font-semibold text-zinc-200 uppercase tracking-wider text-[11px]">{evt.type.replace("_", " ")}</span>
                          <p className="text-[11px] text-zinc-400">{evt.details || "Sustained anomaly detected"}</p>
                        </div>
                      </div>
                      <span className="text-[10px] text-zinc-500 font-mono">
                        {new Date(evt.timestamp).toLocaleTimeString()} ({Math.round((evt.durationMs || 0) / 1000)}s)
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-emerald-400 font-medium flex items-center gap-1.5">
                  ✓ Clean Session: No integrity anomalies were recorded during this interview.
                </p>
              )}
            </div>

            {/* Recommended Follow-up */}
            {feedback.recommendedFollowUp && (
              <div className="mb-6 rounded-xl bg-purple-900/20 border border-purple-800/30 p-4">
                <h3 className="text-sm font-semibold text-purple-300 mb-2">Recommended Follow-up</h3>
                <p className="text-sm text-zinc-300">{feedback.recommendedFollowUp}</p>
              </div>
            )}

            {/* Interview Duration */}
            <div className="text-xs text-zinc-500">
              Interview Duration: {feedback.interviewDuration} minutes
            </div>
          </div>
        </div>
      )}

      {/* Generating Feedback Overlay */}
      {isGeneratingFeedback && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="text-center">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-purple-500/30 border-t-purple-500 mx-auto mb-4" />
            <p className="text-lg font-medium text-white">Generating Interview Feedback...</p>
            <p className="text-sm text-zinc-400 mt-2">AI is analyzing your responses</p>
          </div>
        </div>
      )}

      <style>{`
        @keyframes speechBar {
          from { transform: scaleY(0.4); opacity: 0.5; }
          to { transform: scaleY(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
