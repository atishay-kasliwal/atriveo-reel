import { z } from "zod";

/**
 * The reel document is the source of truth for a render. The editor produces
 * it, the API stores it verbatim, and the renderer consumes it. Nothing else
 * is allowed to carry render-affecting state, so a stored reel always renders
 * to the same output.
 */

export const OUTPUT_WIDTH = 1080;
export const OUTPUT_HEIGHT = 1920;
export const OUTPUT_FPS = 30;

export const formatSchema = z.object({
  width: z.number().int().positive().default(OUTPUT_WIDTH),
  height: z.number().int().positive().default(OUTPUT_HEIGHT),
  fps: z.number().int().positive().max(60).default(OUTPUT_FPS),
});

/**
 * "top-bottom-turns" keeps both panes on screen like `top-bottom`, but the
 * clips play one after the other instead of together: while one plays, the
 * other holds a still frame. It is a split layout geometrically and a
 * sequential one temporally.
 */
export const layoutSchema = z.enum([
  "sequential",
  "top-bottom",
  "top-bottom-turns",
  "side-by-side",
]);

/** Layouts that composite both clips into one frame. */
export function isSplitLayout(layout: Layout): boolean {
  return layout !== "sequential";
}

/**
 * Layouts that stack their panes vertically, and so have a horizontal gap
 * between them that a caption band can occupy.
 */
export function isStackedLayout(layout: Layout): boolean {
  return layout === "top-bottom" || layout === "top-bottom-turns";
}

/**
 * How a source frame is fitted into its slot when the aspect ratios differ.
 * "contain" letterboxes and never crops; "cover" fills the slot and crops the
 * overflow. Both preserve the source aspect ratio — we never stretch.
 */
export const fitModeSchema = z.enum(["contain", "cover"]);

export const textPositionSchema = z.enum(["top", "center", "bottom"]);
export const textAlignSchema = z.enum(["left", "center", "right"]);
export const textBackgroundStyleSchema = z.enum(["solid", "blur"]);

const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "Must be a hex color");

/** A trimmed span of a media source. */
export const videoElementSchema = z.object({
  type: z.literal("video"),
  sourceId: z.string().min(1),
  /** Seconds from the start of the source. */
  start: z.number().min(0),
  /** Seconds from the start of the source. Must exceed `start`. */
  end: z.number().min(0),
  /** Slot label, used by the multi-slot layouts to place this clip. */
  slot: z.enum(["a", "b"]).default("a"),
  fit: fitModeSchema.default("cover"),
  muted: z.boolean().default(false),
});

/** A held frame or blank gap between clips. */
export const pauseElementSchema = z.object({
  type: z.literal("pause"),
  duration: z.number().min(0).max(10),
  /**
   * "freeze" holds the last frame of the preceding clip; "black" shows a blank
   * frame. Freeze reads as a deliberate beat, black reads as a scene break.
   */
  style: z.enum(["freeze", "black"]).default("freeze"),
});

/** A full-frame text card shown between clips. */
export const textElementSchema = z.object({
  type: z.literal("text"),
  text: z.string().min(1).max(200),
  duration: z.number().min(0.1).max(15).default(1.5),
  fontSize: z.number().int().min(24).max(200).default(84),
  position: textPositionSchema.default("center"),
  align: textAlignSchema.default("center"),
  color: hexColor.default("#ffffff"),
  /** Card background. Alpha is honoured, so #00000000 gives transparent. */
  background: hexColor.default("#000000"),
  /** A blurred hold-frame from the surrounding video, or a solid colour. */
  backgroundStyle: textBackgroundStyleSchema.default("solid"),
});

/**
 * A caption that lives in the gap between the panes of a stacked layout and
 * stays on screen for the whole reel.
 *
 * Unlike a text element this is not part of the timeline: it belongs to the
 * document, applies to every clip, and never interrupts playback. Its height
 * is taken out of the panes rather than overlaid on them, so no footage is
 * ever hidden behind the words. An empty `text` or a zero `height` leaves the
 * panes separated by the plain `gutter` instead.
 */
export const captionBandSchema = z.object({
  text: z.string().max(200).default(""),
  /** Band height in output pixels, subtracted from the two panes. */
  height: z.number().int().min(0).max(600).default(220),
  fontSize: z.number().int().min(24).max(160).default(64),
  color: hexColor.default("#ffffff"),
  background: hexColor.default("#000000"),
});

export const elementSchema = z.discriminatedUnion("type", [
  videoElementSchema,
  pauseElementSchema,
  textElementSchema,
]);

