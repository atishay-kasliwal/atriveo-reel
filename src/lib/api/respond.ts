import { NextResponse } from "next/server";

import { toAppError } from "../shared/errors";

/**
 * Turns any thrown value into a safe JSON error response.
 *
 * Internal detail is logged and never sent to the browser: the client only
 * receives a stable code and a message written for a person.
 */
export function errorResponse(error: unknown): NextResponse {
  const appError = toAppError(error);

  if (appError.httpStatus >= 500) {
    console.error(`[api] ${appError.code}: ${appError.detail ?? appError.message}`);
  } else {
    console.warn(`[api] ${appError.code}: ${appError.detail ?? appError.message}`);
  }

  return NextResponse.json(appError.toJSON(), { status: appError.httpStatus });
}

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}
