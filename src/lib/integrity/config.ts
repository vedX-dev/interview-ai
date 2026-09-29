/**
 * Integrity Monitoring Configuration.
 * Centralized settings, model asset paths, detection thresholds, and policy rules.
 */

export const INTEGRITY_CONFIG = {
  // Self-hosted MediaPipe assets in /public
  wasmLoaderPath: "/mediapipe/wasm",
  faceLandmarkerModelPath: "/mediapipe/face_landmarker.task",
  objectDetectorModelPath: "/mediapipe/object_detector.tflite",

  // Sampling Frequencies
  faceDetectionIntervalMs: 150, // ~6.6 fps
  objectDetectionIntervalMs: 1500, // every 1.5s

  // Calibration
  calibrationDurationMs: 3000, // 3s lobby calibration

  // Baseline Relative Thresholds
  thresholds: {
    yawMaxDegrees: 25, // Head turning left/right beyond baseline
    pitchMaxDegrees: 20, // Head tilting up/down beyond baseline
    gazeBlendshapeThreshold: 0.42, // Eye look away threshold
    objectConfidence: 0.50, // Object detection minimum score
  },

  // Debounce Durations (Violation must be continuous for this duration before firing event)
  debounceMs: {
    noFace: 5000,          // >5s continuous no face
    multipleFaces: 1000,   // >1s continuous second person
    gazeAway: 4000,        // >4s continuous gaze/head away
    cellPhone: 2000,       // >2s continuous phone visible
    extraPerson: 2000,     // >2s continuous extra person
    suspiciousObject: 4000,// >4s continuous laptop/book
    tabSwitch: 500,        // tab blur/hidden
    fullscreenExit: 500,   // fullscreen exit
  },

  // Grace Period
  gracePeriodMs: 10000, // Ignore violations during first 10s of interview

  // Policy Settings
  maxStrikes: 3,
  // Immediate stop allowed ONLY for these two cases (as per strict prompt requirement)
  immediateStopTypes: ["multiple_faces", "cell_phone"] as const,
};
