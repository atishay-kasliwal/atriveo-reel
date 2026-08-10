import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable } from "node:stream";

import { AppError } from "../shared/errors";

/**
 * Serves a local file with HTTP range support.
 *
 * Range handling is what makes video seekable: without a 206 response the
 * browser must download the entire file before it can jump to a timestamp,
 * which would make clip selection unusable on a long source.
 */
export async function serveFile(
  filePath: string,
  request: Request,
  options: { contentType: string; downloadName?: string },
): Promise<Response> {
  let stats;
  try {
    stats = await fs.stat(filePath);
  } catch {
    throw new AppError("NOT_FOUND", `File missing: ${filePath}`);
  }

  const headers = new Headers({
    "Content-Type": options.contentType,
    "Accept-Ranges": "bytes",
    // These files are immutable once written, so let the browser keep them.
    "Cache-Control": "private, max-age=3600",
  });

  if (options.downloadName) {
    // Quote the filename and strip quotes from it, so a title with a quote
    // can't break out of the header value.
    const safeName = options.downloadName.replace(/["\\]/g, "");
    headers.set("Content-Disposition", `attachment; filename="${safeName}"`);
  }

  const rangeHeader = request.headers.get("range");

  if (!rangeHeader) {
    headers.set("Content-Length", String(stats.size));
    const stream = Readable.toWeb(
      createReadStream(filePath),
    ) as unknown as ReadableStream;
    return new Response(stream, { status: 200, headers });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) {
    headers.set("Content-Range", `bytes */${stats.size}`);
    return new Response(null, { status: 416, headers });
  }

  const [, rawStart, rawEnd] = match;

  // "bytes=-500" means the final 500 bytes, not a range starting at zero.
  let start: number;
  let end: number;

  if (rawStart === "") {
    const suffixLength = Number(rawEnd);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      headers.set("Content-Range", `bytes */${stats.size}`);
      return new Response(null, { status: 416, headers });
    }
    start = Math.max(0, stats.size - suffixLength);
    end = stats.size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? stats.size - 1 : Number(rawEnd);
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start > end ||
    start >= stats.size
  ) {
    headers.set("Content-Range", `bytes */${stats.size}`);
    return new Response(null, { status: 416, headers });
  }

  // A client may ask past the end; serving what exists is correct.
  end = Math.min(end, stats.size - 1);

  headers.set("Content-Range", `bytes ${start}-${end}/${stats.size}`);
  headers.set("Content-Length", String(end - start + 1));

  const stream = Readable.toWeb(
    createReadStream(filePath, { start, end }),
  ) as unknown as ReadableStream;

  return new Response(stream, { status: 206, headers });
}
