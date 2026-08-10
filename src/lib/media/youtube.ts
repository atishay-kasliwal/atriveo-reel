import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { config } from "../shared/config";
import { AppError } from "../shared/errors";
import { storage } from "../storage/local";
import { probe } from "./ffprobe";
import type {
  DownloadOptions,
  MediaProvider,
  ResolvedMedia,
} from "./types";

/**
 * Recognised YouTube URL shapes. Anything not matching one of these is
 * rejected before we spend a subprocess on it.
 */
const URL_PATTERNS: RegExp[] = [
  /^https?:\/\/(?:www\.|m\.)?youtube\.com\/watch\?(?:.*&)?v=([\w-]{11})/,
  /^https?:\/\/youtu\.be\/([\w-]{11})/,
  /^https?:\/\/(?:www\.)?youtube\.com\/shorts\/([\w-]{11})/,
  /^https?:\/\/(?:www\.)?youtube\.com\/embed\/([\w-]{11})/,
  /^https?:\/\/(?:www\.)?youtube\.com\/live\/([\w-]{11})/,
];

export function extractVideoId(input: string): string | null {
  const trimmed = input.trim();

  for (const pattern of URL_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) return match[1];
  }
  // A bare 11-character id is accepted as a convenience.
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
  return null;
}

/**
 * Prefer H.264 + AAC. YouTube increasingly serves AV1 or VP9 by default, both
 * of which decode far more slowly and can't use the Mac's hardware H.264 path
 * during render. The trailing fallbacks accept whatever exists so an unusual
 * video still works — the renderer normalises anything non-conforming later.
 */
const FORMAT_SELECTOR = [
  "bv*[vcodec^=avc1][height<=1080]+ba[acodec^=mp4a]",
  "b[vcodec^=avc1][height<=1080]",
  "bv*[height<=1080]+ba",
  "b[height<=1080]",
  "b",
].join("/");

/** Maps yt-dlp's stderr text onto our error taxonomy. */
function classifyYtdlpError(stderr: string): AppError {
  const text = stderr.toLowerCase();

  if (text.includes("private video") || text.includes("sign in to confirm your age")) {
    return new AppError("VIDEO_UNAVAILABLE", stderr);
  }
  if (text.includes("video unavailable") || text.includes("removed by the uploader")) {
    return new AppError("VIDEO_UNAVAILABLE", stderr);
  }
  if (text.includes("not available in your country") || text.includes("geo")) {
    return new AppError("VIDEO_UNAVAILABLE", stderr);
  }
  if (text.includes("members-only") || text.includes("join this channel")) {
    return new AppError("VIDEO_UNAVAILABLE", stderr);
  }
  if (text.includes("is not a valid url") || text.includes("unsupported url")) {
    return new AppError("INVALID_URL", stderr);
  }
  if (text.includes("unable to download") || text.includes("network") || text.includes("timed out")) {
    return new AppError("DOWNLOAD_FAILED", stderr);
  }
  return new AppError("DOWNLOAD_FAILED", stderr);
}

interface YtdlpMetadata {
  id: string;
  title?: string;
  duration?: number;
  thumbnail?: string;
  width?: number;
  height?: number;
  is_live?: boolean;
  live_status?: string;
}

export class YouTubeProvider implements MediaProvider {
  readonly type = "youtube" as const;

  canHandle(input: string): boolean {
    return extractVideoId(input) !== null;
  }

  async resolve(input: string): Promise<ResolvedMedia> {
    const videoId = extractVideoId(input);
    if (!videoId) throw new AppError("INVALID_URL", `Unrecognised YouTube URL: ${input}`);

    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const { stdout, stderr, code } = await run(config.media.ytdlpPath, [
      "--dump-json",
      "--no-warnings",
      "--no-playlist",
      canonicalUrl,
    ]);

    if (code !== 0) throw classifyYtdlpError(stderr);

    let meta: YtdlpMetadata;
    try {
      meta = JSON.parse(stdout) as YtdlpMetadata;
    } catch {
      throw new AppError("VIDEO_UNAVAILABLE", `Unparseable yt-dlp metadata for ${videoId}`);
    }

    // Live streams have no fixed duration, so clip selection is meaningless.
    if (meta.is_live || meta.live_status === "is_live") {
      throw new AppError(
        "UNSUPPORTED_MEDIA",
        `${videoId} is a live stream`,
        "Live streams can't be used. Try a regular video.",
      );
    }

    const duration = meta.duration;
    if (duration && duration > config.media.maxSourceDurationSeconds) {
      const hours = Math.floor(config.media.maxSourceDurationSeconds / 3600);
      throw new AppError(
        "UNSUPPORTED_MEDIA",
        `${videoId} exceeds max duration (${duration}s)`,
        `That video is longer than the ${hours}-hour limit.`,
      );
    }

    return {
      type: "youtube",
      sourceReference: videoId,
      title: meta.title ?? `YouTube ${videoId}`,
      durationSeconds: duration,
      thumbnailUrl: meta.thumbnail,
      width: meta.width,
      height: meta.height,
    };
  }

