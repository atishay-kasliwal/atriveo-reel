"use client";

import { useId, useState } from "react";

/**
 * A collapsible control section in the left panel.
 *
 * Collapsing hides the section visually but keeps its children mounted, so
 * every selection, draft input and player instance survives being folded away.
 * Unmounting would reset clip state and tear down the YouTube players.
 */
export function Panel({
  index,
  title,
  summary,
  status,
  defaultOpen = true,
  children,
}: {
  index: number;
  title: string;
  /** Collapsed-state recap, so a folded section still communicates its value. */
  summary?: string;
  status?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <section
      className={`surface relative transition-colors duration-fast ${
        // An open section lifts above its neighbours so the shared 1px seam
        // never cuts through its content.
        open ? "z-10 bg-ink-900" : "bg-ink-900/70"
      }`}
    >
      <h2>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={contentId}
          className="group flex w-full items-center gap-2.5 rounded-[inherit] px-3.5 py-2.5
                     text-left transition-colors duration-fast hover:bg-ink-850"
        >
          <span
            aria-hidden="true"
            className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center
                        rounded-full text-[10px] font-medium tabular-nums
                        transition-colors duration-fast ${
                          open
                            ? "bg-ink-700 text-ink-200"
                            : "bg-ink-800 text-ink-400 group-hover:bg-ink-700"
                        }`}
          >
            {index}
          </span>

          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium leading-tight text-ink-100">
              {title}
            </span>
            {!open && summary && (
              <span className="mt-0.5 block truncate text-[11.5px] leading-tight text-ink-300">
                {summary}
              </span>
            )}
          </span>

          {status}

          <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            className={`h-3 w-3 shrink-0 transition-transform duration-base ${
              open ? "rotate-180 text-ink-300" : "text-ink-500"
            }`}
          >
            <path
              d="M2.5 4.5 6 8l3.5-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </h2>

      {/* `hidden` rather than conditional rendering: children stay mounted. */}
      <div
        id={contentId}
        hidden={!open}
        className="border-t border-ink-800 px-3.5 pb-3.5 pt-3"
      >
        {children}
      </div>
    </section>
  );
}

/** A small state pill for a panel header. */
export function PanelStatus({
  tone,
  children,
}: {
  tone: "ready" | "pending";
  children: React.ReactNode;
}) {
  return (
    <span
      className={`flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5
                  text-[11px] font-medium ${
                    tone === "ready"
                      ? "bg-emerald-500/10 text-emerald-300"
                      : "bg-ink-800 text-ink-300"
                  }`}
    >
      {tone === "ready" && (
        <svg aria-hidden="true" viewBox="0 0 10 10" className="h-2.5 w-2.5">
          <path
            d="M1.5 5.2 3.8 7.5 8.5 2.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {children}
    </span>
  );
}
