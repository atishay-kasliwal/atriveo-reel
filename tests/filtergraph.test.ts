import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPauseArgs,
  buildTextCardArgs,
  buildTurnsGraph,
  buildTurnsPhaseGraph,
  captionBandRect,
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

/** A stacked take-turns document carrying a caption band. */
function bandDoc(
  band: { text?: string; height?: number } = {},
  layout: "top-bottom" | "top-bottom-turns" | "side-by-side" = "top-bottom-turns",
): ReelDocument {
  return reelDocumentSchema.parse({
    layout,
    gutter: 6,
    captionBand: { text: "WHO DID IT BETTER?", height: 220, ...band },
    elements: [
      { type: "video", sourceId: "a", start: 0, end: 10, slot: "a" },
      { type: "video", sourceId: "b", start: 0, end: 4, slot: "b" },
    ],
  });
}

function bandClip(doc: ReelDocument, id: string): ClipInput {
  return {
    path: `/tmp/${id}.mp4`,
    element: doc.elements.find(
      (element) => element.type === "video" && element.sourceId === id,
    ) as ClipInput["element"],
    sourceDuration: 300,
    hasAudio: true,
  };
}

test("the caption band takes its height out of the panes, not off the top", () => {
  const geometry = slotGeometry(bandDoc({ height: 220 }));
  assert.ok(geometry);

  // 1920 - 220 = 1700, halved and rounded down to even.
  assert.equal(geometry.a.h, 850);
  assert.equal(geometry.b.h, 850);
  assert.equal(geometry.a.h % 2, 0);

  const rect = captionBandRect(bandDoc({ height: 220 }));
  assert.ok(rect);
  assert.equal(rect.y, 850);
  assert.equal(rect.width, 1080);
  // The band fills the whole gap, including any pixel left by even-rounding.
  assert.equal(rect.height, 1920 - 850 * 2);
  assert.equal(rect.y + rect.height + geometry.b.h, 1920);

  // An odd height still leaves even panes and a gap-filling band.
  const odd = bandDoc({ height: 221 });
  const oddGeometry = slotGeometry(odd);
  const oddRect = captionBandRect(odd);
  assert.ok(oddGeometry && oddRect);
  assert.equal(oddGeometry.a.h % 2, 0);
  assert.equal(oddRect.height, 1920 - oddGeometry.a.h - oddGeometry.b.h);
});

test("the band applies only where there is a gap between the panes", () => {
  // Empty text and zero height both mean no band, and the panes fall back to
  // the plain gutter.
  assert.equal(captionBandRect(bandDoc({ text: "" })), null);
  assert.equal(captionBandRect(bandDoc({ text: "   " })), null);
  assert.equal(captionBandRect(bandDoc({ height: 0 })), null);
  // (1920 - 6) / 2, rounded down to even.
  assert.equal(slotGeometry(bandDoc({ text: "" }))!.a.h, 956);

  // Side-by-side has no horizontal gap to put words in.
  assert.equal(captionBandRect(bandDoc({}, "side-by-side")), null);
  assert.equal(slotGeometry(bandDoc({}, "side-by-side"))!.a.w, 536);
});

test("both stacked phases composite the same band over the panes", () => {
  const doc = bandDoc();
  const rect = captionBandRect(doc);
  assert.ok(rect);

  const phases = ["a", "b"] as const;
  for (const phase of phases) {
    const graph = buildTurnsPhaseGraph(
      doc,
      bandClip(doc, "a"),
      bandClip(doc, "b"),
      phase,
      "/tmp/band.png",
    );
    const filters = graph.args[graph.args.indexOf("-filter_complex") + 1];

    // The band is the input after both clips, scaled to the gap it fills and
    // laid over the finished panes.
    assert.match(filters, new RegExp(`\\[2:v\\].*scale=1080:${rect.height}`));
    assert.match(filters, new RegExp(`\\[panes\\]\\[band\\]overlay=0:${rect.y}`));
    // Pane B still sits below the band, not under the old 6px gutter.
    assert.match(filters, new RegExp(`overlay=0:${rect.y + rect.height}\\[panes\\]`));
  }

  // With no band rendered the panes go straight to the output, unchanged.
  const plain = buildTurnsPhaseGraph(
    doc,
    bandClip(doc, "a"),
    bandClip(doc, "b"),
    "a",
    null,
  );
  const plainFilters = plain.args[plain.args.indexOf("-filter_complex") + 1];
  assert.ok(!plainFilters.includes("[band]"));
  assert.match(plainFilters, /\[vb\]overlay=0:\d+\[vout\]/);
});

