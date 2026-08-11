"use client";

import { useEffect, useRef, useState } from "react";

import { api, type JobStatus } from "@/lib/api/client";
import { isTerminal, type RenderStatus } from "@/lib/shared/types";

/**
 * Stages shown as a checklist, in the order they occur. The status values are
 * the backend's; only the wording is presentational.
 */
const STAGES: { status: RenderStatus; label: string }[] = [
  { status: "downloading", label: "Importing media" },
  { status: "preparing", label: "Preparing clips" },
  { status: "rendering", label: "Composing reel" },
  { status: "encoding", label: "Encoding video" },
];

const STAGE_INDEX: Record<string, number> = Object.fromEntries(
  STAGES.map((stage, index) => [stage.status, index]),
);

/**
 * Subscribes to a render job and reports its status.
 *
 * Extracted from the view so the workspace can react to the job — locking the
 * editor while it runs — without the progress UI owning that decision. The
 * transport is unchanged: SSE first, polling as a fallback.
 */
export function useRenderJob(jobId: string | null) {
  const [job, setJob] = useState<JobStatus | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);

  // Progress must never visually run backwards, even if a stage recalculates
  // its estimate downward.
  const highWaterMark = useRef(0);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      highWaterMark.current = 0;
      return;
    }

    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    const apply = (next: JobStatus) => {
      highWaterMark.current = Math.max(highWaterMark.current, next.progress);
      setJob(next);
      setConnectionLost(false);
    };

    /** Fallback for when SSE can't connect or drops. */
    const startPolling = () => {
      if (pollTimer || closed) return;
      pollTimer = setInterval(async () => {
        try {
          const next = await api.getJob(jobId);
          apply(next);
          if (isTerminal(next.status)) {
            clearInterval(pollTimer!);
            pollTimer = null;
          }
        } catch {
          setConnectionLost(true);
        }
      }, 2000);
    };

    try {
      source = new EventSource(`/api/renders/${jobId}/events`);

      source.addEventListener("progress", (event) => {
        apply(JSON.parse((event as MessageEvent).data) as JobStatus);
      });

      source.addEventListener("done", (event) => {
        apply(JSON.parse((event as MessageEvent).data) as JobStatus);
        source?.close();
      });

      source.addEventListener("error", () => {
        // EventSource fires this for both transport drops and server-sent
        // error events; polling covers either case.
        if (!closed) startPolling();
      });
    } catch {
      startPolling();
    }

    return () => {
      closed = true;
      source?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [jobId]);

  const displayProgress = job
    ? Math.max(highWaterMark.current, job.progress)
    : 0;

  return { job, connectionLost, displayProgress };
}

/**
 * The render state of the preview panel.
 *
 * Occupies the same column and canvas geometry as the editing preview, so
 * starting a render changes what the panel shows without moving anything
 * around it.
 */
