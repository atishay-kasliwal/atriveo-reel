import type { MediaSource, MediaType } from "../shared/types";

export interface ResolvedMedia {
  type: MediaType;
  /** Stable upstream identifier, e.g. a YouTube video id. */
  sourceReference: string;
  title: string;
  durationSeconds?: number;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
}

export interface DownloadProgress {
  /** 0..1 within this download, or undefined when the provider can't say. */
  fraction?: number;
  bytesDownloaded?: number;
  totalBytes?: number;
  speedBytesPerSecond?: number;
}

export interface DownloadOptions {
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
}

/**
 * A place media can come from. Adding a provider (Vimeo, a local NAS) means
 * implementing this and registering it — no other layer needs to change.
 */
export interface MediaProvider {
  readonly type: MediaType;
  /** Whether this provider handles the given user input. */
  canHandle(input: string): boolean;
  /** Reads metadata without downloading the media itself. */
  resolve(input: string): Promise<ResolvedMedia>;
  /**
   * Downloads to local storage and returns the storage key.
   * Implementations must honour `signal` so cancellation is prompt.
   */
  download(
    media: ResolvedMedia,
    options?: DownloadOptions,
  ): Promise<{ storageKey: string }>;
}

export type { MediaSource };