test("the band is on screen for every clip, and adds no time to the reel", () => {
  const doc = bandDoc();
  // A persistent band is document state, not a timeline element: the reel is
  // still just the two clips back to back.
  assert.equal(reelDuration(doc), 14);
  assert.equal(doc.elements.filter((e) => e.type === "text").length, 0);

  const graphA = buildTurnsPhaseGraph(
    doc,
    bandClip(doc, "a"),
    bandClip(doc, "b"),
    "a",
    "/tmp/band.png",
  );
  const graphB = buildTurnsPhaseGraph(
    doc,
    bandClip(doc, "a"),
    bandClip(doc, "b"),
    "b",
    "/tmp/band.png",
  );
  assert.equal(graphA.durationSeconds + graphB.durationSeconds, 14);
});

test("a band with no room for the panes is rejected", () => {
  assert.throws(() =>
    reelDocumentSchema.parse({
      layout: "top-bottom",
      format: { width: 1080, height: 600, fps: 30 },
      captionBand: { text: "TOO BIG", height: 600 },
      elements: [
        { type: "video", sourceId: "a", start: 0, end: 5, slot: "a" },
        { type: "video", sourceId: "b", start: 0, end: 5, slot: "b" },
      ],
    }),
  );
});

test("a card or a pause does not blink the band off screen", () => {
  const doc = reelDocumentSchema.parse({
    layout: "top-bottom-turns",
    gutter: 6,
    captionBand: { text: "WHO DID IT BETTER?", height: 220 },
    elements: [
      { type: "video", sourceId: "a", start: 0, end: 10, slot: "a" },
      { type: "text", text: "BETWEEN", duration: 1.5 },
      { type: "video", sourceId: "b", start: 0, end: 4, slot: "b" },
    ],
  });
  const rect = captionBandRect(doc);
  assert.ok(rect);
  const card = doc.elements.find((element) => element.type === "text");
  assert.ok(card && card.type === "text");

  const carded = buildTextCardArgs(
    doc,
    card,
    "/tmp/words.png",
    "/tmp/card.mp4",
    null,
    "/tmp/band.png",
  );
  const cardFilters = carded[carded.indexOf("-filter_complex") + 1];

  // The band goes on after the words, so it is never covered by them.
  assert.match(cardFilters, /\[txt\]overlay=0:0:format=auto\[carded\]/);
  assert.match(
    cardFilters,
    new RegExp(`\\[carded\\]\\[band\\]overlay=0:${rect.y}:format=auto\\[banded\\]`),
  );
  assert.deepEqual(
    carded.slice(carded.indexOf("-map"), carded.indexOf("-map") + 2),
    ["-map", "[banded]"],
  );

  const paused = buildPauseArgs(doc, 1, "black", null, "/tmp/pause.mp4", "/tmp/band.png");
  const pauseFilters = paused[paused.indexOf("-filter_complex") + 1];
  assert.match(
    pauseFilters,
    new RegExp(`\\[still\\]\\[band\\]overlay=0:${rect.y}`),
  );

  // Silence keeps its index whether or not a band input follows it, or the
  // segment would be mapped to the band's video stream.
  for (const [args, inputs] of [
    // background, words, silence, band.
    [carded, 4],
    // background, silence, band — a pause has no words.
    [paused, 3],
  ] as const) {
    const audioMap = args[args.lastIndexOf("-map") + 1];
    assert.match(audioMap, /^\d+:a$/);
    assert.equal(args.filter((arg) => arg === "-i").length, inputs);
    // Silence is the input before the band, never the last one.
    assert.equal(audioMap, `${inputs - 2}:a`);
  }
});

test("without a band, cards and pauses are built exactly as before", () => {
  const plain = reelDocumentSchema.parse({
    layout: "sequential",
    elements: [
      { type: "video", sourceId: "a", start: 0, end: 10, slot: "a" },
      { type: "text", text: "BETWEEN", duration: 1.5 },
    ],
  });
  const card = plain.elements.find((element) => element.type === "text");
  assert.ok(card && card.type === "text");

  const args = buildTextCardArgs(plain, card, "/tmp/words.png", "/tmp/card.mp4");
  const filters = args[args.indexOf("-filter_complex") + 1];
  assert.ok(!filters.includes("[band]"));
  assert.match(filters, /\[carded\]/);
  assert.equal(args[args.indexOf("-map") + 1], "[carded]");

  // A card with no overlay still holds its place as a plain coloured frame.
  const bare = buildTextCardArgs(plain, card, null, "/tmp/card.mp4");
  const bareFilters = bare[bare.indexOf("-filter_complex") + 1];
  assert.ok(!bareFilters.includes("[txt]"));
  assert.equal(bare[bare.indexOf("-map") + 1], "[bg]");
  assert.match(bare.join(" "), /color=c=0x000000/);
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
