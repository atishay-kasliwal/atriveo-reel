"use client";

import { useCallback, useMemo, useState } from "react";

import { api, ApiError } from "@/lib/api/client";
import {
  reelDocumentSchema,
  type Layout,
  type ReelDocument,
  type ReelElementInput,
} from "@/lib/shared/reel";
import type { MediaSource } from "@/lib/shared/types";

import { SourceStep } from "./steps/SourceStep";
import { ClipStep } from "./steps/ClipStep";
import { LayoutStep } from "./steps/LayoutStep";
import { CustomizeStep } from "./steps/CustomizeStep";
import { PreviewStep } from "./steps/PreviewStep";
import { RenderStep } from "./steps/RenderStep";
import { StepHeader } from "./StepHeader";

export type Step = "sources" | "clips" | "layout" | "customize" | "preview" | "render";

export interface Selection {
  start: number;
  end: number;
}

/** Everything the editor collects before a reel document is assembled. */
export interface EditorState {
  sourceA: MediaSource | null;
  sourceB: MediaSource | null;
  clipA: Selection;
  clipB: Selection;
  layout: Layout;
  pauseDuration: number;
  text: string;
  textDuration: number;
  textPosition: "top" | "center" | "bottom";
  textSize: number;
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
  text: "",
  textDuration: 1.5,
  textPosition: "center",
  textSize: 84,
};

const STEP_ORDER: Step[] = ["sources", "clips", "layout", "customize", "preview"];

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

  // In the split layouts both clips play together, so a pause or text card
  // between them would have no meaning — they bracket the pair instead.
  if (state.layout === "sequential") {
    if (state.pauseDuration > 0) {
      elements.push({ type: "pause", duration: state.pauseDuration, style: "freeze" });
    }
    if (state.text.trim() !== "") {
      elements.push({
        type: "text",
        text: state.text.trim(),
        duration: state.textDuration,
        fontSize: state.textSize,
        position: state.textPosition,
      });
    }
  }

  elements.push({
    type: "video",
    sourceId: state.sourceB.id,
    start: state.clipB.start,
    end: state.clipB.end,
    slot: "b",
    fit: "cover",
  });

  if (state.layout !== "sequential" && state.text.trim() !== "") {
    elements.push({
      type: "text",
      text: state.text.trim(),
      duration: state.textDuration,
      fontSize: state.textSize,
      position: state.textPosition,
    });
  }

  return reelDocumentSchema.parse({
    layout: state.layout,
    elements,
    gutter: state.layout === "sequential" ? 0 : 6,
  });
}

export function Editor() {
  const [step, setStep] = useState<Step>("sources");
  const [state, setState] = useState<EditorState>(INITIAL_STATE);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      setStep("render");
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
    setStep("sources");
  }, []);

  const goBack = useCallback(() => {
    const index = STEP_ORDER.indexOf(step);
    if (index > 0) setStep(STEP_ORDER[index - 1]);
  }, [step]);

  return (
    <main className="mx-auto w-full max-w-2xl px-5 pb-24 pt-10 sm:pt-16">
      {step !== "render" && (
        <StepHeader
          step={step}
          steps={STEP_ORDER}
          onBack={step === "sources" ? undefined : goBack}
        />
      )}

      {error && step !== "render" && (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300"
        >
          {error}
        </div>
      )}

      {step === "sources" && (
        <SourceStep
          sourceA={state.sourceA}
          sourceB={state.sourceB}
          onChange={update}
          onContinue={() => setStep("clips")}
        />
      )}

      {step === "clips" && state.sourceA && state.sourceB && (
        <ClipStep
          sourceA={state.sourceA}
          sourceB={state.sourceB}
          clipA={state.clipA}
          clipB={state.clipB}
          onChange={update}
          onContinue={() => setStep("layout")}
        />
      )}

      {step === "layout" && (
        <LayoutStep
          layout={state.layout}
          onChange={(layout) => update({ layout })}
          onContinue={() => setStep("customize")}
        />
      )}

      {step === "customize" && (
        <CustomizeStep
          state={state}
          onChange={update}
          onContinue={() => setStep("preview")}
        />
      )}

      {step === "preview" && document && (
        <PreviewStep
          state={state}
          document={document}
          submitting={submitting}
          onCreate={handleCreate}
        />
      )}

      {step === "render" && jobId && (
        <RenderStep jobId={jobId} onStartOver={handleStartOver} />
      )}
    </main>
  );
}
