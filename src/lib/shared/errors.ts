/**
 * Every failure the user can see is one of these codes. Each carries a message
 * written for a person, not a developer — internal detail stays in the logs so
 * stack traces never reach the browser.
 */
export type ErrorCode =
  | "INVALID_URL"
  | "VIDEO_UNAVAILABLE"
  | "UNSUPPORTED_MEDIA"
  | "TIMESTAMP_OUT_OF_RANGE"
  | "DOWNLOAD_FAILED"
  | "RENDER_FAILED"
  | "INSUFFICIENT_DISK"
  | "WORKER_UNAVAILABLE"
  | "CANCELLED"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "VALIDATION_FAILED"
  | "UPLOAD_TOO_LARGE"
  | "INTERNAL";

const USER_MESSAGES: Record<ErrorCode, string> = {
  INVALID_URL: "That doesn't look like a YouTube link. Check the URL and try again.",
  VIDEO_UNAVAILABLE:
    "That video can't be accessed. It may be private, age-restricted, region-locked, or removed.",
  UNSUPPORTED_MEDIA: "That file format isn't supported. Try an MP4, MOV, or WebM.",
  TIMESTAMP_OUT_OF_RANGE: "The selected clip falls outside the video's length.",
  DOWNLOAD_FAILED: "The source video couldn't be downloaded. Check your connection and try again.",
  RENDER_FAILED: "The source video could not be processed.",
  INSUFFICIENT_DISK: "Not enough free disk space to render. Free up space and try again.",
  WORKER_UNAVAILABLE: "The render worker isn't running. Start it and try again.",
  CANCELLED: "The render was cancelled.",
  NOT_FOUND: "That item no longer exists.",
  UNAUTHORIZED: "You need to sign in to do that.",
  VALIDATION_FAILED: "Some of the reel settings aren't valid.",
  UPLOAD_TOO_LARGE: "That file is too large to upload.",
  INTERNAL: "Something went wrong on our end. Try again.",
};

const STATUS_CODES: Partial<Record<ErrorCode, number>> = {
  INVALID_URL: 400,
  VIDEO_UNAVAILABLE: 422,
  UNSUPPORTED_MEDIA: 415,
  TIMESTAMP_OUT_OF_RANGE: 400,
  VALIDATION_FAILED: 400,
  UPLOAD_TOO_LARGE: 413,
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  INSUFFICIENT_DISK: 507,
  WORKER_UNAVAILABLE: 503,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  /** Shown to the user. Safe to render verbatim. */
  readonly userMessage: string;
  /** Logged only. May contain paths, command output, and other internals. */
  readonly detail?: string;

  constructor(code: ErrorCode, detail?: string, userMessage?: string) {
    super(userMessage ?? USER_MESSAGES[code]);
    this.name = "AppError";
    this.code = code;
    this.userMessage = userMessage ?? USER_MESSAGES[code];
    this.detail = detail;
  }

  get httpStatus(): number {
    return STATUS_CODES[this.code] ?? 500;
  }

  toJSON() {
    return { error: { code: this.code, message: this.userMessage } };
  }
}

export function userMessageFor(code: ErrorCode): string {
  return USER_MESSAGES[code];
}

/**
 * Narrows any thrown value to an AppError. Unrecognised errors collapse to
 * INTERNAL with their real message preserved in `detail` for the logs.
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error) return new AppError("INTERNAL", error.stack ?? error.message);
  return new AppError("INTERNAL", String(error));
}
