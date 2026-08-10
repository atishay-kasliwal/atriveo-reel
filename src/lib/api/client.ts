import type { MediaSource, Reel, RenderJob, RenderStatus } from "../shared/types";
import type { ReelDocument } from "../shared/reel";

/** Error shape every API route returns on failure. */
export interface ApiErrorBody {
  error: { code: string; message: string };
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...init?.headers,
      },
    });
  } catch {
    // A network-level failure has no response body to read.
    throw new ApiError("NETWORK", "Couldn't reach the server. Check your connection.", 0);
  }

  if (!response.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // Non-JSON error page; fall through to the generic message.
    }
    throw new ApiError(
      body?.error.code ?? "INTERNAL",
      body?.error.message ?? "Something went wrong. Try again.",
      response.status,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  login: (password: string) =>
    request<{ ok: true }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),

  addSource: (url: string, projectId?: string) =>
    request<MediaSource>("/api/sources", {
      method: "POST",
      body: JSON.stringify({ url, projectId }),
    }),

  uploadSource: (file: File, projectId?: string) => {
    const formData = new FormData();
    formData.append("file", file);
    if (projectId) formData.append("projectId", projectId);
    return request<MediaSource>("/api/sources/upload", {
      method: "POST",
      body: formData,
    });
  },

  createReel: (document: ReelDocument, title?: string, projectId?: string) =>
    request<Reel>("/api/reels", {
      method: "POST",
      body: JSON.stringify({ document, title, projectId }),
    }),

  startRender: (reelId: string) =>
    request<RenderJob>("/api/renders", {
      method: "POST",
      body: JSON.stringify({ reelId }),
    }),

  getJob: (id: string) => request<JobStatus>(`/api/renders/${id}`),

  cancelJob: (id: string) =>
    request<{ ok: true }>(`/api/renders/${id}`, { method: "DELETE" }),
};

export interface JobStatus {
  id: string;
  status: RenderStatus;
  progress: number;
  estimatedRemainingSeconds?: number;
  queuePosition: number;
  stageLabel: string;
  stageDetail: string | null;
  error?: string;
  errorCode?: string;
  output: {
    durationSeconds: number;
    sizeBytes: number;
    downloadUrl: string;
  } | null;
}
