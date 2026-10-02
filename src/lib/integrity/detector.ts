import {
  FilesetResolver,
  FaceLandmarker,
  ObjectDetector,
  type FaceLandmarkerResult,
  type ObjectDetectorResult,
} from "@mediapipe/tasks-vision";
import { INTEGRITY_CONFIG } from "./config";
import type { IntegrityEvent, IntegrityEventType, CalibrationData } from "@/src/schemas/integrity";

// ── Box Visibility Thresholds & Durations (Cosmetic Fade Rule) ────────────────
export const BOX_SWEEP_DISPLACEMENT_THRESHOLD = 0.50; // 50% of frame width displacement
export const BOX_DISPLACEMENT_WINDOW_MS = 2000;       // 2-second rolling window
export const BOX_HOLD_VISIBLE_MS = 1500;              // 1.5s hold time after movement settles
export const BOX_FADE_IN_MS = 150;                    // 150ms fade-in
export const BOX_FADE_OUT_MS = 400;                   // 400ms fade-out

// ── Calibration Requirements & Thresholds ─────────────────────────────────────
export const CALIBRATION_REQUIRED_WINDOW_MS = 3000;   // 3s calibration window
export const CALIBRATION_MIN_QUALIFYING_RATIO = 0.80; // >= 80% qualifying frames required
export const CALIBRATION_CENTER_BOUND_MIN = 0.20;    // Central ~60% bounds (20% to 80%)
export const CALIBRATION_CENTER_BOUND_MAX = 0.80;
export const CALIBRATION_MIN_FACE_WIDTH_RATIO = 0.15; // Face width >= 15% frame width

// ── Continuous Metrics Type ───────────────────────────────────────────────────
export interface LiveIntegrityMetrics {
  headPose: {
    yaw: number;   // degrees
    pitch: number; // degrees
    roll: number;  // degrees
  };
  gaze: {
    score: number;
    gazeAway: boolean;
    vector: { x: number; y: number };
  };
  eyes: {
    blinkLeft: number;
    blinkRight: number;
    isOpen: boolean;
  };
  mouth: {
    jawOpen: number;
    mouthSmile: number;
    mouthPucker: number;
  };
  expression: {
    label: "neutral" | "happy" | "tense" | "surprised";
    confidence: number;
    rawScores: {
      neutral: number;
      happy: number;
      tense: number;
      surprised: number;
    };
  };
  faceBoundingBox: {
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
  } | null;
  faceCount: number;
  isCalibrated: boolean;
  timestamp: number;
}

export interface IntegrityDetectorCallbacks {
  onViolation: (event: IntegrityEvent) => void;
  onFaceDetected?: (detected: boolean, faceCount: number) => void;
  onMetricsUpdate?: (metrics: LiveIntegrityMetrics) => void; // Throttled UI updates (~5 Hz)
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
  private isCalibrating = false;
  private videoElement: HTMLVideoElement | null = null;

  private videoCallbackId: number | null = null;
  private animFrameId: number | null = null;
  private objectTimerId: any = null;
  private canvasAnimId: number | null = null;
  private isProcessingFaceFrame = false;

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

  // Continuous Metrics & UI Throttling
  private currentMetrics: LiveIntegrityMetrics = createEmptyMetrics();
  private lastUiCallbackTime = 0;

  // Expression EMA Smoothing
  private smoothedExpressionScores = {
    neutral: 1.0,
    happy: 0.0,
    tense: 0.0,
    surprised: 0.0,
  };

  // Canvas Overlay Renderer & Box Visibility State
  private canvasElement: HTMLCanvasElement | null = null;
  private candidateName: string = "Candidate";
  private smoothBox: LiveIntegrityMetrics["faceBoundingBox"] = null;
  private centerHistory: Array<{ x: number; y: number; timestamp: number }> = [];
  private lastSweepTimestamp = 0;
  private boxOpacity = 0;

