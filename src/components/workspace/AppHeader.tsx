"use client";

import { BrandMark } from "@/components/BrandMark";

/**
 * The Buy Me a Coffee page this links to.
 *
 * Kept as a named constant because it is the one value here that cannot be
 * derived or guessed: a wrong slug sends supporters to a stranger's page.
 */
const SUPPORT_URL = "https://www.buymeacoffee.com/atishaykasliwal";

/**
 * The workspace header: identity, a truthful status line, and a way to say
 * thanks.
 *
 * Still deliberately free of invented affordances — there are no accounts,
 * projects or sharing in this product, so the header does not imply them.
 */
export function AppHeader({ status }: { status?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-950/85 backdrop-blur">
      <div className="flex h-14 items-center gap-2.5 px-4 sm:px-6">
        <BrandMark className="h-[18px] w-[18px] shrink-0 text-ink-200" />
        <span className="text-[13px] font-semibold tracking-[0.14em] text-ink-200">
          ATRIVEO <span className="text-accent">REEL</span>
        </span>

        <div className="ml-auto flex items-center gap-1 sm:gap-3">
          {status}
          <SupportLink />
        </div>
      </div>
    </header>
  );
}

/**
 * Quiet by design. This is a thank-you, not a call to action competing with
 * the render button, so it reads as a header utility rather than an advert —
 * and it keeps the app's palette instead of importing the brand yellow, which
 * would be the loudest thing on a deliberately dark screen.
 *
 * The label collapses below `sm`, where the status line needs the room.
 */
function SupportLink() {
  return (
    <a
      href={SUPPORT_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="btn-subtle shrink-0"
      title="Buy me a coffee"
    >
      <CoffeeIcon />
      <span className="hidden sm:inline">Buy me a coffee</span>
      <span className="sr-only sm:hidden">Buy me a coffee</span>
    </a>
  );
}

function CoffeeIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="h-[15px] w-[15px]"
    >
      {/* Cup, handle, and two rising wisps — legible at 15px because nothing
          is finer than the 1.3px stroke. */}
      <path
        d="M2.75 6.25h8.5v3.5a3 3 0 0 1-3 3h-2.5a3 3 0 0 1-3-3v-3.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M11.25 7.25h.75a1.75 1.75 0 0 1 0 3.5h-.75"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        d="M5.75 2.25v1.5M8.25 2.25v1.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        opacity="0.6"
      />
    </svg>
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
