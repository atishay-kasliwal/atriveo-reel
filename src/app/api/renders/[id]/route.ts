import { errorResponse, ok } from "@/lib/api/respond";
import {
  getJobStageDetail,
  getQueuePosition,
  getRenderJob,
  getRenderOutputByJob,
  requestCancel,
} from "@/lib/db";
import { AppError } from "@/lib/shared/errors";
import { STAGE_LABELS } from "@/lib/shared/types";

export const runtime = "nodejs";

/** Current state of a render job. Polled as a fallback when SSE is unavailable. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const job = getRenderJob(id);
    if (!job) throw new AppError("NOT_FOUND", `No job: ${id}`);

    const output = getRenderOutputByJob(job.id);

    return ok({
      ...job,
      queuePosition: getQueuePosition(job.id),
      stageLabel: STAGE_LABELS[job.status],
      stageDetail: getJobStageDetail(job.id),
      output: output
        ? {
            durationSeconds: output.durationSeconds,
            sizeBytes: output.sizeBytes,
            width: output.width,
            height: output.height,
            downloadUrl: `/api/renders/${job.id}/file`,
          }
        : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Requests cancellation. The worker notices and stops its FFmpeg processes. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const job = getRenderJob(id);
    if (!job) throw new AppError("NOT_FOUND", `No job: ${id}`);

    requestCancel(id);
    return ok({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
