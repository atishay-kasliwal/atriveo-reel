import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

/**
 * Gates every route behind the shared password.
 *
 * Auth is disabled entirely when APP_PASSWORD is empty, which keeps local
 * development frictionless. In production behind the tunnel the password
 * should always be set.
 */

const PUBLIC_PATHS = ["/login", "/api/auth/login"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Auth config lives in the Node runtime; middleware runs on the edge
  // runtime, so read the env var directly rather than importing config.
  const password = process.env.APP_PASSWORD ?? "";
  if (password === "") return NextResponse.next();

  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (verifySessionToken(token)) return NextResponse.next();

  // API callers get a JSON 401; a redirect would be parsed as data.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "You need to sign in to do that." } },
      { status: 401 },
    );
  }

  const loginUrl = new URL("/login", request.url);
  // Preserve where they were headed so login can return them there.
  if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  /*
   * Node runtime, not edge: session verification uses node:crypto's HMAC.
   * Running on the edge runtime would mean reimplementing the same signing
   * in Web Crypto and keeping two implementations in agreement.
   */
  runtime: "nodejs",
  matcher: [
    /*
     * Everything except Next's own assets and the favicon. Media files are
     * served through /api/media, so they stay behind auth.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