export function RenderPanel({
  job,
  connectionLost,
  displayProgress,
  onCancel,
  cancelling,
}: {
  job: JobStatus | null;
  connectionLost: boolean;
  displayProgress: number;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const currentIndex = job ? (STAGE_INDEX[job.status] ?? -1) : -1;
  const queued = job?.status === "queued";
  const percent = Math.round(displayProgress * 100);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <p className="section-label">Rendering</p>
        <span className="text-[11px] tabular-nums text-ink-400">
          {queued ? "Queued" : `${percent}%`}
        </span>
      </div>

      <PreviewFrame>
        <div className="skeleton absolute inset-0" aria-hidden="true" />

        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <span className="text-[28px] font-semibold tabular-nums text-ink-100">
            {queued ? "—" : `${percent}%`}
          </span>
          <span className="px-4 text-center text-[11px] text-ink-300">
            {queued
              ? job && job.queuePosition > 1
                ? `Number ${job.queuePosition} in the queue`
                : "Starting shortly"
              : (job?.stageDetail ?? job?.stageLabel ?? "Preparing")}
          </span>
        </div>
      </PreviewFrame>

      <div
        className="h-1 overflow-hidden rounded-full bg-ink-800"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Render progress"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
          style={{ width: `${displayProgress * 100}%` }}
        />
      </div>

      <ol className="space-y-1.5">
        {STAGES.map((stage, index) => {
          const done = currentIndex > index;
          const active = currentIndex === index;
          return (
            <li
              key={stage.status}
              className={`flex items-center gap-2 text-[12px] ${
                done ? "text-ink-400" : active ? "text-ink-100" : "text-ink-600"
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[8px] ${
                  done
                    ? "bg-accent/15 text-accent"
                    : active
                      ? "bg-accent text-white"
                      : "border border-ink-700"
                }`}
              >
                {done ? "✓" : ""}
              </span>
              {stage.label}
              {active && (
                <span className="ml-auto text-[11px] text-ink-400">
                  in progress
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <EtaLine seconds={job?.estimatedRemainingSeconds} queued={queued} />

      {connectionLost && (
        <p className="text-[11px] text-amber-500/80">
          Lost the live connection — still checking. The render is unaffected.
        </p>
      )}

      <button
        type="button"
        onClick={onCancel}
        disabled={cancelling}
        className="btn-ghost w-full py-2 text-[13px]"
      >
        {cancelling ? "Cancelling…" : "Cancel render"}
      </button>
    </div>
  );
}

/**
 * The spec is explicit that a misleading countdown is worse than none: when
 * the worker has no history to estimate from, say so plainly instead.
 */
function EtaLine({ seconds, queued }: { seconds?: number; queued: boolean }) {
  if (queued) {
    return (
      <p className="text-[12px] text-ink-400">
        Another render is running. This one starts automatically.
      </p>
    );
  }

  if (seconds === undefined || !Number.isFinite(seconds)) {
    return <p className="text-[12px] text-ink-400">Estimating time remaining…</p>;
  }

  if (seconds <= 2) {
    return <p className="text-[12px] text-ink-400">Almost done</p>;
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);

  return (
    <p className="text-[12px] text-ink-400">
      About{" "}
      <span className="tabular-nums text-ink-200">
        {minutes}:{String(remainder).padStart(2, "0")}
      </span>{" "}
      remaining
    </p>
  );
}

/** The completed state, in the same panel the preview occupied. */
export function CompletePanel({
  job,
  onStartOver,
}: {
  job: JobStatus;
  onStartOver: () => void;
}) {
  const output = job.output!;
  const megabytes = (output.sizeBytes / 1024 / 1024).toFixed(1);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <p className="section-label flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500/15 text-[9px] text-emerald-300"
          >
            ✓
          </span>
          Reel ready
        </p>
        <span className="text-[11px] tabular-nums text-ink-400">9:16</span>
      </div>

      {/*
        The finished file, with the browser's own transport: play, scrub,
        volume and fullscreen all come from the media element rather than
        controls we would have to reimplement.
      */}
      <video
        src={output.downloadUrl}
        controls
        playsInline
        preload="metadata"
        className="w-full rounded-panel border border-ink-800 bg-black shadow-stage"
        style={{ aspectRatio: "9 / 16" }}
      />

      <dl className="grid grid-cols-3 gap-x-3 gap-y-1 rounded-control border border-ink-800 bg-ink-900 px-3 py-2">
        <Stat label="Length" value={`${output.durationSeconds.toFixed(1)}s`} />
        <Stat label="Size" value={`${megabytes} MB`} />
        <Stat label="Output" value="1080 × 1920" />
      </dl>

      <a
        href={output.downloadUrl}
        download
        className="btn-primary w-full py-2.5 text-[14px] font-semibold"
      >
        Download MP4
      </a>

      <button
        type="button"
        onClick={onStartOver}
        className="btn-ghost w-full py-2 text-[13px]"
      >
        Make another
      </button>
    </div>
  );
}

/** A failed or cancelled render, recoverable without leaving the workspace. */
export function RenderErrorPanel({
  title,
  message,
  onRetry,
  onDismiss,
  retrying,
}: {
  title: string;
  message: string;
  onRetry: () => void;
  onDismiss: () => void;
  retrying: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="section-label">Render</p>

      <PreviewFrame>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-5 text-center">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-red-500/10 text-[13px] text-red-300"
          >
            !
          </span>
          <p className="text-[13px] font-medium text-ink-100">{title}</p>
          <p className="text-[11px] leading-relaxed text-ink-300">{message}</p>
        </div>
      </PreviewFrame>

      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="btn-primary w-full py-2.5 text-[14px] font-semibold"
      >
        {retrying ? "Starting…" : "Try again"}
      </button>

      <button
        type="button"
        onClick={onDismiss}
        className="btn-ghost w-full py-2 text-[13px]"
      >
        Back to editing
      </button>
    </div>
  );
}

/**
 * The 9:16 canvas shell. Shared by every panel state so the column keeps a
 * constant height and nothing shifts as the render progresses.
 */
function PreviewFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-panel border border-ink-800
                 bg-ink-975 shadow-stage"
      style={{ aspectRatio: "9 / 16" }}
    >
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] text-ink-400">{label}</dt>
      <dd className="metric truncate text-[12px]">{value}</dd>
    </div>
  );
}
