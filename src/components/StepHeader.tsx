"use client";

import type { Step } from "./Editor";

const LABELS: Record<Step, string> = {
  sources: "Add videos",
  clips: "Choose clips",
  layout: "Comparison",
  customize: "Customize",
  preview: "Preview",
  render: "Rendering",
};

export function StepHeader({
  step,
  steps,
  onBack,
}: {
  step: Step;
  steps: Step[];
  onBack?: () => void;
}) {
  const index = steps.indexOf(step);

  return (
    <header className="mb-8">
      <div className="mb-6 flex items-center justify-between">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="-ml-2 rounded-lg px-2 py-1 text-sm text-ink-400 transition-colors hover:text-ink-100"
          >
            ← Back
          </button>
        ) : (
          <span className="text-sm font-semibold tracking-[0.2em] text-ink-300">
            ATRIVEO <span className="text-accent">REEL</span>
          </span>
        )}

        <span className="text-xs tabular-nums text-ink-500">
          {index + 1} / {steps.length}
        </span>
      </div>

      {/* Progress through the flow, as a segmented bar. */}
      <div className="mb-7 flex gap-1.5" role="presentation">
        {steps.map((candidate, position) => (
          <div
            key={candidate}
            className={`h-0.5 flex-1 rounded-full transition-colors ${
              position <= index ? "bg-accent" : "bg-ink-800"
            }`}
          />
        ))}
      </div>

      {step === "sources" ? (
        <>
          <h1 className="text-3xl font-semibold tracking-tight">
            Create a comparison reel
          </h1>
          <p className="mt-1.5 text-sm text-ink-500">
            Two clips, one vertical video. Under a minute.
          </p>
        </>
      ) : (
        <h1 className="text-2xl font-semibold tracking-tight">{LABELS[step]}</h1>
      )}
    </header>
  );
}
