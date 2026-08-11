"use client";

import { useCallback, useMemo, useState } from "react";

import { api, ApiError } from "@/lib/api/client";
import {
  formatTimecode,
  reelDocumentSchema,
  type Layout,
  type ReelDocument,
  type ReelElementInput,
} from "@/lib/shared/reel";
import type { MediaSource } from "@/lib/shared/types";

import { AppHeader, ReadyStatus } from "./workspace/AppHeader";
import { LayoutPanel } from "./workspace/LayoutPanel";
import { MediaPanel } from "./workspace/MediaPanel";
import { Panel, PanelStatus } from "./workspace/Panel";
import { PreviewStage } from "./workspace/PreviewStage";
import {
  CompletePanel,
  RenderErrorPanel,
  RenderPanel,
  useRenderJob,
} from "./workspace/RenderView";
import { TextPanel } from "./workspace/TextPanel";
import { TrimRow } from "./workspace/TrimPanel";

export interface Selection {
  start: number;
  end: number;
}

/** Where a text card sits in the timeline. */
export type TextSlot = "intro" | "middle" | "outro";

export const TEXT_SLOTS: TextSlot[] = ["intro", "middle", "outro"];

/**
 * One text card. Empty `text` means the slot is unused and contributes
 * nothing to the timeline.
 */
export interface TextCard {
  text: string;
  duration: number;
  position: "top" | "center" | "bottom";
  size: number;
}

export function emptyTextCard(): TextCard {
  return { text: "", duration: 1.5, position: "center", size: 84 };
}

/** Everything the editor collects before a reel document is assembled. */
export interface EditorState {
  sourceA: MediaSource | null;
  sourceB: MediaSource | null;
  clipA: Selection;
  clipB: Selection;
  layout: Layout;
  pauseDuration: number;
  /** Text cards keyed by slot; each is independently optional. */
  texts: Record<TextSlot, TextCard>;
}

const INITIAL_STATE: EditorState = {
  sourceA: null,
  sourceB: null,
  // A ten-second default: long enough to show something, short enough to
  // render fast, and the most common length for this format.
  clipA: { start: 0, end: 10 },
  clipB: { start: 0, end: 10 },
  layout: "sequential",
  pauseDuration: 0,
  texts: {
    intro: emptyTextCard(),
    middle: emptyTextCard(),
    outro: emptyTextCard(),
  },
};

/**
 * Builds the reel document from editor state.
 *
 * This is the single place the UI's shape is translated into the render
 * contract, so the document sent to the server always matches what the
 * preview showed.
 */
export function buildDocument(state: EditorState): ReelDocument {
  const elements: ReelElementInput[] = [];

  if (!state.sourceA || !state.sourceB) {
    throw new Error("Both sources are required");
  }

  /** Appends a slot's card, if it has any text. */
  const pushText = (slot: TextSlot) => {
    const card = state.texts[slot];
    if (card.text.trim() === "") return;
    elements.push({
      type: "text",
      text: card.text.trim(),
      duration: card.duration,
      fontSize: card.size,
      position: card.position,
    });
  };

  pushText("intro");

  elements.push({
    type: "video",
    sourceId: state.sourceA.id,
    start: state.clipA.start,
    end: state.clipA.end,
    slot: "a",
    // Split panes crop to fill; a full-frame sequential clip does too, so a
    // vertical reel never shows letterboxing unless the source demands it.
    fit: "cover",
  });

  // A pause or card between the clips only has somewhere to go when the reel
  // plays full-frame. The composited layouts render extras as separate
  // full-screen segments, which would break the split view mid-reel, so the
  // middle slot stays sequential-only.
  if (state.layout === "sequential") {
    if (state.pauseDuration > 0) {
      elements.push({ type: "pause", duration: state.pauseDuration, style: "freeze" });
    }
    pushText("middle");
  }

  elements.push({
    type: "video",
    sourceId: state.sourceB.id,
    start: state.clipB.start,
    end: state.clipB.end,
    slot: "b",
    fit: "cover",
  });

  pushText("outro");

  return reelDocumentSchema.parse({
    layout: state.layout,
    elements,
    gutter: state.layout === "sequential" ? 0 : 6,
  });
}

