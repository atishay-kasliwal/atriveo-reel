import {
  getJobStageDetail,
  getQueuePosition,
  getRenderJob,
  getRenderOutputByJob,
} from "@/lib/db";
import { STAGE_LABELS, isTerminal } from "@/lib/shared/types";

export const runtime = "nodejs";
// The stream stays open for the life of the render.
export const maxDuration = 3600;
export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 500;
/** Give up on a job that never reaches a terminal state. */
const MAX_STREAM_MS = 60 * 60 * 1000;

/**
 * Streams render progress over Server-Sent Events.
 *
 * The worker writes progress to SQLite and this endpoint polls that row, so
 * the two processes need no direct channel between them. SSE rather than a
 * WebSocket: the data flows one way, and it survives the Cloudflare Tunnel
 * without extra configuration.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const startedAt = Date.now();
      let lastPayload = "";
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          // Already closed by the client disconnecting.
        }
      };

      // Stop work promptly when the browser navigates away.
      request.signal.addEventListener("abort", close);

      const tick = () => {
        if (closed) return;

        try {
          const job = getRenderJob(id);
          if (!job) {
            send("error", { code: "NOT_FOUND", message: "That render no longer exists." });
            close();
            return;
          }

          const output = getRenderOutputByJob(job.id);
          const payload = {
            id: job.id,
            status: job.status,
            progress: job.progress,
            estimatedRemainingSeconds: job.estimatedRemainingSeconds,
            queuePosition: getQueuePosition(job.id),
            stageLabel: STAGE_LABELS[job.status],
            stageDetail: getJobStageDetail(job.id),
            error: job.error,
            errorCode: job.errorCode,
            output: output
              ? {
                  durationSeconds: output.durationSeconds,
                  sizeBytes: output.sizeBytes,
                  downloadUrl: `/api/renders/${job.id}/file`,
                }
              : null,
          };

          // Only push when something actually changed, so an idle queue
          // doesn't stream identical frames twice a second.
          const serialized = JSON.stringify(payload);
          if (serialized !== lastPayload) {
            lastPayload = serialized;
            send("progress", payload);
          }

          if (isTerminal(job.status)) {
            send("done", payload);
            close();
            return;
          }

          if (Date.now() - startedAt > MAX_STREAM_MS) {
            send("error", {
              code: "INTERNAL",
              message: "Lost track of this render. Refresh to check its status.",
            });
            close();
          }
        } catch (error) {
          console.error("[sse] poll failed:", error);
          close();
        }
      };

      const timer = setInterval(tick, POLL_INTERVAL_MS);
      tick();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tell any proxy in front of us not to buffer the stream.
      "X-Accel-Buffering": "no",
    },
  });
}
