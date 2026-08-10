import fs from "node:fs/promises";
import path from "node:path";

import { config } from "../shared/config";
import { AppError } from "../shared/errors";
import {
  reelDuration,
  type ReelDocument,
  type TextElement,
  type VideoElement,
} from "../shared/reel";
import { probe } from "../media/ffprobe";
import { extractFrame, runFfmpeg } from "./ffmpeg";
import {
  buildPauseArgs,
  buildSegmentArgs,
  buildSplitGraph,
  buildTextCardArgs,
  encoderArgs,
  type ClipInput,
} from "./filtergraph";
import { renderTextCard } from "./textcard";

export interface PipelineSource {
  /** Element sourceId this file satisfies. */
  sourceId: string;
  path: string;
}

export interface PipelineOptions {
  document: ReelDocument;
  sources: PipelineSource[];
  /** Scratch directory, removed by the caller. */
  workDir: string;
  outputPath: string;
  /** Reports 0..1 within the render+encode phase. */
  onProgress?: (fraction: number, detail: string) => void;
  signal?: AbortSignal;
}

/**
 * Renders a reel document to an MP4.
 *
 * Sequential reels are built segment-by-segment then concatenated; split
 * layouts render in a single pass. Segments are intermediate files rather than
 * one enormous filter graph because it keeps per-stage progress meaningful and
 * makes a failure attributable to a specific clip.
 */
export async function renderReel(options: PipelineOptions): Promise<void> {
  const { document, workDir, outputPath, signal } = options;

  await fs.mkdir(workDir, { recursive: true });

  const clips = await resolveClips(document, options.sources);

  if (document.layout === "sequential") {
    await renderSequential(options, clips);
  } else {
    await renderSplit(options, clips);
  }

  // A render that produced nothing playable is a failure even if FFmpeg
  // returned zero, so verify before declaring success.
  const info = await probe(outputPath);
  if (info.durationSeconds <= 0) {
    throw new AppError("RENDER_FAILED", `Output has zero duration: ${outputPath}`);
  }
  if (signal?.aborted) throw new AppError("CANCELLED", "Cancelled after render");
}

/** Pairs each video element with its file and probed metadata. */
async function resolveClips(
  document: ReelDocument,
  sources: PipelineSource[],
): Promise<Map<VideoElement, ClipInput>> {
  const byId = new Map(sources.map((s) => [s.sourceId, s.path]));
  const clips = new Map<VideoElement, ClipInput>();

  for (const element of document.elements) {
    if (element.type !== "video") continue;

    const filePath = byId.get(element.sourceId);
    if (!filePath) {
      throw new AppError("RENDER_FAILED", `No file for source: ${element.sourceId}`);
    }

    const info = await probe(filePath);

    // Guard against a selection that runs past the end of the source; FFmpeg
    // would silently produce a short clip rather than erroring.
    if (element.start >= info.durationSeconds) {
      throw new AppError(
        "TIMESTAMP_OUT_OF_RANGE",
        `Clip starts at ${element.start}s but source is ${info.durationSeconds}s`,
      );
    }

    clips.set(element, {
      path: filePath,
      // Clamp the end so a slightly-too-long selection trims instead of failing.
      element: { ...element, end: Math.min(element.end, info.durationSeconds) },
      sourceDuration: info.durationSeconds,
      hasAudio: info.hasAudio,
    });
  }

  return clips;
}

/**
 * Sequential: normalise every element to identical parameters, then concat.
 *
 * The concat demuxer requires exact agreement on codec, resolution, SAR, and
 * audio layout, which is why each segment is re-encoded rather than copied.
 */