export function Editor() {
  const [state, setState] = useState<EditorState>(INITIAL_STATE);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  /** Mobile only: the preview is a tab rather than a second column. */
  const [mobileTab, setMobileTab] = useState<"edit" | "preview">("edit");

  const update = useCallback((patch: Partial<EditorState>) => {
    setState((previous) => ({ ...previous, ...patch }));
  }, []);

  const document = useMemo(() => {
    if (!state.sourceA || !state.sourceB) return null;
    try {
      return buildDocument(state);
    } catch {
      return null;
    }
  }, [state]);

  const handleCreate = useCallback(async () => {
    if (!document) return;

    setSubmitting(true);
    setError(null);

    try {
      const reel = await api.createReel(document, "Comparison reel");
      const job = await api.startRender(reel.id);
      setJobId(job.id);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Couldn't start the render. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }, [document]);

  const handleStartOver = useCallback(() => {
    setState(INITIAL_STATE);
    setJobId(null);
    setError(null);
    setCancelling(false);
    setMobileTab("edit");
  }, []);

  /** Leaves the configuration intact and returns the panel to editing. */
  const handleDismissJob = useCallback(() => {
    setJobId(null);
    setCancelling(false);
    setError(null);
  }, []);

  const { job, connectionLost, displayProgress } = useRenderJob(jobId);

  const handleCancel = useCallback(async () => {
    if (!jobId) return;
    setCancelling(true);
    try {
      await api.cancelJob(jobId);
    } catch {
      setCancelling(false);
    }
  }, [jobId]);

  const ready = document !== null;
  const bothSources = state.sourceA !== null && state.sourceB !== null;

  // The job drives which state the right panel shows. The workspace around it
  // never unmounts, so no selection is lost between states.
  const completed = job?.status === "completed" && job.output !== null;
  const failed = job?.status === "failed" || job?.status === "cancelled";
  const rendering = jobId !== null && !completed && !failed;

  // Editing is locked only while work is actually in flight.
  const locked = rendering || submitting;

  const createButton = (
    <button
      type="button"
      onClick={handleCreate}
      disabled={!ready || locked}
      className="btn-primary w-full py-2.5 text-[14px] font-semibold"
    >
      {submitting ? "Starting…" : rendering ? "Rendering…" : "Create reel"}
    </button>
  );

  /*
   * One column, three states. The panel swaps its contents while the header,
   * the editing sections and the column geometry stay exactly where they are.
   */
  const previewPane = (
    <>
      {completed && job ? (
        <CompletePanel job={job} onStartOver={handleStartOver} />
      ) : failed ? (
        <RenderErrorPanel
          title={
            job?.status === "cancelled"
              ? "Render cancelled"
              : "Couldn't create the reel"
          }
          message={
            job?.status === "cancelled"
              ? "Nothing was saved. Your setup is still here."
              : (job?.error ?? "The source video could not be processed.")
          }
          onRetry={() => {
            handleDismissJob();
            void handleCreate();
          }}
          onDismiss={handleDismissJob}
          retrying={submitting}
        />
      ) : rendering ? (
        <RenderPanel
          job={job}
          connectionLost={connectionLost}
          displayProgress={displayProgress}
          onCancel={handleCancel}
          cancelling={cancelling}
        />
      ) : (
        <>
          <PreviewStage state={state} document={document} />

          {error && (
            <p
              role="alert"
              className="rounded-control border border-red-900/60 bg-red-950/40 px-3 py-2 text-[12px] text-red-300"
            >
              {error}
            </p>
          )}

          <div className="hidden lg:block">
            {createButton}
            {!ready && (
              <p className="mt-2 text-center text-[11px] text-ink-400">
                Add both videos to continue.
              </p>
            )}
          </div>
        </>
      )}
    </>
  );

  return (
    <>
      <AppHeader
        status={
          <ReadyStatus
            ready={ready}
            detail={ready ? "Ready to render" : "Add two videos"}
          />
        }
      />

      {/* Mobile: preview and controls are tabs, never a squeezed two-column. */}
      <div className="sticky top-14 z-20 border-b border-ink-800 bg-ink-950/85 px-4 backdrop-blur lg:hidden">
        <div role="tablist" aria-label="Workspace view" className="flex gap-1">
          {(["edit", "preview"] as const).map((tab) => (
            <button
              key={tab}
              role="tab"
              type="button"
              aria-selected={mobileTab === tab}
              onClick={() => setMobileTab(tab)}
              className={`-mb-px border-b-2 px-3 py-2.5 text-[13px] transition-colors duration-fast ${
                mobileTab === tab
                  ? "border-accent text-ink-100"
                  : "border-transparent text-ink-400 hover:text-ink-200"
              }`}
            >
              {tab === "edit" ? "Edit" : "Preview"}
            </button>
          ))}
        </div>
      </div>

      {/*
        The preview column grows from 360px to 400px on large screens — about
        13% more canvas — and the gap tightens on laptops so the extra width
        comes from spacing rather than from the editing column.
      */}
      <main className="mx-auto w-full max-w-[1440px] px-4 pb-24 pt-4 sm:px-6 lg:pb-8">
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-6 xl:grid-cols-[minmax(0,1fr)_400px] xl:gap-8">
          {/* Controls */}
          <div className={mobileTab === "edit" ? "" : "hidden lg:block"}>
            <div className="mb-4 hidden items-baseline justify-between lg:flex">
              <div>
                <h1 className="text-[19px] font-semibold tracking-tight">
                  Create a comparison reel
                </h1>
                <p className="mt-0.5 text-[12.5px] text-ink-300">
                  Two clips, one vertical video.
                </p>
              </div>

              {locked && (
                <span className="flex items-center gap-1.5 text-[11px] text-ink-300">
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent"
                  />
                  Rendering — editing locked
                </span>
              )}
            </div>

            {/*
              Locked rather than unmounted: every selection stays exactly as it
              was, and cancelling returns the user to an untouched workspace.
            */}
            <fieldset
              disabled={locked}
              className={`editor-stack m-0 border-0 p-0 transition-opacity duration-base ${
                locked ? "pointer-events-none opacity-50" : "opacity-100"
              }`}
            >
              <Panel
                index={1}
                title="Media"
                summary={
                  bothSources
                    ? `${state.sourceA!.title} · ${state.sourceB!.title}`
                    : "Add two videos"
                }
                status={
                  <PanelStatus tone={bothSources ? "ready" : "pending"}>
                    {bothSources ? "Ready" : `${countSources(state)}/2`}
                  </PanelStatus>
                }
              >
                <MediaPanel
                  sourceA={state.sourceA}
                  sourceB={state.sourceB}
                  onChangeA={(source) => update({ sourceA: source })}
                  onChangeB={(source) => update({ sourceB: source })}
                />
              </Panel>

              <Panel
                index={2}
                title="Trim"
                summary={trimSummary(state)}
                status={
                  bothSources ? (
                    <PanelStatus tone="ready">Set</PanelStatus>
                  ) : undefined
                }
                defaultOpen={false}
              >
                {bothSources ? (
                  <div className="space-y-2">
                    <TrimRow
                      slot="A"
                      source={state.sourceA!}
                      start={state.clipA.start}
                      end={state.clipA.end}
                      onChange={(clipA) => update({ clipA })}
                    />
                    <TrimRow
                      slot="B"
                      source={state.sourceB!}
                      start={state.clipB.start}
                      end={state.clipB.end}
                      onChange={(clipB) => update({ clipB })}
                    />
                  </div>
                ) : (
                  <EmptyHint>Add both videos to choose your clips.</EmptyHint>
                )}
              </Panel>

              <Panel index={3} title="Layout" summary={layoutLabel(state.layout)}>
                <LayoutPanel
                  layout={state.layout}
                  onChange={(layout) => update({ layout })}
                />
              </Panel>

              <Panel
                index={4}
                title="Text and timing"
                summary={textSummary(state)}
                defaultOpen={false}
              >
                <TextPanel state={state} onChange={update} />
              </Panel>
            </fieldset>
          </div>

          {/* Preview: sticky beside the controls on desktop. */}
          <aside
            className={`mt-5 space-y-3 lg:sticky lg:top-[4.25rem] lg:mt-0 ${
              mobileTab === "preview" ? "" : "hidden lg:block"
            }`}
          >
            {previewPane}
          </aside>
        </div>
      </main>

      {/* Mobile: the primary action stays reachable without scrolling. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-ink-800 bg-ink-950/95 p-3 backdrop-blur lg:hidden">
        {createButton}
      </div>
    </>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-control border border-dashed border-ink-700 px-3 py-5 text-center text-[12px] text-ink-300">
      {children}
    </p>
  );
}

/**
 * Collapsed-state recap for Trim: both durations, and the exact ranges when
 * they fit. Clip selection matters enough to read without expanding.
 */
function trimSummary(state: EditorState): string {
  const a = state.clipA;
  const b = state.clipB;
  const lengths = `A ${(a.end - a.start).toFixed(1)}s · B ${(b.end - b.start).toFixed(1)}s`;
  const ranges = `${formatTimecode(a.start)}–${formatTimecode(a.end)} · ${formatTimecode(
    b.start,
  )}–${formatTimecode(b.end)}`;
  return `${lengths}  ·  ${ranges}`;
}

function countSources(state: EditorState): number {
  return (state.sourceA ? 1 : 0) + (state.sourceB ? 1 : 0);
}

function layoutLabel(layout: Layout): string {
  const labels: Record<Layout, string> = {
    sequential: "Sequential",
    "top-bottom": "Top and bottom",
    "top-bottom-turns": "Take turns",
    "side-by-side": "Side by side",
  };
  return labels[layout];
}

function textSummary(state: EditorState): string {
  const used = TEXT_SLOTS.filter(
    (slot) => state.texts[slot].text.trim() !== "",
  ).length;
  const pause = state.pauseDuration > 0 ? `, ${state.pauseDuration}s pause` : "";
  if (used === 0) return `No text cards${pause}`;
  return `${used} text card${used > 1 ? "s" : ""}${pause}`;
}

