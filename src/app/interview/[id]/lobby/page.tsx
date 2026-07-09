"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { Mic, MicOff, Volume2, VolumeX, CheckCircle, XCircle, ArrowRight } from "lucide-react";

export default function InterviewLobbyPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const interviewId = params.id;

  const [micPermission, setMicPermission] = useState<"granted" | "denied" | "pending">("pending");
  const [audioLevel, setAudioLevel] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [ttsTested, setTtsTested] = useState(false);
  const [sttTested, setSttTested] = useState(false);
  const [speakerWorks, setSpeakerWorks] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(true);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const microphoneRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    // Validate interview ID on mount
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!interviewId || !uuidRegex.test(interviewId)) {
      console.error("[LOBBY] Invalid interview ID:", interviewId);
      setError("Invalid interview ID. Redirecting to home...");
      setTimeout(() => {
        router.push("/");
      }, 2000);
      return;
    }

    // Verify interview exists
    const validateInterview = async () => {
      try {
        const response = await fetch(`/api/interviews/transcript?interviewId=${interviewId}`);
        if (response.status === 404) {
          setError("Interview not found. Redirecting to home...");
          setTimeout(() => {
            router.push("/");
          }, 2000);
          return;
        }
        if (!response.ok) {
          setError("Failed to validate interview. Please try again.");
          return;
        }
        console.log("[LOBBY] Interview validated:", interviewId);
        setIsValidating(false);
      } catch (err) {
        console.error("[LOBBY] Validation error:", err);
        setError("Failed to validate interview. Redirecting to home...");
        setTimeout(() => {
          router.push("/");
        }, 2000);
      }
    };

    validateInterview();

    // Initialize audio context on mount
    if (typeof window !== "undefined" && window.AudioContext) {
      audioContextRef.current = new AudioContext();
    }

    return () => {
      // Cleanup
      if (microphoneRef.current) {
        microphoneRef.current.getTracks().forEach(track => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [interviewId, router]);

  const requestMicPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphoneRef.current = stream;
      setMicPermission("granted");
      setError(null);
      
      // Set up audio analyzer for level meter
      if (audioContextRef.current) {
        const source = audioContextRef.current.createMediaStreamSource(stream);
        const analyser = audioContextRef.current.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;
        
        // Start audio level monitoring
        updateAudioLevel();
      }
    } catch (err) {
      console.error("Mic permission denied:", err);
      setMicPermission("denied");
      setError("Microphone permission denied. You can continue with text input.");
    }
  };

  const updateAudioLevel = () => {
    if (!analyserRef.current) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    const update = () => {
      if (!analyserRef.current) return;
      
      analyserRef.current.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      setAudioLevel(average);
      
      // Continue monitoring as long as mic permission is granted
      if (micPermission === "granted") {
        requestAnimationFrame(update);
      }
    };
    
    update();
  };

  const startSttTest = () => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      setError("Speech recognition not supported in this browser");
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      setIsListening(true);
      setTranscript("");
      setError(null);
    };

    recognition.onresult = (event: any) => {
      const interim = Array.from(event.results)
        .map((result: any) => result[0])
        .map((result: any) => result.transcript)
        .join("");
      
      setTranscript(interim);
      
      // Check if we got a final result
      const finalResult = event.results[event.results.length - 1];
      if (finalResult.isFinal) {
        setSttTested(true);
        setIsListening(false);
      }
    };

    recognition.onerror = (event: any) => {
      console.error("STT error:", event.error);
      setIsListening(false);
      if (event.error === "not-allowed") {
        setError("Microphone access denied");
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      if (transcript.length > 5) {
        setSttTested(true);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const stopSttTest = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsListening(false);
  };

  const testTts = () => {
    if (!("speechSynthesis" in window)) {
      setError("Text-to-speech not supported in this browser");
      return;
    }

    const utterance = new SpeechSynthesisUtterance("This is a test of the audio system. Can you hear me clearly?");
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;

    utterance.onend = () => {
      setSpeakerWorks(true);
      setTtsTested(true);
    };

    utterance.onerror = () => {
      setError("Failed to play audio. Check your speaker settings.");
      setSpeakerWorks(false);
      setTtsTested(true);
    };

    window.speechSynthesis.speak(utterance);
  };

  const canStartInterview = !isValidating && micPermission === "granted" && sttTested && ttsTested && speakerWorks;

  const startInterview = () => {
    console.log("[LOBBY] Starting interview with ID:", interviewId);
    console.log("[LOBBY] Route param ID:", params.id);
    router.push(`/interview/${interviewId}`);
  };

  const skipSetup = () => {
    router.push(`/interview/${interviewId}`);
  };

  return (
    <div className="min-h-screen bg-black text-zinc-100 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-white">Setup Your Audio</h1>
          <p className="text-zinc-400">Let's make sure your microphone and speakers are working before we start.</p>
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 space-y-6">
          {/* Microphone Permission */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-full ${
                  micPermission === "granted" ? "bg-green-900/50 text-green-400" :
                  micPermission === "denied" ? "bg-red-900/50 text-red-400" :
                  "bg-zinc-800 text-zinc-400"
                }`}>
                  {micPermission === "granted" ? <CheckCircle size={20} /> :
                   micPermission === "denied" ? <XCircle size={20} /> :
                   <Mic size={20} />}
                </div>
                <div>
                  <h3 className="font-semibold text-white">Microphone Permission</h3>
                  <p className="text-sm text-zinc-400">
                    {micPermission === "granted" ? "Permission granted" :
                     micPermission === "denied" ? "Permission denied" :
                     "Click to request permission"}
                  </p>
                </div>
              </div>
              {micPermission === "pending" && (
                <button
                  onClick={requestMicPermission}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Request Permission
                </button>
              )}
            </div>

            {/* Audio Level Meter */}
            {micPermission === "granted" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm text-zinc-400">
                  <span>Audio Level</span>
                  <span>{Math.round(audioLevel)}%</span>
                </div>
                <div className="h-8 flex items-center gap-1">
                  {Array.from({ length: 20 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex-1 bg-gradient-to-t from-green-500 to-green-400 rounded-sm transition-all duration-75"
                      style={{
                        height: `${Math.min(100, (audioLevel / 255) * 100 * (1 - i * 0.03))}%`,
                        opacity: audioLevel > 10 ? 1 : 0.3,
                      }}
                    />
                  ))}
                </div>
                <p className="text-xs text-zinc-500">Speak to see the level meter move</p>
              </div>
            )}
          </div>

          {/* Speech Recognition Test */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-full ${
                  sttTested ? "bg-green-900/50 text-green-400" : "bg-zinc-800 text-zinc-400"
                }`}>
                  {sttTested ? <CheckCircle size={20} /> : <Mic size={20} />}
                </div>
                <div>
                  <h3 className="font-semibold text-white">Speech Recognition Test</h3>
                  <p className="text-sm text-zinc-400">
                    {sttTested ? "Working correctly" : "Say something to test transcription"}
                  </p>
                </div>
              </div>
              {!sttTested && (
                <button
                  onClick={isListening ? stopSttTest : startSttTest}
                  disabled={micPermission !== "granted"}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isListening 
                      ? "bg-red-600 hover:bg-red-500 text-white" 
                      : "bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  }`}
                >
                  {isListening ? "Stop" : "Test"}
                </button>
              )}
            </div>

            {transcript && (
              <div className="bg-zinc-800 rounded-lg p-3">
                <p className="text-sm text-zinc-300">{transcript}</p>
              </div>
            )}
          </div>

          {/* Speaker Test */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-full ${
                  ttsTested && speakerWorks ? "bg-green-900/50 text-green-400" :
                  ttsTested && !speakerWorks ? "bg-red-900/50 text-red-400" :
                  "bg-zinc-800 text-zinc-400"
                }`}>
                  {ttsTested && speakerWorks ? <CheckCircle size={20} /> :
                   ttsTested && !speakerWorks ? <XCircle size={20} /> :
                   <Volume2 size={20} />}
                </div>
                <div>
                  <h3 className="font-semibold text-white">Speaker Test</h3>
                  <p className="text-sm text-zinc-400">
                    {ttsTested 
                      ? speakerWorks 
                        ? "Working correctly" 
                        : "Speaker issue detected"
                      : "Click to test audio playback"}
                  </p>
                </div>
              </div>
              {!ttsTested && (
                <button
                  onClick={testTts}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Test Audio
                </button>
              )}
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="bg-red-900/20 border border-red-800 rounded-lg p-3">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4">
          <button
            onClick={skipSetup}
            className="flex-1 px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg font-medium transition-colors"
          >
            Skip Setup
          </button>
          <button
            onClick={startInterview}
            disabled={!canStartInterview}
            className={`flex-1 px-6 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
              canStartInterview
                ? "bg-purple-600 hover:bg-purple-500 text-white"
                : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
            }`}
          >
            Start Interview
            <ArrowRight size={18} />
          </button>
        </div>

        <p className="text-center text-sm text-zinc-500">
          {canStartInterview 
            ? "All checks passed! Ready to start your interview."
            : "Complete the audio checks above to enable the start button, or skip to continue with text input."}
        </p>
      </div>
    </div>
  );
}
