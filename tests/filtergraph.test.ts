import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTextCardArgs,
  buildTurnsGraph,
  buildTurnsPhaseGraph,
  fitFilter,
  slotGeometry,
  type ClipInput,
} from "../src/lib/renderer/filtergraph";
import {
  parseTimecode,
  formatTimecode,
  reelDuration,
  reelDocumentSchema,
  type ReelDocument,
  type ReelDocumentInput,
} from "../src/lib/shared/reel";

function doc(overrides: Partial<ReelDocumentInput> = {}): ReelDocument {
  return reelDocumentSchema.parse({
    layout: "sequential",
    elements: [
      { type: "video", sourceId: "a", start: 0, end: 10, slot: "a" },
    ],
    ...overrides,
  } satisfies ReelDocumentInput);
}

test("fitFilter never stretches: contain pads, cover crops", () => {
  const contain = fitFilter(1080, 960, "contain", "#000000");
  assert.match(contain, /force_original_aspect_ratio=decrease/);
  assert.match(contain, /pad=1080:960/);

  const cover = fitFilter(1080, 960, "cover", "#000000");
  assert.match(cover, /force_original_aspect_ratio=increase/);
  assert.match(cover, /crop=1080:960/);

  // Both must pin SAR, or a non-square-pixel source renders distorted.
  assert.match(contain, /setsar=1/);
  assert.match(cover, /setsar=1/);
});

/** A valid split-layout document: exactly one clip per pane. */
function splitDoc(layout: "top-bottom" | "side-by-side", gutter: number): ReelDocument {
  return reelDocumentSchema.parse({
    layout,
    gutter,
    elements: [
      { type: "video", sourceId: "a", start: 0, end: 10, slot: "a" },
      { type: "video", sourceId: "b", start: 0, end: 10, slot: "b" },
    ],
  });
}

test("split layout panes are even-dimensioned and account for the gutter", () => {
  const topBottom = slotGeometry(splitDoc("top-bottom", 0));
  assert.ok(topBottom);
  assert.equal(topBottom.a.w, 1080);
  assert.equal(topBottom.a.h, 960);
  assert.equal(topBottom.a.h + topBottom.b.h, 1920);

  // An odd gutter must still yield even pane heights (yuv420p requirement).
  const withGutter = slotGeometry(splitDoc("top-bottom", 11));
  assert.ok(withGutter);
  assert.equal(withGutter.a.h % 2, 0);
  assert.ok(withGutter.a.h * 2 + 11 <= 1920);

  const sideBySide = slotGeometry(splitDoc("side-by-side", 0));
  assert.ok(sideBySide);
  assert.equal(sideBySide.a.w, 540);
  assert.equal(sideBySide.a.h, 1920);

  assert.equal(slotGeometry(doc({ layout: "sequential" })), null);
});

test("take-turns holds each pane still while the other plays", () => {
  const turnsDoc = reelDocumentSchema.parse({
    layout: "top-bottom-turns",
    gutter: 6,
    elements: [
      { type: "video", sourceId: "a", start: 0, end: 10, slot: "a" },
      { type: "video", sourceId: "b", start: 0, end: 4, slot: "b" },
    ],
  });

  const clip = (id: string, end: number, hasAudio: boolean): ClipInput => ({
    path: `/tmp/${id}.mp4`,
    element: turnsDoc.elements.find(
      (e) => e.type === "video" && e.sourceId === id,
    ) as ClipInput["element"],
    sourceDuration: 300,
    hasAudio,
  });

  const graph = buildTurnsGraph(
    turnsDoc,
    clip("a", 10, true),
    clip("b", 4, true),
  );
  const filters = graph.args[graph.args.indexOf("-filter_complex") + 1];

  // The reel runs for both clips back to back, not the longer of the two.
  assert.equal(graph.durationSeconds, 14);

  // A plays first, so it pads its tail for exactly B's length.
  assert.match(filters, /tpad=stop_mode=clone:stop_duration=4\.000/);
  // B waits through A, so it pads its head for exactly A's length.
  assert.match(filters, /tpad=start_mode=clone:start_duration=10\.000/);

  // Audio plays in turn rather than mixing, or the waiting pane would be heard.
  assert.match(filters, /concat=n=2:v=0:a=1/);
  assert.ok(!filters.includes("amix"));

  // Pane B sits below pane A, offset by the pane height plus the gutter.
  const geometry = slotGeometry(turnsDoc);
  assert.ok(geometry);
  assert.match(filters, new RegExp(`overlay=0:${geometry.a.h + 6}`));
});

