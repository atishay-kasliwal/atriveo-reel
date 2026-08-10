"use client";

import { useEffect, useRef, useState } from "react";

import { api, type JobStatus } from "@/lib/api/client";
import { isTerminal, type RenderStatus } from "@/lib/shared/types";

/** Stages shown as a checklist, in the order they occur. */
const STAGES: { status: RenderStatus; label: string }[] = [
  { status: "downloading", label: "Fetching videos" },
  { status: "preparing", label: "Preparing clips" },
  { status: "rendering", label: "Rendering" },
  { status: "encoding", label: "Encoding MP4" },
];

const STAGE_INDEX: Record<string, number> = Object.fromEntries(
  STAGES.map((stage, index) => [stage.status, index]),
);

export function RenderStep({
  jobId,
  onStartOver,
}: {
  jobId: string;
  onStartOver: () => void;
}) {
  const [job, setJob] = useState<JobStatus | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Progress must never visually run backwards, even if a stage recalculates
  // its estimate downward.
  const highWaterMark = useRef(0);

  useEffect(() => {
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

  async function handleCancel() {
    setCancelling(true);
    try {
      await api.cancelJob(jobId);
    } catch {
      setCancelling(false);
    }
  }

  if (!job) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center">
        <p className="text-sm text-ink-400">Starting…</p>
      </div>
    );
  }

  if (job.status === "completed" && job.output) {
    return <CompletedView job={job} onStartOver={onStartOver} />;
  }

  if (job.status === "failed") {
    return (
      <FailureView
        title="Couldn't create the reel."
        message={job.error ?? "The source video could not be processed."}
        onStartOver={onStartOver}
      />
    );
  }

  if (job.status === "cancelled") {
    return (
      <FailureView
        title="Render cancelled."
        message="Nothing was saved."
        onStartOver={onStartOver}
      />
    );
  }

  const displayProgress = Math.max(highWaterMark.current, job.progress);
  const currentIndex = STAGE_INDEX[job.status] ?? -1;

  return (
    <div className="mx-auto max-w-md py-8">
      <h1 className="mb-8 text-2xl font-semibold tracking-tight">
        Creating your reel
      </h1>

      {job.status === "queued" ? (
        <QueuedView position={job.queuePosition} />
      ) : (
        <>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm text-ink-300">
              {job.stageDetail ?? job.stageLabel}
            </span>
            <span className="text-sm tabular-nums text-ink-400">
              {Math.round(displayProgress * 100)}%
            </span>
          </div>

          <div
            className="mb-8 h-2 overflow-hidden rounded-full bg-ink-800"
            role="progressbar"
            aria-valuenow={Math.round(displayProgress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Render progress"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
              style={{ width: `${displayProgress * 100}%` }}
            />
          </div>

          <ol className="mb-8 space-y-2.5">
            {STAGES.map((stage, index) => {
              const done = currentIndex > index;
              const active = currentIndex === index;
              return (
                <li
                  key={stage.status}
                  className={`flex items-center gap-3 text-sm ${
                    done ? "text-ink-400" : active ? "text-ink-100" : "text-ink-600"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
                      done
                        ? "bg-accent/20 text-accent"
                        : active
                          ? "bg-accent text-white"
                          : "border border-ink-700"
                    }`}
                  >
                    {done ? "✓" : ""}
                  </span>
                  {stage.label}
                </li>
              );
            })}
          </ol>

          <EtaLine seconds={job.estimatedRemainingSeconds} />
        </>
      )}

      {connectionLost && (
        <p className="mt-6 text-xs text-amber-500/80">
          Lost the live connection — still checking. The render is unaffected.
        </p>
      )}

      <button
        type="button"
        onClick={handleCancel}
        disabled={cancelling}
        className="mt-8 text-sm text-ink-500 transition-colors hover:text-ink-300"
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
function EtaLine({ seconds }: { seconds?: number }) {
  if (seconds === undefined || !Number.isFinite(seconds)) {
    return <p className="text-sm text-ink-500">Rendering…</p>;
  }

  if (seconds <= 2) {
    return <p className="text-sm text-ink-500">Almost done</p>;
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);

  return (
    <div>
      <p className="mb-1 text-xs text-ink-500">Estimated time remaining</p>
      <p className="text-2xl tabular-nums text-ink-200">
        {minutes}:{String(remainder).padStart(2, "0")}
      </p>
    </div>
  );
}

function QueuedView({ position }: { position: number }) {
  return (
    <div className="rounded-2xl border border-ink-800 bg-ink-900/60 p-6 text-center">
      <p className="mb-1 text-ink-200">
        {position > 1 ? `#${position} in the queue` : "Next up"}
      </p>
      <p className="text-sm text-ink-500">
        Another render is running. This one starts automatically.
      </p>
    </div>
  );
}

function CompletedView({
  job,
  onStartOver,
}: {
  job: JobStatus;
  onStartOver: () => void;
}) {
  const output = job.output!;
  const megabytes = (output.sizeBytes / 1024 / 1024).toFixed(1);

  return (
    <div className="mx-auto max-w-md py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-semibold tracking-tight">
        <span className="text-accent">✓</span> Reel ready
      </h1>

      <div className="mb-6 flex justify-center">
        <video
          src={output.downloadUrl}
          controls
          playsInline
          preload="metadata"
          className="w-full max-w-[280px] rounded-2xl border border-ink-800 bg-black"
          style={{ aspectRatio: "9 / 16" }}
        />
      </div>

      <p className="mb-6 text-center text-xs text-ink-500">
        {output.durationSeconds.toFixed(1)}s · {megabytes} MB · 1080 × 1920
      </p>

      <div className="space-y-3">
        <a
          href={output.downloadUrl}
          download
          className="btn-primary w-full py-4 text-base font-semibold"
        >
          Download MP4
        </a>

        <button type="button" onClick={onStartOver} className="btn-ghost w-full">
          Make another
        </button>
      </div>
    </div>
  );
}

function FailureView({
  title,
  message,
  onStartOver,
}: {
  title: string;
  message: string;
  onStartOver: () => void;
}) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="mb-3 text-xl font-semibold text-ink-100">{title}</h1>
      <p className="mb-8 text-sm leading-relaxed text-ink-400">{message}</p>

      <button type="button" onClick={onStartOver} className="btn-primary">
        Try again
      </button>
    </div>
  );
}
