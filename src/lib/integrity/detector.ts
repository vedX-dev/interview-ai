import {
  FilesetResolver,
  FaceLandmarker,
  ObjectDetector,
  type FaceLandmarkerResult,
  type ObjectDetectorResult,
} from "@mediapipe/tasks-vision";
import { INTEGRITY_CONFIG } from "./config";
import type { IntegrityEvent, IntegrityEventType, CalibrationData } from "@/src/schemas/integrity";

export interface IntegrityDetectorCallbacks {
  onViolation: (event: IntegrityEvent) => void;
  onFaceDetected?: (detected: boolean, faceCount: number) => void;
  onDebugFrame?: (data: {
    yaw: number;
    pitch: number;
    gazeAway: boolean;
    faceCount: number;
    detectedObjects: string[];
  }) => void;
}

export class IntegrityDetector {
  private faceLandmarker: FaceLandmarker | null = null;
  private objectDetector: ObjectDetector | null = null;
  private isRunning = false;
  private videoElement: HTMLVideoElement | null = null;
  private animFrameId: number | null = null;
  private objectTimerId: any = null;

  private lastFaceTimestamp = 0;
  private lastObjectTimestamp = 0;

  private startTime: number = Date.now();
  private isAiSpeaking = false;

  private baseline: CalibrationData = {
    baselineYaw: 0,
    baselinePitch: 0,
    timestamp: Date.now(),
  };

  // Debounce tracking map: conditionName -> startTime
  private activeConditions: Map<string, number> = new Map();
  // Fired violation cooldowns to prevent spamming duplicate events
  private firedCooldowns: Map<string, number> = new Map();

  private callbacks: IntegrityDetectorCallbacks;

  constructor(callbacks: IntegrityDetectorCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Set baseline calibration data (e.g. from lobby 3s check)
   */
  public setBaseline(calibration: CalibrationData) {
    this.baseline = calibration;
    console.log("[INTEGRITY] Baseline set:", calibration);
  }

  /**
   * Update AI speaking state (gaze away suppressed while AI speaks)
   */
  public setAiSpeaking(speaking: boolean) {
    this.isAiSpeaking = speaking;
  }

  /**
   * Initialize MediaPipe vision models from self-hosted /public assets
   */
  public async initialize(): Promise<boolean> {
    try {
      console.log("[INTEGRITY] Resolving MediaPipe vision WASM from:", INTEGRITY_CONFIG.wasmLoaderPath);
      const vision = await FilesetResolver.forVisionTasks(INTEGRITY_CONFIG.wasmLoaderPath);

      console.log("[INTEGRITY] Loading FaceLandmarker model from:", INTEGRITY_CONFIG.faceLandmarkerModelPath);
      this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: INTEGRITY_CONFIG.faceLandmarkerModelPath,
          delegate: "CPU",
        },
        outputFaceBlendshapes: true,
        runningMode: "VIDEO",
        numFaces: 5,
      });

