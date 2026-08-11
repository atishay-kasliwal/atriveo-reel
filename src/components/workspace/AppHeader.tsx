"use client";

/**
 * The workspace header: identity, a truthful status line, and nothing else.
 *
 * Deliberately free of invented affordances — there are no accounts, projects
 * or sharing in this product, so the header does not imply them.
 */
export function AppHeader({ status }: { status?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-950/85 backdrop-blur">
      <div className="flex h-14 items-center gap-4 px-4 sm:px-6">
        <span className="text-[13px] font-semibold tracking-[0.14em] text-ink-200">
          ATRIVEO <span className="text-accent">REEL</span>
        </span>

        <div className="ml-auto flex items-center gap-3">{status}</div>
      </div>
    </header>
  );
}

/**
 * A live status line. Only ever reflects real client state — there is no
 * server-side persistence to report, so this never claims "saved".
 */
export function ReadyStatus({
  ready,
  detail,
}: {
  ready: boolean;
  detail: string;
}) {
  return (
    <span className="flex items-center gap-2 text-[12px] text-ink-400">
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${
          ready ? "bg-emerald-400" : "bg-ink-600"
        }`}
      />
      {detail}
    </span>
  );
}
