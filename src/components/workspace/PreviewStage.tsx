"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  formatTimecode,
  reelDuration,
  type ReelDocument,
} from "@/lib/shared/reel";
import type { EditorState } from "../Editor";
import type { MediaSource } from "@/lib/shared/types";

/**
 * The persistent 9:16 output canvas.
 *
 * A composed diagram rather than live video: the panes come from YouTube
 * embeds that cannot be composited client-side, and rendering an FFmpeg
 * preview per keystroke would defeat the point. What it does show accurately —
 * and updates on every change — is the arrangement, the ordering, the text
 * cards and the timing.
 */
export function PreviewStage({
  state,
  document,
}: {
  state: EditorState;
  document: ReelDocument | null;
}) {
  const total = document ? reelDuration(document) : 0;
  const clipA = state.clipA.end - state.clipA.start;
  const clipB = state.clipB.end - state.clipB.start;
  const ready = state.sourceA !== null && state.sourceB !== null;

  /** Scrub position along the composed timeline, in seconds. */
  const [playhead, setPlayhead] = useState(0);

  // Keep the playhead inside the composition as clip lengths change.
  const clamped = Math.min(playhead, total);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <p className="section-label">Preview</p>
        <span className="text-[11px] tabular-nums text-ink-400">9:16</span>
      </div>

      <div
        className="relative w-full overflow-hidden rounded-panel border
                   border-ink-800 bg-ink-975 shadow-stage"
        style={{ aspectRatio: "9 / 16" }}
      >
        {!ready ? (
          <EmptyStage />
        ) : (
          <>
            {state.layout === "sequential" && <SequentialStage state={state} />}
            {state.layout === "top-bottom" && <StackedStage state={state} />}
            {state.layout === "top-bottom-turns" && (
              <StackedStage state={state} takeTurns />
            )}
            {state.layout === "side-by-side" && <SideBySideStage state={state} />}

            {state.layout !== "sequential" && <BracketCards state={state} />}
          </>
        )}
      </div>

      {/*
        A timeline over the composed document rather than a media transport:
        the panes are YouTube embeds that cannot be composited client-side, so
        there is no single video to play. Scrubbing shows which element of the
        reel occupies a given moment, which is real information the document
        already carries.
      */}
      {ready && document && (
        <Timeline
          document={document}
          total={total}
          playhead={clamped}
          onScrub={setPlayhead}
        />
      )}

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-control border border-ink-800 bg-ink-900 px-3 py-2">
        <Metric label="Output" value="1080 × 1920" />
        <Metric label="Frame rate" value="30 fps" />
        <Metric label="Length" value={ready ? `${total.toFixed(1)}s` : "—"} />
        <Metric
          label="Clips"
          value={ready ? `A ${clipA.toFixed(1)}s · B ${clipB.toFixed(1)}s` : "—"}
        />
      </dl>
    </div>
  );
}

/** Segment of the composed reel, for the timeline strip. */
interface Segment {
  kind: "video" | "text" | "pause";
  label: string;
  seconds: number;
}

function segmentsOf(document: ReelDocument): Segment[] {
  return document.elements.map((element) => {
    if (element.type === "video") {
      return {
        kind: "video" as const,
        label: element.slot === "a" ? "A" : "B",
        seconds: element.end - element.start,
      };
    }
    if (element.type === "text") {
      return { kind: "text" as const, label: element.text, seconds: element.duration };
    }
    return { kind: "pause" as const, label: "Pause", seconds: element.duration };
  });
}

/**
 * The reel's own timeline: proportional segments, a draggable playhead, and a
 * readout of the element under it.
 */
function Timeline({
  document,
  total,
  playhead,
  onScrub,
}: {
  document: ReelDocument;
  total: number;
  playhead: number;
  onScrub: (seconds: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const segments = segmentsOf(document);

  // For split layouts the two clips share one span of time rather than
  // following each other, so they collapse into a single labelled segment.
  const simultaneous =
    document.layout === "top-bottom" || document.layout === "side-by-side";

  const strip: Segment[] = simultaneous
    ? segments.reduce<Segment[]>((acc, segment) => {
        if (segment.kind !== "video") return [...acc, segment];
        const existing = acc.find((s) => s.kind === "video");
        if (existing) return acc;
        return [
          ...acc,
          {
            kind: "video",
            label: "A + B",
            seconds: Math.max(
              ...segments.filter((s) => s.kind === "video").map((s) => s.seconds),
            ),
          },
        ];
      }, [])
    : segments;

  const toSeconds = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track || total <= 0) return 0;
      const rect = track.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      return Math.max(0, Math.min(1, ratio)) * total;
    },
    [total],
  );

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => onScrub(toSeconds(event.clientX));
    const up = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragging, toSeconds, onScrub]);

  // Which element the playhead currently sits inside.
  let elapsed = 0;
  let active = strip[0];
  for (const segment of strip) {
    if (playhead < elapsed + segment.seconds) {
      active = segment;
      break;
    }
    elapsed += segment.seconds;
    active = segment;
  }

  const step = (delta: number) =>
    onScrub(Math.max(0, Math.min(total, playhead + delta)));

  return (
    <div className="space-y-1.5">
      <div
        ref={trackRef}
        className="relative flex h-7 cursor-pointer gap-px overflow-hidden
                   rounded-[6px] border border-ink-800 bg-ink-975 touch-none"
        onPointerDown={(event) => {
          onScrub(toSeconds(event.clientX));
          setDragging(true);
        }}
      >
        {strip.map((segment, index) => (
          <div
            key={index}
            style={{ flexGrow: segment.seconds || 0.01 }}
            className={`flex min-w-0 items-center justify-center px-1 ${
              segment.kind === "video"
                ? "bg-accent/25"
                : segment.kind === "text"
                  ? "bg-ink-700"
                  : "bg-ink-800"
            }`}
          >
            <span className="truncate text-[9px] font-medium text-ink-200">
              {segment.kind === "video" ? segment.label : ""}
            </span>
          </div>
        ))}

        <div
          className="pointer-events-none absolute inset-y-0 w-[1.5px] rounded-full bg-ink-100"
          style={{ left: `${total > 0 ? (playhead / total) * 100 : 0}%` }}
          aria-hidden="true"
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={Math.max(total, 0.1)}
          step={0.1}
          value={playhead}
          onChange={(event) => onScrub(Number(event.target.value))}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              step(-0.5);
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              step(0.5);
            }
          }}
          aria-label="Scrub the reel timeline"
          aria-valuetext={`${formatTimecode(playhead)} of ${formatTimecode(total)}`}
          className="sr-only"
        />
        <span className="metric text-[11px]">{formatTimecode(playhead)}</span>
        <span className="min-w-0 flex-1 truncate text-center text-[11px] text-ink-300">
          {active?.kind === "video"
            ? `Clip ${active.label}`
            : (active?.label ?? "")}
        </span>
        <span className="text-[11px] tabular-nums text-ink-400">
          {formatTimecode(total)}
        </span>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] leading-tight text-ink-400">{label}</dt>
      <dd className="metric truncate text-[12px] leading-tight">{value}</dd>
    </div>
  );
}

