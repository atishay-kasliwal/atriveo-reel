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
  buildTurnsPhaseGraph,
  captionBandRect,
  encoderArgs,
  type ClipInput,
} from "./filtergraph";
import { renderCaptionBand, renderTextCard } from "./textcard";

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
    // The band belongs to the document, not to any one clip, so it is drawn
    // once and reused by every pass that composites panes.
    const bandPath = await renderBandOverlay(document, workDir);

    if (document.layout === "top-bottom-turns") {
      await renderTurns(options, clips, bandPath);
    } else {
      await renderSplit(options, clips, bandPath);
    }
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
 * Renders the persistent caption band to a PNG, or null when the document has
 * none — or when Remotion could not draw it.
 *
 * A failure is not fatal, for the same reason a failed text card is not: the
 * panes have already given up the band's height to the layout, so the reel
 * still completes with a plain strip where the words would have been. A reel
 * missing its caption beats no reel at all.
 */
async function renderBandOverlay(
  document: ReelDocument,
  workDir: string,
): Promise<string | null> {
  const rect = captionBandRect(document);
  if (!rect) return null;

  try {
    const bandPath = path.join(workDir, "caption-band.png");
    await renderCaptionBand(document.captionBand, rect, bandPath);
    return bandPath;
  } catch (error) {
    console.error(
      `[pipeline] Caption band could not be rendered; the reel will show an ` +
        `empty strip between the panes instead. Cause: ${(error as Error).message}`,
    );
    return null;
  }
}

/**
 * Gets a reference for a blurred intro card before the first rendered segment
 * exists. Later cards use their preceding rendered video frame instead.
 */
async function extractOpeningFrame(
  document: ReelDocument,
  clips: Map<VideoElement, ClipInput>,
  workDir: string,
): Promise<string | null> {
  const firstVideoIndex = document.elements.findIndex((element) => element.type === "video");
  const needsOpeningBlur = document.elements.some(
    (element, index) =>
      index < firstVideoIndex &&
      element.type === "text" &&
      element.backgroundStyle === "blur",
  );
  if (!needsOpeningBlur) return null;

  const firstVideo = document.elements[firstVideoIndex];
  if (!firstVideo || firstVideo.type !== "video") return null;
  const clip = clips.get(firstVideo);
  if (!clip) return null;

  const framePath = path.join(workDir, "opening-frame.png");
  try {
    // extractFrame seeks a small amount before its target so target just past
    // the clip start gives us the first visible video frame.
    await extractFrame(
      clip.path,
      Math.min(clip.sourceDuration, clip.element.start + 0.05),
      framePath,
    );
    return framePath;
  } catch {
    return null;
  }
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
  const openingFramePath = await extractOpeningFrame(document, clips, workDir);

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
        ["-y", ...buildTextCardArgs(
          document,
          element,
          overlayPath,
          segmentPath,
          lastFramePath ?? openingFramePath,
        ).slice(0, -1),
          ...encoder, segmentPath],
        { signal },
      );
      completedDuration += element.duration;
      // Keep the last video frame so adjacent cards can share its blur.
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
 * Take-turns: render A and B as separate stacked phases, so any card between
 * their video elements is a true full-frame break rather than being moved to
 * the end of the comparison.
 */
