"use client";

import type { Layout } from "@/lib/shared/reel";

// Take turns leads: it is the default, and the arrangement this format is
// most often cut for.
const OPTIONS: { value: Layout; title: string; description: string }[] = [
  {
    value: "top-bottom-turns",
    title: "Take turns",
    description: "Stacked. A plays while B holds.",
  },
  {
    value: "top-bottom",
    title: "Top and bottom",
    description: "Stacked. Both play at once.",
  },
  {
    value: "sequential",
    title: "Sequential",
    description: "Full frame. A plays, then B.",
  },
  {
    value: "side-by-side",
    title: "Side by side",
    description: "Split. Both play at once.",
  },
];

export function LayoutPanel({
  layout,
  onChange,
}: {
  layout: Layout;
  onChange: (layout: Layout) => void;
}) {
  return (
    <fieldset>
      <legend className="sr-only">Comparison layout</legend>

      <div className="grid grid-cols-2 gap-2">
        {OPTIONS.map((option) => {
          const selected = layout === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              aria-pressed={selected}
              className={`relative flex items-center gap-2.5 rounded-control border
                          p-2.5 text-left transition-colors duration-fast ${
                            selected
                              ? // A precise border and a barely-there tint: the
                                // selection reads from the border and check,
                                // not from a saturated surface.
                                "border-accent bg-accent/[0.06]"
                              : "border-ink-800 bg-ink-950/40 hover:border-ink-600 hover:bg-ink-850"
                          }`}
            >
              <LayoutGlyph layout={option.value} selected={selected} />

              <span className="min-w-0 flex-1">
                <span
                  className={`block text-[12.5px] font-medium leading-tight ${
                    selected ? "text-ink-100" : "text-ink-200"
                  }`}
                >
                  {option.title}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-ink-300">
                  {option.description}
                </span>
              </span>

              {selected && (
                <span
                  aria-hidden="true"
                  className="absolute right-2 top-2 flex h-3.5 w-3.5 items-center
                             justify-center rounded-full bg-accent text-white"
                >
                  <svg viewBox="0 0 10 10" className="h-2 w-2">
                    <path
                      d="M1.5 5.2 3.8 7.5 8.5 2.8"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** A 9:16 miniature of what the layout produces. */
function LayoutGlyph({ layout, selected }: { layout: Layout; selected: boolean }) {
  // The icon brightens on selection; the surrounding surface stays dark.
  const fill = selected ? "fill-accent" : "fill-ink-600";
  const dim = selected ? "fill-accent/30" : "fill-ink-700";

  return (
    <svg
      viewBox="0 0 24 42"
      className={`h-9 w-[21px] shrink-0 rounded-[4px] border transition-colors
                  duration-fast ${
                    selected ? "border-accent/50 bg-ink-975" : "border-ink-700 bg-ink-975"
                  }`}
      aria-hidden="true"
    >
      {layout === "sequential" && (
        <>
          <rect x="3" y="4" width="18" height="14" rx="1.5" className={fill} />
          <rect x="9" y="20" width="6" height="2" rx="1" className={dim} />
          <rect x="3" y="24" width="18" height="14" rx="1.5" className={fill} />
        </>
      )}

      {layout === "top-bottom" && (
        <>
          <rect x="2" y="3" width="20" height="17" rx="1.5" className={fill} />
          <rect x="2" y="22" width="20" height="17" rx="1.5" className={fill} />
        </>
      )}

      {/* The waiting pane is dimmed, showing it holds a still frame. */}
      {layout === "top-bottom-turns" && (
        <>
          <rect x="2" y="3" width="20" height="17" rx="1.5" className={fill} />
          <rect x="2" y="22" width="20" height="17" rx="1.5" className={dim} />
          <polygon points="10,27 10,34 16,30.5" className="fill-ink-950/70" />
        </>
      )}

      {layout === "side-by-side" && (
        <>
          <rect x="2" y="12" width="9.5" height="18" rx="1.5" className={fill} />
          <rect x="12.5" y="12" width="9.5" height="18" rx="1.5" className={fill} />
        </>
      )}
    </svg>
  );
}
