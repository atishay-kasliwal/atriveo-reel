import { NextResponse } from "next/server";
import { z } from "zod";

import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
  verifyPassword,
} from "@/lib/auth/session";
import { errorResponse } from "@/lib/api/respond";
import { AppError } from "@/lib/shared/errors";

export const runtime = "nodejs";

const bodySchema = z.object({ password: z.string() });

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());

    if (!verifyPassword(body.password)) {
      // Slow down credential guessing a little without a rate-limit store.
      await new Promise((resolve) => setTimeout(resolve, 400));
      throw new AppError(
        "UNAUTHORIZED",
        "Bad password attempt",
        "That password isn't right.",
      );
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, createSessionToken(), sessionCookieOptions());
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
