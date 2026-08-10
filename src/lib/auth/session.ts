import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { config } from "../shared/config";

export const SESSION_COOKIE = "reels_session";

/**
 * Stateless signed-cookie sessions.
 *
 * A single shared password gates the app; there are no user accounts, so the
 * cookie only needs to prove "someone knew the password before this expiry".
 * The payload is `expiry.nonce`, signed with HMAC-SHA256.
 */

function secret(): string {
  // Falling back to the password keeps a misconfigured install working, but
  // SESSION_SECRET should be set so rotating one doesn't invalidate the other.
  return config.auth.sessionSecret || config.auth.password;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

export function createSessionToken(): string {
  const expiresAt = Date.now() + config.auth.sessionTtlHours * 60 * 60 * 1000;
  // The nonce makes tokens issued in the same millisecond distinct.
  const payload = `${expiresAt}.${randomBytes(8).toString("hex")}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const [expiresAt, nonce, signature] = parts;
  const expected = sign(`${expiresAt}.${nonce}`);

  // Length check first: timingSafeEqual throws on a length mismatch.
  if (signature.length !== expected.length) return false;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;

  const expiry = Number(expiresAt);
  return Number.isFinite(expiry) && expiry > Date.now();
}

/** Constant-time password comparison, to avoid leaking a prefix match. */
export function verifyPassword(candidate: string): boolean {
  const expected = config.auth.password;
  if (expected === "") return true;

  // Hash both sides so the comparison is over equal-length digests regardless
  // of input length.
  const a = createHmac("sha256", secret()).update(candidate).digest();
  const b = createHmac("sha256", secret()).update(expected).digest();
  return timingSafeEqual(a, b);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: config.auth.sessionTtlHours * 60 * 60,
    // The tunnel terminates TLS, so the browser always sees HTTPS in
    // production. Local development over plain HTTP still needs this off.
    secure: process.env.NODE_ENV === "production",
  };
}
