import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getStageRate, recordStageTiming } from "../db";
import { materialize } from "../media";
import { config } from "../shared/config";
import { AppError } from "../shared/errors";
import { reelDuration } from "../shared/reel";
import { storage } from "../storage/local";
import { probe } from "../media/ffprobe";
import { renderReel } from "./pipeline";
import type {
  RenderJobInput,
  RenderProgressUpdate,
  RenderResult,
  RenderWorker,
} from "./worker";

/**
 * Share of total progress each stage represents. Download dominates for a
 * fresh YouTube source; when everything is cached the job jumps quickly past
 * it, which is honest — the work really is done.
 */
const STAGE_SHARE = {
  downloading: 0.4,
  preparing: 0.1,
  rendering: 0.4,
  encoding: 0.1,
} as const;

export class LocalMacRenderWorker implements RenderWorker {
  readonly id: string;

  constructor(id = `mac-${os.hostname()}-${process.pid}`) {
    this.id = id;
  }

  async healthCheck(): Promise<{ healthy: boolean; reason?: string }> {
    const freeBytes = await storage.freeSpaceBytes();
    const requiredBytes = config.render.minFreeDiskMb * 1024 * 1024;

    if (freeBytes < requiredBytes) {
      return {
        healthy: false,
        reason: `Only ${Math.round(freeBytes / 1024 / 1024)}MB free, need ${config.render.minFreeDiskMb}MB`,
      };
    }
    return { healthy: true };
  }

