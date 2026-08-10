import path from "node:path";

import { AppError } from "../shared/errors";
import { storage } from "../storage/local";
import { probe } from "./ffprobe";
import type { MediaProvider, ResolvedMedia } from "./types";

const ALLOWED_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi"]);

/**
 * Locally uploaded files. The HTTP layer writes bytes to storage first, then
 * calls `register`, so this provider never handles the transfer itself and
 * `download` is a no-op — the file is already local.
 */
export class UploadProvider implements MediaProvider {
  readonly type = "upload" as const;

  /** Uploads arrive through their own endpoint, never by pasting text. */
  canHandle(): boolean {
    return false;
  }

  async resolve(storageKey: string): Promise<ResolvedMedia> {
    return this.register(storageKey, path.basename(storageKey));
  }

  async download(media: ResolvedMedia): Promise<{ storageKey: string }> {
    return { storageKey: media.sourceReference };
  }

  /** Probes an already-stored upload and builds its media record. */
  async register(storageKey: string, originalName: string): Promise<ResolvedMedia> {
    const extension = path.extname(originalName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      throw new AppError("UNSUPPORTED_MEDIA", `Rejected upload extension: ${extension}`);
    }

    const localPath = storage.localPath("sources", storageKey);
    // Extension alone proves nothing; ffprobe is what actually establishes
    // that this is decodable video.
    const info = await probe(localPath);

    if (info.durationSeconds <= 0) {
      throw new AppError("UNSUPPORTED_MEDIA", `Upload has no measurable duration: ${storageKey}`);
    }

    return {
      type: "upload",
      sourceReference: storageKey,
      title: path.basename(originalName, extension),
      durationSeconds: info.durationSeconds,
      width: info.width,
      height: info.height,
    };
  }
}

export const uploadProvider = new UploadProvider();
export { ALLOWED_EXTENSIONS };
