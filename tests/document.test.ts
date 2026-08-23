import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDocument,
  emptyTextCard,
  type EditorState,
  type TextSlot,
} from "../src/components/Editor";
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
    texts: {
      intro: emptyTextCard(),
      middle: emptyTextCard(),
      outro: emptyTextCard(),
    },
    ...overrides,
  };
}

/** Builds the `texts` map with the named slots filled in. */
function withText(entries: Partial<Record<TextSlot, string>>) {
  return {
    intro: { ...emptyTextCard(), text: entries.intro ?? "" },
    middle: { ...emptyTextCard(), text: entries.middle ?? "" },
    outro: { ...emptyTextCard(), text: entries.outro ?? "" },
  };
}

test("sequential document orders clips with the beats between them", () => {
  const doc = buildDocument(
    state({ pauseDuration: 1, texts: withText({ middle: "WHO DID IT BETTER?" }) }),
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
    state({
      layout: "top-bottom",
      pauseDuration: 2,
      texts: withText({ outro: "AFTER" }),
    }),
  );

  // A pause between simultaneous clips has no meaning, so it is omitted.
  assert.ok(!doc.elements.some((e) => e.type === "pause"));
  assert.equal(doc.elements.at(-1)?.type, "text");

  // Panes play together: max(10, 8) + 1.5s text
  assert.equal(reelDuration(doc), 11.5);
});

test("take-turns keeps both panes but runs for both clips back to back", () => {
  const doc = buildDocument(state({ layout: "top-bottom-turns" }));

  // Geometrically a split: one clip per pane, with a gutter between them.
  const videos = doc.elements.filter((e) => e.type === "video");
  assert.equal(videos.length, 2);
  assert.deepEqual(
    videos.map((v) => (v.type === "video" ? v.slot : null)),
    ["a", "b"],
  );
  assert.ok(doc.gutter > 0);

  // Temporally sequential: 10s clip + 8s clip, not max(10, 8).
  assert.equal(reelDuration(doc), 18);
});

test("take-turns still brackets with intro and outro cards", () => {
  const doc = buildDocument(
    state({
      layout: "top-bottom-turns",
      texts: withText({ intro: "FIRST", outro: "LAST" }),
    }),
  );

  assert.equal(doc.elements[0].type, "text");
  assert.equal(doc.elements.at(-1)?.type, "text");
  // 10s + 8s of clips, plus two 1.5s cards.
  assert.equal(reelDuration(doc), 21);
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
  const doc = buildDocument(state({ texts: withText({ middle: "   " }) }));
  assert.ok(!doc.elements.some((e) => e.type === "text"));
});

test("intro, middle and outro cards land in timeline order", () => {
  const doc = buildDocument(
    state({
      texts: withText({ intro: "FIRST", middle: "THEN", outro: "LAST" }),
    }),
  );

  assert.deepEqual(
    doc.elements.map((e) => e.type),
    ["text", "video", "text", "video", "text"],
  );
  assert.deepEqual(
    doc.elements.flatMap((e) => (e.type === "text" ? [e.text] : [])),
    ["FIRST", "THEN", "LAST"],
  );
  // 10s + 8s of clips, plus three 1.5s cards.
  assert.equal(reelDuration(doc), 22.5);
});

test("each text slot is independently optional", () => {
  const introOnly = buildDocument(state({ texts: withText({ intro: "HI" }) }));
  assert.deepEqual(
    introOnly.elements.map((e) => e.type),
    ["text", "video", "video"],
  );

  const outroOnly = buildDocument(state({ texts: withText({ outro: "BYE" }) }));
  assert.deepEqual(
    outroOnly.elements.map((e) => e.type),
    ["video", "video", "text"],
  );
});

test("text cards preserve the selected background style", () => {
  const texts = withText({ middle: "WATCH THIS" });
  texts.middle.backgroundStyle = "blur";
  const document = buildDocument(state({ texts }));
  const middle = document.elements.find(
    (element) => element.type === "text" && element.text === "WATCH THIS",
  );

  assert.equal(middle?.type, "text");
  assert.equal(middle?.backgroundStyle, "blur");
});

test("intro, middle and outro support every selection combination", () => {
  const slots: TextSlot[] = ["intro", "middle", "outro"];

  for (let selected = 0; selected < 2 ** slots.length; selected += 1) {
    const entries: Partial<Record<TextSlot, string>> = {};
    const expected: string[] = [];

    slots.forEach((slot, index) => {
      if ((selected & (1 << index)) === 0) return;
      const text = slot.toUpperCase();
      entries[slot] = text;
      expected.push(text);
    });

    const document = buildDocument(state({ texts: withText(entries) }));
    assert.deepEqual(
      document.elements.flatMap((element) =>
        element.type === "text" ? [element.text] : [],
      ),
      expected,
    );
  }
});

test("every layout keeps the middle card", () => {
  for (const layout of [
    "sequential",
    "top-bottom-turns",
    "top-bottom",
    "side-by-side",
  ] as const) {
    const doc = buildDocument(
      state({ layout, texts: withText({ middle: "BETWEEN" }) }),
    );

    assert.deepEqual(
      doc.elements.map((element) => element.type),
      ["video", "text", "video"],
    );
    assert.deepEqual(
      doc.elements.flatMap((element) =>
        element.type === "text" ? [element.text] : [],
      ),
      ["BETWEEN"],
    );
  }
});

test("simultaneous layouts place intro, middle and outro around the comparison", () => {
  const doc = buildDocument(
    state({
      layout: "side-by-side",
      texts: withText({ intro: "FIRST", middle: "AFTER", outro: "LAST" }),
    }),
  );

  assert.deepEqual(
    doc.elements.flatMap((e) => (e.type === "text" ? [e.text] : [])),
    ["FIRST", "AFTER", "LAST"],
  );
  // The intro must precede both videos so the renderer places it first.
  assert.equal(doc.elements[0].type, "text");
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