async function renderSequential(
  options: PipelineOptions,
  clips: Map<VideoElement, ClipInput>,
): Promise<void> {
  const { document, workDir, outputPath, signal } = options;
  const encoder = encoderArgs(config.render.encoder, config.render.quality);

  const segmentPaths: string[] = [];
  const totalDuration = reelDuration(document);
  let completedDuration = 0;
  // Segment building is the bulk of the work; reserve the tail for concat.
  const SEGMENT_SHARE = 0.85;

  /** Last video frame seen, so a following pause can freeze on it. */
  let lastFramePath: string | null = null;

  for (const [index, element] of document.elements.entries()) {
    if (signal?.aborted) throw new AppError("CANCELLED", "Cancelled during segments");

    const segmentPath = path.join(workDir, `seg-${String(index).padStart(3, "0")}.mp4`);

    if (element.type === "video") {
      const clip = clips.get(element);
      if (!clip) throw new AppError("RENDER_FAILED", `Missing clip for element ${index}`);

      const { args, durationSeconds } = buildSegmentArgs(document, clip, segmentPath);
      const base = completedDuration;

      await runFfmpeg(["-y", ...args.slice(0, -1), ...encoder, segmentPath], {
        totalDurationSeconds: durationSeconds,
        signal,
        onProgress: (_progress, fraction) => {
          if (fraction === undefined) return;
          const overall = (base + fraction * durationSeconds) / totalDuration;
          options.onProgress?.(overall * SEGMENT_SHARE, `Clip ${index + 1}`);
        },
      });

      completedDuration += durationSeconds;

      // Capture the tail frame in case the next element is a freeze pause.
      const framePath = path.join(workDir, `frame-${index}.png`);
      try {
        await extractFrame(segmentPath, durationSeconds, framePath);
        lastFramePath = framePath;
      } catch {
        // A missing freeze frame only downgrades the pause to black.
        lastFramePath = null;
      }
    } else if (element.type === "pause") {
      if (element.duration <= 0) continue;

      await runFfmpeg(
        ["-y", ...buildPauseArgs(
          document,
          element.duration,
          element.style,
          lastFramePath,
          segmentPath,
        ).slice(0, -1), ...encoder, segmentPath],
        { signal },
      );
      completedDuration += element.duration;
    } else {
      const overlayPath = await renderTextOverlay(element, document, workDir, index);

      await runFfmpeg(
        ["-y", ...buildTextCardArgs(document, element, overlayPath, segmentPath).slice(0, -1),
          ...encoder, segmentPath],
        { signal },
      );
      completedDuration += element.duration;
      // A text card resets the freeze reference; freezing on it would be odd.
      lastFramePath = null;
    }

    segmentPaths.push(segmentPath);
    options.onProgress?.(
      (completedDuration / totalDuration) * SEGMENT_SHARE,
      `Clip ${index + 1} of ${document.elements.length}`,
    );
  }

  if (segmentPaths.length === 0) {
    throw new AppError("RENDER_FAILED", "Reel produced no segments");
  }

  await concatSegments(segmentPaths, workDir, outputPath, totalDuration, options);
}

/**
 * Joins finished segments. Since every segment was encoded with identical
 * parameters, this is a stream copy — fast, and it avoids a second generation
 * of lossy encoding.
 */
async function concatSegments(
  segmentPaths: string[],
  workDir: string,
  outputPath: string,
  totalDuration: number,
  options: PipelineOptions,
): Promise<void> {
  const listPath = path.join(workDir, "concat.txt");
  // Single quotes are the concat demuxer's escape mechanism for paths.
  const listBody = segmentPaths
    .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
    .join("\n");
  await fs.writeFile(listPath, `${listBody}\n`, "utf8");

  await runFfmpeg(
    [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listPath,
      "-c", "copy",
      "-movflags", "+faststart",
      outputPath,
    ],
    {
      totalDurationSeconds: totalDuration,
      signal: options.signal,
      onProgress: (_progress, fraction) => {
        if (fraction === undefined) return;
        options.onProgress?.(0.85 + fraction * 0.15, "Joining clips");
      },
    },
  );
}

