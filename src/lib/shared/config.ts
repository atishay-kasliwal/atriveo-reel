import os from "node:os";
import path from "node:path";

function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

function str(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value === "" ? fallback : value;
}

function int(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1" || raw === "yes";
}

const dataDir = path.resolve(expandHome(str("DATA_DIR", "~/reels-data")));

export const config = {
  appPort: int("APP_PORT", 3000),

  auth: {
    password: str("APP_PASSWORD", ""),
    sessionSecret: str("SESSION_SECRET", ""),
    sessionTtlHours: int("SESSION_TTL_HOURS", 720),
    get enabled(): boolean {
      return config.auth.password !== "";
    },
  },

  storage: {
    dataDir,
    sourcesDir: path.join(dataDir, "sources"),
    projectsDir: path.join(dataDir, "projects"),
    rendersDir: path.join(dataDir, "renders"),
    tempDir: path.join(dataDir, "temp"),
    databasePath: path.join(dataDir, "reels.db"),
  },

  render: {
    maxConcurrent: Math.max(1, int("MAX_CONCURRENT_RENDERS", 1)),
    encoder: str("VIDEO_ENCODER", "h264_videotoolbox"),
    quality: str("VIDEO_QUALITY", "8M"),
    minFreeDiskMb: int("MIN_FREE_DISK_MB", 5000),
  },

  media: {
    ytdlpPath: str("YTDLP_PATH", "yt-dlp"),
    maxSourceDurationSeconds: int("MAX_SOURCE_DURATION_SECONDS", 14400),
    maxUploadMb: int("MAX_UPLOAD_MB", 2048),
  },

  cleanup: {
    tempOnSuccess: bool("CLEANUP_TEMP_ON_SUCCESS", true),
    sourceRetentionDays: int("SOURCE_RETENTION_DAYS", 7),
    renderRetentionDays: int("RENDER_RETENTION_DAYS", 0),
  },
} as const;

export type Config = typeof config;
