import { errorResponse } from "@/lib/api/respond";
import { serveFile } from "@/lib/api/serve-file";
import { getReel, getRenderJob, getRenderOutputByJob } from "@/lib/db";
import { AppError } from "@/lib/shared/errors";
import { storage } from "@/lib/storage/local";

export const runtime = "nodejs";

/** Streams a finished render, with range support so it can be scrubbed. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const job = getRenderJob(id);
    if (!job) throw new AppError("NOT_FOUND", `No job: ${id}`);

    const output = getRenderOutputByJob(id);
    if (!output) throw new AppError("NOT_FOUND", `Job ${id} has no output yet`);

    const reel = getReel(job.reelId);
    const filename = `${slugify(reel?.title ?? "reel")}.mp4`;

    return await serveFile(
      storage.localPath("renders", output.storageKey),
      request,
      {
        contentType: "video/mp4",
        // Inline playback happens through the preview element; this endpoint
        // is the explicit download.
        downloadName: request.headers.get("range") ? undefined : filename,
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "reel"
  );
}