/** Split layouts: both panes composite in a single FFmpeg pass. */
async function renderSplit(
  options: PipelineOptions,
  clips: Map<VideoElement, ClipInput>,
): Promise<void> {
  const { document, workDir, outputPath, signal } = options;

  const videos = document.elements.filter(
    (e): e is VideoElement => e.type === "video",
  );
  const elementA = videos.find((v) => v.slot === "a");
  const elementB = videos.find((v) => v.slot === "b");
  if (!elementA || !elementB) {
    throw new AppError("RENDER_FAILED", "Split layout is missing a pane");
  }

  const clipA = clips.get(elementA);
  const clipB = clips.get(elementB);
  if (!clipA || !clipB) throw new AppError("RENDER_FAILED", "Split layout clips unresolved");

  const graph = buildSplitGraph(document, clipA, clipB);
  const encoder = encoderArgs(config.render.encoder, config.render.quality);

  const compositePath = path.join(workDir, "composite.mp4");

  await runFfmpeg(
    [
      "-y",
      "-ss", clipA.element.start.toFixed(3),
      "-t", (clipA.element.end - clipA.element.start).toFixed(3),
      "-i", clipA.path,
      "-ss", clipB.element.start.toFixed(3),
      "-t", (clipB.element.end - clipB.element.start).toFixed(3),
      "-i", clipB.path,
      ...graph.args,
      ...encoder,
      compositePath,
    ],
    {
      totalDurationSeconds: graph.durationSeconds,
      signal,
      onProgress: (_progress, fraction) => {
        if (fraction === undefined) return;
        options.onProgress?.(fraction * 0.9, "Compositing panes");
      },
    },
  );

  // Text and pause elements still apply to split layouts; they play before or
  // after the composited pair rather than beside it.
  const extras = document.elements.filter(
    (e) => e.type === "text" || e.type === "pause",
  );

  if (extras.length === 0) {
    await fs.rename(compositePath, outputPath);
    options.onProgress?.(1, "Finishing");
    return;
  }

  const segments: string[] = [];
  for (const [index, element] of extras.entries()) {
    const segmentPath = path.join(workDir, `extra-${index}.mp4`);

    if (element.type === "text") {
      const overlayPath = await renderTextOverlay(element, document, workDir, index);
      await runFfmpeg(
        ["-y", ...buildTextCardArgs(document, element, overlayPath, segmentPath).slice(0, -1),
          ...encoder, segmentPath],
        { signal },
      );
    } else {
      if (element.duration <= 0) continue;
      await runFfmpeg(
        ["-y", ...buildPauseArgs(document, element.duration, "black", null, segmentPath).slice(0, -1),
          ...encoder, segmentPath],
        { signal },
      );
    }
    segments.push(segmentPath);
  }

  // Ordering follows the document: elements listed before the videos play
  // first, the rest play after.
  const firstVideoIndex = document.elements.findIndex((e) => e.type === "video");
  const before: string[] = [];
  const after: string[] = [];
  let cursor = 0;
  for (const [index, element] of document.elements.entries()) {
    if (element.type === "video") continue;
    if (element.type === "pause" && element.duration <= 0) continue;
    const segmentPath = segments[cursor++];
    if (!segmentPath) continue;
    (index < firstVideoIndex ? before : after).push(segmentPath);
  }

  await concatSegments(
    [...before, compositePath, ...after],
    workDir,
    outputPath,
    reelDuration(document),
    options,
  );
}

/**
 * Renders a text card to a transparent PNG via Remotion.
 *
 * Remotion is the only text path — FFmpeg's text filters aren't present in the
 * stock macOS build. Returning null degrades the card to a plain coloured
 * frame: the reel still completes, just without the words. Failing the whole
 * render over a caption would be the worse trade.
 */
async function renderTextOverlay(
  element: TextElement,
  document: ReelDocument,
  workDir: string,
  index: number,
): Promise<string | null> {
  try {
    const overlayPath = path.join(workDir, `text-${index}.png`);
    await renderTextCard(element, document.format, overlayPath);
    return overlayPath;
  } catch (error) {
    console.error(
      `[pipeline] Text card could not be rendered; the reel will show a blank ` +
        `card instead. Cause: ${(error as Error).message}`,
    );
    return null;
  }
}
