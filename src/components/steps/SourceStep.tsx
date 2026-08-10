"use client";

import { useRef, useState } from "react";

import { api, ApiError } from "@/lib/api/client";
import { formatTimecode } from "@/lib/shared/reel";
import type { MediaSource } from "@/lib/shared/types";
import type { EditorState } from "../Editor";

type Slot = "A" | "B";

export function SourceStep({
  sourceA,
  sourceB,
  onChange,
  onContinue,
}: {
  sourceA: MediaSource | null;
  sourceB: MediaSource | null;
  onChange: (patch: Partial<EditorState>) => void;
  onContinue: () => void;
}) {
  const [urlA, setUrlA] = useState("");
  const [urlB, setUrlB] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Slot, string>>>({});

  const ready = sourceA !== null && sourceB !== null;

  /** Resolves whichever slots still need a source, in parallel. */
  async function handleContinue() {
    setBusy(true);
    setErrors({});

    const jobs: Promise<void>[] = [];
    const nextErrors: Partial<Record<Slot, string>> = {};

    const resolve = async (slot: Slot, url: string, existing: MediaSource | null) => {
      if (existing) return;
      if (url.trim() === "") {
        nextErrors[slot] = "Add a video for this slot.";
        return;
      }
      try {
        const source = await api.addSource(url.trim());
        onChange(slot === "A" ? { sourceA: source } : { sourceB: source });
      } catch (caught) {
        nextErrors[slot] =
          caught instanceof ApiError ? caught.message : "Couldn't add that video.";
      }
    };

    jobs.push(resolve("A", urlA, sourceA));
    jobs.push(resolve("B", urlB, sourceB));
    await Promise.all(jobs);

    setBusy(false);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) onContinue();
  }

  return (
    <div className="space-y-8">
      <p className="text-[15px] leading-relaxed text-ink-400">
        Paste two YouTube links to compare them side by side.
      </p>


      <div className="space-y-4">
        <SourceField
          slot="A"
          url={urlA}
          source={sourceA}
          error={errors.A}
          disabled={busy}
          onUrlChange={setUrlA}
          onUploaded={(source) => onChange({ sourceA: source })}
          onClear={() => {
            onChange({ sourceA: null });
            setUrlA("");
          }}
        />

        <SourceField
          slot="B"
          url={urlB}
          source={sourceB}
          error={errors.B}
          disabled={busy}
          onUrlChange={setUrlB}
          onUploaded={(source) => onChange({ sourceB: source })}
          onClear={() => {
            onChange({ sourceB: null });
            setUrlB("");
          }}
        />
      </div>

      <button
        type="button"
        onClick={handleContinue}
        disabled={busy || (!ready && urlA.trim() === "" && urlB.trim() === "")}
        className="btn-primary w-full"
      >
        {busy ? "Checking videos…" : "Continue"}
      </button>

      <p className="text-xs leading-relaxed text-ink-500">
        You're responsible for having the rights to use any media you process here.
      </p>
    </div>
  );
}

function SourceField({
  slot,
  url,
  source,
  error,
  disabled,
  onUrlChange,
  onUploaded,
  onClear,
}: {
  slot: Slot;
  url: string;
  source: MediaSource | null;
  error?: string;
  disabled: boolean;
  onUrlChange: (value: string) => void;
  onUploaded: (source: MediaSource) => void;
  onClear: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError(null);
    try {
      onUploaded(await api.uploadSource(file));
    } catch (caught) {
      setUploadError(
        caught instanceof ApiError ? caught.message : "Couldn't upload that file.",
      );
    } finally {
      setUploading(false);
      // Reset so re-picking the same file fires a change event.
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  if (source) {
    return (
      <div className="card flex items-center gap-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-sm font-semibold text-accent">
          {slot}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] text-ink-100">{source.title}</p>
          <p className="text-xs text-ink-500">
            {source.duration ? formatTimecode(source.duration) : "Ready"}
            {source.type === "upload" && " · Uploaded"}
          </p>
        </div>

        <button
          type="button"
          onClick={onClear}
          className="shrink-0 rounded-lg px-2 py-1 text-sm text-ink-400 transition-colors hover:text-ink-100"
          aria-label={`Remove video ${slot}`}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div>
      <label className="mb-2 block text-xs font-medium tracking-wide text-ink-400">
        VIDEO {slot}
      </label>

      <input
        type="url"
        inputMode="url"
        value={url}
        onChange={(event) => onUrlChange(event.target.value)}
        placeholder="Paste YouTube URL"
        disabled={disabled || uploading}
        className="field"
        aria-invalid={error !== undefined}
        aria-describedby={error ? `error-${slot}` : undefined}
      />

      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={disabled || uploading}
          className="text-xs text-ink-500 transition-colors hover:text-ink-300 disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "or upload a file"}
        </button>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv"
        onChange={handleFile}
        className="hidden"
      />

      {(error || uploadError) && (
        <p id={`error-${slot}`} role="alert" className="mt-2 text-sm text-red-400">
          {error ?? uploadError}
        </p>
      )}
    </div>
  );
}
