import { errorResponse } from "@/lib/api/respond";
import { serveFile } from "@/lib/api/serve-file";
import { getMediaSource } from "@/lib/db";
import { AppError } from "@/lib/shared/errors";
import { storage } from "@/lib/storage/local";

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
};

/**
 * Streams a locally cached source video for in-browser scrubbing.
 *
 * Only sources already downloaded are served. A YouTube source that hasn't
 * been fetched yet is played through its own embed instead, so we don't
 * trigger a multi-hundred-megabyte download just to show a preview.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const source = getMediaSource(id);
    if (!source) throw new AppError("NOT_FOUND", `No source: ${id}`);
    if (!source.localKey) {
      throw new AppError("NOT_FOUND", `Source ${id} is not downloaded yet`);
    }

    const extension = source.localKey.slice(source.localKey.lastIndexOf("."));

    return await serveFile(storage.localPath("sources", source.localKey), request, {
      contentType: CONTENT_TYPES[extension] ?? "application/octet-stream",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
