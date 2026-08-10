"use client";

import type { Layout } from "@/lib/shared/reel";

const OPTIONS: {
  value: Layout;
  title: string;
  description: string;
}[] = [
  {
    value: "sequential",
    title: "Sequential",
    description: "A plays, then B. Room for text between them.",
  },
  {
    value: "top-bottom",
    title: "Top / Bottom",
    description: "Both at once, stacked vertically.",
  },
  {
    value: "side-by-side",
    title: "Side by Side",
    description: "Both at once, side by side.",
  },
];

export function LayoutStep({
  layout,
  onChange,
  onContinue,
}: {
  layout: Layout;
  onChange: (layout: Layout) => void;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-8">
      <fieldset className="space-y-3">
        <legend className="sr-only">Comparison layout</legend>

        {OPTIONS.map((option) => {
          const selected = layout === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              aria-pressed={selected}
              className={`flex w-full items-center gap-5 rounded-2xl border p-5 text-left transition-colors ${
                selected
                  ? "border-accent bg-accent/10"
                  : "border-ink-800 bg-ink-900/60 hover:border-ink-600"
              }`}
            >
              <LayoutGlyph layout={option.value} selected={selected} />

              <div className="min-w-0">
                <p className="font-medium text-ink-100">{option.title}</p>
                <p className="mt-0.5 text-sm text-ink-400">{option.description}</p>
              </div>
            </button>
          );
        })}
      </fieldset>

      <button type="button" onClick={onContinue} className="btn-primary w-full">
        Continue
      </button>
    </div>
  );
}

/** A small 9:16 diagram of how the panes are arranged. */
function LayoutGlyph({ layout, selected }: { layout: Layout; selected: boolean }) {
  const fill = selected ? "fill-accent/70" : "fill-ink-600";

  return (
    <svg
      viewBox="0 0 36 64"
      className="h-16 w-9 shrink-0 rounded-md border border-ink-700 bg-ink-950"
      aria-hidden="true"
    >
      {layout === "sequential" && (
        <>
          <rect x="6" y="8" width="24" height="18" rx="2" className={fill} />
          <rect x="14" y="30" width="8" height="4" rx="1" className="fill-ink-500" />
          <rect x="6" y="38" width="24" height="18" rx="2" className={fill} />
        </>
      )}

      {layout === "top-bottom" && (
        <>
          <rect x="4" y="6" width="28" height="25" rx="2" className={fill} />
          <rect x="4" y="33" width="28" height="25" rx="2" className={fill} />
        </>
      )}

      {layout === "side-by-side" && (
        <>
          <rect x="4" y="18" width="13" height="28" rx="2" className={fill} />
          <rect x="19" y="18" width="13" height="28" rx="2" className={fill} />
        </>
      )}
    </svg>
  );
}