      console.log("[INTEGRITY] Loading ObjectDetector model from:", INTEGRITY_CONFIG.objectDetectorModelPath);
      this.objectDetector = await ObjectDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: INTEGRITY_CONFIG.objectDetectorModelPath,
          delegate: "CPU",
        },
        scoreThreshold: INTEGRITY_CONFIG.thresholds.objectConfidence,
        runningMode: "VIDEO",
      });

      console.log("[INTEGRITY] Models initialized successfully!");
      return true;
    } catch (err) {
      console.error("[INTEGRITY] Model initialization failed:", err);
      return false;
    }
  }

  /**
   * Start integrity monitoring using existing video element (reusing media stream)
   */
  public start(video: HTMLVideoElement) {
    if (this.isRunning) return;
    this.videoElement = video;
    this.isRunning = true;
    this.startTime = Date.now();
    this.lastFaceTimestamp = 0;
    this.lastObjectTimestamp = 0;
    this.activeConditions.clear();
    this.firedCooldowns.clear();

    // Attach browser window events
    this.attachBrowserEventListeners();

    // Start detection loops
    this.runFaceDetectionLoop();
    this.runObjectDetectionLoop();
    console.log("[INTEGRITY] Detector started.");
  }

  /**
   * Stop detection loops and cleanup
   */
  public stop() {
    this.isRunning = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.objectTimerId) {
      clearInterval(this.objectTimerId);
      this.objectTimerId = null;
    }
    this.detachBrowserEventListeners();
    console.log("[INTEGRITY] Detector stopped.");
  }

  /**
   * Face Detection Loop (~6.6 fps)
   */
  private runFaceDetectionLoop = () => {
    if (!this.isRunning) return;

    if (
      this.faceLandmarker &&
      this.videoElement &&
      this.videoElement.readyState >= 2 &&
      this.videoElement.videoWidth > 0 &&
      this.videoElement.videoHeight > 0 &&
      !this.videoElement.paused &&
      !this.videoElement.ended
    ) {
      try {
        let now = Math.round(performance.now());
        if (now <= this.lastFaceTimestamp) {
          now = this.lastFaceTimestamp + 1;
        }
        this.lastFaceTimestamp = now;

        const results = this.faceLandmarker.detectForVideo(this.videoElement, now);
        this.processFaceResults(results);
      } catch (err) {
        console.warn("[INTEGRITY] Face frame processing warning:", err);
      }
    }

    setTimeout(() => {
      if (this.isRunning) {
        this.animFrameId = requestAnimationFrame(this.runFaceDetectionLoop);
      }
    }, INTEGRITY_CONFIG.faceDetectionIntervalMs);
  };

  /**
   * Object Detection Loop (every 1.5s)
   */
  private runObjectDetectionLoop = () => {
    this.objectTimerId = setInterval(() => {
      if (!this.isRunning) return;
      if (
        this.objectDetector &&
        this.videoElement &&
        this.videoElement.readyState >= 2 &&
        this.videoElement.videoWidth > 0 &&
        this.videoElement.videoHeight > 0 &&
        !this.videoElement.paused &&
        !this.videoElement.ended
      ) {
        try {
          let now = Math.round(performance.now());
          if (now <= this.lastObjectTimestamp) {
            now = this.lastObjectTimestamp + 1;
          }
          this.lastObjectTimestamp = now;

          const results = this.objectDetector.detectForVideo(this.videoElement, now);
          this.processObjectResults(results);
        } catch (err) {
          console.warn("[INTEGRITY] Object frame processing warning:", err);
        }
      }
    }, INTEGRITY_CONFIG.objectDetectionIntervalMs);
  };

  /**
   * Process Face Landmark Results
   */
  private processFaceResults(results: FaceLandmarkerResult) {
    const faceCount = results.faceLandmarks ? results.faceLandmarks.length : 0;
    this.callbacks.onFaceDetected?.(faceCount > 0, faceCount);

    const now = Date.now();
    const elapsedTime = now - this.startTime;
    const inGracePeriod = elapsedTime < INTEGRITY_CONFIG.gracePeriodMs;

    // 1. Check No Face
    if (faceCount === 0) {
      this.checkCondition("no_face", true, INTEGRITY_CONFIG.debounceMs.noFace, inGracePeriod);
      this.checkCondition("multiple_faces", false, 0, false);
      this.checkCondition("gaze_away", false, 0, false);

      this.callbacks.onDebugFrame?.({
        yaw: 0,
        pitch: 0,
        gazeAway: false,
        faceCount: 0,
        detectedObjects: [],
      });
      return;
    }

    this.checkCondition("no_face", false, 0, false);

    // 2. Check Multiple Faces
    if (faceCount > 1) {
      this.checkCondition("multiple_faces", true, INTEGRITY_CONFIG.debounceMs.multipleFaces, false);
    } else {
      this.checkCondition("multiple_faces", false, 0, false);
    }

    // 3. Pose & Gaze Analysis for primary face
    const landmarks = results.faceLandmarks[0];
    const blendshapes = results.faceBlendshapes?.[0]?.categories || [];

    const { yaw, pitch } = calculateHeadPose(landmarks);
    const relYaw = Math.abs(yaw - this.baseline.baselineYaw);
    const relPitch = Math.abs(pitch - this.baseline.baselinePitch);

    // Check eye blendshapes
    const gazeScore = getGazeScore(blendshapes);
    const isHeadAway = relYaw > INTEGRITY_CONFIG.thresholds.yawMaxDegrees || relPitch > INTEGRITY_CONFIG.thresholds.pitchMaxDegrees;
    const isEyeAway = gazeScore > INTEGRITY_CONFIG.thresholds.gazeBlendshapeThreshold;
    const isGazeAway = isHeadAway || isEyeAway;

    // Suppress gaze away during initial 10s grace period OR while AI is speaking
    const suppressGaze = inGracePeriod || this.isAiSpeaking;
    this.checkCondition("gaze_away", isGazeAway, INTEGRITY_CONFIG.debounceMs.gazeAway, suppressGaze);

    this.callbacks.onDebugFrame?.({
      yaw: Math.round(yaw),
      pitch: Math.round(pitch),
      gazeAway: isGazeAway,
      faceCount,
      detectedObjects: [],
    });
  }

  /**
   * Process Object Detector Results
   */
  private processObjectResults(results: ObjectDetectorResult) {
    const detections = results.detections || [];
    const detectedLabels = detections.flatMap((d) => d.categories.map((c) => c.categoryName.toLowerCase()));

    const hasPhone = detectedLabels.some((l) => l.includes("cell phone") || l.includes("phone") || l.includes("mobile"));
    const hasLaptopOrBook = detectedLabels.some((l) => l.includes("book") || l.includes("laptop"));

    const now = Date.now();
    const elapsedTime = now - this.startTime;
    const inGracePeriod = elapsedTime < INTEGRITY_CONFIG.gracePeriodMs;

    this.checkCondition("cell_phone", hasPhone, INTEGRITY_CONFIG.debounceMs.cellPhone, false);
    this.checkCondition("suspicious_object", hasLaptopOrBook, INTEGRITY_CONFIG.debounceMs.suspiciousObject, inGracePeriod);
  }

  /**
   * Debouncing Condition Logic
   */
  private checkCondition(
    type: IntegrityEventType,
    isDetected: boolean,
    requiredDurationMs: number,
    isSuppressed: boolean,
  ) {
    const now = Date.now();

    if (!isDetected || isSuppressed) {
      this.activeConditions.delete(type);
      return;
    }

    if (!this.activeConditions.has(type)) {
      this.activeConditions.set(type, now);
      return;
    }

    const firstSeenTime = this.activeConditions.get(type)!;
    const durationMs = now - firstSeenTime;

    if (durationMs >= requiredDurationMs) {
      const lastFired = this.firedCooldowns.get(type) || 0;
      // 10s cooldown per event type to prevent duplicate event spam
      if (now - lastFired > 10000) {
        this.firedCooldowns.set(type, now);
        this.callbacks.onViolation({
          type,
          timestamp: now,
          durationMs,
          confidence: 0.9,
          details: `Sustained ${type.replace("_", " ")} detected for ${Math.round(durationMs / 1000)}s`,
          strikeNumber: 0, // Assigned by server/policy
        });
      }
    }
  }

  /**
   * Browser window event listeners (Tab switch, paste, fullscreen exit)
   */
  private handleVisibilityChange = () => {
    if (document.hidden) {
      this.callbacks.onViolation({
        type: "tab_switch",
        timestamp: Date.now(),
        durationMs: 500,
        confidence: 1.0,
        details: "User switched tab or minimized browser window",
        strikeNumber: 0,
      });
    }
  };

  private handleFullscreenChange = () => {
    if (!document.fullscreenElement) {
      this.callbacks.onViolation({
        type: "fullscreen_exit",
        timestamp: Date.now(),
        durationMs: 500,
        confidence: 1.0,
        details: "User exited fullscreen mode",
        strikeNumber: 0,
      });
    }
  };

  private handlePaste = (e: ClipboardEvent) => {
    this.callbacks.onViolation({
      type: "paste_attempt",
      timestamp: Date.now(),
      durationMs: 0,
      confidence: 1.0,
      details: "Clipboard paste detected",
      strikeNumber: 0,
    });
  };

  private attachBrowserEventListeners() {
    if (typeof window === "undefined") return;
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    document.addEventListener("fullscreenchange", this.handleFullscreenChange);
    document.addEventListener("paste", this.handlePaste);
  }

  private detachBrowserEventListeners() {
    if (typeof window === "undefined") return;
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    document.removeEventListener("fullscreenchange", this.handleFullscreenChange);
    document.removeEventListener("paste", this.handlePaste);
  }
}

