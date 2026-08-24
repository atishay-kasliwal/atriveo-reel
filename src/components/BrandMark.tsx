/**
 * The Atriveo Reel mark: a 9:16 frame split into two panes.
 *
 * The product turns two clips into one vertical video, so the mark is that
 * sentence rather than a generic play triangle — one portrait frame, divided,
 * with the lower pane carrying the accent so the split reads as deliberate
 * rather than as a seam.
 *
 * Geometry is chosen to survive 16px: an 11x20 frame inside a 24 box, a 1.5px
 * gutter, and no stroke detail finer than 1px.
 */
export function BrandMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      {/* Upper pane: the first clip. Inherits text colour so the mark works
          anywhere the header does. */}
      <path
        d="M9.25 2.75h5.5a2.5 2.5 0 0 1 2.5 2.5v6H6.75v-6a2.5 2.5 0 0 1 2.5-2.5Z"
        fill="currentColor"
        opacity="0.55"
      />
      {/* Lower pane: the second clip, in the accent. */}
      <path
        d="M6.75 12.75h10.5v6a2.5 2.5 0 0 1-2.5 2.5h-5.5a2.5 2.5 0 0 1-2.5-2.5v-6Z"
        fill="#4f8cff"
      />
    </svg>
  );
}
