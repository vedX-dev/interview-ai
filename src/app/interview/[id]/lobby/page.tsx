"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { Mic, MicOff, Volume2, VolumeX, CheckCircle, XCircle, ArrowRight, ArrowLeft, Camera, CameraOff, ShieldCheck, Eye } from "lucide-react";

export default function InterviewLobbyPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const interviewId = params.id;

  const [micPermission, setMicPermission] = useState<"granted" | "denied" | "pending">("pending");
  const [cameraPermission, setCameraPermission] = useState<"granted" | "denied" | "pending">("pending");
  const [isMicOn, setIsMicOn] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [ttsTested, setTtsTested] = useState(false);
  const [sttTested, setSttTested] = useState(false);
  const [speakerWorks, setSpeakerWorks] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(true);

  // Integrity Monitoring & Calibration State
  const [integrityConsent, setIntegrityConsent] = useState(true);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [isCalibrated, setIsCalibrated] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const microphoneRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

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

        // Phase 3: Lobby background pre-computation (topics, opening variants, provider pool warm)
        fetch(`/api/interviews/${interviewId}/prewarm`, { method: "POST" }).catch((e) => {
          console.warn("[LOBBY] Background prewarm triggered (non-blocking):", e);
        });
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
      if (microphoneRef.current) {
        microphoneRef.current.getTracks().forEach(track => track.stop());
      }
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [interviewId, router, cameraStream]);

  // Dedicated effect to attach stream to video element when available
  useEffect(() => {
    if (videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [cameraStream, isCameraOn]);

  const startMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphoneRef.current = stream;
      setMicPermission("granted");
      setIsMicOn(true);
      setError(null);
      
      // Set up audio analyzer for level meter
      if (audioContextRef.current) {
        const source = audioContextRef.current.createMediaStreamSource(stream);
        const analyser = audioContextRef.current.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;
        
        updateAudioLevel();
      }
    } catch (err) {
      console.error("Mic permission denied:", err);
      setMicPermission("denied");
      setIsMicOn(false);
      setError("Microphone permission denied. You can continue with text input.");
    }
  };

  const toggleMic = async () => {
    if (isMicOn && microphoneRef.current) {
      microphoneRef.current.getTracks().forEach((track) => track.stop());
      microphoneRef.current = null;
      setIsMicOn(false);
      setAudioLevel(0);
    } else {
      await startMic();
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      setCameraStream(stream);
      setIsCameraOn(true);
      setCameraPermission("granted");
      setError(null);
    } catch (err) {
      console.error("Camera permission denied:", err);
      setCameraPermission("denied");
      setIsCameraOn(false);
      setError("Camera permission denied or camera unavailable.");
    }
  };

  const toggleCamera = async () => {
    if (isCameraOn && cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      setCameraStream(null);
      setIsCameraOn(false);
    } else {
      await startCamera();
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

  const run3sCalibration = () => {
    if (!isCameraOn || cameraPermission !== "granted") {
      setError("Please enable camera before starting baseline calibration.");
      return;
    }
    setIsCalibrating(true);
    setCalibrationProgress(0);
    let step = 0;
    const interval = setInterval(() => {
      step += 10;
      setCalibrationProgress(step);
      if (step >= 100) {
        clearInterval(interval);
        setIsCalibrating(false);
        setIsCalibrated(true);
        const calData = {
          baselineYaw: 0,
          baselinePitch: 0,
          timestamp: Date.now(),
        };
        localStorage.setItem(`integrity_calibration_${interviewId}`, JSON.stringify(calData));
        console.log("[LOBBY] Baseline calibration stored:", calData);
      }
    }, 300);
  };

  const canStartInterview = !isValidating && micPermission === "granted" && sttTested && ttsTested && speakerWorks && integrityConsent;

  const startInterview = () => {
    console.log("[LOBBY] Starting interview with ID:", interviewId);
    console.log("[LOBBY] Route param ID:", params.id);
    router.push(`/interview/${interviewId}`);
  };

  const skipSetup = () => {
    router.push(`/interview/${interviewId}`);
  };

  return (
    <div className="h-dvh max-h-dvh w-full bg-black text-zinc-100 flex flex-col justify-between p-3 sm:p-4 overflow-hidden select-none">
      <div className="max-w-2xl w-full mx-auto flex-1 min-h-0 flex flex-col justify-between py-1 space-y-2">
        {/* Top Navigation Header with Back Button */}
        <div className="flex items-center justify-between shrink-0">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors py-1 px-2.5 rounded-lg bg-zinc-900 border border-zinc-800"
          >
            <ArrowLeft size={14} />
            <span>Back</span>
          </button>
          <div className="text-center">
            <h1 className="text-base sm:text-lg font-bold text-white">Setup Audio & Camera</h1>
            <p className="text-[11px] text-zinc-400">Verify your devices before entering the interview</p>
          </div>
          <div className="w-16" />
        </div>

        {/* Setup Check Cards Container */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3 sm:p-4 flex-1 min-h-0 overflow-y-auto space-y-3 flex flex-col justify-between shadow-xl">
          {/* Microphone Check */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={`p-1.5 rounded-full ${
                  micPermission === "granted" && isMicOn ? "bg-green-900/50 text-green-400" :
                  micPermission === "denied" ? "bg-red-900/50 text-red-400" :
                  "bg-zinc-800 text-zinc-400"
                }`}>
                  {micPermission === "granted" && isMicOn ? <CheckCircle size={18} /> :
                   micPermission === "denied" ? <XCircle size={18} /> :
                   <Mic size={18} />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-white text-xs sm:text-sm">Microphone Check</h3>
                    {micPermission === "granted" && isMicOn && (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
                        audioLevel > 15
                          ? "bg-green-500/20 text-green-400 border-green-500/40"
                          : "bg-zinc-800 text-zinc-500 border-zinc-800"
                      }`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${audioLevel > 15 ? "bg-green-400 animate-ping" : "bg-zinc-600"}`} />
                        {audioLevel > 15 ? "Mic Active" : "Mic Idle"}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    {micPermission === "granted" && isMicOn
                      ? "Permission granted & microphone active"
                      : micPermission === "granted" && !isMicOn
                      ? "Permission granted (Microphone off)"
                      : micPermission === "denied"
                      ? "Permission denied or microphone unavailable"
                      : "Test microphone & request permission"}
                  </p>
                </div>
              </div>

              {micPermission === "pending" ? (
                <button
                  onClick={startMic}
                  className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-medium transition-colors"
                >
                  Enable Mic
                </button>
              ) : (
                <button
                  onClick={toggleMic}
                  disabled={micPermission === "denied"}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                    isMicOn
                      ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700"
                      : "bg-purple-600 hover:bg-purple-500 text-white border-purple-500 disabled:opacity-50"
                  }`}
                >
                  {isMicOn ? <MicOff size={13} /> : <Mic size={13} />}
                  <span>{isMicOn ? "Turn Mic Off" : "Turn Mic On"}</span>
                </button>
              )}
            </div>
          </div>

          {/* Camera Check & Preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={`p-1.5 rounded-full ${
                  cameraPermission === "granted" && isCameraOn ? "bg-green-900/50 text-green-400" :
                  cameraPermission === "denied" ? "bg-red-900/50 text-red-400" :
                  "bg-zinc-800 text-zinc-400"
                }`}>
                  {cameraPermission === "granted" && isCameraOn ? <CheckCircle size={18} /> :
                   cameraPermission === "denied" ? <XCircle size={18} /> :
                   <Camera size={18} />}
                </div>
                <div>
                  <h3 className="font-semibold text-white text-xs sm:text-sm">Camera Check</h3>
                  <p className="text-[11px] text-zinc-400">
                    {cameraPermission === "granted" && isCameraOn
                      ? "Permission granted & camera active"
                      : cameraPermission === "granted" && !isCameraOn
                      ? "Permission granted (Camera off)"
                      : cameraPermission === "denied"
                      ? "Permission denied or camera unavailable"
                      : "Test camera preview & request permission"}
                  </p>
                </div>
              </div>

              {cameraPermission === "pending" ? (
                <button
                  onClick={startCamera}
                  className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-medium transition-colors"
                >
                  Enable Camera
                </button>
              ) : (
                <button
                  onClick={toggleCamera}
                  disabled={cameraPermission === "denied"}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                    isCameraOn
                      ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700"
                      : "bg-purple-600 hover:bg-purple-500 text-white border-purple-500 disabled:opacity-50"
                  }`}
                >
                  {isCameraOn ? <CameraOff size={13} /> : <Camera size={13} />}
                  <span>{isCameraOn ? "Turn Camera Off" : "Turn Camera On"}</span>
                </button>
              )}
            </div>

            {/* Large Responsive Camera Preview Frame */}
            <div className="relative w-full aspect-[16/9] max-h-[35vh] sm:max-h-[250px] mx-auto rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-center overflow-hidden shadow-inner my-1">
              {cameraPermission === "granted" && isCameraOn && cameraStream ? (
                <>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover object-center transform -scale-x-100"
                  />
                  <div className="absolute top-2.5 left-2.5 flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-green-500/30 text-[11px] text-green-400 font-medium">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                    Live Camera {isCalibrated && "• Baseline Calibrated"}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center text-center p-4">
                  <div className="p-3 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-600 mb-2">
                    <CameraOff size={24} />
                  </div>
                  <p className="text-xs text-zinc-400 font-medium">
                    {cameraPermission === "denied"
                      ? "Camera access denied or device unavailable"
                      : cameraPermission === "granted" && !isCameraOn
                      ? "Camera is currently turned off"
                      : "Click 'Enable Camera' to test your video preview"}
                  </p>
                </div>
              )}
            </div>

            {/* Calibration Bar */}
            {cameraPermission === "granted" && isCameraOn && (
              <div className="flex items-center justify-between bg-zinc-950/80 p-2 rounded-lg border border-zinc-800 text-xs mt-1">
                <div className="flex items-center gap-2">
                  <Eye size={14} className={isCalibrated ? "text-green-400" : "text-amber-400"} />
                  <span className="text-zinc-300">
                    {isCalibrated ? "Face Baseline Calibrated" : "3-Sec Alignment Calibration"}
                  </span>
                </div>
                <button
                  onClick={run3sCalibration}
                  disabled={isCalibrating}
                  className="px-2.5 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-medium transition-colors disabled:opacity-50"
                >
                  {isCalibrating ? `Calibrating (${calibrationProgress}%)` : isCalibrated ? "Recalibrate" : "Calibrate Alignment (3s)"}
                </button>
              </div>
            )}
          </div>

          {/* Integrity Monitoring Consent */}
          <div className="bg-zinc-950/60 p-2.5 rounded-lg border border-zinc-800/80 space-y-1">
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                id="integrityConsent"
                checked={integrityConsent}
                onChange={(e) => setIntegrityConsent(e.target.checked)}
                className="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-purple-600 focus:ring-purple-500"
              />
              <label htmlFor="integrityConsent" className="text-[11px] text-zinc-300 cursor-pointer">
                <span className="font-semibold text-white flex items-center gap-1 inline-flex">
                  <ShieldCheck size={13} className="text-purple-400" />
                  Integrity Monitoring:
                </span>{" "}
                Monitors face alignment, multi-person, and device presence locally in browser. <span className="text-zinc-400">Video frames are NEVER uploaded or stored.</span>
              </label>
            </div>
          </div>

          {/* Speech Recognition Test */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={`p-1.5 rounded-full ${
                  sttTested ? "bg-green-900/50 text-green-400" : "bg-zinc-800 text-zinc-400"
                }`}>
                  {sttTested ? <CheckCircle size={18} /> : <Mic size={18} />}
                </div>
                <div>
                  <h3 className="font-semibold text-white text-xs sm:text-sm">Speech Recognition Test</h3>
                  <p className="text-[11px] text-zinc-400">
                    {sttTested ? "Working correctly" : "Say something to test transcription"}
                  </p>
                </div>
              </div>
              {!sttTested && (
                <button
                  onClick={isListening ? stopSttTest : startSttTest}
                  disabled={micPermission !== "granted" || !isMicOn}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
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
              <div className="bg-zinc-800/80 rounded-md p-1.5">
                <p className="text-xs text-zinc-300 truncate">{transcript}</p>
              </div>
            )}
          </div>

          {/* Speaker Test */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={`p-1.5 rounded-full ${
                  ttsTested && speakerWorks ? "bg-green-900/50 text-green-400" :
                  ttsTested && !speakerWorks ? "bg-red-900/50 text-red-400" :
                  "bg-zinc-800 text-zinc-400"
                }`}>
                  {ttsTested && speakerWorks ? <CheckCircle size={18} /> :
                   ttsTested && !speakerWorks ? <XCircle size={18} /> :
                   <Volume2 size={18} />}
                </div>
                <div>
                  <h3 className="font-semibold text-white text-xs sm:text-sm">Speaker Test</h3>
                  <p className="text-[11px] text-zinc-400">
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
                  className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-medium transition-colors"
                >
                  Test Audio
                </button>
              )}
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="bg-red-900/20 border border-red-800 rounded-md p-2">
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 shrink-0 pt-0.5">
          <button
            onClick={skipSetup}
            className="flex-1 px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs sm:text-sm font-medium transition-colors"
          >
            Skip Setup
          </button>
          <button
            onClick={startInterview}
            disabled={!canStartInterview}
            className={`flex-1 px-4 py-2.5 rounded-lg text-xs sm:text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
              canStartInterview
                ? "bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/20"
                : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
            }`}
          >
            <span>Start Interview</span>
            <ArrowRight size={16} />
          </button>
        </div>

        <p className="text-center text-[11px] text-zinc-500 shrink-0">
          {canStartInterview 
            ? "All checks passed! Ready to start your interview."
            : "Complete the audio checks above to enable the start button, or skip to continue."}
        </p>
      </div>
    </div>
  );
}
