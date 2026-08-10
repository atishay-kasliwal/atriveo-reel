import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { config } from "../shared/config";
import { reelDocumentSchema, type ReelDocument } from "../shared/reel";
import type {
  MediaSource,
  Project,
  Reel,
  RenderJob,
  RenderOutput,
  RenderStatus,
} from "../shared/types";

let db: Database.Database | null = null;

/**
 * Opens the database, creating it and applying the schema on first use.
 * WAL mode lets the web process and the worker process operate concurrently
 * without blocking each other on reads.
 */
export function getDb(): Database.Database {
  if (db) return db;

  fs.mkdirSync(path.dirname(config.storage.databasePath), { recursive: true });
  db = new Database(config.storage.databasePath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Wait rather than immediately throwing SQLITE_BUSY when the other process
  // holds the write lock.
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");

  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "schema.sql"),
    path.join(process.cwd(), "src/lib/db/schema.sql"),
  ];
  const schemaPath = candidates.find((p) => fs.existsSync(p));
  if (!schemaPath) throw new Error("Could not locate schema.sql");

  db.exec(fs.readFileSync(schemaPath, "utf8"));
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}

const now = () => new Date().toISOString();
export const newId = () => randomUUID();

/* ---------------------------------------------------------------- projects */

export function createProject(title = "Untitled reel"): Project {
  const project: Project = {
    id: newId(),
    title,
    createdAt: now(),
    updatedAt: now(),
  };
  getDb()
    .prepare(
      `INSERT INTO projects (id, title, created_at, updated_at)
       VALUES (@id, @title, @createdAt, @updatedAt)`,
    )
    .run(project);
  return project;
}

export function getProject(id: string): Project | null {
  const row = getDb()
    .prepare(`SELECT * FROM projects WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToProject(row) : null;
}

export function listProjects(limit = 50): Project[] {
  const rows = getDb()
    .prepare(`SELECT * FROM projects ORDER BY updated_at DESC LIMIT ?`)
    .all(limit) as Record<string, unknown>[];
  return rows.map(rowToProject);
}

function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    title: row.title as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/* ----------------------------------------------------------- media sources */

export function createMediaSource(
  input: Omit<MediaSource, "id" | "createdAt"> & { projectId?: string },
): MediaSource {
  const source: MediaSource = {
    id: newId(),
    type: input.type,
    title: input.title,
    duration: input.duration,
    sourceReference: input.sourceReference,
    thumbnailUrl: input.thumbnailUrl,
    localKey: input.localKey,
    width: input.width,
    height: input.height,
    createdAt: now(),
  };

  getDb()
    .prepare(
      `INSERT INTO media_sources
         (id, project_id, type, title, duration, source_reference,
          thumbnail_url, local_key, width, height, created_at, last_used_at)
       VALUES
         (@id, @projectId, @type, @title, @duration, @sourceReference,
          @thumbnailUrl, @localKey, @width, @height, @createdAt, @createdAt)`,
    )
    .run({
      ...source,
      projectId: input.projectId ?? null,
      duration: source.duration ?? null,
      thumbnailUrl: source.thumbnailUrl ?? null,
      localKey: source.localKey ?? null,
      width: source.width ?? null,
      height: source.height ?? null,
    });

  return source;
}

export function getMediaSource(id: string): MediaSource | null {
  const row = getDb()
    .prepare(`SELECT * FROM media_sources WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToMediaSource(row) : null;
}

/**
 * Finds an already-downloaded copy of the same upstream media, so pasting the
 * same YouTube link twice doesn't download it twice.
 */
export function findCachedSource(
  type: MediaSource["type"],
  sourceReference: string,
): MediaSource | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM media_sources
       WHERE type = ? AND source_reference = ? AND local_key IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(type, sourceReference) as Record<string, unknown> | undefined;
  return row ? rowToMediaSource(row) : null;
}

