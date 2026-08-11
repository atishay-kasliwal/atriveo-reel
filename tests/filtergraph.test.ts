import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTurnsGraph,
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
