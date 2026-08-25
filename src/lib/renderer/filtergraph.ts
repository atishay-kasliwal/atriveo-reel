import {
  hasCaptionBand,
  paneGap,
  type FitMode,
  type ReelDocument,
  type TextElement,
  type VideoElement,
} from "../shared/reel";

/**
 * Builds FFmpeg filter graphs for a reel.
 *
 * Kept pure — inputs and a document in, argv out — so the layout and aspect
 * ratio logic can be tested without invoking FFmpeg or touching a file.
 */

export interface ClipInput {
  /** Absolute path to the source file on disk. */
  path: string;
  /** The element this input satisfies. */
  element: VideoElement;
  /** Real duration of the source, from ffprobe. */
  sourceDuration: number;
  hasAudio: boolean;
}

export interface GraphResult {
  args: string[];
  /** Duration of the output this graph produces, in seconds. */
  durationSeconds: number;
}

/**
 * Scale-and-pad chain that fits a source into a slot without ever distorting it.
 *
 * `contain` scales until the whole frame fits, then pads the leftover with the
 * background colour. `cover` scales until the slot is filled, then crops the
 * overflow. `force_original_aspect_ratio` is what guarantees we never stretch.
 */
export function fitFilter(
  width: number,
  height: number,
  fit: FitMode,
  background: string,
): string {
  const pad = background.replace("#", "0x");

  if (fit === "contain") {
    return [
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      // Even dimensions are required by yuv420p chroma subsampling.
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:${pad}`,
      `setsar=1`,
    ].join(",");
  }

  return [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    `setsar=1`,
  ].join(",");
}

/** Slot geometry for a layout, in output pixels. */
export function slotGeometry(
  doc: ReelDocument,
): { a: { w: number; h: number }; b: { w: number; h: number } } | null {
  const { width, height } = doc.format;
  // The caption band widens the gap when it is in use, so the panes give up
  // exactly the space it occupies.
  const gutter = paneGap(doc);

  if (doc.layout === "top-bottom" || doc.layout === "top-bottom-turns") {
    // Split the gutter out of the total height, then halve. Rounding to even
    // keeps both panes yuv420p-safe.
    const paneHeight = evenDown((height - gutter) / 2);
    return { a: { w: width, h: paneHeight }, b: { w: width, h: paneHeight } };
  }

  if (doc.layout === "side-by-side") {
    const paneWidth = evenDown((width - gutter) / 2);
    return { a: { w: paneWidth, h: height }, b: { w: paneWidth, h: height } };
  }

  return null;
}

function evenDown(value: number): number {
  const floored = Math.floor(value);
  return floored % 2 === 0 ? floored : floored - 1;
}

/**
 * Where the caption band sits in the output frame, or null when there is no
 * band to draw.
 *
 * The height is measured as the leftover between the two panes rather than
 * read from the document: rounding pane heights down to even numbers can
 * leave the gap a pixel taller than requested, and the band has to fill it
 * exactly or a hairline of background shows through.
 */
export function captionBandRect(
  doc: ReelDocument,
): { y: number; width: number; height: number } | null {
  if (!hasCaptionBand(doc)) return null;

  const geometry = slotGeometry(doc);
  if (!geometry) return null;

  const height = doc.format.height - geometry.a.h - geometry.b.h;
  if (height <= 0) return null;

  return { y: geometry.a.h, width: doc.format.width, height };
}

/**
 * The steps that lay the caption band over a finished pane composite.
 *
 * `paneLabel` is where the panes should be written: straight to `[vout]` when
 * there is no band, so every caller emits the same shape whether or not one
 * is in play. The band arrives as a pre-rendered PNG on `bandInputIndex`,
 * which callers supply as the input after the two clips.
 */
function captionBandOverlay(
  doc: ReelDocument,
  bandPath: string | null,
  bandInputIndex: number,
): { paneLabel: string; filters: string[] } {
  const rect = bandPath === null ? null : captionBandRect(doc);
  if (!rect) return { paneLabel: "[vout]", filters: [] };

  return {
    paneLabel: "[panes]",
    filters: [
      `[${bandInputIndex}:v]fps=${doc.format.fps},` +
        `scale=${rect.width}:${rect.height},setsar=1[band]`,
      // format=auto keeps the band's alpha, so rounded or padded artwork
      // composites rather than punching a hole in the frame.
      `[panes][band]overlay=0:${rect.y}:format=auto[vout]`,
    ],
  };
}

/**
 * Builds the graph for a split layout, where both clips play simultaneously.
 *
 * The panes are stacked onto a background canvas rather than with hstack/vstack
 * so a gutter can sit between them and the shorter clip can hold its final
 * frame instead of collapsing the layout.
 */
export function buildSplitGraph(
  doc: ReelDocument,
  clipA: ClipInput,
  clipB: ClipInput,
  /** Pre-rendered caption band PNG, supplied as the input after both clips. */
  bandPath: string | null = null,
): GraphResult {
  const geometry = slotGeometry(doc);
  if (!geometry) throw new Error(`buildSplitGraph called for layout: ${doc.layout}`);

  const { width, height, fps } = doc.format;
  const durationA = clipA.element.end - clipA.element.start;
  const durationB = clipB.element.end - clipB.element.start;
  // Both panes stay on screen for the longer of the two clips.
  const duration = Math.max(durationA, durationB);
  const background = doc.backgroundColor.replace("#", "0x");

  const filters: string[] = [];

  // Canvas the panes composite onto. Sized to the full output so pane
  // placement is a simple offset.
  filters.push(
    `color=c=${background}:s=${width}x${height}:r=${fps}:d=${duration.toFixed(3)}[canvas]`,
  );

  for (const [index, clip] of [clipA, clipB].entries()) {
    const label = index === 0 ? "a" : "b";
    const slot = index === 0 ? geometry.a : geometry.b;
    const clipDuration = clip.element.end - clip.element.start;

    const steps = [
      `fps=${fps}`,
      fitFilter(slot.w, slot.h, clip.element.fit, doc.backgroundColor),
    ];

    // A shorter clip freezes on its last frame so the pane never goes blank
    // mid-comparison. tpad only extends; it never truncates.
    if (clipDuration < duration - 0.001) {
      steps.push(`tpad=stop_mode=clone:stop_duration=${(duration - clipDuration).toFixed(3)}`);
    }
    steps.push("setpts=PTS-STARTPTS");

    filters.push(`[${index}:v]${steps.join(",")}[v${label}]`);
  }

  const isVertical =
    doc.layout === "top-bottom" || doc.layout === "top-bottom-turns";
  const gap = paneGap(doc);
  const offsetB = isVertical
    ? `0:${geometry.a.h + gap}`
    : `${geometry.a.w + gap}:0`;
  const band = captionBandOverlay(doc, bandPath, 2);

  filters.push(`[canvas][va]overlay=0:0:shortest=0[stage1]`);
  filters.push(`[stage1][vb]overlay=${offsetB}${band.paneLabel}`);
  filters.push(...band.filters);

  const audioFilters = buildSplitAudio([clipA, clipB], duration);
  filters.push(...audioFilters.filters);

  return {
    args: [
      "-filter_complex",
      [...filters].join(";"),
      "-map", "[vout]",
      "-map", audioFilters.outputLabel,
      "-t", duration.toFixed(3),
    ],
    durationSeconds: duration,
  };
}

/**
 * Builds the graph for "top-bottom-turns": both panes stay on screen, but the
 * clips play in turn rather than together.
 *
 * Each pane is the clip preceded or followed by a held still, so the pane is
 * never blank:
 *
 *   pane A = [ clip A plays ][ A holds its last frame ]
 *   pane B = [ B holds its first frame ][ clip B plays ]
 *
 * `tpad` supplies both holds — `stop_mode=clone` extends the tail with the
 * final frame, `start_mode=clone` extends the head with the first one. The
 * result is two streams of identical length that composite exactly like the
 * simultaneous layout, so pane placement is unchanged.
 *
 * Audio is concatenated rather than mixed: only the playing clip should be
 * audible, or the waiting pane's soundtrack would bleed over its neighbour.
 */
export function buildTurnsGraph(
  doc: ReelDocument,
  clipA: ClipInput,
  clipB: ClipInput,
  bandPath: string | null = null,
): GraphResult {
  const geometry = slotGeometry(doc);
  if (!geometry) throw new Error(`buildTurnsGraph called for layout: ${doc.layout}`);

  const { width, height, fps } = doc.format;
  const durationA = clipA.element.end - clipA.element.start;
  const durationB = clipB.element.end - clipB.element.start;
  // The panes take turns, so the reel runs for both clips back to back.
  const duration = durationA + durationB;
  const background = doc.backgroundColor.replace("#", "0x");

  const filters: string[] = [];

  filters.push(
    `color=c=${background}:s=${width}x${height}:r=${fps}:d=${duration.toFixed(3)}[canvas]`,
  );

  // Pane A: plays first, then freezes on its final frame for B's turn.
  filters.push(
    `[0:v]fps=${fps},${fitFilter(geometry.a.w, geometry.a.h, clipA.element.fit, doc.backgroundColor)},` +
      `tpad=stop_mode=clone:stop_duration=${durationB.toFixed(3)},` +
      `setpts=PTS-STARTPTS[va]`,
  );

  // Pane B: holds its opening frame through A's turn, then plays.
  filters.push(
    `[1:v]fps=${fps},${fitFilter(geometry.b.w, geometry.b.h, clipB.element.fit, doc.backgroundColor)},` +
      `tpad=start_mode=clone:start_duration=${durationA.toFixed(3)},` +
      `setpts=PTS-STARTPTS[vb]`,
  );

  const offsetB = `0:${geometry.a.h + paneGap(doc)}`;
  const band = captionBandOverlay(doc, bandPath, 2);
  filters.push(`[canvas][va]overlay=0:0:shortest=0[stage1]`);
  filters.push(`[stage1][vb]overlay=${offsetB}${band.paneLabel}`);
  filters.push(...band.filters);

  const audio = buildTurnsAudio(clipA, clipB, durationA, durationB);
  filters.push(...audio.filters);

  return {
    args: [
      "-filter_complex",
      filters.join(";"),
      "-map", "[vout]",
      "-map", audio.outputLabel,
      "-t", duration.toFixed(3),
    ],
    durationSeconds: duration,
  };
}

/** One playable leg of the take-turns comparison. */
export type TurnsPhase = "a" | "b";

/**
 * Builds either half of a take-turns comparison as its own movie.
 *
 * Keeping the halves separate lets a full-frame card sit exactly between clip
 * A and clip B. The inactive pane is a held first/last frame, matching the
 * behaviour of `buildTurnsGraph`; only the active pane's audio is included.
 */
export function buildTurnsPhaseGraph(
  doc: ReelDocument,
  clipA: ClipInput,
  clipB: ClipInput,
  phase: TurnsPhase,
  bandPath: string | null = null,
): GraphResult {
  const geometry = slotGeometry(doc);
  if (!geometry) {
    throw new Error(`buildTurnsPhaseGraph called for layout: ${doc.layout}`);
  }

  const { width, height, fps } = doc.format;
  const durationA = clipA.element.end - clipA.element.start;
  const durationB = clipB.element.end - clipB.element.start;
  const duration = phase === "a" ? durationA : durationB;
  const background = doc.backgroundColor.replace("#", "0x");
  const oneFrame = 1 / fps;
  const filters: string[] = [
    `color=c=${background}:s=${width}x${height}:r=${fps}:d=${duration.toFixed(3)}[canvas]`,
  ];

  const active = phase === "a" ? clipA : clipB;
  const inactive = phase === "a" ? clipB : clipA;
  const activeIndex = phase === "a" ? 0 : 1;
  const inactiveIndex = phase === "a" ? 1 : 0;
  const activeSlot = phase === "a" ? geometry.a : geometry.b;
  const inactiveSlot = phase === "a" ? geometry.b : geometry.a;
  const inactiveFrameStart =
    phase === "a"
      ? 0
      : Math.max(0, durationA - oneFrame);
  const inactiveFrameEnd =
    phase === "a" ? oneFrame : durationA;

  filters.push(
    `[${activeIndex}:v]fps=${fps},` +
      `${fitFilter(activeSlot.w, activeSlot.h, active.element.fit, doc.backgroundColor)},` +
      `setpts=PTS-STARTPTS[v${phase === "a" ? "a" : "b"}]`,
  );
  filters.push(
    `[${inactiveIndex}:v]fps=${fps},` +
      `${fitFilter(inactiveSlot.w, inactiveSlot.h, inactive.element.fit, doc.backgroundColor)},` +
      `trim=start=${inactiveFrameStart.toFixed(3)}:end=${inactiveFrameEnd.toFixed(3)},` +
      `tpad=stop_mode=clone:stop_duration=${duration.toFixed(3)},` +
      `trim=duration=${duration.toFixed(3)},setpts=PTS-STARTPTS[` +
      `v${phase === "a" ? "b" : "a"}]`,
  );

  const offsetB = `0:${geometry.a.h + paneGap(doc)}`;
  const band = captionBandOverlay(doc, bandPath, 2);
  filters.push(`[canvas][va]overlay=0:0:shortest=0[stage1]`);
  filters.push(`[stage1][vb]overlay=${offsetB}${band.paneLabel}`);
  filters.push(...band.filters);

  const audio = buildTurnsPhaseAudio(active, activeIndex, duration);
  filters.push(...audio.filters);

  return {
    args: [
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[vout]",
      "-map",
      audio.outputLabel,
      "-t",
      duration.toFixed(3),
    ],
    durationSeconds: duration,
  };
}

/**
 * Audio for the take-turns layout: A's sound, then B's, joined end to end.
 *
 * A silent stretch stands in for a clip with no audio, so the two halves stay
 * aligned with their video no matter which sources carry sound.
 */
function buildTurnsAudio(
  clipA: ClipInput,
  clipB: ClipInput,
  durationA: number,
  durationB: number,
): { filters: string[]; outputLabel: string } {
  const filters: string[] = [];

  const half = (
    clip: ClipInput,
    index: number,
    duration: number,
    label: string,
  ) => {
    if (clip.hasAudio && !clip.element.muted) {
      filters.push(
        `[${index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
          `apad,atrim=0:${duration.toFixed(3)},asetpts=PTS-STARTPTS[${label}]`,
      );
    } else {
      filters.push(
        `anullsrc=channel_layout=stereo:sample_rate=48000,` +
          `atrim=0:${duration.toFixed(3)},asetpts=PTS-STARTPTS[${label}]`,
      );
    }
  };

  half(clipA, 0, durationA, "atA");
  half(clipB, 1, durationB, "atB");

  filters.push(`[atA][atB]concat=n=2:v=0:a=1[aout]`);
  return { filters, outputLabel: "[aout]" };
}

/** Audio for one take-turns phase: just the pane that is actually playing. */
function buildTurnsPhaseAudio(
  clip: ClipInput,
  index: number,
  duration: number,
): { filters: string[]; outputLabel: string } {
  if (clip.hasAudio && !clip.element.muted) {
    return {
      filters: [
        `[${index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
          `apad,atrim=0:${duration.toFixed(3)},asetpts=PTS-STARTPTS[aout]`,
      ],
      outputLabel: "[aout]",
    };
  }

  return {
    filters: [
      `anullsrc=channel_layout=stereo:sample_rate=48000,` +
        `atrim=0:${duration.toFixed(3)},asetpts=PTS-STARTPTS[aout]`,
    ],
    outputLabel: "[aout]",
  };
}

/**
 * Audio for split layouts: both clips are audible, mixed together.
 *
 * amix rather than amerge, so the result stays stereo rather than becoming a
 * 4-channel file. `normalize=0` preserves each source's level; letting amix
 * normalise would make both sides quieter as inputs are added.
 */
function buildSplitAudio(
  clips: ClipInput[],
  duration: number,
): { filters: string[]; outputLabel: string } {
  const filters: string[] = [];
  const audible = clips.filter((c) => c.hasAudio && !c.element.muted);

  if (audible.length === 0) {
    filters.push(
      `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${duration.toFixed(3)}[aout]`,
    );
    return { filters, outputLabel: "[aout]" };
  }

  const labels: string[] = [];
  for (const clip of audible) {
    const index = clips.indexOf(clip);
    const label = `aud${index}`;
    filters.push(
      `[${index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
        `apad,atrim=0:${duration.toFixed(3)},asetpts=PTS-STARTPTS[${label}]`,
    );
    labels.push(`[${label}]`);
  }

  if (labels.length === 1) {
    return { filters, outputLabel: labels[0] };
  }

  filters.push(
    `${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0[aout]`,
  );
  return { filters, outputLabel: "[aout]" };
}

/**
 * Normalises one clip to output geometry, framerate and audio format.
 *
 * Sequential reels are built by normalising each segment to identical
 * parameters and then concatenating: the concat filter requires exact
 * agreement on resolution, SAR, framerate, and audio layout.
 */
export function buildSegmentArgs(
  doc: ReelDocument,
  clip: ClipInput,
  outputPath: string,
): { args: string[]; durationSeconds: number } {
  const { width, height, fps } = doc.format;
  const duration = clip.element.end - clip.element.start;

  const videoChain = [
    `fps=${fps}`,
    fitFilter(width, height, clip.element.fit, doc.backgroundColor),
    `setpts=PTS-STARTPTS`,
  ].join(",");

  const args = [
    // -ss before -i seeks by keyframe index instead of decoding from zero,
    // which matters when pulling a clip from deep inside a long video.
    "-ss", clip.element.start.toFixed(3),
    "-t", duration.toFixed(3),
    "-i", clip.path,
  ];

  if (clip.hasAudio && !clip.element.muted) {
    args.push(
      "-filter_complex",
      `[0:v]${videoChain}[v];` +
        `[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
        `apad,atrim=0:${duration.toFixed(3)},asetpts=PTS-STARTPTS[a]`,
      "-map", "[v]",
      "-map", "[a]",
    );
  } else {
    // Silent sources still need an audio track: concat demands that every
    // segment carry the same stream layout.
    args.push(
      "-f", "lavfi",
      "-i", `anullsrc=channel_layout=stereo:sample_rate=48000`,
      "-filter_complex", `[0:v]${videoChain}[v]`,
      "-map", "[v]",
      "-map", "1:a",
      "-t", duration.toFixed(3),
    );
  }

  args.push("-t", duration.toFixed(3), outputPath);
  return { args, durationSeconds: duration };
}

/**
 * Collects FFmpeg inputs while keeping track of the index each one lands on.
 *
 * The still-frame builders layer a variable set of inputs — a background, a
 * text overlay, silence, a caption band — and every filter has to address its
 * input by position. Handing out the index at the point the input is added is
 * what stops that bookkeeping from drifting as layers come and go.
 */
function inputCollector(): {
  args: string[];
  add: (...args: string[]) => number;
} {
  const args: string[] = [];
  let next = 0;
  return {
    args,
    add: (...parts: string[]) => {
      args.push(...parts);
      return next++;
    },
  };
}

/**
 * Overlays the caption band onto a still segment, so a card or a pause does
 * not blink the band off screen for its duration.
 *
 * Returns the label the finished frame ends up on, which is the label it was
 * given when there is no band to add.
 */
function overlayBandOnStill(
  doc: ReelDocument,
  filters: string[],
  inputs: ReturnType<typeof inputCollector>,
  label: string,
  duration: string,
  bandPath: string | null,
): string {
  const rect = bandPath === null ? null : captionBandRect(doc);
  if (!rect) return label;

  const index = inputs.add("-loop", "1", "-t", duration, "-i", bandPath!);
  filters.push(
    `[${index}:v]fps=${doc.format.fps},` +
      `scale=${rect.width}:${rect.height},setsar=1[band]`,
  );
  filters.push(`${label}[band]overlay=0:${rect.y}:format=auto[banded]`);
  return "[banded]";
}

/** A held frame or blank segment, matching segment geometry exactly. */
export function buildPauseArgs(
  doc: ReelDocument,
  duration: number,
  style: "freeze" | "black",
  previousFramePath: string | null,
  outputPath: string,
  /** Pre-rendered caption band, so a pause does not interrupt it. */
  bandPath: string | null = null,
): string[] {
  const { width, height, fps } = doc.format;
  const background = doc.backgroundColor.replace("#", "0x");
  const seconds = duration.toFixed(3);

  const inputs = inputCollector();
  const filters: string[] = [];

  // A freeze needs a frame to hold; without one it degrades to black.
  const freeze = style === "freeze" && previousFramePath !== null;
  const backgroundIndex = freeze
    ? inputs.add("-loop", "1", "-t", seconds, "-i", previousFramePath!)
    : inputs.add(
        "-f",
        "lavfi",
        "-i",
        `color=c=${background}:s=${width}x${height}:r=${fps}:d=${seconds}`,
      );

  filters.push(
    freeze
      ? `[${backgroundIndex}:v]fps=${fps},scale=${width}:${height},setsar=1,` +
          `setpts=PTS-STARTPTS[still]`
      : `[${backgroundIndex}:v]setpts=PTS-STARTPTS[still]`,
  );

  // Silence is registered before the band so its index never moves when the
  // band comes and goes.
  const silenceIndex = inputs.add(
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=48000",
  );

  const label = overlayBandOnStill(
    doc,
    filters,
    inputs,
    "[still]",
    seconds,
    bandPath,
  );

  return [
    ...inputs.args,
    "-filter_complex", filters.join(";"),
    "-map", label,
    "-map", `${silenceIndex}:a`,
    "-t", seconds,
    outputPath,
  ];
}

/**
 * A text card composited over a background.
 *
 * `overlayPath` is a pre-rendered RGBA image from Remotion. Remotion is the
 * only text path: FFmpeg's `drawtext` needs a libfreetype-enabled build, and
 * its SVG decoder needs librsvg — the stock Homebrew macOS build has neither.
 * When no overlay is available the card still renders, as a plain coloured
 * frame holding its place in the timeline, so the reel completes without text
 * rather than failing.
 *
 * The frame is built in layers — background, then words, then the caption
 * band — so a card interrupts the clips without interrupting the band. The
 * band goes on last: it owns its strip outright, and the card's words are laid
 * out to keep clear of it rather than to be covered by it.
 */
export function buildTextCardArgs(
  doc: ReelDocument,
  element: TextElement,
  overlayPath: string | null,
  outputPath: string,
  /** A rendered frame from the relevant video, when blur was requested. */
  backgroundFramePath: string | null = null,
  /** Pre-rendered caption band, so a card does not interrupt it. */
  bandPath: string | null = null,
): string[] {
  const { width, height, fps } = doc.format;
  const background = element.background.replace("#", "0x");
  const seconds = element.duration.toFixed(3);

  const inputs = inputCollector();
  const filters: string[] = [];

  // Background: a blurred frame from the surrounding video when one was asked
  // for and could be extracted, otherwise the card's flat colour.
  const blurred =
    element.backgroundStyle === "blur" && backgroundFramePath !== null;
  const backgroundIndex = blurred
    ? inputs.add("-loop", "1", "-t", seconds, "-i", backgroundFramePath!)
    : inputs.add(
        "-f",
        "lavfi",
        "-i",
        `color=c=${background}:s=${width}x${height}:r=${fps}:d=${seconds}`,
      );

  filters.push(
    blurred
      ? `[${backgroundIndex}:v]fps=${fps},` +
          `${fitFilter(width, height, "cover", doc.backgroundColor)},` +
          `boxblur=20:1,eq=brightness=-0.08:saturation=0.75,setpts=PTS-STARTPTS[bg]`
      : `[${backgroundIndex}:v]setpts=PTS-STARTPTS[bg]`,
  );

  let label = "[bg]";

  if (overlayPath) {
    const index = inputs.add("-loop", "1", "-t", seconds, "-i", overlayPath);
    filters.push(`[${index}:v]fps=${fps},scale=${width}:${height},setsar=1[txt]`);
    // format=auto preserves the overlay's alpha channel during compositing.
    filters.push(`${label}[txt]overlay=0:0:format=auto[carded]`);
    label = "[carded]";
  }

  const silenceIndex = inputs.add(
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=48000",
  );

  label = overlayBandOnStill(doc, filters, inputs, label, seconds, bandPath);

  return [
    ...inputs.args,
    "-filter_complex", filters.join(";"),
    "-map", label,
    "-map", `${silenceIndex}:a`,
    "-t", seconds,
    outputPath,
  ];
}

/** Encoder flags for the configured codec. */
export function encoderArgs(encoder: string, quality: string): string[] {
  if (encoder === "h264_videotoolbox") {
    return [
      "-c:v", "h264_videotoolbox",
      "-b:v", quality,
      // VideoToolbox ignores CRF, so bitrate is the only quality lever.
      "-profile:v", "high",
      "-pix_fmt", "yuv420p",
      // Required for playback in browsers and on phones: moves the index to
      // the front so the file streams instead of needing a full download.
      "-movflags", "+faststart",
      "-c:a", "aac",
      "-b:a", "192k",
      "-ar", "48000",
    ];
  }

  return [
    "-c:v", "libx264",
    "-crf", quality,
    "-preset", "medium",
    "-profile:v", "high",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "48000",
  ];
}
