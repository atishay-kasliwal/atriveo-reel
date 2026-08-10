import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { config } from "../shared/config";
import { AppError } from "../shared/errors";
import type { Storage, StorageBucket, StoredObject } from "./types";

const execFileAsync = promisify(execFile);

const BUCKET_DIRS: Record<StorageBucket, string> = {
  sources: config.storage.sourcesDir,
  projects: config.storage.projectsDir,
  renders: config.storage.rendersDir,
  temp: config.storage.tempDir,
};

export class LocalStorage implements Storage {
  private ready: Promise<void> | null = null;

  /** Creates the bucket directories once, on first use. */
  private async ensureDirs(): Promise<void> {
    this.ready ??= (async () => {
      for (const dir of Object.values(BUCKET_DIRS)) {
        await fs.mkdir(dir, { recursive: true });
      }
    })();
    return this.ready;
  }

  /**
   * Resolves a key inside its bucket, rejecting anything that would escape.
   * Keys arrive from request bodies, so traversal has to be blocked here
   * rather than trusted upstream.
   */
  localPath(bucket: StorageBucket, key: string): string {
    const root = BUCKET_DIRS[bucket];
    if (!root) throw new AppError("INTERNAL", `Unknown bucket: ${bucket}`);

    if (key.includes("\0")) {
      throw new AppError("VALIDATION_FAILED", `Null byte in storage key: ${key}`);
    }

    const resolved = path.resolve(root, key);
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
    if (resolved !== root && !resolved.startsWith(rootWithSep)) {
      throw new AppError("VALIDATION_FAILED", `Storage key escapes bucket: ${key}`);
    }
    return resolved;
  }

  async save(bucket: StorageBucket, key: string, data: Buffer | Readable): Promise<string> {
    await this.ensureDirs();
    const target = this.localPath(bucket, key);
    await fs.mkdir(path.dirname(target), { recursive: true });

    // Write to a sibling temp file and rename, so a crash mid-write can never
    // leave a half-written file that later looks complete.
    const staging = `${target}.${process.pid}.partial`;
    try {
      if (Buffer.isBuffer(data)) {
        await fs.writeFile(staging, data);
      } else {
        await pipeline(data, createWriteStream(staging));
      }
      await fs.rename(staging, target);
    } catch (error) {
      await fs.rm(staging, { force: true });
      throw error;
    }
    return key;
  }

  async read(bucket: StorageBucket, key: string): Promise<Readable> {
    const target = this.localPath(bucket, key);
    if (!(await this.exists(bucket, key))) {
      throw new AppError("NOT_FOUND", `Missing object: ${bucket}/${key}`);
    }
    return createReadStream(target);
  }

  async readBuffer(bucket: StorageBucket, key: string): Promise<Buffer> {
    const target = this.localPath(bucket, key);
    try {
      return await fs.readFile(target);
    } catch {
      throw new AppError("NOT_FOUND", `Missing object: ${bucket}/${key}`);
    }
  }

  async delete(bucket: StorageBucket, key: string): Promise<void> {
    const target = this.localPath(bucket, key);
    await fs.rm(target, { force: true, recursive: true });
  }

  async exists(bucket: StorageBucket, key: string): Promise<boolean> {
    try {
      await fs.access(this.localPath(bucket, key));
      return true;
    } catch {
      return false;
    }
  }

  async stat(bucket: StorageBucket, key: string): Promise<StoredObject | null> {
    try {
      const stats = await fs.stat(this.localPath(bucket, key));
      return {
        key,
        bucket,
        sizeBytes: stats.size,
        modifiedAt: stats.mtime,
      };
    } catch {
      return null;
    }
  }

  async list(bucket: StorageBucket, prefix = ""): Promise<StoredObject[]> {
    await this.ensureDirs();
    const root = BUCKET_DIRS[bucket];
    const results: StoredObject[] = [];

    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        const key = path.relative(root, full);
        if (prefix && !key.startsWith(prefix)) continue;
        // Staging files are not yet real objects.
        if (key.endsWith(".partial")) continue;
        const stats = await fs.stat(full);
        results.push({ key, bucket, sizeBytes: stats.size, modifiedAt: stats.mtime });
      }
    };

    await walk(root);
    return results;
  }

  /**
   * Free bytes on the volume holding the data directory.
   *
   * `fs.statfs` is the direct route but has been unreliable on some macOS
   * builds, so `df` is used as a fallback before giving up.
   */
  async freeSpaceBytes(): Promise<number> {
    await this.ensureDirs();
    try {
      const stats = await fs.statfs(config.storage.dataDir);
      return Number(stats.bavail) * Number(stats.bsize);
    } catch {
      // Fall through to df.
    }
    try {
      const { stdout } = await execFileAsync("df", ["-k", config.storage.dataDir]);
      const line = stdout.trim().split("\n").at(-1) ?? "";
      const available = Number(line.split(/\s+/)[3]);
      if (Number.isFinite(available)) return available * 1024;
    } catch {
      // Fall through.
    }
    return Number.POSITIVE_INFINITY;
  }

  /** Absolute path of a bucket's root directory. */
  bucketRoot(bucket: StorageBucket): string {
    return BUCKET_DIRS[bucket];
  }

  async init(): Promise<void> {
    await this.ensureDirs();
  }
}

export const storage = new LocalStorage();