export const reelDocumentSchema = z
  .object({
    format: formatSchema.default({
      width: OUTPUT_WIDTH,
      height: OUTPUT_HEIGHT,
      fps: OUTPUT_FPS,
    }),
    layout: layoutSchema,
    elements: z.array(elementSchema).min(1),
    /**
     * Gap between the two panes in the split layouts, in output pixels.
     * Zero means the panes touch.
     */
    gutter: z.number().int().min(0).max(80).default(0),
    /**
     * The persistent caption between the panes. Ignored by layouts that have
     * no horizontal gap to put it in.
     */
    captionBand: captionBandSchema.default({}),
    backgroundColor: hexColor.default("#000000"),
  })
  .superRefine((doc, ctx) => {
    const videos = doc.elements.filter((e) => e.type === "video");

    if (videos.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A reel needs at least one video clip.",
        path: ["elements"],
      });
    }

    for (const [index, element] of doc.elements.entries()) {
      if (element.type === "video" && element.end <= element.start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Clip end must come after its start.",
          path: ["elements", index, "end"],
        });
      }
    }

    // A band taller than the frame it divides would leave no panes at all.
    // The schema's own ceiling makes this unreachable at 1080x1920, but the
    // format is configurable and the geometry has to stay sane at any size.
    if (
      isStackedLayout(doc.layout) &&
      doc.captionBand.height >= doc.format.height - 200
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The caption band leaves no room for the video panes.",
        path: ["captionBand", "height"],
      });
    }

    // The split layouts composite exactly one clip per pane. More than one
    // clip per slot has no defined meaning, so reject it here rather than
    // letting the renderer silently drop clips.
    if (isSplitLayout(doc.layout)) {
      const slotA = videos.filter((v) => v.slot === "a").length;
      const slotB = videos.filter((v) => v.slot === "b").length;

      if (slotA !== 1 || slotB !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Split layouts need exactly one clip in slot A and one in slot B.",
          path: ["elements"],
        });
      }
    }
  });

export type Format = z.infer<typeof formatSchema>;
export type Layout = z.infer<typeof layoutSchema>;
export type FitMode = z.infer<typeof fitModeSchema>;
export type VideoElement = z.infer<typeof videoElementSchema>;
export type PauseElement = z.infer<typeof pauseElementSchema>;
export type TextElement = z.infer<typeof textElementSchema>;
export type TextBackgroundStyle = z.infer<typeof textBackgroundStyleSchema>;
export type CaptionBand = z.infer<typeof captionBandSchema>;
export type ReelElement = z.infer<typeof elementSchema>;
export type ReelDocument = z.infer<typeof reelDocumentSchema>;

/**
 * The shape callers pass *in*, where fields with defaults are optional.
 * `ReelDocument` is the parsed result, in which every default is filled.
 */
export type ReelDocumentInput = z.input<typeof reelDocumentSchema>;
export type ReelElementInput = z.input<typeof elementSchema>;

/**
 * Whether the caption band is actually drawn.
 *
 * The band needs both words and room, and a gap to sit in: side-by-side puts
 * its panes shoulder to shoulder and sequential shows one clip at a time, so
 * neither has a "between" for it to occupy.
 */
export function hasCaptionBand(doc: ReelDocument): boolean {
  return (
    isStackedLayout(doc.layout) &&
    doc.captionBand.text.trim() !== "" &&
    doc.captionBand.height > 0
  );
}

/**
 * Space between the two panes, in output pixels.
 *
 * The band replaces the gutter rather than adding to it: it already separates
 * the panes, so keeping both would leave a seam above and below the words.
 */
export function paneGap(doc: ReelDocument): number {
  return hasCaptionBand(doc) ? doc.captionBand.height : doc.gutter;
}

/**
 * Total duration of the finished reel in seconds.
 *
 * Clips contribute their sum when they play one after another, and the longer
 * of the two when they play together. "top-bottom-turns" shows both panes at
 * once but plays them in turn, so it sums like a sequential reel even though
 * it composites like a split one.
 */
export function reelDuration(doc: ReelDocument): number {
  const nonVideo = doc.elements
    .filter((e) => e.type !== "video")
    .reduce((total, e) => total + (e as PauseElement | TextElement).duration, 0);

  const videos = doc.elements.filter(
    (e): e is VideoElement => e.type === "video",
  );

  if (doc.layout === "sequential" || doc.layout === "top-bottom-turns") {
    const videoTime = videos.reduce((total, v) => total + (v.end - v.start), 0);
    return videoTime + nonVideo;
  }

  const paneTime = Math.max(
    0,
    ...videos.map((v) => v.end - v.start),
  );
  return paneTime + nonVideo;
}

/** Frame count for the reel at its declared fps. */
export function reelFrameCount(doc: ReelDocument): number {
  return Math.max(1, Math.round(reelDuration(doc) * doc.format.fps));
}

export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    return `${hours}:${String(mins % 60).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/** Parse "1:23", "83", or "1:02:03" into seconds. Returns null if unparseable. */
export function parseTimecode(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;

  const parts = trimmed.split(":");
  if (parts.length > 3) return null;

  let seconds = 0;
  for (const part of parts) {
    if (!/^\d*\.?\d*$/.test(part) || part === "") return null;
    const value = Number(part);
    if (!Number.isFinite(value)) return null;
    seconds = seconds * 60 + value;
  }
  return seconds;
}
