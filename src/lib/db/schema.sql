-- Reels schema. Single-user, single-writer; SQLite in WAL mode handles the
-- web process and the worker process reading and writing concurrently.

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_sources (
  id                TEXT PRIMARY KEY,
  project_id        TEXT REFERENCES projects(id) ON DELETE CASCADE,
  type              TEXT NOT NULL CHECK (type IN ('youtube', 'upload')),
  title             TEXT NOT NULL,
  duration          REAL,
  source_reference  TEXT NOT NULL,
  thumbnail_url     TEXT,
  local_key         TEXT,
  width             INTEGER,
  height            INTEGER,
  created_at        TEXT NOT NULL,
  last_used_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_media_sources_project ON media_sources(project_id);

-- A downloaded YouTube video is reused across projects rather than fetched
-- again, so the reference is (type, source_reference), not the row id.
CREATE INDEX IF NOT EXISTS idx_media_sources_ref ON media_sources(type, source_reference);

CREATE TABLE IF NOT EXISTS reels (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  document    TEXT NOT NULL,          -- ReelDocument as JSON
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reels_project ON reels(project_id);

CREATE TABLE IF NOT EXISTS render_jobs (
  id                    TEXT PRIMARY KEY,
  reel_id               TEXT NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
  status                TEXT NOT NULL,
  progress              REAL NOT NULL DEFAULT 0,
  stage_detail          TEXT,
  estimated_remaining   REAL,
  output_path           TEXT,
  error                 TEXT,          -- user-facing message only
  error_code            TEXT,
  attempts              INTEGER NOT NULL DEFAULT 0,
  -- Set when a worker claims the job; lets us detect jobs orphaned by a crash.
  worker_id             TEXT,
  heartbeat_at          TEXT,
  cancel_requested      INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL,
  started_at            TEXT,
  completed_at          TEXT
);

CREATE INDEX IF NOT EXISTS idx_render_jobs_status ON render_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_render_jobs_reel ON render_jobs(reel_id);

CREATE TABLE IF NOT EXISTS render_outputs (
  id                TEXT PRIMARY KEY,
  job_id            TEXT NOT NULL REFERENCES render_jobs(id) ON DELETE CASCADE,
  reel_id           TEXT NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
  storage_key       TEXT NOT NULL,
  size_bytes        INTEGER NOT NULL,
  duration_seconds  REAL NOT NULL,
  width             INTEGER NOT NULL,
  height            INTEGER NOT NULL,
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_render_outputs_job ON render_outputs(job_id);

-- Per-stage timings from completed renders. Used to estimate remaining time
-- for new jobs from this machine's own history rather than a guessed constant.
CREATE TABLE IF NOT EXISTS render_stats (
  id                TEXT PRIMARY KEY,
  job_id            TEXT NOT NULL,
  stage             TEXT NOT NULL,
  duration_seconds  REAL NOT NULL,
  -- Output seconds produced, so we can derive a seconds-of-work-per-second-of-
  -- video rate that generalises across differently sized reels.
  output_seconds    REAL NOT NULL,
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_render_stats_stage ON render_stats(stage, created_at);
