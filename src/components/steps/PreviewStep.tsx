"use client";

import { formatTimecode, reelDuration, type ReelDocument } from "@/lib/shared/reel";
import type { EditorState } from "../Editor";

/**
 * Shows the composition before committing to a render.
 *
 * Deliberately a static diagram rather than live video playback: the panes
 * come from YouTube embeds that can't be composited client-side, and a full
 * FFmpeg render just to preview the arrangement would defeat the point. What
 * the user needs to confirm here is the layout, text, and timing — all of
 * which this shows accurately.
 */
export function PreviewStep({
  state,
  document,
  submitting,
  onCreate,
}: {
  state: EditorState;
  document: ReelDocument;
  submitting: boolean;
  onCreate: () => void;
}) {
  const total = reelDuration(document);
  const clipALength = state.clipA.end - state.clipA.start;
  const clipBLength = state.clipB.end - state.clipB.start;

  return (
    <div className="space-y-8">
      <div className="flex justify-center">
        <div
          className="relative w-full max-w-[260px] overflow-hidden rounded-2xl border border-ink-800 bg-black"
          style={{ aspectRatio: "9 / 16" }}
        >
          {state.layout === "sequential" && (
            <SequentialPreview state={state} />
          )}

          {state.layout === "top-bottom" && (
            <div className="flex h-full flex-col gap-[3px]">
              <Pane label="A" title={state.sourceA?.title} />
              <Pane label="B" title={state.sourceB?.title} />
            </div>
          )}

          {state.layout === "side-by-side" && (
            <div className="flex h-full gap-[3px]">
              <Pane label="A" title={state.sourceA?.title} />
              <Pane label="B" title={state.sourceB?.title} />
            </div>
          )}

          {state.text.trim() !== "" && state.layout !== "sequential" && (
            <div className="pointer-events-none absolute inset-x-0 bottom-8 px-4">
              <p className="text-center text-[13px] font-bold uppercase leading-tight text-white drop-shadow-lg">
                {state.text}
              </p>
            </div>
          )}
        </div>
      </div>

      <dl className="mx-auto max-w-xs space-y-2 text-sm">
        <Row label="Output" value="1080 × 1920 · 30fps" />
        <Row label="Length" value={`${formatTimecode(total)} (${total.toFixed(1)}s)`} />
        <Row
          label="Clips"
          value={`A ${clipALength.toFixed(1)}s · B ${clipBLength.toFixed(1)}s`}
        />
      </dl>

      <button
        type="button"
        onClick={onCreate}
        disabled={submitting}
        className="btn-primary w-full py-4 text-base font-semibold"
      >
        {submitting ? "Starting…" : "CREATE REEL"}
      </button>
    </div>
  );
}

/** Sequential plays A, then optional beats, then B — shown as a filmstrip. */
function SequentialPreview({ state }: { state: EditorState }) {
  const hasText = state.text.trim() !== "";
  const hasPause = state.pauseDuration > 0;

  return (
    <div className="flex h-full flex-col">
      <Pane label="A" title={state.sourceA?.title} />

      {(hasPause || hasText) && (
        <div className="flex shrink-0 flex-col items-center justify-center gap-1 bg-ink-950 py-3">
          {hasPause && (
            <span className="text-[10px] text-ink-500">
              pause {state.pauseDuration}s
            </span>
          )}
          {hasText && (
            <p className="px-3 text-center text-[11px] font-bold uppercase leading-tight text-white">
              {state.text}
            </p>
          )}
        </div>
      )}

      <Pane label="B" title={state.sourceB?.title} />
    </div>
  );
}

function Pane({ label, title }: { label: string; title?: string }) {
  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center bg-ink-900">
      <span className="text-2xl font-semibold text-ink-700">{label}</span>
      {title && (
        <span className="absolute inset-x-0 bottom-1.5 truncate px-2 text-center text-[9px] text-ink-600">
          {title}
        </span>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-500">{label}</dt>
      <dd className="tabular-nums text-ink-200">{value}</dd>
    </div>
  );
}
