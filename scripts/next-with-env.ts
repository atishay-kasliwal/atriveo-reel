/**
 * Starts Next.js on the port from APP_PORT.
 *
 * `next dev -p ${APP_PORT}` doesn't work: the shell expands that variable
 * before Next loads .env.local, so the port would silently fall back to 3000
 * and the Cloudflare Tunnel would point at nothing. Reading the env file here
 * and passing an explicit --port avoids that.
 */

import { spawn } from "node:child_process";

import { loadEnv } from "../src/worker/env";

loadEnv();

const command = process.argv[2] === "dev" ? "dev" : "start";
const port = process.env.APP_PORT ?? "3000";

// Bind to loopback only: the app is reached through the Cloudflare Tunnel,
// so there is no reason to listen on the LAN.
const hostname = process.env.APP_HOSTNAME ?? "127.0.0.1";

const child = spawn(
  "npx",
  ["next", command, "--port", port, "--hostname", hostname],
  { stdio: "inherit", env: process.env },
);

child.on("exit", (code) => process.exit(code ?? 0));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}
