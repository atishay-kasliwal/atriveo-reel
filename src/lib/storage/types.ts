import type { Readable } from "node:stream";

/**
 * Logical buckets. Each maps to a directory locally and would map to a key
 * prefix on R2/S3.
 */
export type StorageBucket = "sources" | "projects" | "renders" | "temp";

export interface StoredObject {
  key: string;
  bucket: StorageBucket;
  sizeBytes: number;
  modifiedAt: Date;
}

/**
 * Storage is addressed by (bucket, key). Implementations must treat `key` as
 * opaque and must reject any key that escapes its bucket.
 *
 * `localPath` is the one method that leaks the local filesystem. FFmpeg needs
 * a real path to work with, so a remote implementation would satisfy it by
 * downloading to a temp file first.
 */
export interface Storage {
  save(bucket: StorageBucket, key: string, data: Buffer | Readable): Promise<string>;
  read(bucket: StorageBucket, key: string): Promise<Readable>;
  readBuffer(bucket: StorageBucket, key: string): Promise<Buffer>;
  delete(bucket: StorageBucket, key: string): Promise<void>;
  exists(bucket: StorageBucket, key: string): Promise<boolean>;
  stat(bucket: StorageBucket, key: string): Promise<StoredObject | null>;
  list(bucket: StorageBucket, prefix?: string): Promise<StoredObject[]>;
  localPath(bucket: StorageBucket, key: string): string;
  freeSpaceBytes(): Promise<number>;
}
