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
  const [ttsProvider, setTtsProvider] = useState<"browser" | "sarvam">("browser");
  const [currentPhase, setCurrentPhase] = useState<"greeting" | "rapport" | "technical" | "wrapup" | "closed">("greeting");
  const [totalTurns, setTotalTurns] = useState(0);
  const [candidateProfile, setCandidateProfile] = useState<any>(null);

  // End Interview flow state
  const [showEndModal, setShowEndModal] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [endingStep, setEndingStep] = useState<
    "idle" | "stopping_audio" | "saving_transcript" | "finalizing" | "generating_feedback"
  >("idle");
  const isEndingRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  
  const [isSessionLoaded, setIsSessionLoaded] = useState(false);
  const recognitionRef = useRef<any>(null);
  const synthesisRef = useRef<SpeechSynthesis | null>(null);
  const [jobRole, setJobRole] = useState("Software Developer");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [ragQuery, setRagQuery] = useState("");
  const [isQueryingRag, setIsQueryingRag] = useState(false);

  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const isAttemptingOrchestratorRef = useRef(false);

  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);

  const isAiSpeaking = turnState === "ai_speaking";

  const stopAllAudioAndMic = useCallback(() => {
    console.log("[TEARDOWN] Halting audio playback and microphone input...");
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.stop();
      } catch (e) {
        console.warn("Failed to stop speech recognition:", e);
      }
    }
    setIsListening(false);

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {
        console.warn("Failed to cancel speechSynthesis:", e);
      }
    }

    if (currentAudioRef.current) {
      try {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      } catch (e) {
        console.warn("Failed to pause audio element:", e);
      }
    }
  }, []);

  const appendTranscript = useCallback(
    async (content: string, speaker: "user" | "ai") => {
      if (!interviewId || isEndingRef.current) {
        console.log("[TRANSCRIPT APPEND] Skipped - missing ID or interview terminating");
        return;
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

      if (isEndingRef.current) return;

      const entry = mapChunkToEntry(data as TranscriptChunkRecord);
      setTranscript((prev) => [...prev, entry]);
      return entry;
    },
    [interviewId],
  );

  const speakAiQuestion = useCallback(
    async (questionText: string) => {
      if (isEndingRef.current) {
        console.log("[SPEAK AI] Skipped - interview is terminating");
        return;
      }
      console.log("[SPEAK AI] Question text:", questionText);
      if (!questionText || questionText.trim().length === 0) {
        console.error("[SPEAK AI] Empty question text provided");
        return;
      }

      setTurnState("ai_speaking");
      await appendTranscript(questionText, "ai");
      
      if (isEndingRef.current) return;
      
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
    const sarvamApiKey = process.env.NEXT_PUBLIC_SARVAM_API_KEY;
    if (!sarvamApiKey) {
      throw new Error("NEXT_PUBLIC_SARVAM_API_KEY not configured");
    }

    // Use correct Sarvam API endpoint according to official docs
    const response = await fetch("https://api.sarvam.ai/text-to-speech/convert", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": sarvamApiKey,
      },
      body: JSON.stringify({
        model: "bulbul:v3",
        text: text,
        target_language_code: "en-IN",
        speaker: "aditya", // Male voice for AI interviewer
        output_format: "wav",
        sample_rate: 24000,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Sarvam TTS failed: ${response.status} - ${errorData.message || 'Unknown error'}`);
    }

    const data = await response.json();
    
    // Decode base64 audio according to official docs
    const audioBase64 = data.audios[0];
    const audioBytes = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
    const audioBlob = new Blob([audioBytes], { type: 'audio/wav' });
    const audioUrl = URL.createObjectURL(audioBlob);
    
    const audio = new Audio(audioUrl);
    currentAudioRef.current = audio;
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => {
        currentAudioRef.current = null;
        URL.revokeObjectURL(audioUrl);
        resolve();
      };
      audio.onerror = (e) => {
        currentAudioRef.current = null;
        URL.revokeObjectURL(audioUrl);
        reject(new Error("Audio playback failed"));
      };
      audio.oncanplaythrough = () => {
        audio.play().catch(reject);
      };
    });
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

  const generateFeedback = useCallback(async () => {
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
      router.push(`/interview/${interviewId}/feedback`);
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
  }, [interviewId, isGeneratingFeedback, router]);

  const callOrchestrator = useCallback(async () => {
    console.log("[ORCHESTRATOR CALL] Interview ID being used:", interviewId);
    console.log("[ORCHESTRATOR CALL] Current totalTurns state:", totalTurns);
    console.log("[ORCHESTRATOR CALL] candidateProfile:", candidateProfile);
    
    if (!interviewId || isEndingRef.current) return;

    // Guard against multiple simultaneous calls
    if (isAttemptingOrchestratorRef.current) {
      console.log("[ORCHESTRATOR CALL] Already attempting orchestrator, skipping duplicate call");
      return;
    }

    isAttemptingOrchestratorRef.current = true;
    console.log("[ORCHESTRATOR CALL] Set attempting flag to true");

    const controller = new AbortController();
    abortControllerRef.current = controller;

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
        signal: controller.signal,
      });

      if (isEndingRef.current || controller.signal.aborted) {
        console.log("[ORCHESTRATOR] Interview terminated / aborted during fetch, ignoring response");
        return;
      }

      console.log("[ORCHESTRATOR] Response status:", response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("[ORCHESTRATOR] Error response:", errorText);
        
        if (response.headers.get("X-AI-Provider")) {
          const provider = response.headers.get("X-AI-Provider");
          setAiProvider(provider as "gemini" | "groq" | "fallback");
          setIsSwitchingProvider(true);
          setTimeout(() => setIsSwitchingProvider(false), 2000);
        }
        
        throw new Error(`Orchestrator failed: ${response.status} - ${errorText}`);
      }

      const decision = await response.json() as OrchestratorDecision;

      if (isEndingRef.current || controller.signal.aborted) {
        console.log("[ORCHESTRATOR] Interview terminated / aborted after json parse, skipping utterance");
        return;
      }
      
      if (response.headers.get("X-AI-Provider")) {
        const provider = response.headers.get("X-AI-Provider");
        setAiProvider(provider as "gemini" | "groq" | "fallback");
        console.log("[ORCHESTRATOR] AI provider used:", provider);
      }
      console.log("[ORCHESTRATOR] Decision:", decision);
      
      setCurrentPhase(decision.phase);
      setIsAiThinking(false);

      if (decision.phase === "closed") {
        await generateFeedback();
      } else {
        await speakAiQuestion(decision.aiUtterance);
      }
    } catch (error: any) {
      if (error?.name === "AbortError" || isEndingRef.current) {
        console.log("[ORCHESTRATOR] Request aborted due to interview termination");
        return;
      }
      console.error("[ORCHESTRATOR] Error:", error);
      setIsAiThinking(false);
      setTranscriptError("Failed to get AI response. Please try again.");
      setTurnState("user_turn");
    } finally {
      isAttemptingOrchestratorRef.current = false;
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }, [interviewId, currentPhase, transcript, candidateProfile, jobRole, totalTurns, speakAiQuestion, generateFeedback]);

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

        if (interview?.status === "completed" || interview?.currentPhase === "closed") {
          console.log("[LOAD SESSION] Interview is completed/closed. Redirecting to feedback page...");
          isEndingRef.current = true;
          router.push(`/interview/${interviewId}/feedback`);
          return;
        }

        setJobRole(interview?.jobRole ?? "Software Developer");
        setCurrentPhase((interview?.currentPhase as any) || "greeting");
        setCandidateProfile(interview?.feedback?.candidateProfile || null);

        const entries = chunks.map(mapChunkToEntry);
        setTranscript(entries);
        setIsSessionLoaded(true);

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
    if (!isSessionLoaded || isEndingRef.current || turnState !== "processing" || transcript.length === 0) return;
    
    const lastEntry = transcript[transcript.length - 1];
    if (lastEntry.speaker === "user") {
      // User just spoke, call orchestrator
      console.log("[EFFECT] Calling orchestrator after user response");
      void callOrchestrator();
    }
  }, [isSessionLoaded, transcript, turnState, callOrchestrator]);

  // Call orchestrator on first load if transcript is empty
  useEffect(() => {
    console.log("[EFFECT] First load check - turnState:", turnState, "transcript length:", transcript.length, "isSessionLoaded:", isSessionLoaded);
    if (isSessionLoaded && !isEndingRef.current && turnState === "processing" && transcript.length === 0 && interviewId) {
      console.log("[EFFECT] Calling orchestrator for initial greeting");
      void callOrchestrator();
    }
  }, [isSessionLoaded, turnState, transcript.length, interviewId, callOrchestrator]);

  const handleTranscriptScroll = useCallback(() => {
    const container = transcriptContainerRef.current;
    if (!container) return;

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const isNearBottom = distanceFromBottom < 80;

    setIsUserScrolledUp(!isNearBottom);
  }, []);

  // Smart auto-scroll: Only scroll to bottom on new entries if candidate is already near bottom
  useEffect(() => {
    const container = transcriptContainerRef.current;
    if (!container) {
      transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const isNearBottom = distanceFromBottom < 100;

    if (isNearBottom || !isUserScrolledUp) {
      transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcript, isUserScrolledUp]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, isQueryingRag]);

  const startListening = () => {
    if (!supportsSpeechRecognition || isListening) return;
    
    // Don't allow listening if AI is speaking or processing
    if (turnState === "ai_speaking" || turnState === "processing") {
      console.log("[SPEECH] Cannot listen - AI is speaking or processing");
      return;
    }
    
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

  const handleConfirmEndInterview = async () => {
    setShowEndModal(false);
    setIsEnding(true);
    isEndingRef.current = true;

    // 1. Abort any in-flight orchestrator requests immediately
    if (abortControllerRef.current) {
      try {
        console.log("[TEARDOWN] Aborting in-flight orchestrator fetch request");
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      } catch (e) {
        console.warn("Failed to abort orchestrator controller:", e);
      }
    }

    // 2. Stop microphone & audio playback
    setEndingStep("stopping_audio");
    stopAllAudioAndMic();
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 3. Saving transcript & finalizing
    setEndingStep("saving_transcript");
    await new Promise((resolve) => setTimeout(resolve, 300));

    setEndingStep("finalizing");
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 4. Generating feedback
    setEndingStep("generating_feedback");
    setIsGeneratingFeedback(true);

    try {
      const response = await fetch(`/api/interviews/${interviewId}/feedback/generate`, {
        method: "POST",
      });
      const data = await response.json();
      if (response.ok) {
        setFeedback(data);
      }
    } catch (err) {
      console.error("[END INTERVIEW] Error generating feedback:", err);
    } finally {
      setIsGeneratingFeedback(false);
    }

    // 5. Navigate candidate to /interview/[id]/feedback
    router.push(`/interview/${interviewId}/feedback`);
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

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-black text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Live Interview
          </p>
          <h1 className="text-sm font-medium text-zinc-300">
            {jobRole} ·{" "}
            <span className="font-mono text-zinc-500">
              {interviewId?.slice(0, 8)}…
            </span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-2 rounded-full border-2 px-4 py-2 text-sm font-bold ${
              turnState === "user_turn"
                ? "border-sky-500 bg-sky-950/50 text-sky-300"
                : turnState === "ai_speaking"
                  ? "border-purple-500 bg-purple-950/50 text-purple-300"
                  : "border-zinc-600 bg-zinc-900/50 text-zinc-400"
            }`}
          >
            <span
              className={`h-3 w-3 rounded-full ${
                turnState === "processing" || isAiSpeaking
                  ? "animate-pulse bg-current"
                  : "bg-current"
              }`}
            />
            {turnLabel[turnState]}
          </span>
          
          {/* Big Mic Toggle */}
          <button
            type="button"
            onClick={isListening ? stopListening : startListening}
            disabled={turnState !== "user_turn"}
            className={`flex h-12 w-12 items-center justify-center rounded-full border-2 transition-all ${
              isListening
                ? "border-red-500 bg-red-950/50 text-red-400 hover:bg-red-900/50"
                : turnState === "user_turn"
                  ? "border-purple-500 bg-purple-950/50 text-purple-400 hover:bg-purple-900/50"
                  : "border-zinc-700 bg-zinc-900/50 text-zinc-500 cursor-not-allowed"
            }`}
          >
            {isListening ? (
              <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            )}
          </button>

          {/* End Interview Secondary Button */}
          <button
            type="button"
            onClick={() => setShowEndModal(true)}
            disabled={isEnding}
            className="flex items-center gap-2 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs font-semibold text-red-400 hover:bg-red-900/60 hover:text-red-300 transition-colors disabled:opacity-50 shadow-sm"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.684A1 1 0 008.279 3H5z" />
            </svg>
            <span>End Interview</span>
          </button>
        </div>
      </header>

      {transcriptError && (
        <div
          role="alert"
          className="border-b border-red-900/50 bg-red-950/40 px-4 py-2 text-xs text-red-300"
        >
          {transcriptError}
        </div>
      )}

      <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-2">
        {/* Left — AI Interviewer */}
        <section className="flex flex-col border-b border-zinc-800 lg:border-b-0 lg:border-r">
          <div className="relative flex aspect-video max-h-[38%] items-center justify-center bg-black">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(139,92,246,0.2)_0%,_transparent_70%)]" />

            <div className="relative flex flex-col items-center gap-4">
              <div
                className={`relative flex h-32 w-32 items-center justify-center rounded-full border-2 bg-purple-950/60 shadow-[0_0_40px_rgba(168,85,247,0.35)] ${
                  isAiSpeaking
                    ? "border-purple-300/80"
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
                  className="relative h-16 w-16 text-purple-200"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <circle cx="32" cy="22" r="12" opacity="0.9" />
                  <path
                    d="M12 58c0-11 9-20 20-20s20 9 20 20"
                    opacity="0.7"
                  />
                </svg>
              </div>

              <div
                className="flex h-8 items-end gap-1"
                aria-label="AI speech activity"
              >
                {Array.from({ length: 14 }).map((_, i) => (
                  <span
                    key={i}
                    className={`w-1 rounded-full transition-colors ${
                      isAiSpeaking ? "bg-purple-300" : "bg-purple-500/30"
                    }`}
                    style={{
                      height: isAiSpeaking ? `${12 + (i % 7) * 3}px` : "8px",
                      animation: isAiSpeaking
                        ? `speechBar ${0.5 + (i % 4) * 0.15}s ease-in-out infinite alternate`
                        : undefined,
                    }}
                  />
                ))}
              </div>

              <p className="text-sm font-medium text-purple-200/90">
                AI Interviewer
              </p>
            </div>
          </div>

          {/* User Video Placeholder */}
          <div className="relative flex aspect-video items-center justify-center bg-black">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(14,165,233,0.2)_0%,_transparent_70%)]" />

            <div className="relative flex flex-col items-center gap-4">
              <div
                className={`relative flex h-32 w-32 items-center justify-center rounded-full border-2 bg-sky-950/60 shadow-[0_0_40px_rgba(14,165,233,0.35)] ${
                  turnState === "user_turn"
                    ? "border-sky-300/80"
                    : "border-sky-500/40"
                }`}
              >
                {turnState === "user_turn" && (
                  <>
                    <div className="absolute inset-0 animate-ping rounded-full bg-sky-500/20" />
                    <div className="absolute -inset-3 animate-pulse rounded-full border border-sky-500/30" />
                  </>
                )}
                <svg
                  viewBox="0 0 64 64"
                  className="relative h-16 w-16 text-sky-200"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <circle cx="32" cy="22" r="12" opacity="0.9" />
                  <path
                    d="M12 58c0-11 9-20 20-20s20 9 20 20"
                    opacity="0.7"
                  />
                </svg>
              </div>

              <div
                className="flex h-8 items-end gap-1"
                aria-label="User speech activity"
              >
                {Array.from({ length: 14 }).map((_, i) => (
                  <span
                    key={i}
                    className={`w-1 rounded-full transition-colors ${
                      turnState === "user_turn" ? "bg-sky-300" : "bg-sky-500/30"
                    }`}
                    style={{
                      height: turnState === "user_turn" ? `${12 + (i % 7) * 3}px` : "8px",
                      animation: turnState === "user_turn"
                        ? `speechBar ${0.5 + (i % 4) * 0.15}s ease-in-out infinite alternate`
                        : undefined,
                    }}
                  />
                ))}
              </div>

              <p className="text-sm font-medium text-sky-200/90">
                You (Candidate)
              </p>
            </div>
          </div>
        </section>

        {/* Right — Conversation Transcript */}
        <section className="relative flex flex-col overflow-hidden">
          <div className="border-b border-zinc-800 px-4 py-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Conversation Transcript
            </h2>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-purple-400">
                {getPhaseLabel(currentPhase)}
              </span>
            </div>
          </div>

          <div
            ref={transcriptContainerRef}
            onScroll={handleTranscriptScroll}
            className="flex-1 space-y-3 overflow-y-auto p-4 scroll-smooth"
          >
            {transcript.length === 0 ? (
              <p className="text-sm text-zinc-500">
                {turnState === "processing"
                  ? "Loading session…"
                  : isAiThinking
                  ? "AI is thinking…"
                  : "Waiting for interviewer…"}
              </p>
            ) : (
              transcript.map((entry) => (
                <div
                  key={entry.id}
                  className={`flex gap-3 ${entry.speaker === "user" ? "flex-row-reverse" : ""}`}
                >
                  {entry.speaker === "ai" && (
                    <div className="mt-0.5 shrink-0 h-8 w-8 rounded-full bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center overflow-hidden">
                      <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
                      </svg>
                    </div>
                  )}
                  {entry.speaker === "user" && (
                    <div className="mt-0.5 shrink-0 h-8 w-8 rounded-full bg-gradient-to-br from-sky-500 to-sky-700 flex items-center justify-center overflow-hidden">
                      <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
                      </svg>
                    </div>
                  )}
                  <span
                    className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                      entry.speaker === "ai"
                        ? "bg-purple-900/60 text-purple-300"
                        : "bg-sky-900/60 text-sky-300"
                    }`}
                  >
                    {entry.speaker}
                  </span>
                  <p
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                      entry.speaker === "ai"
                        ? "bg-purple-950/40 text-zinc-200"
                        : "bg-sky-950/40 text-zinc-200"
                    }`}
                  >
                    {entry.text}
                  </p>
                </div>
              ))
            )}
            
            {/* AI Thinking Indicator */}
            {isAiThinking && (
              <div className="flex gap-3">
                <div className="mt-0.5 shrink-0 h-8 w-8 rounded-full bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center overflow-hidden">
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
                  </svg>
                </div>
                <div className="max-w-[85%] rounded-lg bg-purple-950/40 px-3 py-2 text-sm text-zinc-200">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      <span className="animate-bounce">•</span>
                      <span className="animate-bounce" style={{ animationDelay: '0.1s' }}>•</span>
                      <span className="animate-bounce" style={{ animationDelay: '0.2s' }}>•</span>
                    </div>
                    <span className="text-xs text-zinc-400">
                      {isSwitchingProvider ? (
                        <span className="text-amber-400 animate-pulse">Searching for candidate...</span>
                      ) : (
                        <span>Thinking...</span>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            )}
            
            <div ref={transcriptEndRef} />
          </div>

          {/* Floating Jump-to-bottom Pill when user is scrolled up */}
          {isUserScrolledUp && (
            <button
              type="button"
              onClick={() => {
                transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
                setIsUserScrolledUp(false);
              }}
              className="absolute bottom-20 right-6 z-20 flex items-center gap-1.5 rounded-full border border-purple-500/50 bg-purple-950/90 px-3.5 py-1.5 text-xs font-semibold text-purple-200 shadow-xl backdrop-blur-md hover:bg-purple-900 transition-all hover:scale-105 active:scale-95"
            >
              <svg className="h-3.5 w-3.5 text-purple-300 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
              <span>Scroll to latest</span>
            </button>
          )}

          <div className="border-t border-zinc-800 bg-zinc-900/60 p-4">
            <label
              className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500"
            >
              {useFallbackInput || !supportsSpeechRecognition ? "Text Input" : "Voice Input"}
            </label>
            
            {useFallbackInput || !supportsSpeechRecognition ? (
              <div className="flex gap-2">
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
                      ? "Type your answer and press Enter…"
                      : "Waiting for your turn…"
                  }
                  className="flex-1 rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-zinc-100 outline-none ring-purple-500/30 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => void handleSpeak()}
                  disabled={!userInput.trim() || turnState !== "user_turn"}
                  className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Live transcript display */}
                {(interimTranscript || userInput) && (
                  <div className="rounded-lg border border-zinc-700 bg-zinc-900/80 p-3">
                    <p className="text-sm text-zinc-300">
                      {interimTranscript || userInput}
                      {isListening && <span className="animate-pulse">|</span>}
                    </p>
                  </div>
                )}
                
                {/* Mic button */}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={isListening ? stopListening : startListening}
                    disabled={turnState !== "user_turn"}
                    className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                      isListening
                        ? "bg-red-600 hover:bg-red-500 text-white"
                        : "bg-purple-600 hover:bg-purple-500 text-white"
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {isListening ? (
                      <>
                        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                          <rect x="6" y="6" width="12" height="12" rx="2" />
                        </svg>
                        Stop
                      </>
                    ) : (
                      <>
                        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                          <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                        </svg>
                        {turnState === "user_turn" ? "Tap to Speak" : "Wait for your turn"}
                      </>
                    )}
                  </button>
                  
                  {isListening && (
                    <span className="text-xs text-zinc-400">
                      Listening…
                    </span>
                  )}
                  
                  {!isListening && (
                    <button
                      type="button"
                      onClick={() => setUseFallbackInput(true)}
                      className="text-xs text-zinc-500 hover:text-zinc-300 underline"
                    >
                      Use text input instead
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

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

      {/* 2. Confirmation Modal (Accidental Ending Protection) */}
      {showEndModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-center space-y-5 shadow-2xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-950/60 border border-red-800/50 text-red-500">
              <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-bold text-white">End this interview?</h2>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Your current transcript will be saved and the interview will be evaluated based on the responses completed so far.
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowEndModal(false)}
                className="flex-1 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmEndInterview}
                className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white hover:bg-red-500 transition-colors shadow-lg shadow-red-900/30"
              >
                End Interview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3 & 4. Ending Interview & Generating Feedback Progress Screen */}
      {isEnding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6 backdrop-blur-md">
          <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center space-y-6 shadow-2xl">
            <div className="relative mx-auto flex h-16 w-16 items-center justify-center">
              <div className="h-full w-full animate-spin rounded-full border-4 border-purple-500/20 border-t-purple-500" />
            </div>

            <div className="space-y-1">
              <h2 className="text-xl font-bold text-white">
                {endingStep === "generating_feedback" ? "Generating Your Feedback" : "Ending Interview..."}
              </h2>
              <p className="text-xs text-zinc-400">
                {endingStep === "generating_feedback"
                  ? "Our AI is analyzing your responses..."
                  : "Stopping audio & saving data"}
              </p>
            </div>

            <div className="space-y-3 text-left border-t border-zinc-800/80 pt-4 text-xs font-medium">
              <div className="flex items-center gap-3 text-zinc-300">
                <span className={`flex h-5 w-5 items-center justify-center rounded-full ${
                  endingStep !== "stopping_audio" ? "bg-emerald-900/80 text-emerald-400 font-bold" : "bg-purple-900/50 text-purple-300 animate-pulse font-bold"
                }`}>✓</span>
                <span>Stopping microphone</span>
              </div>
              <div className="flex items-center gap-3 text-zinc-300">
                <span className={`flex h-5 w-5 items-center justify-center rounded-full ${
                  endingStep === "saving_transcript" || endingStep === "finalizing" || endingStep === "generating_feedback"
                    ? "bg-emerald-900/80 text-emerald-400 font-bold"
                    : "bg-zinc-800 text-zinc-500"
                }`}>✓</span>
                <span>Stopping AI audio</span>
              </div>
              <div className="flex items-center gap-3 text-zinc-300">
                <span className={`flex h-5 w-5 items-center justify-center rounded-full ${
                  endingStep === "finalizing" || endingStep === "generating_feedback"
                    ? "bg-emerald-900/80 text-emerald-400 font-bold"
                    : "bg-zinc-800 text-zinc-500"
                }`}>✓</span>
                <span>Saving transcript</span>
              </div>
              <div className="flex items-center gap-3 text-zinc-300">
                <span className={`flex h-5 w-5 items-center justify-center rounded-full ${
                  endingStep === "generating_feedback"
                    ? "bg-emerald-900/80 text-emerald-400 font-bold"
                    : "bg-zinc-800 text-zinc-500"
                }`}>✓</span>
                <span>Finalizing interview</span>
              </div>
              <div className="flex items-center gap-3 text-zinc-300">
                <span className={`flex h-5 w-5 items-center justify-center rounded-full ${
                  endingStep === "generating_feedback"
                    ? "bg-purple-900/80 text-purple-300 animate-pulse font-bold"
                    : "bg-zinc-800 text-zinc-500"
                }`}>⟳</span>
                <span>Redirecting to feedback...</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Generating Feedback Overlay */}
      {isGeneratingFeedback && !isEnding && (
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