function EmptyStage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-8 w-8 text-ink-700"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="3" y="3" width="18" height="8" rx="2" />
        <rect x="3" y="13" width="18" height="8" rx="2" />
      </svg>
      <p className="text-[12px] leading-relaxed text-ink-500">
        Add two videos to see your reel take shape.
      </p>
    </div>
  );
}

/** Full-frame clips in sequence, shown as a vertical filmstrip. */
function SequentialStage({ state }: { state: EditorState }) {
  const intro = state.texts.intro.text.trim();
  const middle = state.texts.middle.text.trim();
  const outro = state.texts.outro.text.trim();
  const hasPause = state.pauseDuration > 0;

  return (
    <div className="flex h-full flex-col">
      {intro !== "" && <CardBand text={intro} />}
      <Pane source={state.sourceA} label="A" />

      {(hasPause || middle !== "") && (
        <div className="flex shrink-0 flex-col items-center justify-center gap-0.5 bg-ink-975 py-2">
          {hasPause && (
            <span className="text-[9px] text-ink-500">
              pause {state.pauseDuration}s
            </span>
          )}
          {middle !== "" && <CardText text={middle} />}
        </div>
      )}

      <Pane source={state.sourceB} label="B" />
      {outro !== "" && <CardBand text={outro} />}
    </div>
  );
}

function StackedStage({
  state,
  takeTurns = false,
}: {
  state: EditorState;
  takeTurns?: boolean;
}) {
  return (
    <div className="flex h-full flex-col gap-[2px]">
      <Pane
        source={state.sourceA}
        label="A"
        badge={takeTurns ? "plays first" : undefined}
      />
      <Pane
        source={state.sourceB}
        label="B"
        badge={takeTurns ? "then plays" : undefined}
        dimmed={takeTurns}
      />
    </div>
  );
}

function SideBySideStage({ state }: { state: EditorState }) {
  return (
    <div className="flex h-full gap-[2px]">
      <Pane source={state.sourceA} label="A" />
      <Pane source={state.sourceB} label="B" />
    </div>
  );
}

/**
 * One pane of the output, using the source thumbnail so the preview shows the
 * user's actual footage rather than a grey placeholder.
 */
function Pane({
  source,
  label,
  badge,
  dimmed = false,
}: {
  source: MediaSource | null;
  label: string;
  badge?: string;
  dimmed?: boolean;
}) {
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-ink-900">
      {source?.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- see MediaPanel
        <img
          src={source.thumbnailUrl}
          alt=""
          className={`h-full w-full object-cover transition-opacity duration-base ${
            dimmed ? "opacity-40" : "opacity-90"
          }`}
          loading="lazy"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <span className="text-lg font-semibold text-ink-700">{label}</span>
        </div>
      )}

      {badge && (
        <span className="absolute inset-x-0 top-1.5 text-center text-[9px] uppercase tracking-wide text-accent">
          {badge}
        </span>
      )}
    </div>
  );
}

/** Intro/outro cards for the split layouts, which bracket the pair. */
function BracketCards({ state }: { state: EditorState }) {
  const intro = state.texts.intro.text.trim();
  const outro = state.texts.outro.text.trim();
  if (intro === "" && outro === "") return null;

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between py-4">
      <div>{intro !== "" && <CardText text={intro} />}</div>
      <div>{outro !== "" && <CardText text={outro} />}</div>
    </div>
  );
}

function CardBand({ text }: { text: string }) {
  return (
    <div className="flex shrink-0 items-center justify-center bg-ink-975 py-2.5">
      <CardText text={text} />
    </div>
  );
}

function CardText({ text }: { text: string }) {
  return (
    <p className="px-3 text-center text-[10px] font-bold uppercase leading-tight text-white drop-shadow">
      {text}
    </p>
  );
}
