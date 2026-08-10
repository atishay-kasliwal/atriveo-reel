import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { AppError } from "../shared/errors";

const execFileAsync = promisify(execFile);

export interface MediaInfo {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  codec: string;
}

/** Reads stream metadata from a local media file. */
export async function probe(filePath: string): Promise<MediaInfo> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      filePath,
    ], { maxBuffer: 10 * 1024 * 1024 }));
  } catch (error) {
    throw new AppError(
      "UNSUPPORTED_MEDIA",
      `ffprobe failed for ${filePath}: ${(error as Error).message}`,
    );
  }

  const data = JSON.parse(stdout) as {
    streams?: Array<Record<string, unknown>>;
    format?: Record<string, unknown>;
  };

  const video = data.streams?.find((s) => s.codec_type === "video");
  if (!video) {
    throw new AppError("UNSUPPORTED_MEDIA", `No video stream in ${filePath}`);
  }

  const hasAudio = data.streams?.some((s) => s.codec_type === "audio") ?? false;

  // Duration can live on the stream or only on the container, depending on
  // the format; prefer the container value since it accounts for edit lists.
  const formatDuration = Number(data.format?.duration);
  const streamDuration = Number(video.duration);
  const durationSeconds = Number.isFinite(formatDuration)
    ? formatDuration
    : Number.isFinite(streamDuration)
      ? streamDuration
      : 0;

  return {
    durationSeconds,
    width: Number(video.width) || 0,
    height: Number(video.height) || 0,
    fps: parseFrameRate(video.r_frame_rate as string | undefined),
    hasAudio,
    codec: (video.codec_name as string) ?? "unknown",
  };
}

/** Parses ffprobe's "30000/1001" rational frame rate into a number. */
function parseFrameRate(value: string | undefined): number {
  if (!value) return 30;
  const [num, den] = value.split("/").map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 30;
  return num / den;
}