export function updateMediaSource(
  id: string,
  patch: Partial<Pick<MediaSource, "localKey" | "duration" | "width" | "height" | "title">>,
): void {
  const fields: string[] = [];
  const values: Record<string, unknown> = { id };

  if (patch.localKey !== undefined) {
    fields.push("local_key = @localKey");
    values.localKey = patch.localKey;
  }
  if (patch.duration !== undefined) {
    fields.push("duration = @duration");
    values.duration = patch.duration;
  }
  if (patch.width !== undefined) {
    fields.push("width = @width");
    values.width = patch.width;
  }
  if (patch.height !== undefined) {
    fields.push("height = @height");
    values.height = patch.height;
  }
  if (patch.title !== undefined) {
    fields.push("title = @title");
    values.title = patch.title;
  }
  if (fields.length === 0) return;

  getDb()
    .prepare(`UPDATE media_sources SET ${fields.join(", ")} WHERE id = @id`)
    .run(values);
}

export function touchMediaSource(id: string): void {
  getDb()
    .prepare(`UPDATE media_sources SET last_used_at = ? WHERE id = ?`)
    .run(now(), id);
}

function rowToMediaSource(row: Record<string, unknown>): MediaSource {
  return {
    id: row.id as string,
    type: row.type as MediaSource["type"],
    title: row.title as string,
    duration: (row.duration as number | null) ?? undefined,
    sourceReference: row.source_reference as string,
    thumbnailUrl: (row.thumbnail_url as string | null) ?? undefined,
    localKey: (row.local_key as string | null) ?? undefined,
    width: (row.width as number | null) ?? undefined,
    height: (row.height as number | null) ?? undefined,
    createdAt: row.created_at as string,
  };
}

/* ------------------------------------------------------------------- reels */

export function createReel(projectId: string, title: string, document: ReelDocument): Reel {
  const reel: Reel = {
    id: newId(),
    projectId,
    title,
    document,
    createdAt: now(),
    updatedAt: now(),
  };

  getDb()
    .prepare(
      `INSERT INTO reels (id, project_id, title, document, created_at, updated_at)
       VALUES (@id, @projectId, @title, @document, @createdAt, @updatedAt)`,
    )
    .run({ ...reel, document: JSON.stringify(document) });

  return reel;
}

export function getReel(id: string): Reel | null {
  const row = getDb()
    .prepare(`SELECT * FROM reels WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    id: row.id as string,
    projectId: row.project_id as string,
    title: row.title as string,
    document: reelDocumentSchema.parse(JSON.parse(row.document as string)),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function updateReelDocument(id: string, document: ReelDocument): void {
  getDb()
    .prepare(`UPDATE reels SET document = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(document), now(), id);
}

/* -------------------------------------------------------------- render jobs */

export function createRenderJob(reelId: string): RenderJob {
  const job: RenderJob = {
    id: newId(),
    reelId,
    status: "queued",
    progress: 0,
    createdAt: now(),
  };

  getDb()
    .prepare(
      `INSERT INTO render_jobs (id, reel_id, status, progress, created_at)
       VALUES (@id, @reelId, @status, @progress, @createdAt)`,
    )
    .run(job);

  return job;
}

export function getRenderJob(id: string): RenderJob | null {
  const row = getDb()
    .prepare(`SELECT * FROM render_jobs WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToRenderJob(row) : null;
}

export function getJobStageDetail(id: string): string | null {
  const row = getDb()
    .prepare(`SELECT stage_detail FROM render_jobs WHERE id = ?`)
    .get(id) as { stage_detail: string | null } | undefined;
  return row?.stage_detail ?? null;
}

/**
 * Position in the queue, 1-based, counting only jobs still waiting.
 * Returns 0 for jobs that are already running or finished.
 */
export function getQueuePosition(jobId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS ahead FROM render_jobs
       WHERE status = 'queued'
         AND created_at < (SELECT created_at FROM render_jobs WHERE id = ?)`,
    )
    .get(jobId) as { ahead: number };

  const job = getRenderJob(jobId);
  if (!job || job.status !== "queued") return 0;
  return row.ahead + 1;
}

export function listActiveJobs(): RenderJob[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM render_jobs
       WHERE status NOT IN ('completed', 'failed', 'cancelled')
       ORDER BY created_at ASC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map(rowToRenderJob);
}

