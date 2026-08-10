import { AppError } from "../shared/errors";
import { storage } from "../storage/local";
import {
  createMediaSource,
  findCachedSource,
  getMediaSource,
  touchMediaSource,
  updateMediaSource,
} from "../db";
import type { MediaSource } from "../shared/types";
import { probe } from "./ffprobe";
import { uploadProvider } from "./upload";
import { youtubeProvider } from "./youtube";
import type { DownloadOptions, MediaProvider } from "./types";

/** Registry of every media provider. Order matters for `canHandle` dispatch. */
const providers: MediaProvider[] = [youtubeProvider, uploadProvider];

export function providerFor(type: MediaSource["type"]): MediaProvider {
  const provider = providers.find((p) => p.type === type);
  if (!provider) throw new AppError("INTERNAL", `No provider for type: ${type}`);
  return provider;
}

/**
 * Turns pasted user input into a stored MediaSource record.
 *
 * Metadata only — no media is transferred here. Downloading is deferred to
 * render time so the user can browse and adjust a selection without paying
 * for a download they might discard.
 */
export async function addSourceFromUrl(
  input: string,
  projectId?: string,
): Promise<MediaSource> {
  const provider = providers.find((p) => p.canHandle(input));
  if (!provider) {
    throw new AppError("INVALID_URL", `No provider accepted input: ${input.slice(0, 200)}`);
  }

  const resolved = await provider.resolve(input);

  // If this exact video was fetched before, reuse the local copy so the user
  // skips the download entirely.
  const cached = findCachedSource(resolved.type, resolved.sourceReference);
  if (cached?.localKey && (await storage.exists("sources", cached.localKey))) {
    touchMediaSource(cached.id);
    return createMediaSource({
      type: cached.type,
      title: cached.title,
      duration: cached.duration,
      sourceReference: cached.sourceReference,
      thumbnailUrl: cached.thumbnailUrl,
      localKey: cached.localKey,
      width: cached.width,
      height: cached.height,
      projectId,
    });
  }

  return createMediaSource({
    type: resolved.type,
    title: resolved.title,
    duration: resolved.durationSeconds,
    sourceReference: resolved.sourceReference,
    thumbnailUrl: resolved.thumbnailUrl,
    width: resolved.width,
    height: resolved.height,
    projectId,
  });
}

/**
 * Guarantees the source's bytes are on local disk, downloading if needed, and
 * returns the absolute path for FFmpeg.
 */
export async function materialize(
  sourceId: string,
  options: DownloadOptions = {},
): Promise<{ path: string; source: MediaSource }> {
  const source = getMediaSource(sourceId);
  if (!source) throw new AppError("NOT_FOUND", `No media source: ${sourceId}`);

  if (source.localKey && (await storage.exists("sources", source.localKey))) {
    touchMediaSource(source.id);
    return { path: storage.localPath("sources", source.localKey), source };
  }

  const provider = providerFor(source.type);
  const { storageKey } = await provider.download(
    {
      type: source.type,
      sourceReference: source.sourceReference,
      title: source.title,
      durationSeconds: source.duration,
    },
    options,
  );

  // Probe post-download: yt-dlp's advertised metadata and the delivered file
  // can differ, and every later trim depends on the real duration.
  const localPath = storage.localPath("sources", storageKey);
  const info = await probe(localPath);

  updateMediaSource(source.id, {
    localKey: storageKey,
    duration: info.durationSeconds,
    width: info.width,
    height: info.height,
  });
  touchMediaSource(source.id);

  return {
    path: localPath,
    source: { ...source, localKey: storageKey, duration: info.durationSeconds },
  };
}

export { probe, youtubeProvider, uploadProvider };
export { extractVideoId } from "./youtube";
export type { MediaProvider, ResolvedMedia, DownloadOptions } from "./types";