  /**
   * Downloads the full video into the sources bucket.
   *
   * Downloading whole rather than only the selected span is deliberate: the
   * user picks timestamps by scrubbing the entire timeline, and they routinely
   * adjust the selection afterwards. One full fetch that every later edit
   * reuses beats re-fetching a new window on each change.
   */
  async download(
    media: ResolvedMedia,
    options: DownloadOptions = {},
  ): Promise<{ storageKey: string }> {
    const key = `youtube/${media.sourceReference}.mp4`;

    // Reuse an existing complete download rather than fetching again.
    if (await storage.exists("sources", key)) {
      return { storageKey: key };
    }

    const finalPath = storage.localPath("sources", key);
    await fs.mkdir(path.dirname(finalPath), { recursive: true });

    // Download into temp, then move into place, so an interrupted download
    // never leaves a truncated file that later looks like a valid cache hit.
    const stagingDir = storage.localPath("temp", `dl-${media.sourceReference}-${Date.now()}`);
    await fs.mkdir(stagingDir, { recursive: true });
    const stagingTemplate = path.join(stagingDir, "source.%(ext)s");

    try {
      const { code, stderr } = await run(
        config.media.ytdlpPath,
        [
          "-f", FORMAT_SELECTOR,
          "--merge-output-format", "mp4",
          "--no-playlist",
          "--no-warnings",
          "--newline",
          // Machine-readable progress; the human-readable bar is not stable
          // enough to parse across yt-dlp versions.
          "--progress-template",
          "DLPROGRESS %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s",
          "-o", stagingTemplate,
          `https://www.youtube.com/watch?v=${media.sourceReference}`,
        ],
        {
          signal: options.signal,
          onStdoutLine: (line) => {
            const parsed = parseProgressLine(line);
            if (parsed) options.onProgress?.(parsed);
          },
        },
      );

      if (code !== 0) {
        if (options.signal?.aborted) throw new AppError("CANCELLED", "Download aborted");
        throw classifyYtdlpError(stderr);
      }

      const produced = (await fs.readdir(stagingDir)).filter((f) => f.startsWith("source."));
      if (produced.length === 0) {
        throw new AppError("DOWNLOAD_FAILED", `yt-dlp produced no file for ${media.sourceReference}`);
      }

      const producedPath = path.join(stagingDir, produced[0]);
      // Confirm it is genuinely decodable before accepting it into the cache.
      await probe(producedPath);
      await fs.rename(producedPath, finalPath);

      return { storageKey: key };
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  }
}

/** Parses one `DLPROGRESS` line into a progress update. */
function parseProgressLine(line: string) {
  if (!line.startsWith("DLPROGRESS")) return null;

  const [, downloaded, total, totalEstimate, speed] = line.trim().split(/\s+/);
  const bytesDownloaded = numberOrUndefined(downloaded);
  // yt-dlp reports "NA" for total until headers land; the estimate fills the gap.
  const totalBytes = numberOrUndefined(total) ?? numberOrUndefined(totalEstimate);

  return {
    bytesDownloaded,
    totalBytes,
    speedBytesPerSecond: numberOrUndefined(speed),
    fraction:
      bytesDownloaded !== undefined && totalBytes !== undefined && totalBytes > 0
        ? Math.min(1, bytesDownloaded / totalBytes)
        : undefined,
  };
}

function numberOrUndefined(value: string | undefined): number | undefined {
  if (!value || value === "NA" || value === "None") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

interface RunOptions {
  signal?: AbortSignal;
  onStdoutLine?: (line: string) => void;
}

/**
 * Runs a subprocess, streaming stdout line-by-line so progress can be reported
 * as it happens rather than only at exit.
 */
function run(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let pending = "";

    const onAbort = () => child.kill("SIGTERM");
    if (options.signal) {
      if (options.signal.aborted) {
        child.kill("SIGTERM");
      } else {
        options.signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;

      if (!options.onStdoutLine) return;
      // Chunks split arbitrarily, so hold the trailing partial line until the
      // rest of it arrives.
      pending += text;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) options.onStdoutLine(line);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      // Cap retained stderr; a failing download can emit a great deal of it.
      if (stderr.length > 64_000) stderr = stderr.slice(-64_000);
    });

    child.on("error", (error) => {
      options.signal?.removeEventListener("abort", onAbort);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new AppError(
            "INTERNAL",
            `${command} not found on PATH`,
            "Media tooling isn't installed on the server.",
          ),
        );
        return;
      }
      reject(error);
    });

    child.on("close", (code) => {
      options.signal?.removeEventListener("abort", onAbort);
      if (pending && options.onStdoutLine) options.onStdoutLine(pending);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

export const youtubeProvider = new YouTubeProvider();