test("take-turns phases can be separated by a full-frame card", () => {
  const turnsDoc = reelDocumentSchema.parse({
    layout: "top-bottom-turns",
    gutter: 6,
    elements: [
      { type: "video", sourceId: "a", start: 0, end: 10, slot: "a" },
      { type: "text", text: "BETWEEN", duration: 1.5 },
      { type: "video", sourceId: "b", start: 0, end: 4, slot: "b" },
    ],
  });

  const clip = (id: string): ClipInput => ({
    path: `/tmp/${id}.mp4`,
    element: turnsDoc.elements.find(
      (element) => element.type === "video" && element.sourceId === id,
    ) as ClipInput["element"],
    sourceDuration: 300,
    hasAudio: true,
  });

  const phaseA = buildTurnsPhaseGraph(turnsDoc, clip("a"), clip("b"), "a");
  const phaseB = buildTurnsPhaseGraph(turnsDoc, clip("a"), clip("b"), "b");
  const filtersA = phaseA.args[phaseA.args.indexOf("-filter_complex") + 1];
  const filtersB = phaseB.args[phaseB.args.indexOf("-filter_complex") + 1];

  assert.equal(phaseA.durationSeconds, 10);
  assert.equal(phaseB.durationSeconds, 4);
  // B holds its first frame while A plays, then A's last frame holds for B.
  assert.match(filtersA, /trim=start=0\.000:end=0\.033/);
  assert.match(filtersB, /trim=start=9\.967:end=10\.000/);
  // Each phase emits the audio of the pane that is actually playing.
  assert.match(filtersA, /\[0:a\].*\[aout\]/);
  assert.match(filtersB, /\[1:a\].*\[aout\]/);
  assert.ok(!filtersA.includes("concat=n=2"));
});

test("blurred text cards use a video frame as their backdrop", () => {
  const textDoc = reelDocumentSchema.parse({
    layout: "sequential",
    elements: [
      { type: "video", sourceId: "a", start: 0, end: 10, slot: "a" },
      { type: "text", text: "BETWEEN", backgroundStyle: "blur" },
    ],
  });
  const text = textDoc.elements.find(
    (element) => element.type === "text",
  );
  assert.ok(text && text.type === "text");

  const blurred = buildTextCardArgs(
    textDoc,
    text,
    "/tmp/words.png",
    "/tmp/card.mp4",
    "/tmp/video-frame.png",
  ).join(" ");
  assert.match(blurred, /-i \/tmp\/video-frame\.png/);
  assert.match(blurred, /boxblur=20:1/);
  assert.match(blurred, /eq=brightness=-0\.08:saturation=0\.75/);

  const fallback = buildTextCardArgs(
    textDoc,
    text,
    "/tmp/words.png",
    "/tmp/card.mp4",
  ).join(" ");
  assert.ok(!fallback.includes("boxblur"));
  assert.match(fallback, /color=c=0x000000/);
});

test("sequential duration sums; split duration takes the longer pane", () => {
  const sequential = doc({
    layout: "sequential",
    elements: [
      { type: "video", sourceId: "a", start: 0, end: 10, slot: "a" },
      { type: "pause", duration: 1 },
      { type: "video", sourceId: "b", start: 5, end: 12, slot: "b" },
    ],
  });
  assert.equal(reelDuration(sequential), 18);

  const split = doc({
    layout: "top-bottom",
    elements: [
      { type: "video", sourceId: "a", start: 0, end: 10, slot: "a" },
      { type: "video", sourceId: "b", start: 0, end: 7, slot: "b" },
    ],
  });
  // Panes play together, so 10 not 17.
  assert.equal(reelDuration(split), 10);
});

test("split layouts reject anything other than one clip per slot", () => {
  assert.throws(() =>
    reelDocumentSchema.parse({
      layout: "side-by-side",
      elements: [
        { type: "video", sourceId: "a", start: 0, end: 5, slot: "a" },
        { type: "video", sourceId: "b", start: 0, end: 5, slot: "a" },
      ],
    }),
  );
});

test("a clip ending before it starts is rejected", () => {
  assert.throws(() =>
    reelDocumentSchema.parse({
      layout: "sequential",
      elements: [{ type: "video", sourceId: "a", start: 10, end: 4, slot: "a" }],
    }),
  );
});

test("timecode parses the formats a user actually types", () => {
  assert.equal(parseTimecode("83"), 83);
  assert.equal(parseTimecode("1:23"), 83);
  assert.equal(parseTimecode("1:02:03"), 3723);
  assert.equal(parseTimecode("1:23.5"), 83.5);
  assert.equal(parseTimecode(""), null);
  assert.equal(parseTimecode("abc"), null);
  assert.equal(parseTimecode("1:2:3:4"), null);

  assert.equal(formatTimecode(83), "01:23");
  assert.equal(formatTimecode(3723), "1:02:03");
  assert.equal(formatTimecode(-5), "00:00");
});
