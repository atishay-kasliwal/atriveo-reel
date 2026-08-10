import type { ReelDocument } from "../shared/reel";
import type { RenderStatus } from "../shared/types";

export interface RenderJobInput {
  jobId: string;
  reelId: string;
  document: ReelDocument;
  /** Media source ids the document references. */
  sourceIds: string[];
}

export interface RenderProgressUpdate {
  status: RenderStatus;
  /** 0..1 across the whole job. */
  progress: number;
  detail?: string;
  estimatedRemainingSeconds?: number;
}

export interface RenderResult {
  /** Storage key of the finished MP4, within the renders bucket. */
  outputKey: string;
  durationSeconds: number;
  sizeBytes: number;
  width: number;
  height: number;
}

/**
 * A machine that can turn a reel document into a video file.
 *
 * The local implementation runs FFmpeg on this Mac. A future cloud
 * implementation would satisfy the same contract by submitting to a remote
 * queue and polling — the queue and API layers wouldn't change.
 */
export interface RenderWorker {
  readonly id: string;
  render(
    job: RenderJobInput,
    onProgress: (update: RenderProgressUpdate) => void,
    signal: AbortSignal,
  ): Promise<RenderResult>;
  /** Whether this worker can currently accept jobs. */
  healthCheck(): Promise<{ healthy: boolean; reason?: string }>;
}
