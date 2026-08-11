"use client";

import { useRef, useState } from "react";

import { api, ApiError } from "@/lib/api/client";
import { formatTimecode } from "@/lib/shared/reel";
import type { MediaSource } from "@/lib/shared/types";

type Slot = "A" | "B";

/**
 * Media selection for both slots.
 *
 * Resolution behaviour is unchanged from the original source step: a pasted
 * URL goes through `api.addSource`, a picked file through `api.uploadSource`,
 * and each slot reports its own error. Only the presentation differs — an
 * accepted source collapses into a summary card instead of staying an input.
 */
export function MediaPanel({
  sourceA,
  sourceB,
  onChangeA,
  onChangeB,
}: {
  sourceA: MediaSource | null;
  sourceB: MediaSource | null;
  onChangeA: (source: MediaSource | null) => void;
  onChangeB: (source: MediaSource | null) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <MediaSlot slot="A" source={sourceA} onChange={onChangeA} />
      <MediaSlot slot="B" source={sourceB} onChange={onChangeB} />
    </div>
  );
}

function MediaSlot({
  slot,
  source,
  onChange,
}: {
  slot: Slot;
  source: MediaSource | null;
  onChange: (source: MediaSource | null) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolve = async () => {
    if (url.trim() === "" || busy) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await api.addSource(url.trim()));
      setUrl("");
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Couldn't add that video.",
      );
    } finally {
      setBusy(false);
    }
  };

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setBusy(true);
    setError(null);
    try {
      onChange(await api.uploadSource(file));
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Couldn't upload that file.",
      );
    } finally {
      setBusy(false);
      // Reset so re-picking the same file fires a change event.
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  if (busy && !source) return <MediaSkeleton slot={slot} />;

  if (source) {
    return (
      <div className="surface-inset group/card flex min-h-[76px] items-start gap-2.5 p-2.5">
        <Thumbnail source={source} />

        <div className="flex min-w-0 flex-1 flex-col gap-1 py-0.5">
          {/* Two lines before truncating: most titles fit, few need an ellipsis. */}
          <p
            className="line-clamp-2 text-[12.5px] font-medium leading-snug text-ink-100"
            title={source.title}
          >
            {source.title}
          </p>
          <p className="mt-auto flex items-center gap-1.5 text-[11px] text-ink-300">
            <SourceIcon type={source.type} />
            {source.type === "youtube" ? "YouTube" : "Uploaded file"}
            <span className="flex items-center gap-1 text-emerald-300/90">
              <span aria-hidden="true" className="text-ink-600">
                ·
              </span>
              Ready
            </span>
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            onChange(null);
            setError(null);
          }}
          aria-label={`Replace video ${slot}`}
          className="btn-subtle shrink-0 border border-transparent opacity-80
                     transition-opacity duration-fast hover:border-ink-700
                     hover:opacity-100 focus-visible:opacity-100
                     group-hover/card:opacity-100"
        >
          Replace
        </button>
      </div>
    );
  }

  return (
    <div className="surface-inset min-h-[76px] p-2.5">
      <div className="mb-2 flex items-center gap-2">
        <SlotBadge slot={slot} />
        <span className="text-[12px] text-ink-300">
          Paste a link or upload a file
        </span>
      </div>

      <input
        type="url"
        inputMode="url"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void resolve();
          }
        }}
        onBlur={() => void resolve()}
        placeholder="youtube.com/watch?v=…"
        disabled={busy}
        aria-label={`Video ${slot} URL`}
        aria-invalid={error !== null}
        aria-describedby={error ? `media-error-${slot}` : undefined}
        className="field"
      />

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void resolve()}
          disabled={busy || url.trim() === ""}
          className="btn-primary px-3 py-1.5 text-[13px]"
        >
          {busy ? "Checking…" : "Add"}
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          className="btn-subtle"
        >
          Upload file
        </button>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv"
        onChange={upload}
        className="hidden"
      />

      {error && (
        <p
          id={`media-error-${slot}`}
          role="alert"
          className="mt-2 text-[12px] text-red-400"
        >
          {error}
        </p>
      )}
    </div>
  );
}

function Thumbnail({ source }: { source: MediaSource }) {
  return (
    <div className="relative aspect-video w-[88px] shrink-0 overflow-hidden rounded-[8px] bg-ink-800">
      {source.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote YouTube
        // thumbnails are not in the Next image allowlist, and optimisation
        // would add a server round-trip for a 92px decoration.
        <img
          src={source.thumbnailUrl}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-ink-600">
          <SourceIcon type={source.type} />
        </div>
      )}

      {source.duration !== undefined && (
        <span className="absolute bottom-1 right-1 rounded bg-ink-975/85 px-1 py-0.5 text-[10px] tabular-nums text-ink-200">
          {formatTimecode(source.duration)}
        </span>
      )}
    </div>
  );
}

function MediaSkeleton({ slot }: { slot: Slot }) {
  return (
    <div
      className="surface-inset flex min-h-[76px] items-start gap-2.5 p-2.5"
      aria-busy="true"
    >
      <div className="skeleton aspect-video w-[88px] shrink-0 rounded-[8px]" />
      <div className="flex flex-1 flex-col gap-2 py-1">
        <div className="skeleton h-3 w-4/5 rounded" />
        <div className="skeleton h-3 w-2/5 rounded" />
        <div className="skeleton mt-auto h-2.5 w-1/3 rounded" />
      </div>
      <span className="sr-only">Loading video {slot}</span>
    </div>
  );
}

function SlotBadge({ slot }: { slot: Slot }) {
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-[6px] bg-ink-800 text-[11px] font-semibold text-ink-300">
      {slot}
    </span>
  );
}

function SourceIcon({ type }: { type: MediaSource["type"] }) {
  if (type === "youtube") {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5">
        <path
          fill="currentColor"
          d="M15.5 4.8a2 2 0 0 0-1.4-1.4C12.9 3 8 3 8 3s-4.9 0-6.1.4A2 2 0 0 0 .5 4.8 20.9 20.9 0 0 0 .1 8c0 1.1.1 2.2.4 3.2a2 2 0 0 0 1.4 1.4c1.2.4 6.1.4 6.1.4s4.9 0 6.1-.4a2 2 0 0 0 1.4-1.4c.3-1 .4-2.1.4-3.2s-.1-2.2-.4-3.2ZM6.5 10.3V5.7L10.4 8l-3.9 2.3Z"
        />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5">
      <path
        fill="currentColor"
        d="M2 4a1.5 1.5 0 0 1 1.5-1.5h6A1.5 1.5 0 0 1 11 4v8a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 2 12V4Zm10.5 1.7 2.2-1.3a.5.5 0 0 1 .8.4v6.4a.5.5 0 0 1-.8.4l-2.2-1.3V5.7Z"
      />
    </svg>
  );
}
