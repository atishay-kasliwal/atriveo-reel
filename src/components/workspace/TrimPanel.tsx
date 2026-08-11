"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { formatTimecode, parseTimecode } from "@/lib/shared/reel";
import type { MediaSource } from "@/lib/shared/types";
import { RangeSlider } from "../RangeSlider";
import { YouTubePlayer, type PlayerHandle } from "../YouTubePlayer";

/** Shortest clip that still reads as a clip rather than a glitch. */
const MIN_CLIP_SECONDS = 0.5;
const MAX_CLIP_SECONDS = 60;

/**
 * Clip selection for one source.
 *
 * The trimming rules, seek behaviour, playhead polling and preview loop are
 * carried over unchanged from the original ClipPicker. The change is spatial:
 * the video surface stays collapsed behind a thumbnail until the user asks to
 * scrub, so two sources fit in a control panel instead of filling the page
 * with stacked embeds.
 */
export function TrimRow({
  slot,
  source,
  start,
  end,
  onChange,
}: {
  slot: "A" | "B";
  source: MediaSource;
  start: number;
  end: number;
  onChange: (selection: { start: number; end: number }) => void;
}) {
  const youtubeRef = useRef<PlayerHandle>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [duration, setDuration] = useState(source.duration ?? 0);
  const [playhead, setPlayhead] = useState(start);
  const [playing, setPlaying] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const isYouTube = source.type === "youtube";

  const seek = useCallback(
    (seconds: number) => {
      const clamped = Math.max(0, Math.min(seconds, duration || seconds));
      setPlayhead(clamped);
      if (isYouTube) youtubeRef.current?.seekTo(clamped);
      else if (videoRef.current) videoRef.current.currentTime = clamped;
    },
    [duration, isYouTube],
  );

  const play = useCallback(() => {
    if (isYouTube) youtubeRef.current?.play();
    else void videoRef.current?.play();
    setPlaying(true);
  }, [isYouTube]);

  const pause = useCallback(() => {
    if (isYouTube) youtubeRef.current?.pause();
    else videoRef.current?.pause();
    setPlaying(false);
    setPreviewing(false);
  }, [isYouTube]);

  /** Plays exactly the selected range, then stops. */
  const previewClip = useCallback(() => {
    setExpanded(true);
    seek(start);
    setPreviewing(true);
    play();
  }, [play, seek, start]);

  // Stop at the end of the selection during a clip preview.
  useEffect(() => {
    if (!previewing) return;
    if (playhead >= end - 0.05) {
      pause();
      seek(start);
    }
  }, [previewing, playhead, end, start, pause, seek]);

  // Poll the playhead: the YouTube iframe API has no continuous time event,
  // and this keeps both player types on one code path.
  useEffect(() => {
    if (!playing) return;

    const timer = setInterval(() => {
      const current = isYouTube
        ? youtubeRef.current?.getCurrentTime()
        : videoRef.current?.currentTime;
      if (typeof current === "number") setPlayhead(current);
    }, 100);

    return () => clearInterval(timer);
  }, [playing, isYouTube]);

  /**
   * Moves the clip's start.
   *
   * A start beyond the current end used to collapse to `end - 0.5s`, silently
   * discarding the typed value: with a default 0–10s clip, asking for 2:07
   * landed on 9.5s. Instead the window slides — the clip keeps its length and
   * moves to the new position — which is what dragging the selection would do
   * and what the user meant.
   */
  const setStart = (value: number) => {
    const ceiling = duration || value + MIN_CLIP_SECONDS;
    const nextStart = Math.max(
      0,
      Math.min(value, Math.max(0, ceiling - MIN_CLIP_SECONDS)),
    );

    if (nextStart < end - MIN_CLIP_SECONDS) {
      // Still a valid window; only the near edge moved.
      onChange({ start: nextStart, end });
      return;
    }

    // Carry the clip along at the length it had before the start moved, so a
    // 10s selection stays 10s rather than collapsing to the minimum.
    const previousLength = Math.min(
      Math.max(end - start, MIN_CLIP_SECONDS),
      MAX_CLIP_SECONDS,
    );
    onChange({
      start: nextStart,
      end: Math.min(nextStart + previousLength, ceiling),
    });
  };

  /**
   * Moves the clip's end.
   *
   * The mirror of `setStart`: an end typed before the current start pulls the
   * start back with it rather than snapping to `start + 0.5s`, so the typed
   * timestamp is always the one that survives.
   */
  const setEnd = (value: number) => {
    const ceiling = duration || value;
    const nextEnd = Math.max(MIN_CLIP_SECONDS, Math.min(value, ceiling));

    if (nextEnd > start + MIN_CLIP_SECONDS) {
      onChange({
        start,
        end: Math.min(nextEnd, start + MAX_CLIP_SECONDS),
      });
      return;
    }

    const previousLength = Math.min(
      Math.max(end - start, MIN_CLIP_SECONDS),
      MAX_CLIP_SECONDS,
    );
    onChange({ start: Math.max(0, nextEnd - previousLength), end: nextEnd });
  };

  const clipLength = end - start;

  return (
    <div className="surface-inset p-2.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] bg-ink-800 text-[10px] font-semibold text-ink-300">
          {slot}
        </span>
        <p className="min-w-0 flex-1 truncate text-[12.5px] text-ink-200">
          {source.title}
        </p>
        <span className="shrink-0 rounded-full bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-accent">
          {clipLength.toFixed(1)}s
        </span>
      </div>

      {/*
        A filmstrip of the source thumbnail stands in for the timeline when the
        player is collapsed, so the row reads as an editing surface rather than
        a bare slider. It is decorative; the slider below owns interaction.
      */}
      {!expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label={`Open the player for video ${slot}`}
          className="group mb-2 flex h-11 w-full gap-px overflow-hidden rounded-[6px]
                     border border-ink-800 bg-ink-975 transition-colors duration-fast
                     hover:border-ink-600"
        >
          {Array.from({ length: 8 }).map((_, index) => (
            <span
              key={index}
              className="relative min-w-0 flex-1 overflow-hidden bg-ink-900"
            >
              {source.thumbnailUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- remote
                // YouTube thumbnail; see MediaPanel for the same reasoning.
                <img
                  src={source.thumbnailUrl}
                  alt=""
                  className="h-full w-full object-cover opacity-45 transition-opacity
                             duration-fast group-hover:opacity-60"
                  loading="lazy"
                />
              )}
            </span>
          ))}
        </button>
      )}

      {/*
        The player mounts only once expanded, so an unopened row costs no
        iframe. Once mounted it stays mounted, keeping playback position.
      */}
      {expanded && (
        <div className="mb-2 overflow-hidden rounded-[6px] bg-black">
          {isYouTube ? (
            <YouTubePlayer
              ref={youtubeRef}
              videoId={source.sourceReference}
              onReady={(playerDuration) => {
                if (playerDuration > 0) setDuration(playerDuration);
              }}
              onStateChange={(state) => setPlaying(state === "playing")}
            />
          ) : (
            <video
              ref={videoRef}
              src={`/api/media/${source.id}`}
              className="aspect-video w-full bg-black"
              playsInline
              preload="metadata"
              onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
              onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
          )}
        </div>
      )}

      <RangeSlider
        duration={duration}
        start={start}
        end={end}
        playhead={playhead}
        onStartChange={setStart}
        onEndChange={setEnd}
        onScrub={(seconds) => {
          setExpanded(true);
          seek(seconds);
        }}
      />

      <div className="mt-2 flex flex-wrap items-end gap-2">
        <TimeField label="Start" value={start} max={duration} onCommit={setStart} />
        <TimeField label="End" value={end} max={duration} onCommit={setEnd} />

        <div className="ml-auto flex items-center gap-1">
          {expanded && (
            <button
              type="button"
              onClick={() => {
                pause();
                setExpanded(false);
              }}
              className="btn-subtle"
            >
              Hide
            </button>
          )}
          <button
            type="button"
            onClick={playing ? pause : previewClip}
            className="btn-ghost px-3 py-1.5 text-[13px]"
          >
            {playing ? "Pause" : "Preview"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A timestamp input that accepts "83", "1:23", or "1:02:03". */
function TimeField({
  label,
  value,
  max,
  onCommit,
}: {
  label: string;
  value: number;
  max: number;
  onCommit: (seconds: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  const commit = () => {
    if (draft === null) return;
    const parsed = parseTimecode(draft);

    if (parsed === null || (max > 0 && parsed > max)) {
      setInvalid(true);
      setDraft(null);
      // Clear the warning once the user has seen it.
      setTimeout(() => setInvalid(false), 2000);
      return;
    }

    onCommit(parsed);
    setDraft(null);
    setInvalid(false);
  };

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-ink-400">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        value={draft ?? formatTimecode(value)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        aria-invalid={invalid}
        aria-label={`${label} timecode`}
        className={`w-[72px] rounded-control border bg-ink-950/80 px-2 py-1.5
                    text-[13px] tabular-nums text-ink-100 transition-colors
                    duration-fast focus:border-accent ${
                      invalid ? "border-red-500/70" : "border-ink-700"
                    }`}
      />
    </label>
  );
}
