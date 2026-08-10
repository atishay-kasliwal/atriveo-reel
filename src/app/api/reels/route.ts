import { z } from "zod";

import { errorResponse, ok } from "@/lib/api/respond";
import { createProject, createReel, getMediaSource } from "@/lib/db";
import { reelDocumentSchema } from "@/lib/shared/reel";
import { AppError } from "@/lib/shared/errors";

export const runtime = "nodejs";

const bodySchema = z.object({
  title: z.string().max(200).optional(),
  projectId: z.string().optional(),
  document: z.unknown(),
});

/**
 * Stores a reel document.
 *
 * The document is validated here rather than at render time so the user sees
 * a problem while they can still fix it, not after queuing a job.
 */
export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());

    const parsed = reelDocumentSchema.safeParse(body.document);
    if (!parsed.success) {
      throw new AppError(
        "VALIDATION_FAILED",
        JSON.stringify(parsed.error.issues),
        parsed.error.issues[0]?.message ?? "Some of the reel settings aren't valid.",
      );
    }
    const document = parsed.data;

    // Every referenced source must exist, or the render would fail later with
    // a much less useful message.
    for (const element of document.elements) {
      if (element.type !== "video") continue;
      const source = getMediaSource(element.sourceId);
      if (!source) {
        throw new AppError("NOT_FOUND", `Unknown source: ${element.sourceId}`);
      }
      if (source.duration && element.start >= source.duration) {
        throw new AppError(
          "TIMESTAMP_OUT_OF_RANGE",
          `start=${element.start} exceeds duration=${source.duration}`,
        );
      }
    }

    const projectId = body.projectId ?? createProject(body.title ?? "Untitled reel").id;
    const reel = createReel(projectId, body.title ?? "Untitled reel", document);

    return ok(reel, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
