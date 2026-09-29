"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DUMMY_RESUME_ID,
  MOCK_STRUCTURED_RESUME,
} from "@/src/lib/default-interview-plan";

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

type OrchestratorDecision = {
  phase: "greeting" | "rapport" | "technical" | "wrapup" | "closed";
  aiUtterance: string;
  phaseComplete: boolean;
  reasoning?: string;
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
  
  // Orchestrator state
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [aiProvider, setAiProvider] = useState<"gemini" | "groq" | "fallback">("gemini");
  const [isSwitchingProvider, setIsSwitchingProvider] = useState(false);
  const [ttsProvider, setTtsProvider] = useState<"browser" | "sarvam">("sarvam");
  const [currentPhase, setCurrentPhase] = useState<"greeting" | "rapport" | "technical" | "wrapup" | "closed">("greeting");
  const [totalTurns, setTotalTurns] = useState(0);
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

  // Candidate webcam stream effect (getUserMedia)
  useEffect(() => {
    let isMounted = true;
    let activeStream: MediaStream | null = null;

    const startWebcam = async () => {
      if (!isCameraOn) {
        if (mediaStream) {
          mediaStream.getTracks().forEach((track) => track.stop());
          setMediaStream(null);
        }
        return;
      }

      try {
        setCameraError(null);
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });

        if (!isMounted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        activeStream = stream;
        setMediaStream(stream);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err: any) {
        console.warn("[WEBCAM] getUserMedia failed or permission denied:", err);
        if (isMounted) {
          setCameraError(err.message || "Camera access denied");
          setIsCameraOn(false);
          setMediaStream(null);
        }
      }
    };

    startWebcam();

    return () => {
      isMounted = false;
      if (activeStream) {
        activeStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [isCameraOn]);

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
      body: JSON.stringify({ text, speaker: "aditya" }),
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

  const callOrchestrator = useCallback(async () => {
    console.log("[ORCHESTRATOR CALL] Interview ID being used:", interviewId);
    console.log("[ORCHESTRATOR CALL] Current totalTurns state:", totalTurns);
    console.log("[ORCHESTRATOR CALL] candidateProfile:", candidateProfile);
    
    if (!interviewId) return;

    // Guard against multiple simultaneous calls
    if (isAttemptingOrchestratorRef.current) {
      console.log("[ORCHESTRATOR CALL] Already attempting orchestrator, skipping duplicate call");
      return;
    }

    isAttemptingOrchestratorRef.current = true;
    console.log("[ORCHESTRATOR CALL] Set attempting flag to true");

    setIsAiThinking(true);
    setIsSwitchingProvider(false);
    setAiProvider("gemini"); // Reset to default
    
    const newTotalTurns = totalTurns + 1;
    setTotalTurns(newTotalTurns);

    console.log("[ORCHESTRATOR CALL] Calculated newTotalTurns:", newTotalTurns);

    const payload = {
      interviewId,
      currentPhase,
      transcript: transcript.map(entry => ({
        speaker: entry.speaker,
        content: entry.text,
        timestamp: entry.timestamp.toISOString(),
      })),
      resumeData: candidateProfile || MOCK_STRUCTURED_RESUME, // Use fallback if null
      jobRole,
      geminiCallsCount: 0, // Will be updated by backend
      totalTurns: newTotalTurns,
      adaptiveDecisionsCount: 0, // Will be updated by backend
    };
    console.log("[ORCHESTRATOR] Payload:", payload);

    try {
      const response = await fetch(`/api/interviews/${interviewId}/orchestrator`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      console.log("[ORCHESTRATOR] Response status:", response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("[ORCHESTRATOR] Error response:", errorText);
        
        // Check if it's a provider switch
        if (response.headers.get("X-AI-Provider")) {
          const provider = response.headers.get("X-AI-Provider");
          setAiProvider(provider as "gemini" | "groq" | "fallback");
          setIsSwitchingProvider(true);
          setTimeout(() => setIsSwitchingProvider(false), 2000);
        }
        
        throw new Error(`Orchestrator failed: ${response.status} - ${errorText}`);
      }

      const decision = await response.json() as OrchestratorDecision;
      
      // Check which provider was used
      if (response.headers.get("X-AI-Provider")) {
        const provider = response.headers.get("X-AI-Provider");
        setAiProvider(provider as "gemini" | "groq" | "fallback");
        console.log("[ORCHESTRATOR] AI provider used:", provider);
      }
      console.log("[ORCHESTRATOR] Decision:", decision);
      console.log("[ORCHESTRATOR] aiUtterance field:", decision.aiUtterance);
      
      setCurrentPhase(decision.phase);
      setIsAiThinking(false);

      if (decision.phase === "closed") {
        // Interview complete, generate feedback
        await generateFeedback();
      } else {
        // Prefetch TTS audio in background to minimize playback latency
        if (decision.aiUtterance) {
          fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: decision.aiUtterance, speaker: "aditya" }),
          }).catch(() => {}); // Fire and forget prefetch
        }

        // Speak the AI's utterance
        console.log("[ORCHESTRATOR] About to speak aiUtterance:", decision.aiUtterance);
        await speakAiQuestion(decision.aiUtterance);
      }
    } catch (error) {
      console.error("[ORCHESTRATOR] Error:", error);
      setIsAiThinking(false);
      setTranscriptError("Failed to get AI response. Please try again.");
      setTurnState("user_turn");
    } finally {
      isAttemptingOrchestratorRef.current = false;
      console.log("[ORCHESTRATOR CALL] Reset attempting flag to false");
    }
  }, [interviewId, currentPhase, transcript, candidateProfile, jobRole, totalTurns, speakAiQuestion]);

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

  useEffect(() => {
    if (!interviewId) return;

    // Validate interview ID format (UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(interviewId)) {
      console.error("[LOAD SESSION] Invalid interview ID format:", interviewId);
      setTranscriptError("Invalid interview ID. Please start a new interview from the home page.");
      setTurnState("idle");
      // Redirect to home after a short delay
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

        // If transcript is empty, this is a fresh interview - call orchestrator for greeting
        if (entries.length === 0) {
          // Will be handled by a separate effect
          setTurnState("processing");
          return;
        }

        // If transcript exists, check if we need to continue or if interview is complete
        const lastEntry = entries[entries.length - 1];
        if (lastEntry.speaker === "ai") {
          // AI just spoke, it's user's turn
          setTurnState("user_turn");
        } else {
          // User just spoke, need to call orchestrator for next AI response
          // Will be handled by a separate effect
          setTurnState("processing");
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
  }, [interviewId, router]);

  // Separate effect to call orchestrator when needed
  useEffect(() => {
    if (turnState !== "processing" || transcript.length === 0) return;
    
    const lastEntry = transcript[transcript.length - 1];
    if (lastEntry.speaker === "user") {
      // User just spoke, call orchestrator
      console.log("[EFFECT] Calling orchestrator after user response");
      void callOrchestrator();
    }
  }, [transcript, turnState, callOrchestrator]);

  // Call orchestrator on first load if transcript is empty
  useEffect(() => {
    console.log("[EFFECT] First load check - turnState:", turnState, "transcript length:", transcript.length);
    if (turnState === "processing" && transcript.length === 0 && interviewId) {
      console.log("[EFFECT] Calling orchestrator for initial greeting");
      void callOrchestrator();
    }
  }, [turnState, transcript.length, interviewId, callOrchestrator]);

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

    setUserInput("");
    setInterimTranscript("");
    setTranscriptError(null);
    setTurnState("processing");

    try {
      await appendTranscript(finalText, "user");
      // Call orchestrator for next AI response
      await callOrchestrator();
    } catch (error) {
      setTranscriptError(
        error instanceof Error 
          ? `Failed to send your response: ${error.message}. Please try again or use text input.`
          : "Failed to send your response. Please try again or use text input.",
      );
      setTurnState("user_turn");
    }
  };

  const generateFeedback = async () => {
    if (!interviewId || isGeneratingFeedback) return;

    setIsGeneratingFeedback(true);
    setTurnState("processing");

    try {
      const response = await fetch(`/api/interviews/${interviewId}/feedback/generate`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Failed to generate feedback");
      }

      setFeedback(data);
      setShowFeedback(true);
      setTurnState("idle");
    } catch (error) {
      setTranscriptError(
        error instanceof Error 
          ? `Failed to generate feedback: ${error.message}. The interview completed but feedback generation failed.`
          : "Failed to generate feedback. The interview completed but feedback generation failed.",
      );
      setTurnState("idle");
    } finally {
      setIsGeneratingFeedback(false);
    }
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
            Q {Math.min(totalTurns + 1, 5)}/5
          </div>
        </div>

        {/* Right Status Pill & Provider */}
        <div className="flex items-center gap-2">
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
            {/* Real Live Webcam Feed */}
            {isCameraOn && mediaStream ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 h-full w-full object-cover transform -scale-x-100 rounded-2xl z-0"
              />
            ) : (
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(14,165,233,0.15)_0%,_transparent_70%)]" />
            )}

            {/* Subtle dark gradient overlay when webcam is active for readability */}
            {isCameraOn && mediaStream && (
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/80 via-transparent to-zinc-950/20 z-10 pointer-events-none" />
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