/**
 * Atomically claims the oldest queued job for a worker.
 *
 * The UPDATE ... WHERE status='queued' is the claim: if two workers race, only
 * one row is modified, and the loser's `changes` is 0. This is what keeps the
 * concurrency limit honest without a separate lock.
 */
export function claimNextJob(workerId: string): RenderJob | null {
  const database = getDb();

  const claim = database.transaction((): RenderJob | null => {
    const candidate = database
      .prepare(
        `SELECT id FROM render_jobs
         WHERE status = 'queued' AND cancel_requested = 0
         ORDER BY created_at ASC LIMIT 1`,
      )
      .get() as { id: string } | undefined;

    if (!candidate) return null;

    const result = database
      .prepare(
        `UPDATE render_jobs
         SET status = 'downloading',
             worker_id = @workerId,
             started_at = @startedAt,
             heartbeat_at = @startedAt,
             attempts = attempts + 1
         WHERE id = @id AND status = 'queued'`,
      )
      .run({ id: candidate.id, workerId, startedAt: now() });

    if (result.changes === 0) return null;
    return getRenderJob(candidate.id);
  });

  return claim();
}

export function updateJobProgress(
  id: string,
  patch: {
    status?: RenderStatus;
    progress?: number;
    stageDetail?: string;
    estimatedRemainingSeconds?: number | null;
  },
): void {
  const fields: string[] = ["heartbeat_at = @heartbeat"];
  const values: Record<string, unknown> = { id, heartbeat: now() };

  if (patch.status !== undefined) {
    fields.push("status = @status");
    values.status = patch.status;
  }
  if (patch.progress !== undefined) {
    fields.push("progress = @progress");
    values.progress = Math.max(0, Math.min(1, patch.progress));
  }
  if (patch.stageDetail !== undefined) {
    fields.push("stage_detail = @stageDetail");
    values.stageDetail = patch.stageDetail;
  }
  if (patch.estimatedRemainingSeconds !== undefined) {
    fields.push("estimated_remaining = @eta");
    values.eta = patch.estimatedRemainingSeconds;
  }

  getDb()
    .prepare(`UPDATE render_jobs SET ${fields.join(", ")} WHERE id = @id`)
    .run(values);
}

export function completeJob(id: string, outputPath: string): void {
  getDb()
    .prepare(
      `UPDATE render_jobs
       SET status = 'completed', progress = 1, output_path = ?,
           completed_at = ?, estimated_remaining = 0, error = NULL, error_code = NULL
       WHERE id = ?`,
    )
    .run(outputPath, now(), id);
}

export function failJob(id: string, errorCode: string, userMessage: string): void {
  getDb()
    .prepare(
      `UPDATE render_jobs
       SET status = 'failed', error = ?, error_code = ?, completed_at = ?
       WHERE id = ?`,
    )
    .run(userMessage, errorCode, now(), id);
}

export function requestCancel(id: string): void {
  const database = getDb();
  database.transaction(() => {
    // A job that hasn't been claimed yet can be cancelled outright. A running
    // one only gets flagged; the worker notices and tears down its processes.
    const job = getRenderJob(id);
    if (!job) return;

    if (job.status === "queued") {
      database
        .prepare(
          `UPDATE render_jobs
           SET status = 'cancelled', cancel_requested = 1, completed_at = ?
           WHERE id = ? AND status = 'queued'`,
        )
        .run(now(), id);
    } else {
      database.prepare(`UPDATE render_jobs SET cancel_requested = 1 WHERE id = ?`).run(id);
    }
  })();
}

export function isCancelRequested(id: string): boolean {
  const row = getDb()
    .prepare(`SELECT cancel_requested FROM render_jobs WHERE id = ?`)
    .get(id) as { cancel_requested: number } | undefined;
  return row?.cancel_requested === 1;
}

export function markCancelled(id: string): void {
  getDb()
    .prepare(
      `UPDATE render_jobs SET status = 'cancelled', completed_at = ? WHERE id = ?`,
    )
    .run(now(), id);
}

/**
 * Returns jobs whose worker stopped reporting. Called at worker startup to
 * recover from a crash mid-render — otherwise those jobs would sit in a
 * running state forever and the UI would spin indefinitely.
 */
