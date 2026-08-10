import { z } from "zod";

import { errorResponse, ok } from "@/lib/api/respond";
import { addSourceFromUrl } from "@/lib/media";

export const runtime = "nodejs";
// Resolving metadata shells out to yt-dlp, which can take a few seconds.
export const maxDuration = 60;

const bodySchema = z.object({
  url: z.string().min(1).max(2000),
  projectId: z.string().optional(),
});

/**
 * Resolves a pasted URL into a media source.
 *
 * Metadata only — the video itself is downloaded at render time, so pasting a
 * link stays fast and costs no bandwidth if the user changes their mind.
 */
export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const source = await addSourceFromUrl(body.url, body.projectId);
    return ok(source, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