async function renderTurns(
  options: PipelineOptions,
  clips: Map<VideoElement, ClipInput>,
  bandPath: string | null,
): Promise<void> {
  const { document, workDir, outputPath, signal } = options;
  const videos = document.elements.filter(
    (element): element is VideoElement => element.type === "video",
  );
  const clipA = clips.get(videos.find((video) => video.slot === "a")!);
  const clipB = clips.get(videos.find((video) => video.slot === "b")!);
  if (!clipA || !clipB) {
    throw new AppError("RENDER_FAILED", "Take-turns layout is missing a pane");
  }

  const encoder = encoderArgs(config.render.encoder, config.render.quality);
  const segmentPaths: string[] = [];
  const totalDuration = reelDuration(document);
  const SEGMENT_SHARE = 0.85;
  let completedDuration = 0;
  let lastFramePath: string | null = null;
  const openingFramePath = await extractOpeningFrame(document, clips, workDir);
  // Null whenever the band failed to render, which keeps the cards laid out
  // for the frame they will actually be composited into.
  const bandRect = bandPath === null ? null : captionBandRect(document);

  for (const [index, element] of document.elements.entries()) {
    if (signal?.aborted) throw new AppError("CANCELLED", "Cancelled during segments");

    const segmentPath = path.join(workDir, `seg-${String(index).padStart(3, "0")}.mp4`);
    let segmentDuration = 0;

    if (element.type === "video") {
      const graph = buildTurnsPhaseGraph(
        document,
        clipA,
        clipB,
        element.slot,
        bandPath,
      );
      const base = completedDuration;
      segmentDuration = graph.durationSeconds;

      await runFfmpeg(
        [
          "-y",
          "-ss",
          clipA.element.start.toFixed(3),
          "-t",
          (clipA.element.end - clipA.element.start).toFixed(3),
          "-i",
          clipA.path,
          "-ss",
          clipB.element.start.toFixed(3),
          "-t",
          (clipB.element.end - clipB.element.start).toFixed(3),
          "-i",
          clipB.path,
          // The band is a still, so it is looped for the phase's length. It
          // must follow both clips: the graph addresses it as input 2.
          ...(bandPath
            ? ["-loop", "1", "-t", segmentDuration.toFixed(3), "-i", bandPath]
            : []),
          ...graph.args,
          ...encoder,
          segmentPath,
        ],
        {
          totalDurationSeconds: segmentDuration,
          signal,
          onProgress: (_progress, fraction) => {
            if (fraction === undefined) return;
            const overall = (base + fraction * segmentDuration) / totalDuration;
            options.onProgress?.(overall * SEGMENT_SHARE, `Clip ${index + 1}`);
          },
        },
      );

      const framePath = path.join(workDir, `frame-${index}.png`);
      try {
        await extractFrame(segmentPath, segmentDuration, framePath);
        lastFramePath = framePath;
      } catch {
        // A blur request gracefully falls back to the solid card background.
        lastFramePath = null;
      }
    } else if (element.type === "text") {
      const overlayPath = await renderTextOverlay(
        element,
        document,
        workDir,
        index,
        bandRect,
      );
      segmentDuration = element.duration;
      await runFfmpeg(
        [
          "-y",
          ...buildTextCardArgs(
            document,
            element,
            overlayPath,
            segmentPath,
            lastFramePath ?? openingFramePath,
            bandPath,
          ).slice(0, -1),
          ...encoder,
          segmentPath,
        ],
        { signal },
      );
    } else {
      if (element.duration <= 0) continue;
      segmentDuration = element.duration;
      await runFfmpeg(
        [
          "-y",
          ...buildPauseArgs(
            document,
            element.duration,
            "black",
            null,
            segmentPath,
            bandPath,
          ).slice(0, -1),
          ...encoder,
          segmentPath,
        ],
        { signal },
      );
    }

    completedDuration += segmentDuration;
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

/** Simultaneous split layouts: both panes composite in a single FFmpeg pass. */
async function renderSplit(
  options: PipelineOptions,
  clips: Map<VideoElement, ClipInput>,
  bandPath: string | null,
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

  // The remaining split layouts both composite two panes concurrently.
  const graph = buildSplitGraph(document, clipA, clipB, bandPath);
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
      // Looped still, after both clips: the graph addresses it as input 2.
      ...(bandPath
        ? ["-loop", "1", "-t", graph.durationSeconds.toFixed(3), "-i", bandPath]
        : []),
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

  // Text and pause elements still apply to simultaneous split layouts. A
  // middle card follows the shared comparison because both panes play at once.
  const extras = document.elements.flatMap((element, index) =>
    element.type === "text" || element.type === "pause"
      ? [{ element, index }]
      : [],
  );

  if (extras.length === 0) {
    await fs.rename(compositePath, outputPath);
    options.onProgress?.(1, "Finishing");
    return;
  }

  const firstVideoIndex = document.elements.findIndex((element) => element.type === "video");
  const needsBlurBefore = extras.some(
    ({ element, index }) =>
      element.type === "text" && element.backgroundStyle === "blur" && index < firstVideoIndex,
  );
  const needsBlurAfter = extras.some(
    ({ element, index }) =>
      element.type === "text" && element.backgroundStyle === "blur" && index >= firstVideoIndex,
  );
  let firstCompositeFrame: string | null = null;
  let lastCompositeFrame: string | null = null;

  if (needsBlurBefore) {
    try {
      firstCompositeFrame = path.join(workDir, "composite-first.png");
      await extractFrame(compositePath, 0, firstCompositeFrame);
    } catch {
      firstCompositeFrame = null;
    }
  }
  if (needsBlurAfter) {
    try {
      lastCompositeFrame = path.join(workDir, "composite-last.png");
      await extractFrame(compositePath, graph.durationSeconds, lastCompositeFrame);
    } catch {
      lastCompositeFrame = null;
    }
  }

  const bandRect = bandPath === null ? null : captionBandRect(document);
  const segments: string[] = [];
  for (const { element, index } of extras) {
    const segmentPath = path.join(workDir, `extra-${index}.mp4`);

    if (element.type === "text") {
      const overlayPath = await renderTextOverlay(
        element,
        document,
        workDir,
        index,
        bandRect,
      );
      const backgroundFramePath =
        index < firstVideoIndex ? firstCompositeFrame : lastCompositeFrame;
      await runFfmpeg(
        ["-y", ...buildTextCardArgs(
          document,
          element,
          overlayPath,
          segmentPath,
          backgroundFramePath,
          bandPath,
        ).slice(0, -1),
          ...encoder, segmentPath],
        { signal },
      );
    } else {
      if (element.duration <= 0) continue;
      await runFfmpeg(
        ["-y", ...buildPauseArgs(
          document,
          element.duration,
          "black",
          null,
          segmentPath,
          bandPath,
        ).slice(0, -1),
          ...encoder, segmentPath],
        { signal },
      );
    }
    segments.push(segmentPath);
  }

  // Ordering follows the document: elements listed before the videos play
  // first, the rest play after.
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
  /** Set on the stacked layouts, where the band stays up through the card. */
  band: { y: number; height: number } | null = null,
): Promise<string | null> {
  try {
    const overlayPath = path.join(workDir, `text-${index}.png`);
    await renderTextCard(element, document.format, overlayPath, band);
    return overlayPath;
  } catch (error) {
    console.error(
      `[pipeline] Text card could not be rendered; the reel will show a blank ` +
        `card instead. Cause: ${(error as Error).message}`,
    );
    return null;
  }
}
