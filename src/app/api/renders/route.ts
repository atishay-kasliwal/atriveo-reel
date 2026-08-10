import { z } from "zod";

import { errorResponse, ok } from "@/lib/api/respond";
import { createRenderJob, getQueuePosition, getReel } from "@/lib/db";
import { AppError } from "@/lib/shared/errors";
import { storage } from "@/lib/storage/local";
import { config } from "@/lib/shared/config";

export const runtime = "nodejs";

const bodySchema = z.object({ reelId: z.string().min(1) });

/**
 * Queues a render.
 *
 * Returns as soon as the job row exists — the worker process picks it up
 * independently, so no HTTP request is ever held open for a render.
 */
export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());

    const reel = getReel(body.reelId);
    if (!reel) throw new AppError("NOT_FOUND", `No reel: ${body.reelId}`);

    // Refuse up front rather than letting the job fail mid-render: the user
    // can act on this message, and it costs nothing to check.
    const freeBytes = await storage.freeSpaceBytes();
    if (freeBytes < config.render.minFreeDiskMb * 1024 * 1024) {
      throw new AppError(
        "INSUFFICIENT_DISK",
        `Only ${Math.round(freeBytes / 1024 / 1024)}MB free`,
      );
    }

    const job = createRenderJob(reel.id);
    return ok({ ...job, queuePosition: getQueuePosition(job.id) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
