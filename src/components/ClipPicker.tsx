"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { formatTimecode, parseTimecode } from "@/lib/shared/reel";
import type { MediaSource } from "@/lib/shared/types";
import { YouTubePlayer, type PlayerHandle } from "./YouTubePlayer";
import { RangeSlider } from "./RangeSlider";

export interface ClipPickerProps {
  label: string;
  source: MediaSource;
  start: number;
  end: number;
  onChange: (selection: { start: number; end: number }) => void;
}

/** Shortest clip that still reads as a clip rather than a glitch. */
const MIN_CLIP_SECONDS = 0.5;
const MAX_CLIP_SECONDS = 60;

/**
 * Picks a clip range from a source.
 *
 * YouTube sources play through the embedded iframe player, because the file
 * hasn't been downloaded yet at this point in the flow — deferring the
 * download until render keeps the editor responsive. Uploaded files stream
 * from local storage through a range-capable endpoint.
 */
export function ClipPicker({ label, source, start, end, onChange }: ClipPickerProps) {
  const youtubeRef = useRef<PlayerHandle>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [duration, setDuration] = useState(source.duration ?? 0);
  const [playhead, setPlayhead] = useState(start);
  const [playing, setPlaying] = useState(false);
  const [previewing, setPreviewing] = useState(false);

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

  const setStart = (value: number) => {
    const clamped = Math.max(0, Math.min(value, end - MIN_CLIP_SECONDS));
    onChange({ start: clamped, end });
  };

  const setEnd = (value: number) => {
    const ceiling = duration || value;
    const clamped = Math.min(
      Math.max(value, start + MIN_CLIP_SECONDS),
      Math.min(ceiling, start + MAX_CLIP_SECONDS),
    );
    onChange({ start, end: clamped });
  };

  const clipLength = end - start;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-medium tracking-wide text-ink-400">{label}</h2>
        <span className="text-xs tabular-nums text-ink-500">
          {clipLength.toFixed(1)}s clip
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-ink-800 bg-black">
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

      <RangeSlider
        duration={duration}
        start={start}
        end={end}
        playhead={playhead}
        onStartChange={setStart}
        onEndChange={setEnd}
        onScrub={seek}
      />

      <div className="flex flex-wrap items-end gap-3">
        <TimeField label="Start" value={start} max={duration} onCommit={setStart} />
        <TimeField label="End" value={end} max={duration} onCommit={setEnd} />

        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={playing ? pause : previewClip}
            className="btn-ghost px-4 py-2 text-sm"
          >
            {playing ? "Pause" : "Preview clip"}
          </button>
        </div>
      </div>
    </section>
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
    <label className="block">
      <span className="mb-1 block text-[11px] text-ink-500">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        value={draft ?? formatTimecode(value)}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(null);
            event.currentTarget.blur();
          }
        }}
        className={`w-[5.5rem] rounded-lg border bg-ink-900 px-3 py-2 text-center text-sm tabular-nums transition-colors ${
          invalid ? "border-red-500 text-red-300" : "border-ink-700 text-ink-100"
        }`}
        aria-label={`${label} time`}
        aria-invalid={invalid}
      />
    </label>
  );
}