  async render(
    job: RenderJobInput,
    onProgress: (update: RenderProgressUpdate) => void,
    signal: AbortSignal,
  ): Promise<RenderResult> {
    const health = await this.healthCheck();
    if (!health.healthy) {
      throw new AppError("INSUFFICIENT_DISK", health.reason);
    }

    const outputSeconds = reelDuration(job.document);
    const workDir = storage.localPath("temp", `job-${job.jobId}`);
    const outputKey = `${job.reelId}/${job.jobId}.mp4`;
    const outputPath = storage.localPath("renders", outputKey);

    await fs.mkdir(workDir, { recursive: true });
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const estimator = new EtaEstimator(outputSeconds);

    try {
      /* ---- Stage 1: make sure every source is on local disk ---- */
      const stageStart = Date.now();
      onProgress({
        status: "downloading",
        progress: 0,
        detail: "Fetching source video",
        estimatedRemainingSeconds: estimator.initialEstimate(),
      });

      const sources: { sourceId: string; path: string }[] = [];

      for (const [index, sourceId] of job.sourceIds.entries()) {
        if (signal.aborted) throw new AppError("CANCELLED", "Cancelled while downloading");

        const { path: localPath } = await materialize(sourceId, {
          signal,
          onProgress: (progress) => {
            // Weight each source equally across the download stage.
            const perSource = 1 / job.sourceIds.length;
            const within = (progress.fraction ?? 0) * perSource;
            const fraction = index * perSource + within;

            onProgress({
              status: "downloading",
              progress: fraction * STAGE_SHARE.downloading,
              detail:
                job.sourceIds.length > 1
                  ? `Fetching video ${index + 1} of ${job.sourceIds.length}`
                  : "Fetching source video",
              estimatedRemainingSeconds: estimator.estimate(
                "downloading",
                fraction,
              ),
            });
          },
        });

        sources.push({ sourceId, path: localPath });
      }

      recordStageTiming(
        job.jobId,
        "downloading",
        (Date.now() - stageStart) / 1000,
        outputSeconds,
      );

      /* ---- Stage 2: verify inputs before committing to a render ---- */
      if (signal.aborted) throw new AppError("CANCELLED", "Cancelled before preparing");

      const prepareStart = Date.now();
      onProgress({
        status: "preparing",
        progress: STAGE_SHARE.downloading,
        detail: "Preparing clips",
        estimatedRemainingSeconds: estimator.estimate("preparing", 0),
      });

      for (const source of sources) {
        await probe(source.path);
      }

      recordStageTiming(
        job.jobId,
        "preparing",
        (Date.now() - prepareStart) / 1000,
        outputSeconds,
      );

      /* ---- Stage 3 & 4: render and encode ---- */
      const renderStart = Date.now();
      const renderBase = STAGE_SHARE.downloading + STAGE_SHARE.preparing;
      const renderSpan = STAGE_SHARE.rendering + STAGE_SHARE.encoding;

      await renderReel({
        document: job.document,
        sources,
        workDir,
        outputPath,
        signal,
        onProgress: (fraction, detail) => {
          // The pipeline's last 15% is the concat, which maps to "encoding".
          const status = fraction > 0.85 ? "encoding" : "rendering";
          onProgress({
            status,
            progress: renderBase + fraction * renderSpan,
            detail,
            estimatedRemainingSeconds: estimator.estimate("rendering", fraction),
          });
        },
      });

      recordStageTiming(
        job.jobId,
        "rendering",
        (Date.now() - renderStart) / 1000,
        outputSeconds,
      );

      /* ---- Finalise ---- */
      const info = await probe(outputPath);
      const stat = await fs.stat(outputPath);

      onProgress({
        status: "encoding",
        progress: 0.99,
        detail: "Finishing up",
        estimatedRemainingSeconds: 0,
      });

      return {
        outputKey,
        durationSeconds: info.durationSeconds,
        sizeBytes: stat.size,
        width: info.width,
        height: info.height,
      };
    } catch (error) {
      // A partial output would look like a valid render to the UI.
      await fs.rm(outputPath, { force: true }).catch(() => {});
      throw error;
    } finally {
      if (config.cleanup.tempOnSuccess) {
        await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }
}

/**
 * Estimates remaining time from this machine's own recorded history.
 *
 * Rates come from previous renders on this hardware, so the estimate improves
 * as the machine is used. Before enough history exists it returns undefined
 * rather than a fabricated number — the UI then shows "Rendering..." instead
 * of a countdown that would be wrong.
 */
class EtaEstimator {
  private readonly outputSeconds: number;
  private readonly stageStarts = new Map<string, number>();

  constructor(outputSeconds: number) {
    this.outputSeconds = outputSeconds;
  }

  /** Total predicted job time, or undefined without enough history. */
  initialEstimate(): number | undefined {
    const stages = ["downloading", "preparing", "rendering"] as const;
    let total = 0;

    for (const stage of stages) {
      const rate = getStageRate(stage);
      if (rate === null) return undefined;
      total += rate * this.outputSeconds;
    }
    return Math.round(total);
  }

  /**
   * Remaining seconds given the fraction of `stage` completed.
   *
   * Blends two signals: the historical rate for this machine, and the observed
   * rate of the current run. Early on the observed rate is noisy, so history
   * carries it; as the stage progresses the live measurement takes over.
   */
  estimate(stage: string, fraction: number): number | undefined {
    const now = Date.now();
    if (!this.stageStarts.has(stage)) this.stageStarts.set(stage, now);

    const remainingStages = this.remainingStagesAfter(stage);
    let downstream = 0;
    for (const next of remainingStages) {
      const rate = getStageRate(next);
      if (rate === null) return undefined;
      downstream += rate * this.outputSeconds;
    }

    const historicalRate = getStageRate(stage);
    const elapsed = (now - (this.stageStarts.get(stage) ?? now)) / 1000;

    let stageRemaining: number | undefined;

    if (fraction > 0.05 && elapsed > 2) {
      // Live measurement: how long the rest of this stage should take at the
      // pace observed so far.
      const observed = (elapsed / fraction) * (1 - fraction);
      if (historicalRate !== null) {
        const predicted = historicalRate * this.outputSeconds * (1 - fraction);
        // Shift weight to the live measurement as the stage advances.
        const liveWeight = Math.min(0.8, fraction);
        stageRemaining = observed * liveWeight + predicted * (1 - liveWeight);
      } else {
        stageRemaining = observed;
      }
    } else if (historicalRate !== null) {
      stageRemaining = historicalRate * this.outputSeconds * (1 - fraction);
    }

    if (stageRemaining === undefined) return undefined;

    const total = stageRemaining + downstream;
    // Sub-second precision is noise at this scale.
    return Math.max(0, Math.round(total));
  }

  private remainingStagesAfter(stage: string): string[] {
    const order = ["downloading", "preparing", "rendering"];
    const index = order.indexOf(stage);
    return index === -1 ? [] : order.slice(index + 1);
  }
}

export const localWorker = new LocalMacRenderWorker();
