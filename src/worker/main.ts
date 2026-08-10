/**
 * Render worker process.
 *
 * Runs separately from the Next.js server so a long FFmpeg render can never
 * block an HTTP request. The two processes share state only through the
 * SQLite database and the data directory — the worker listens on no port and
 * is never exposed through the Cloudflare Tunnel.
 */

import { loadEnv } from "./env";

// Must run before anything that reads config: the config module snapshots
// process.env when it is first imported, so every other import is deferred
// into main() below rather than hoisted to the top of the file.
loadEnv();

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

async function main() {
  const { config } = await import("../lib/shared/config");
  const { getDb, closeDb } = await import("../lib/db");
  const { storage } = await import("../lib/storage/local");
  const { RenderQueue } = await import("../lib/queue/queue");
  const { localWorker } = await import("../lib/renderer/local-worker");
  const { warmTextCardBundle } = await import("../lib/renderer/textcard");
  const { runCleanup } = await import("../lib/storage/cleanup");

  console.log("[worker] starting");
  console.log(`[worker] data dir: ${config.storage.dataDir}`);
  console.log(`[worker] encoder: ${config.render.encoder} @ ${config.render.quality}`);
  console.log(`[worker] max concurrent renders: ${config.render.maxConcurrent}`);

  await storage.init();
  getDb();

  const health = await localWorker.healthCheck();
  if (!health.healthy) {
    // Not fatal: disk may be freed while the worker runs, and the queue
    // re-checks before each job.
    console.warn(`[worker] health check: ${health.reason}`);
  }

  // Bundle Remotion up front so the first text card doesn't pay for it.
  void warmTextCardBundle().then((ok) => {
    console.log(
      ok
        ? "[worker] Remotion ready for text cards"
        : "[worker] Remotion unavailable; text falls back to FFmpeg drawtext",
    );
  });

  const queue = new RenderQueue(localWorker);
  queue.start();

  const cleanupTimer = setInterval(() => {
    runCleanup().catch((error) => {
      console.error("[worker] cleanup failed:", error);
    });
  }, CLEANUP_INTERVAL_MS);

  // Run once at startup to clear anything left by a previous crash.
  runCleanup().catch((error) => console.error("[worker] initial cleanup failed:", error));

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`[worker] ${signal} received, finishing up`);
    clearInterval(cleanupTimer);
    await queue.stop();
    closeDb();
    console.log("[worker] stopped");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  process.on("uncaughtException", (error) => {
    console.error("[worker] uncaught exception:", error);
    void shutdown("uncaughtException");
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[worker] unhandled rejection:", reason);
  });

  console.log("[worker] ready, waiting for jobs");
}

main().catch((error) => {
  console.error("[worker] fatal:", error);
  process.exit(1);
});