export function findStaleJobs(staleAfterSeconds: number): RenderJob[] {
  const cutoff = new Date(Date.now() - staleAfterSeconds * 1000).toISOString();
  const rows = getDb()
    .prepare(
      `SELECT * FROM render_jobs
       WHERE status IN ('downloading', 'preparing', 'rendering', 'encoding')
         AND (heartbeat_at IS NULL OR heartbeat_at < ?)`,
    )
    .all(cutoff) as Record<string, unknown>[];
  return rows.map(rowToRenderJob);
}

export function requeueJob(id: string): void {
  getDb()
    .prepare(
      `UPDATE render_jobs
       SET status = 'queued', progress = 0, worker_id = NULL,
           heartbeat_at = NULL, started_at = NULL, stage_detail = NULL
       WHERE id = ?`,
    )
    .run(id);
}

export function getJobAttempts(id: string): number {
  const row = getDb()
    .prepare(`SELECT attempts FROM render_jobs WHERE id = ?`)
    .get(id) as { attempts: number } | undefined;
  return row?.attempts ?? 0;
}

function rowToRenderJob(row: Record<string, unknown>): RenderJob {
  return {
    id: row.id as string,
    reelId: row.reel_id as string,
    status: row.status as RenderStatus,
    progress: row.progress as number,
    estimatedRemainingSeconds:
      (row.estimated_remaining as number | null) ?? undefined,
    outputPath: (row.output_path as string | null) ?? undefined,
    error: (row.error as string | null) ?? undefined,
    errorCode: (row.error_code as string | null) ?? undefined,
    createdAt: row.created_at as string,
    startedAt: (row.started_at as string | null) ?? undefined,
    completedAt: (row.completed_at as string | null) ?? undefined,
  };
}

/* ----------------------------------------------------------- render outputs */

export function createRenderOutput(
  input: Omit<RenderOutput, "id" | "createdAt">,
): RenderOutput {
  const output: RenderOutput = { id: newId(), createdAt: now(), ...input };
  getDb()
    .prepare(
      `INSERT INTO render_outputs
         (id, job_id, reel_id, storage_key, size_bytes, duration_seconds,
          width, height, created_at)
       VALUES
         (@id, @jobId, @reelId, @storageKey, @sizeBytes, @durationSeconds,
          @width, @height, @createdAt)`,
    )
    .run(output);
  return output;
}

export function getRenderOutputByJob(jobId: string): RenderOutput | null {
  const row = getDb()
    .prepare(`SELECT * FROM render_outputs WHERE job_id = ?`)
    .get(jobId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    jobId: row.job_id as string,
    reelId: row.reel_id as string,
    storageKey: row.storage_key as string,
    sizeBytes: row.size_bytes as number,
    durationSeconds: row.duration_seconds as number,
    width: row.width as number,
    height: row.height as number,
    createdAt: row.created_at as string,
  };
}

/* ------------------------------------------------------------ render stats */

export function recordStageTiming(
  jobId: string,
  stage: string,
  durationSeconds: number,
  outputSeconds: number,
): void {
  getDb()
    .prepare(
      `INSERT INTO render_stats
         (id, job_id, stage, duration_seconds, output_seconds, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(newId(), jobId, stage, durationSeconds, outputSeconds, now());
}

/**
 * Median seconds of wall time per second of output video for a stage, taken
 * from recent runs on this machine. Median rather than mean so one pathological
 * render doesn't skew every future estimate. Returns null until there is
 * enough history to be meaningful.
 */
export function getStageRate(stage: string, sampleSize = 20): number | null {
  const rows = getDb()
    .prepare(
      `SELECT duration_seconds, output_seconds FROM render_stats
       WHERE stage = ? AND output_seconds > 0
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(stage, sampleSize) as { duration_seconds: number; output_seconds: number }[];

  if (rows.length < 3) return null;

  const rates = rows
    .map((r) => r.duration_seconds / r.output_seconds)
    .sort((a, b) => a - b);
  const mid = Math.floor(rates.length / 2);
  return rates.length % 2 === 0 ? (rates[mid - 1] + rates[mid]) / 2 : rates[mid];
}
