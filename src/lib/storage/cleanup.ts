import fs from "node:fs/promises";

import { getDb } from "../db";
import { config } from "../shared/config";
import { storage } from "./local";

export interface CleanupReport {
  tempRemoved: number;
  sourcesRemoved: number;
  rendersRemoved: number;
  bytesReclaimed: number;
}

/** Working directories older than this are assumed abandoned by a dead job. */
const ORPHAN_TEMP_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Applies the configured retention policies.
 *
 * Finished renders are only deleted when a retention period is explicitly
 * configured. The default is to keep them forever: silently deleting
 * someone's finished reel to save disk is not a tradeoff to make on their
 * behalf.
 */
export async function runCleanup(): Promise<CleanupReport> {
  const report: CleanupReport = {
    tempRemoved: 0,
    sourcesRemoved: 0,
    rendersRemoved: 0,
    bytesReclaimed: 0,
  };

  await cleanTemp(report);
  await cleanSources(report);
  await cleanRenders(report);

  if (report.bytesReclaimed > 0) {
    console.log(
      `[cleanup] reclaimed ${(report.bytesReclaimed / 1024 / 1024).toFixed(1)}MB ` +
        `(temp=${report.tempRemoved} sources=${report.sourcesRemoved} renders=${report.rendersRemoved})`,
    );
  }
  return report;
}

/**
 * Removes leftover job working directories.
 *
 * A live job's directory is left alone: the age check is what distinguishes an
 * abandoned directory from one actively being written.
 */
async function cleanTemp(report: CleanupReport): Promise<void> {
  const objects = await storage.list("temp");
  const cutoff = Date.now() - ORPHAN_TEMP_AGE_MS;

  for (const object of objects) {
    if (object.modifiedAt.getTime() > cutoff) continue;
    await storage.delete("temp", object.key);
    report.tempRemoved += 1;
    report.bytesReclaimed += object.sizeBytes;
  }

  // Drop the now-empty job directories the files lived in.
  const tempRoot = storage.bucketRoot("temp");
  try {
    for (const entry of await fs.readdir(tempRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dirPath = `${tempRoot}/${entry.name}`;
      const stats = await fs.stat(dirPath);
      if (stats.mtimeMs > cutoff) continue;
      const remaining = await fs.readdir(dirPath);
      if (remaining.length === 0) await fs.rmdir(dirPath);
    }
  } catch {
    // A racing worker may have removed it already.
  }
}

/**
 * Deletes cached source videos past their retention window.
 *
 * Sources referenced by a reel are kept regardless of age — re-downloading
 * them on the next render would be slower and would waste bandwidth.
 */
async function cleanSources(report: CleanupReport): Promise<void> {
  if (config.cleanup.sourceRetentionDays <= 0) return;

  const cutoff = new Date(
    Date.now() - config.cleanup.sourceRetentionDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const rows = getDb()
    .prepare(
      `SELECT id, local_key FROM media_sources
       WHERE local_key IS NOT NULL
         AND COALESCE(last_used_at, created_at) < ?
         AND id NOT IN (
           -- Keep anything a stored reel still points at.
           SELECT DISTINCT json_extract(value, '$.sourceId')
           FROM reels, json_each(json_extract(reels.document, '$.elements'))
           WHERE json_extract(value, '$.type') = 'video'
         )`,
    )
    .all(cutoff) as { id: string; local_key: string }[];

  for (const row of rows) {
    const stat = await storage.stat("sources", row.local_key);
    await storage.delete("sources", row.local_key);
    getDb().prepare(`UPDATE media_sources SET local_key = NULL WHERE id = ?`).run(row.id);
    report.sourcesRemoved += 1;
    report.bytesReclaimed += stat?.sizeBytes ?? 0;
  }
}

/** Deletes finished renders past retention, if one is configured. */
async function cleanRenders(report: CleanupReport): Promise<void> {
  if (config.cleanup.renderRetentionDays <= 0) return;

  const cutoff = new Date(
    Date.now() - config.cleanup.renderRetentionDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const rows = getDb()
    .prepare(`SELECT id, storage_key FROM render_outputs WHERE created_at < ?`)
    .all(cutoff) as { id: string; storage_key: string }[];

  for (const row of rows) {
    const stat = await storage.stat("renders", row.storage_key);
    await storage.delete("renders", row.storage_key);
    getDb().prepare(`DELETE FROM render_outputs WHERE id = ?`).run(row.id);
    report.rendersRemoved += 1;
    report.bytesReclaimed += stat?.sizeBytes ?? 0;
  }
}
