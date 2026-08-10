import { spawn } from "node:child_process";

import { AppError } from "../shared/errors";

export interface FfmpegProgress {
  /** Output timestamp reached, in seconds. */
  timeSeconds: number;
  /** Encoding rate relative to realtime, e.g. 2.1 means 2.1x faster. */
  speed?: number;
  frame?: number;
  fps?: number;
}

export interface RunFfmpegOptions {
  /** Expected output duration; enables fraction-of-work progress. */
  totalDurationSeconds?: number;
  onProgress?: (progress: FfmpegProgress, fraction: number | undefined) => void;
  signal?: AbortSignal;
}

/**
 * Runs FFmpeg with machine-readable progress on stdout.
 *
 * `-progress pipe:1` emits stable `key=value` lines, unlike the human-readable
 * status line on stderr which changes between versions and is painful to parse.
 */
export function runFfmpeg(
  args: string[],
  options: RunFfmpegOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const fullArgs = [
      "-hide_banner",
      "-nostdin",
      "-loglevel", "error",
      "-progress", "pipe:1",
      "-stats_period", "0.5",
      ...args,
    ];

    const child = spawn("ffmpeg", fullArgs, { stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    let pending = "";
    const current: Partial<FfmpegProgress> = {};

    const onAbort = () => {
      // SIGTERM lets FFmpeg finalise and release the file handle; SIGKILL can
      // leave a corrupt partial file behind.
      child.kill("SIGTERM");
    };

    if (options.signal) {
      if (options.signal.aborted) child.kill("SIGTERM");
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (chunk: Buffer) => {
      pending += chunk.toString();
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";

      for (const line of lines) {
        const [key, rawValue] = line.split("=");
        if (!key || rawValue === undefined) continue;
        const value = rawValue.trim();

        switch (key.trim()) {
          case "out_time_us":
          case "out_time_ms": {
            // Both keys are microseconds despite the _ms name.
            const micros = Number(value);
            if (Number.isFinite(micros) && micros >= 0) {
              current.timeSeconds = micros / 1_000_000;
            }
            break;
          }
          case "frame": {
            const frame = Number(value);
            if (Number.isFinite(frame)) current.frame = frame;
            break;
          }
          case "fps": {
            const fps = Number(value);
            if (Number.isFinite(fps)) current.fps = fps;
            break;
          }
          case "speed": {
            const speed = Number(value.replace("x", ""));
            if (Number.isFinite(speed)) current.speed = speed;
            break;
          }
          case "progress": {
            // Emitted at the end of each progress block.
            if (current.timeSeconds === undefined) break;
            const fraction =
              options.totalDurationSeconds && options.totalDurationSeconds > 0
                ? Math.min(1, current.timeSeconds / options.totalDurationSeconds)
                : undefined;
            options.onProgress?.(current as FfmpegProgress, fraction);
            break;
          }
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 32_000) stderr = stderr.slice(-32_000);
    });

    child.on("error", (error) => {
      options.signal?.removeEventListener("abort", onAbort);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new AppError(
            "INTERNAL",
            "ffmpeg not found on PATH",
            "Video tooling isn't installed on the server.",
          ),
        );
        return;
      }
      reject(error);
    });

    child.on("close", (code, signal) => {
      options.signal?.removeEventListener("abort", onAbort);

      if (options.signal?.aborted) {
        reject(new AppError("CANCELLED", "Render aborted by request"));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new AppError(
          "RENDER_FAILED",
          `ffmpeg exited ${code}${signal ? ` (${signal})` : ""}: ${stderr.slice(-4000)}`,
        ),
      );
    });
  });
}

/** Extracts a single frame as PNG — used to freeze the last frame for pauses. */
export async function extractFrame(
  inputPath: string,
  atSeconds: number,
  outputPath: string,
): Promise<void> {
  await runFfmpeg([
    "-y",
    // Seek slightly before the requested point: asking for the exact final
    // timestamp often lands past the last frame and yields nothing.
    "-ss", Math.max(0, atSeconds - 0.05).toFixed(3),
    "-i", inputPath,
    "-frames:v", "1",
    "-q:v", "2",
    outputPath,
  ]);
}
