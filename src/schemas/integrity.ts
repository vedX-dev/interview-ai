import { z } from "zod";

export const IntegrityEventTypeEnum = z.enum([
  "no_face",
  "multiple_faces",
  "gaze_away",
  "cell_phone",
  "extra_person",
  "suspicious_object",
  "tab_switch",
  "fullscreen_exit",
  "paste_attempt",
]);

export const IntegrityEventSchema = z.object({
  type: IntegrityEventTypeEnum,
  timestamp: z.number(),
  durationMs: z.number().min(0),
  confidence: z.number().min(0).max(1),
  details: z.string().optional(),
  strikeNumber: z.number().optional(),
});

export type IntegrityEventType = z.infer<typeof IntegrityEventTypeEnum>;
export type IntegrityEvent = z.infer<typeof IntegrityEventSchema>;

export const CalibrationDataSchema = z.object({
  baselineYaw: z.number(),
  baselinePitch: z.number(),
  timestamp: z.number(),
});

export type CalibrationData = z.infer<typeof CalibrationDataSchema>;
