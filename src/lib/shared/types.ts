import { z } from "zod";
import { reelDocumentSchema } from "./reel";

/** Where a piece of media came from. Extend this union to add providers. */
export const mediaTypeSchema = z.enum(["youtube", "upload"]);
export type MediaType = z.infer<typeof mediaTypeSchema>;

export const mediaSourceSchema = z.object({
  id: z.string(),
  type: mediaTypeSchema,
  title: z.string(),
  duration: z.number().optional(),
  /**
   * Provider-specific handle: a YouTube video id, or the storage key of an
   * uploaded file. Only the matching adapter should interpret it.
   */
  sourceReference: z.string(),
  thumbnailUrl: z.string().optional(),
  /** Storage key of the downloaded/cached local file, once materialised. */
  localKey: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  createdAt: z.string(),
});

export type MediaSource = z.infer<typeof mediaSourceSchema>;

export const renderStatusSchema = z.enum([
  "queued",
  "downloading",
  "preparing",
  "rendering",
  "encoding",
  "completed",
  "failed",
  "cancelled",
]);

export type RenderStatus = z.infer<typeof renderStatusSchema>;

/** Statuses after which a job will never change again. */
export const TERMINAL_STATUSES: readonly RenderStatus[] = [
  "completed",
  "failed",
  "cancelled",
];

export function isTerminal(status: RenderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export const renderJobSchema = z.object({
  id: z.string(),
  reelId: z.string(),
  status: renderStatusSchema,
  /** 0..1 across the whole job, not within the current stage. */
  progress: z.number().min(0).max(1),
  estimatedRemainingSeconds: z.number().optional(),
  outputPath: z.string().optional(),
  /** Operator-facing message. Never contains a stack trace. */
  error: z.string().optional(),
  errorCode: z.string().optional(),
  queuePosition: z.number().optional(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
});

export type RenderJob = z.infer<typeof renderJobSchema>;

export const reelSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  document: reelDocumentSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Reel = z.infer<typeof reelSchema>;

export const projectSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Project = z.infer<typeof projectSchema>;

export const renderOutputSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  reelId: z.string(),
  storageKey: z.string(),
  sizeBytes: z.number(),
  durationSeconds: z.number(),
  width: z.number(),
  height: z.number(),
  createdAt: z.string(),
});

export type RenderOutput = z.infer<typeof renderOutputSchema>;

/**
 * Stages a job passes through, in order, with the share of total progress
 * each one accounts for. Weights are tuned to how long each stage actually
 * takes so the bar advances at a roughly even pace instead of stalling at 90%.
 */
export const STAGE_WEIGHTS: Record<string, number> = {
  downloading: 0.35,
  preparing: 0.15,
  rendering: 0.35,
  encoding: 0.15,
};

export const STAGE_LABELS: Record<RenderStatus, string> = {
  queued: "Waiting in queue",
  downloading: "Fetching source video",
  preparing: "Preparing clips",
  rendering: "Rendering",
  encoding: "Encoding MP4",
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};
