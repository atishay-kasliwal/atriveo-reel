import assert from "node:assert/strict";
import test from "node:test";

import { buildDocument, type EditorState } from "../src/components/Editor";
import { reelDuration } from "../src/lib/shared/reel";
import type { MediaSource } from "../src/lib/shared/types";

function source(id: string): MediaSource {
  return {
    id,
    type: "youtube",
    title: `Video ${id}`,
    duration: 300,
    sourceReference: id,
    createdAt: new Date().toISOString(),
  };
}

function state(overrides: Partial<EditorState> = {}): EditorState {
  return {
    sourceA: source("a"),
    sourceB: source("b"),
    clipA: { start: 10, end: 20 },
    clipB: { start: 30, end: 38 },
    layout: "sequential",
    pauseDuration: 0,
    text: "",
    textDuration: 1.5,
    textPosition: "center",
    textSize: 84,
    ...overrides,
  };
}

test("sequential document orders clips with the beats between them", () => {
  const doc = buildDocument(
    state({ pauseDuration: 1, text: "WHO DID IT BETTER?" }),
  );

  assert.deepEqual(
    doc.elements.map((e) => e.type),
    ["video", "pause", "text", "video"],
  );
  // 10s clip + 1s pause + 1.5s text + 8s clip
  assert.equal(reelDuration(doc), 20.5);
});

test("split layouts drop the pause and put text after the pair", () => {
  const doc = buildDocument(
    state({ layout: "top-bottom", pauseDuration: 2, text: "AFTER" }),
  );

  // A pause between simultaneous clips has no meaning, so it is omitted.
  assert.ok(!doc.elements.some((e) => e.type === "pause"));
  assert.equal(doc.elements.at(-1)?.type, "text");

  // Panes play together: max(10, 8) + 1.5s text
  assert.equal(reelDuration(doc), 11.5);
});

test("split layouts assign one clip to each slot", () => {
  const doc = buildDocument(state({ layout: "side-by-side" }));
  const videos = doc.elements.filter((e) => e.type === "video");

  assert.equal(videos.length, 2);
  assert.deepEqual(
    videos.map((v) => (v.type === "video" ? v.slot : null)),
    ["a", "b"],
  );
  // Split layouts need a gutter to read as two panes rather than one image.
  assert.ok(doc.gutter > 0);
});

test("whitespace-only text is treated as no text", () => {
  const doc = buildDocument(state({ text: "   " }));
  assert.ok(!doc.elements.some((e) => e.type === "text"));
});

test("a zero-length pause is omitted rather than emitted as a no-op", () => {
  const doc = buildDocument(state({ pauseDuration: 0 }));
  assert.ok(!doc.elements.some((e) => e.type === "pause"));
});

test("output is always 1080x1920 at 30fps", () => {
  const doc = buildDocument(state());
  assert.equal(doc.format.width, 1080);
  assert.equal(doc.format.height, 1920);
  assert.equal(doc.format.fps, 30);
});
