"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { formatTimecode } from "@/lib/shared/reel";

type Handle = "start" | "end" | "scrub";

/**
 * A two-handle range selector over the source timeline.
 *
 * Pointer events rather than mouse events, so dragging works identically with
 * touch — the owner may well be doing this on a phone. Handles are also
 * focusable and arrow-key adjustable, since a drag target this small is
 * awkward for precise selection.
 */
export function RangeSlider({
  duration,
  start,
  end,
  playhead,
  onStartChange,
  onEndChange,
  onScrub,
}: {
  duration: number;
  start: number;
  end: number;
  playhead: number;
  onStartChange: (seconds: number) => void;
  onEndChange: (seconds: number) => void;
  onScrub: (seconds: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<Handle | null>(null);

  const toSeconds = useCallback(
    (clientX: number): number => {
      const track = trackRef.current;
      if (!track || duration <= 0) return 0;
      const rect = track.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      return Math.max(0, Math.min(1, ratio)) * duration;
    },
    [duration],
  );

  // Drag is tracked on window: the pointer routinely leaves the track's
  // bounds mid-drag, and losing the handle there would feel broken.
  useEffect(() => {
    if (!dragging) return;

    const handleMove = (event: PointerEvent) => {
      const seconds = toSeconds(event.clientX);
      if (dragging === "start") onStartChange(seconds);
      else if (dragging === "end") onEndChange(seconds);
      else onScrub(seconds);
    };

    const handleUp = () => setDragging(null);

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [dragging, toSeconds, onStartChange, onEndChange, onScrub]);

  if (duration <= 0) {
    return (
      <div className="h-9 animate-pulse rounded-lg bg-ink-800/60" aria-hidden="true" />
    );
  }

  const percent = (seconds: number) => `${(seconds / duration) * 100}%`;

  const keyStep = (event: React.KeyboardEvent, current: number, apply: (v: number) => void) => {
    // Shift gives coarse seeking; the default is frame-ish precision.
    const step = event.shiftKey ? 5 : 0.5;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      apply(current - step);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      apply(current + step);
    }
  };

  return (
    <div className="select-none pt-1">
      <div
        ref={trackRef}
        className="relative h-9 cursor-pointer touch-none"
        onPointerDown={(event) => {
          // Clicking the track scrubs; handles stop propagation themselves.
          onScrub(toSeconds(event.clientX));
          setDragging("scrub");
        }}
      >
        {/* Track */}
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-ink-800" />

        {/* Selected range */}
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent/85"
          style={{ left: percent(start), width: percent(end - start) }}
        />

        {/* Playhead */}
        <div
          className="pointer-events-none absolute top-1/2 h-5 w-[1.5px] -translate-y-1/2 rounded-full bg-ink-100"
          style={{ left: percent(playhead) }}
          aria-hidden="true"
        />

        <Handle
          position={percent(start)}
          label="Clip start"
          value={start}
          duration={duration}
          onPointerDown={() => setDragging("start")}
          onKeyDown={(event) => keyStep(event, start, onStartChange)}
        />
        <Handle
          position={percent(end)}
          label="Clip end"
          value={end}
          duration={duration}
          onPointerDown={() => setDragging("end")}
          onKeyDown={(event) => keyStep(event, end, onEndChange)}
        />
      </div>

      <div className="flex justify-between text-[11px] tabular-nums text-ink-500">
        <span>00:00</span>
        <span>{formatTimecode(duration)}</span>
      </div>
    </div>
  );
}

function Handle({
  position,
  label,
  value,
  duration,
  onPointerDown,
  onKeyDown,
}: {
  position: string;
  label: string;
  value: number;
  duration: number;
  onPointerDown: () => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
}) {
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={value}
      aria-valuetext={formatTimecode(value)}
      onPointerDown={(event) => {
        event.stopPropagation();
        onPointerDown();
      }}
      onKeyDown={onKeyDown}
      className="group absolute top-1/2 flex h-6 w-4 -translate-x-1/2 -translate-y-1/2
                 cursor-grab items-center justify-center rounded-[4px] border
                 border-ink-950/80 bg-accent shadow-panel transition-transform
                 duration-fast hover:scale-110 active:cursor-grabbing
                 active:scale-105 focus-visible:scale-110"
      style={{ left: position }}
    >
      {/* A grip line, so the handle reads as a draggable editing control. */}
      <span
        aria-hidden="true"
        className="h-2.5 w-px rounded-full bg-ink-950/45"
      />
    </div>
  );
}
