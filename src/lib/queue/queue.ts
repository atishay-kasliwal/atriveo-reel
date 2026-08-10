import {
  claimNextJob,
  completeJob,
  createRenderOutput,
  failJob,
  findStaleJobs,
  getJobAttempts,
  getReel,
  isCancelRequested,
  markCancelled,
  requeueJob,
  updateJobProgress,
} from "../db";
import { config } from "../shared/config";
import { AppError, toAppError } from "../shared/errors";
import type { RenderWorker } from "../renderer/worker";

/** A job is considered orphaned if its worker stops reporting for this long. */
const STALE_AFTER_SECONDS = 120;
const HEARTBEAT_INTERVAL_MS = 10_000;
const POLL_INTERVAL_MS = 1_500;
/** Retry ceiling: transient failures get another chance, real ones don't loop. */
const MAX_ATTEMPTS = 2;

/**
 * Pulls jobs off the queue and runs them one at a time.
 *
 * Concurrency is enforced by the claim being an atomic UPDATE in the database
 * rather than by an in-process lock, so even a second worker process cannot
 * double-run a job.
 */
export class RenderQueue {
  private readonly worker: RenderWorker;
  private running = false;
  private activeCount = 0;
  private readonly cancellers = new Map<string, AbortController>();
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(worker: RenderWorker) {
    this.worker = worker;
  }

  /** Begins polling. Returns once the loop is scheduled, not when it ends. */
  start(): void {
    if (this.running) return;
    this.running = true;

    this.recoverStaleJobs();

    const tick = async () => {
      if (!this.running) return;
      try {
        await this.drain();
      } catch (error) {
        console.error("[queue] poll failed:", toAppError(error).detail);
      }
      if (this.running) this.pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
    };

    void tick();
    console.log(`[queue] started (worker=${this.worker.id}, max=${config.render.maxConcurrent})`);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);

    // Abort in-flight renders so FFmpeg doesn't outlive the process.
    for (const controller of this.cancellers.values()) controller.abort();

    // Give running jobs a moment to unwind and mark themselves.
    const deadline = Date.now() + 5000;
    while (this.activeCount > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** Requests cancellation of a running job. */
  cancel(jobId: string): void {
    this.cancellers.get(jobId)?.abort();
  }

  get active(): number {
    return this.activeCount;
  }

  /**
   * Returns jobs abandoned by a crashed worker to the queue.
   *
   * Without this, a job interrupted by a crash would sit in "rendering"
   * forever and its UI would spin indefinitely.
   */
  private recoverStaleJobs(): void {
    const stale = findStaleJobs(STALE_AFTER_SECONDS);

    for (const job of stale) {
      if (getJobAttempts(job.id) >= MAX_ATTEMPTS) {
        failJob(
          job.id,
          "RENDER_FAILED",
          "The render stopped unexpectedly. Try again.",
        );
        console.warn(`[queue] job ${job.id} exceeded retries after a crash`);
      } else {
        requeueJob(job.id);
        console.warn(`[queue] requeued stale job ${job.id}`);
      }
    }
  }

  /** Claims and starts jobs until the concurrency limit is reached. */
  private async drain(): Promise<void> {
    while (this.activeCount < config.render.maxConcurrent) {
      const job = claimNextJob(this.worker.id);
      if (!job) return;

      this.activeCount += 1;
      void this.execute(job.id).finally(() => {
        this.activeCount -= 1;
        this.cancellers.delete(job.id);
      });
    }
  }

  private async execute(jobId: string): Promise<void> {
    const controller = new AbortController();
    this.cancellers.set(jobId, controller);

    // Heartbeat proves this worker is alive, so another process doesn't
    // reclaim a job that is progressing normally.
    const heartbeat = setInterval(() => {
      if (isCancelRequested(jobId)) controller.abort();
      updateJobProgress(jobId, {});
    }, HEARTBEAT_INTERVAL_MS);

    try {
      const jobRow = await this.loadJob(jobId);

      const result = await this.worker.render(
        jobRow,
        (update) => {
          updateJobProgress(jobId, {
            status: update.status,
            progress: update.progress,
            stageDetail: update.detail,
            estimatedRemainingSeconds: update.estimatedRemainingSeconds ?? null,
          });
        },
        controller.signal,
      );

      createRenderOutput({
        jobId,
        reelId: jobRow.reelId,
        storageKey: result.outputKey,
        sizeBytes: result.sizeBytes,
        durationSeconds: result.durationSeconds,
        width: result.width,
        height: result.height,
      });

      completeJob(jobId, result.outputKey);
      console.log(`[queue] job ${jobId} completed (${result.durationSeconds.toFixed(1)}s output)`);
    } catch (error) {
      const appError = toAppError(error);

      if (appError.code === "CANCELLED" || controller.signal.aborted) {
        markCancelled(jobId);
        console.log(`[queue] job ${jobId} cancelled`);
        return;
      }

      // Retry once for failures that are plausibly transient; a bad URL or an
      // out-of-range timestamp will fail identically on a second attempt.
      const retryable =
        appError.code === "DOWNLOAD_FAILED" || appError.code === "INTERNAL";

      if (retryable && getJobAttempts(jobId) < MAX_ATTEMPTS) {
        requeueJob(jobId);
        console.warn(`[queue] job ${jobId} failed, retrying: ${appError.detail}`);
        return;
      }

      failJob(jobId, appError.code, appError.userMessage);
      console.error(`[queue] job ${jobId} failed: ${appError.detail ?? appError.message}`);
    } finally {
      clearInterval(heartbeat);
    }
  }

  /** Loads the job's reel and derives the source ids it needs. */
  private async loadJob(jobId: string) {
    const { getRenderJob } = await import("../db");
    const job = getRenderJob(jobId);
    if (!job) throw new AppError("NOT_FOUND", `Job vanished: ${jobId}`);

    const reel = getReel(job.reelId);
    if (!reel) throw new AppError("NOT_FOUND", `Reel missing for job: ${jobId}`);

    const sourceIds = [
      ...new Set(
        reel.document.elements
          .filter((element) => element.type === "video")
          .map((element) => element.sourceId),
      ),
    ];

    return {
      jobId,
      reelId: job.reelId,
      document: reel.document,
      sourceIds,
    };
  }
}