  constructor(callbacks: IntegrityDetectorCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Set baseline calibration data (from lobby 3s check)
   */
  public setBaseline(calibration: CalibrationData) {
    this.baseline = calibration;
    this.currentMetrics.isCalibrated = true;
    console.log("[INTEGRITY] Baseline set:", calibration);
  }

  /**
   * Update AI speaking state (gaze away suppressed while AI speaks)
   */
  public setAiSpeaking(speaking: boolean) {
    this.isAiSpeaking = speaking;
  }

  /**
   * Get latest live metrics synchronously (ref access, non-React re-render)
   */
  public getMetrics(): LiveIntegrityMetrics {
    return this.currentMetrics;
  }

  /**
   * Initialize MediaPipe vision models from self-hosted /public assets with GPU delegate fallback to CPU
   */
  public async initialize(): Promise<boolean> {
    try {
      console.log("[INTEGRITY] Resolving MediaPipe vision WASM from:", INTEGRITY_CONFIG.wasmLoaderPath);
      const vision = await FilesetResolver.forVisionTasks(INTEGRITY_CONFIG.wasmLoaderPath);

      // FaceLandmarker: GPU delegate with CPU fallback, numFaces: 2, blendshapes & matrixes enabled
      const baseFaceOptions = {
        baseOptions: {
          modelAssetPath: INTEGRITY_CONFIG.faceLandmarkerModelPath,
        },
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        runningMode: "VIDEO" as const,
        numFaces: 2,
      };

      try {
        console.log("[INTEGRITY] Attempting FaceLandmarker initialization with GPU delegate...");
        this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          ...baseFaceOptions,
          baseOptions: {
            ...baseFaceOptions.baseOptions,
            delegate: "GPU",
          },
        });
        console.log("[INTEGRITY] FaceLandmarker initialized with GPU delegate.");
      } catch (gpuErr) {
        console.warn("[INTEGRITY] GPU delegate failed for FaceLandmarker, falling back to CPU:", gpuErr);
        this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          ...baseFaceOptions,
          baseOptions: {
            ...baseFaceOptions.baseOptions,
            delegate: "CPU",
          },
        });
        console.log("[INTEGRITY] FaceLandmarker initialized with CPU delegate.");
      }

      // ObjectDetector: GPU delegate with CPU fallback
      try {
        console.log("[INTEGRITY] Attempting ObjectDetector initialization with GPU delegate...");
        this.objectDetector = await ObjectDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: INTEGRITY_CONFIG.objectDetectorModelPath,
            delegate: "GPU",
          },
          scoreThreshold: INTEGRITY_CONFIG.thresholds.objectConfidence,
          runningMode: "VIDEO",
        });
      } catch (gpuErr) {
        console.warn("[INTEGRITY] GPU delegate failed for ObjectDetector, falling back to CPU:", gpuErr);
        this.objectDetector = await ObjectDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: INTEGRITY_CONFIG.objectDetectorModelPath,
            delegate: "CPU",
          },
          scoreThreshold: INTEGRITY_CONFIG.thresholds.objectConfidence,
          runningMode: "VIDEO",
        });
      }

      console.log("[INTEGRITY] Models initialized successfully!");
      return true;
    } catch (err) {
      console.error("[INTEGRITY] Model initialization failed:", err);
      return false;
    }
  }

  /**
   * Run 3-second lobby calibration window.
   * Requires >=80% qualifying frames (1 face, center in 60%, width >= 15%).
   * Logs NOTHING to the server. Returns baseline yaw/pitch calculated ONLY from qualifying frames.
   */
  public async calibrateWindow(
    video: HTMLVideoElement,
    durationMs: number = CALIBRATION_REQUIRED_WINDOW_MS,
    onProgress?: (progressPercent: number, feedbackMessage: string | null) => void
  ): Promise<CalibrationData> {
    if (!this.faceLandmarker) {
      const ok = await this.initialize();
      if (!ok || !this.faceLandmarker) {
        throw new Error("Failed to initialize Face Landmarker for calibration.");
      }
    }

    this.isCalibrating = true;
    const startTime = performance.now();
    const qualifyingFrames: Array<{ yaw: number; pitch: number }> = [];
    let totalFrames = 0;

    let noFaceCount = 0;
    let multiFaceCount = 0;
    let offCenterCount = 0;
    let tooSmallCount = 0;

    return new Promise<CalibrationData>((resolve, reject) => {
      const stepCalibration = () => {
        if (!this.isCalibrating) {
          reject(new Error("Calibration cancelled"));
          return;
        }

        const now = performance.now();
        const elapsed = now - startTime;
        const progressPercent = Math.min(100, Math.round((elapsed / durationMs) * 100));

        if (
          video.readyState >= 2 &&
          video.videoWidth > 0 &&
          video.videoHeight > 0 &&
          !video.paused
        ) {
          try {
            const timestamp = Math.round(now);
            const results = this.faceLandmarker!.detectForVideo(video, timestamp);
            const faceCount = results.faceLandmarks ? results.faceLandmarks.length : 0;
            totalFrames++;

            let feedback: string | null = null;

            if (faceCount === 0) {
              noFaceCount++;
              feedback = "No face detected";
            } else if (faceCount > 1) {
              multiFaceCount++;
              feedback = "Multiple faces detected";
            } else {
              const landmarks = results.faceLandmarks[0];
              const bbox = calculateFaceBoundingBox(landmarks);

              if (!bbox) {
                noFaceCount++;
                feedback = "No face detected";
              } else if (
                bbox.centerX < CALIBRATION_CENTER_BOUND_MIN ||
                bbox.centerX > CALIBRATION_CENTER_BOUND_MAX ||
                bbox.centerY < CALIBRATION_CENTER_BOUND_MIN ||
                bbox.centerY > CALIBRATION_CENTER_BOUND_MAX
              ) {
                offCenterCount++;
                feedback = "Move to center";
              } else if (bbox.width < CALIBRATION_MIN_FACE_WIDTH_RATIO) {
                tooSmallCount++;
                feedback = "Move closer";
              } else {
                // Qualifying frame
                let pose = extractPoseFromMatrix(results.facialTransformationMatrixes?.[0]);
                if (!pose) {
                  pose = calculateHeadPose(landmarks);
                }
                qualifyingFrames.push({ yaw: pose.yaw, pitch: pose.pitch });
              }
            }

            onProgress?.(progressPercent, feedback);
          } catch (err) {
            console.warn("[CALIBRATION] Calibration frame warning:", err);
          }
        }

        if (elapsed < durationMs) {
          if ("requestVideoFrameCallback" in video) {
            (video as any).requestVideoFrameCallback(stepCalibration);
          } else {
            requestAnimationFrame(stepCalibration);
          }
        } else {
          this.isCalibrating = false;
          const ratio = totalFrames > 0 ? qualifyingFrames.length / totalFrames : 0;

          if (totalFrames > 0 && ratio >= CALIBRATION_MIN_QUALIFYING_RATIO && qualifyingFrames.length > 0) {
            const avgYaw = qualifyingFrames.reduce((acc, f) => acc + f.yaw, 0) / qualifyingFrames.length;
            const avgPitch = qualifyingFrames.reduce((acc, f) => acc + f.pitch, 0) / qualifyingFrames.length;

            const calibration: CalibrationData = {
              baselineYaw: avgYaw,
              baselinePitch: avgPitch,
              timestamp: Date.now(),
            };
            this.setBaseline(calibration);
            resolve(calibration);
          } else {
            // Determine dominant failure feedback
            let dominantMsg = "No face detected";
            const maxVal = Math.max(noFaceCount, multiFaceCount, offCenterCount, tooSmallCount);
            if (maxVal === multiFaceCount && multiFaceCount > 0) dominantMsg = "Multiple faces detected";
            else if (maxVal === offCenterCount && offCenterCount > 0) dominantMsg = "Move to center";
            else if (maxVal === tooSmallCount && tooSmallCount > 0) dominantMsg = "Move closer";
            else if (maxVal === noFaceCount) dominantMsg = "No face detected";

            reject(new Error(dominantMsg));
          }
        }
      };

      if ("requestVideoFrameCallback" in video) {
        (video as any).requestVideoFrameCallback(stepCalibration);
      } else {
        requestAnimationFrame(stepCalibration);
      }
    });
  }

  /**
   * Start integrity monitoring using video element
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

    this.attachBrowserEventListeners();

    // Start Face Detection Loop (~20-30 FPS aligned with video frames)
    this.runFaceDetectionLoop();
    // Start Object Detection Loop (~1.5 FPS on independent timer)
    this.runObjectDetectionLoop();

    console.log("[INTEGRITY] Detector started.");
  }

  /**
   * Attach overlay canvas for smooth green bounding box rendering
   */
  public attachCanvas(canvas: HTMLCanvasElement, candidateName: string = "Candidate") {
    this.canvasElement = canvas;
    this.candidateName = candidateName;

    if (this.canvasAnimId) {
      cancelAnimationFrame(this.canvasAnimId);
    }

    const renderLoop = () => {
      if (!this.canvasElement) return;
      this.renderCanvasFrame();
      this.canvasAnimId = requestAnimationFrame(renderLoop);
    };

    this.canvasAnimId = requestAnimationFrame(renderLoop);
  }

  /**
   * Detach canvas renderer
   */
  public detachCanvas() {
    if (this.canvasAnimId) {
      cancelAnimationFrame(this.canvasAnimId);
      this.canvasAnimId = null;
    }
    if (this.canvasElement) {
      const ctx = this.canvasElement.getContext("2d");
      ctx?.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
      this.canvasElement = null;
    }
  }

  /**
   * Stop detection loops
   */
  public stop() {
    this.isRunning = false;
    this.isCalibrating = false;

    if (this.videoCallbackId && this.videoElement && "cancelVideoFrameCallback" in this.videoElement) {
      (this.videoElement as any).cancelVideoFrameCallback(this.videoCallbackId);
      this.videoCallbackId = null;
    }
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.objectTimerId) {
      clearInterval(this.objectTimerId);
      this.objectTimerId = null;
    }

    this.detachCanvas();
    this.detachBrowserEventListeners();
    console.log("[INTEGRITY] Detector stopped.");
  }

  /**
   * Full cleanup of MediaPipe resources on unmount
   */
  public close() {
    this.stop();
    try {
      this.faceLandmarker?.close();
    } catch (e) {
      console.warn("[INTEGRITY] FaceLandmarker close warning:", e);
    }
    try {
      this.objectDetector?.close();
    } catch (e) {
      console.warn("[INTEGRITY] ObjectDetector close warning:", e);
    }
    this.faceLandmarker = null;
    this.objectDetector = null;
  }

  /**
   * Face Detection Loop (~20-30 FPS aligned with requestVideoFrameCallback)
   */
  private runFaceDetectionLoop = () => {
    if (!this.isRunning) return;

    const processFrame = () => {
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
        if (!this.isProcessingFaceFrame) {
          this.isProcessingFaceFrame = true;
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
          } finally {
            this.isProcessingFaceFrame = false;
          }
        }
      }

      if (this.isRunning && this.videoElement) {
        if ("requestVideoFrameCallback" in this.videoElement) {
          this.videoCallbackId = (this.videoElement as any).requestVideoFrameCallback(processFrame);
        } else {
          this.animFrameId = requestAnimationFrame(processFrame);
        }
      }
    };

    if (this.videoElement) {
      if ("requestVideoFrameCallback" in this.videoElement) {
        this.videoCallbackId = (this.videoElement as any).requestVideoFrameCallback(processFrame);
      } else {
        this.animFrameId = requestAnimationFrame(processFrame);
      }
    }
  };

  /**
   * Object Detection Loop (every 1.5s on independent timer)
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
   * Process Face Landmark Results and calculate continuous metrics
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

      this.currentMetrics = {
        ...createEmptyMetrics(),
        faceCount: 0,
        isCalibrated: this.currentMetrics.isCalibrated,
        timestamp: now,
      };

      this.notifyMetricsUpdated(now);
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

    // 3. Primary Face Metrics Extraction
    const landmarks = results.faceLandmarks[0];
    const blendshapes = results.faceBlendshapes?.[0]?.categories || [];

    // Head Pose (Transformation Matrix with 3D landmark fallback)
    let headPose = extractPoseFromMatrix(results.facialTransformationMatrixes?.[0]);
    if (!headPose) {
      headPose = calculateHeadPose(landmarks);
    }

    // Gaze Vector & Score
    const gaze = calculateGazeVectorAndScore(landmarks, blendshapes);

    // Relative Head Turns from Baseline Calibration
    const relYaw = Math.abs(headPose.yaw - this.baseline.baselineYaw);
    const relPitch = Math.abs(headPose.pitch - this.baseline.baselinePitch);

    const isHeadAway = relYaw > INTEGRITY_CONFIG.thresholds.yawMaxDegrees || relPitch > INTEGRITY_CONFIG.thresholds.pitchMaxDegrees;
    const isEyeAway = gaze.gazeAway;
    const isGazeAway = isHeadAway || isEyeAway;

    // Suppress gaze away violation during 10s grace period or while AI speaks
    const suppressGaze = inGracePeriod || this.isAiSpeaking;
    this.checkCondition("gaze_away", isGazeAway, INTEGRITY_CONFIG.debounceMs.gazeAway, suppressGaze);

    // Extract Facial Features & Blendshapes
    const blendMap: Record<string, number> = {};
    for (const b of blendshapes) {
      blendMap[b.categoryName] = b.score;
    }

    const blinkLeft = blendMap["eyeBlinkLeft"] || 0;
    const blinkRight = blendMap["eyeBlinkRight"] || 0;
    const jawOpen = blendMap["jawOpen"] || 0;
    const mouthSmile = ((blendMap["mouthSmileLeft"] || 0) + (blendMap["mouthSmileRight"] || 0)) / 2;
    const mouthPucker = blendMap["mouthPucker"] || 0;

    // Derived Expression Label with EMA (~0.3)
    const rawExpr = classifyRawExpression(blendMap);
    const expression = this.applyExpressionEma(rawExpr);

    // Bounding Box
    const faceBoundingBox = calculateFaceBoundingBox(landmarks);

    // Update Continuous Live Metrics Object
    this.currentMetrics = {
      headPose,
      gaze,
      eyes: {
        blinkLeft,
        blinkRight,
        isOpen: blinkLeft < 0.4 && blinkRight < 0.4,
      },
      mouth: {
        jawOpen,
        mouthSmile,
        mouthPucker,
      },
      expression,
      faceBoundingBox,
      faceCount,
      isCalibrated: this.baseline.timestamp > 0,
      timestamp: now,
    };

    this.notifyMetricsUpdated(now);
    this.callbacks.onDebugFrame?.({
      yaw: Math.round(headPose.yaw),
      pitch: Math.round(headPose.pitch),
      gazeAway: isGazeAway,
      faceCount,
      detectedObjects: [],
    });
  }

  /**
   * Throttle UI metrics callback to ~5 Hz (200ms interval) to prevent 30 FPS React re-renders
   */
  private notifyMetricsUpdated(now: number) {
    if (now - this.lastUiCallbackTime >= 200) {
      this.lastUiCallbackTime = now;
      this.callbacks.onMetricsUpdate?.(this.currentMetrics);
    }
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
          strikeNumber: 0,
        });
      }
    }
  }

  /**
   * Apply Exponential Moving Average (EMA ~0.3) to expression scores
   */
  private applyExpressionEma(raw: { neutral: number; happy: number; tense: number; surprised: number }) {
    const alpha = 0.3; // EMA weight
    this.smoothedExpressionScores.neutral = alpha * raw.neutral + (1 - alpha) * this.smoothedExpressionScores.neutral;
    this.smoothedExpressionScores.happy = alpha * raw.happy + (1 - alpha) * this.smoothedExpressionScores.happy;
    this.smoothedExpressionScores.tense = alpha * raw.tense + (1 - alpha) * this.smoothedExpressionScores.tense;
    this.smoothedExpressionScores.surprised = alpha * raw.surprised + (1 - alpha) * this.smoothedExpressionScores.surprised;

    let maxLabel: "neutral" | "happy" | "tense" | "surprised" = "neutral";
    let maxVal = this.smoothedExpressionScores.neutral;

    if (this.smoothedExpressionScores.happy > maxVal) {
      maxVal = this.smoothedExpressionScores.happy;
      maxLabel = "happy";
    }
    if (this.smoothedExpressionScores.tense > maxVal) {
      maxVal = this.smoothedExpressionScores.tense;
      maxLabel = "tense";
    }
    if (this.smoothedExpressionScores.surprised > maxVal) {
      maxVal = this.smoothedExpressionScores.surprised;
      maxLabel = "surprised";
    }

    return {
      label: maxLabel,
      confidence: maxVal,
      rawScores: { ...this.smoothedExpressionScores },
    };
  }

  /**
   * Render Canvas Overlay (Green Bounding Box + Cosmetic Fade Rule)
   */
  private renderCanvasFrame() {
    const canvas = this.canvasElement;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const rectWidth = canvas.clientWidth;
    const rectHeight = canvas.clientHeight;

    if (rectWidth === 0 || rectHeight === 0) return;

    if (canvas.width !== rectWidth * dpr || canvas.height !== rectHeight * dpr) {
      canvas.width = rectWidth * dpr;
      canvas.height = rectHeight * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rectWidth, rectHeight);

    const targetBox = this.currentMetrics.faceBoundingBox;
    const now = performance.now();

    if (targetBox) {
      // Smooth bounding box coordinates using LERP (0.25)
      if (!this.smoothBox) {
        this.smoothBox = { ...targetBox };
      } else {
        const lerpAlpha = 0.25;
        this.smoothBox.xMin += (targetBox.xMin - this.smoothBox.xMin) * lerpAlpha;
        this.smoothBox.yMin += (targetBox.yMin - this.smoothBox.yMin) * lerpAlpha;
        this.smoothBox.xMax += (targetBox.xMax - this.smoothBox.xMax) * lerpAlpha;
        this.smoothBox.yMax += (targetBox.yMax - this.smoothBox.yMax) * lerpAlpha;
      }

      // Track face center position over 2s rolling window for sweep detection
      const currentCenter = {
        x: (this.smoothBox.xMin + this.smoothBox.xMax) / 2,
        y: (this.smoothBox.yMin + this.smoothBox.yMax) / 2,
        timestamp: now,
      };

      this.centerHistory.push(currentCenter);
      const cutoff = now - BOX_DISPLACEMENT_WINDOW_MS;
      this.centerHistory = this.centerHistory.filter((pt) => pt.timestamp >= cutoff);

      // Max displacement across 2s window
      let maxDisplacement = 0;
      if (this.centerHistory.length > 1) {
        for (let i = 0; i < this.centerHistory.length; i++) {
          for (let j = i + 1; j < this.centerHistory.length; j++) {
            const dx = this.centerHistory[i].x - this.centerHistory[j].x;
            const dy = this.centerHistory[i].y - this.centerHistory[j].y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > maxDisplacement) maxDisplacement = dist;
          }
        }
      }

      if (maxDisplacement >= BOX_SWEEP_DISPLACEMENT_THRESHOLD) {
        this.lastSweepTimestamp = now;
      }

      // Opacity calculation based on Cosmetic Fade Rule:
      // Fade in (~150ms), hold for 1.5s after movement settles, fade out (~400ms)
      const timeSinceSweep = now - this.lastSweepTimestamp;
      let targetAlpha = 0;

      if (timeSinceSweep <= BOX_HOLD_VISIBLE_MS) {
        targetAlpha = 1.0;
      } else if (timeSinceSweep <= BOX_HOLD_VISIBLE_MS + BOX_FADE_OUT_MS) {
        targetAlpha = 1.0 - (timeSinceSweep - BOX_HOLD_VISIBLE_MS) / BOX_FADE_OUT_MS;
      } else {
        targetAlpha = 0;
      }

      const opacityStep = 0.08;
      if (this.boxOpacity < targetAlpha) {
        this.boxOpacity = Math.min(targetAlpha, this.boxOpacity + opacityStep * 2);
      } else if (this.boxOpacity > targetAlpha) {
        this.boxOpacity = Math.max(targetAlpha, this.boxOpacity - opacityStep);
      }
    } else {
      this.smoothBox = null;
      this.boxOpacity = Math.max(0, this.boxOpacity - 0.05);
    }

    // Draw overlay box and badge if visible
    if (this.boxOpacity > 0.01 && this.smoothBox) {
      ctx.globalAlpha = Math.min(1.0, Math.max(0.0, this.boxOpacity));

      // Map mirrored coordinates: Video has CSS transform scaleX(-1)
      const xMinScreen = (1 - this.smoothBox.xMax) * rectWidth;
      const xMaxScreen = (1 - this.smoothBox.xMin) * rectWidth;
      const yMinScreen = this.smoothBox.yMin * rectHeight;
      const yMaxScreen = this.smoothBox.yMax * rectHeight;

      const pad = 12;
      const bx = Math.max(2, xMinScreen - pad);
      const by = Math.max(2, yMinScreen - pad);
      const bw = Math.min(rectWidth - bx - 2, (xMaxScreen - xMinScreen) + pad * 2);
      const bh = Math.min(rectHeight - by - 2, (yMaxScreen - yMinScreen) + pad * 2);

      // Green rounded rectangle box
      ctx.strokeStyle = "#22c55e"; // Emerald green
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      const cornerRadius = 10;
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(bx, by, bw, bh, cornerRadius);
      } else {
        ctx.rect(bx, by, bw, bh);
      }
      ctx.stroke();

      // Corner accent ticks
      ctx.lineWidth = 4;
      const tickLen = 14;
      ctx.beginPath();
      ctx.moveTo(bx, by + tickLen); ctx.lineTo(bx, by); ctx.lineTo(bx + tickLen, by);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx + bw - tickLen, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by + tickLen);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx, by + bh - tickLen); ctx.lineTo(bx, by + bh); ctx.lineTo(bx + tickLen, by + bh);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx + bw - tickLen, by + bh); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw, by + bh - tickLen);
      ctx.stroke();

      // Label Pill
      const exprLabel = (this.currentMetrics.expression?.label || "neutral").toUpperCase();
      const labelText = `${this.candidateName} • ${exprLabel}`;

      ctx.font = "600 11px Inter, system-ui, sans-serif";
      const textMetrics = ctx.measureText(labelText);
      const pillWidth = textMetrics.width + 22;
      const pillHeight = 22;
      const pillX = Math.max(4, Math.min(rectWidth - pillWidth - 4, bx + (bw - pillWidth) / 2));
      const pillY = Math.max(4, by - pillHeight - 6);

      ctx.fillStyle = "rgba(9, 9, 11, 0.88)";
      ctx.strokeStyle = "rgba(34, 197, 94, 0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(pillX, pillY, pillWidth, pillHeight, 11);
      } else {
        ctx.rect(pillX, pillY, pillWidth, pillHeight);
      }
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#22c55e";
      ctx.beginPath();
      ctx.arc(pillX + 11, pillY + 11, 3.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#f4f4f5";
      ctx.textBaseline = "middle";
      ctx.fillText(labelText, pillX + 18, pillY + 11);
    }

    ctx.restore();
  }

  /**
   * Window event listeners (Tab switch, paste, fullscreen exit)
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

// ── Helper Math Functions ─────────────────────────────────────────────────────

function createEmptyMetrics(): LiveIntegrityMetrics {
  return {
    headPose: { yaw: 0, pitch: 0, roll: 0 },
    gaze: { score: 0, gazeAway: false, vector: { x: 0, y: 0 } },
    eyes: { blinkLeft: 0, blinkRight: 0, isOpen: true },
    mouth: { jawOpen: 0, mouthSmile: 0, mouthPucker: 0 },
    expression: {
      label: "neutral",
      confidence: 1.0,
      rawScores: { neutral: 1.0, happy: 0, tense: 0, surprised: 0 },
    },
    faceBoundingBox: null,
    faceCount: 0,
    isCalibrated: false,
    timestamp: Date.now(),
  };
}

function calculateHeadPose(landmarks: Array<{ x: number; y: number; z: number }>) {
  if (!landmarks || landmarks.length < 300) return { yaw: 0, pitch: 0, roll: 0 };

  const noseTip = landmarks[1];
  const chin = landmarks[152];
  const leftEye = landmarks[33];
  const rightEye = landmarks[263];

  const eyeCenter = {
    x: (leftEye.x + rightEye.x) / 2,
    y: (leftEye.y + rightEye.y) / 2,
  };

  const yaw = (noseTip.x - eyeCenter.x) * 180;
  const pitch = (noseTip.y - (eyeCenter.y + chin.y) / 2) * 180;
  const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * (180 / Math.PI);

  return { yaw, pitch, roll };
}

function extractPoseFromMatrix(matrix: any): { yaw: number; pitch: number; roll: number } | null {
  if (!matrix) return null;
  const data: number[] = Array.isArray(matrix) ? matrix : matrix.data || matrix.rows || null;
  if (!data || data.length < 16) return null;

  const r02 = data[8];
  const r12 = data[9];
  const r22 = data[10];
  const r10 = data[1];
  const r00 = data[0];

  const pitch = Math.atan2(-r12, Math.sqrt(r02 * r02 + r22 * r22)) * (180 / Math.PI);
  const yaw = Math.atan2(r02, r22) * (180 / Math.PI);
  const roll = Math.atan2(r10, r00) * (180 / Math.PI);

  return { yaw, pitch, roll };
}

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

function calculateGazeVectorAndScore(
  landmarks: Array<{ x: number; y: number; z: number }>,
  blendshapes: Array<{ categoryName: string; score: number }>
): { score: number; gazeAway: boolean; vector: { x: number; y: number } } {
  const score = getGazeScore(blendshapes);
  let gazeVector = { x: 0, y: 0 };

  if (landmarks && landmarks.length >= 478) {
    const lOuter = landmarks[33];
    const lInner = landmarks[133];
    const lIris = landmarks[468];

    const rOuter = landmarks[263];
    const rInner = landmarks[362];
    const rIris = landmarks[473];

    const lWidth = Math.abs(lInner.x - lOuter.x) || 1e-5;
    const lDx = (lIris.x - Math.min(lOuter.x, lInner.x)) / lWidth - 0.5;

    const rWidth = Math.abs(rInner.x - rOuter.x) || 1e-5;
    const rDx = (rIris.x - Math.min(rOuter.x, rInner.x)) / rWidth - 0.5;

    gazeVector = {
      x: lDx + rDx,
      y: (lIris.y + rIris.y) / 2 - 0.5,
    };
  }

  return {
    score,
    gazeAway: score > INTEGRITY_CONFIG.thresholds.gazeBlendshapeThreshold,
    vector: gazeVector,
  };
}

function calculateFaceBoundingBox(landmarks: Array<{ x: number; y: number; z: number }>) {
  if (!landmarks || landmarks.length === 0) return null;

  let xMin = 1;
  let xMax = 0;
  let yMin = 1;
  let yMax = 0;

  for (let i = 0; i < landmarks.length; i++) {
    const pt = landmarks[i];
    if (pt.x < xMin) xMin = pt.x;
    if (pt.x > xMax) xMax = pt.x;
    if (pt.y < yMin) yMin = pt.y;
    if (pt.y > yMax) yMax = pt.y;
  }

  const width = xMax - xMin;
  const height = yMax - yMin;
  const centerX = (xMin + xMax) / 2;
  const centerY = (yMin + yMax) / 2;

  return { xMin, yMin, xMax, yMax, width, height, centerX, centerY };
}

function classifyRawExpression(blendMap: Record<string, number>): {
  neutral: number;
  happy: number;
  tense: number;
  surprised: number;
} {
  const happy = ((blendMap["mouthSmileLeft"] || 0) + (blendMap["mouthSmileRight"] || 0)) / 2;
  const surprised = Math.min(1, (blendMap["jawOpen"] || 0) * 0.5 + ((blendMap["browOuterUpLeft"] || 0) + (blendMap["browOuterUpRight"] || 0)) * 0.25);
  const tense = Math.min(1, ((blendMap["browDownLeft"] || 0) + (blendMap["browDownRight"] || 0)) * 0.4 + (blendMap["mouthPucker"] || 0) * 0.3 + (blendMap["mouthRollLower"] || 0) * 0.3);
  const neutral = Math.max(0, 1.0 - Math.max(happy, surprised, tense));

  return { neutral, happy, tense, surprised };
}
