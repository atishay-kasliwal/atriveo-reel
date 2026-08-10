import { randomUUID } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";

import { errorResponse, ok } from "@/lib/api/respond";
import { createMediaSource } from "@/lib/db";
import { uploadProvider } from "@/lib/media/upload";
import { config } from "@/lib/shared/config";
import { AppError } from "@/lib/shared/errors";
import { storage } from "@/lib/storage/local";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Accepts a local video upload.
 *
 * The body is streamed to disk rather than buffered: a 2GB upload held in
 * memory would take the server down.
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      throw new AppError("VALIDATION_FAILED", "No file field in upload");
    }

    const maxBytes = config.media.maxUploadMb * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new AppError(
        "UPLOAD_TOO_LARGE",
        `Upload of ${file.size} bytes exceeds ${maxBytes}`,
        `That file is larger than the ${config.media.maxUploadMb}MB limit.`,
      );
    }

    const extension = path.extname(file.name).toLowerCase() || ".mp4";
    const storageKey = `uploads/${randomUUID()}${extension}`;

    const stream = Readable.fromWeb(file.stream() as Parameters<typeof Readable.fromWeb>[0]);
    await storage.save("sources", storageKey, stream);

    // Probes the file; throws UNSUPPORTED_MEDIA if it isn't decodable video.
    const resolved = await uploadProvider.register(storageKey, file.name);

    const source = createMediaSource({
      type: "upload",
      title: resolved.title,
      duration: resolved.durationSeconds,
      sourceReference: storageKey,
      localKey: storageKey,
      width: resolved.width,
      height: resolved.height,
      projectId: (formData.get("projectId") as string) || undefined,
    });

    return ok(source, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
