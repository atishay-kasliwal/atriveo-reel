import fs from "node:fs";
import path from "node:path";

/**
 * Loads .env files for the worker process.
 *
 * Next.js does this automatically for the web app, but the worker is a plain
 * Node process — without this it would silently fall back to defaults and
 * write to a different data directory than the web server, which is a
 * genuinely confusing failure.
 *
 * Precedence matches Next's: .env.local overrides .env, and anything already
 * in the real environment wins over both.
 */
export function loadEnv(cwd = process.cwd()): void {
  // Later files take precedence, so load the more general one first.
  for (const filename of [".env", ".env.local"]) {
    const filePath = path.join(cwd, filename);
    if (!fs.existsSync(filePath)) continue;

    for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) continue;

      const separator = trimmed.indexOf("=");
      if (separator === -1) continue;

      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();

      // Strip matching surrounding quotes, keeping any inside the value.
      if (
        (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
        (value.startsWith("'") && value.endsWith("'") && value.length > 1)
      ) {
        value = value.slice(1, -1);
      }

      // An explicitly exported variable beats the file.
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