/**
 * Calculate approximate head Yaw and Pitch from 3D Face Landmarks
 */
function calculateHeadPose(landmarks: Array<{ x: number; y: number; z: number }>) {
  if (!landmarks || landmarks.length < 300) return { yaw: 0, pitch: 0 };

  const noseTip = landmarks[1];
  const chin = landmarks[152];
  const leftEye = landmarks[33];
  const rightEye = landmarks[263];

  const eyeCenter = {
    x: (leftEye.x + rightEye.x) / 2,
    y: (leftEye.y + rightEye.y) / 2,
  };

  // Yaw: horizontal offset between nose and eye center
  const yaw = (noseTip.x - eyeCenter.x) * 180;
  // Pitch: vertical offset between nose and chin line
  const pitch = (noseTip.y - (eyeCenter.y + chin.y) / 2) * 180;

  return { yaw, pitch };
}

/**
 * Calculate Gaze Off-Screen score from eye blendshapes
 */
function getGazeScore(categories: Array<{ categoryName: string; score: number }>): number {
  let gazeScore = 0;
  for (const cat of categories) {
    if (
      cat.categoryName === "eyeLookInLeft" ||
      cat.categoryName === "eyeLookOutLeft" ||
      cat.categoryName === "eyeLookInRight" ||
      cat.categoryName === "eyeLookOutRight" ||
      cat.categoryName === "eyeLookUpLeft" ||
      cat.categoryName === "eyeLookDownLeft"
    ) {
      gazeScore = Math.max(gazeScore, cat.score);
    }
  }
  return gazeScore;
}
