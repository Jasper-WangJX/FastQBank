import { toast } from "sonner";

import { API_BASE } from "../config";

// Single source of truth for the localStorage key holding the JWT.
const TOKEN_KEY = "aqb_token";

/**
 * Thrown for any non-2xx response. `message` carries the backend's
 * `detail` string (e.g. "email already registered") so pages can show
 * a meaningful error instead of a generic failure.
 */
export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Dispatched on the window when the API returns 401. AuthContext (F2)
 * listens for this to force a logout + redirect to /login, keeping that
 * navigation concern out of this transport layer.
 */
export const UNAUTHORIZED_EVENT = "aqb:unauthorized";

// Centralized user-facing messages. Kept as constants so toast copy
// stays consistent and so a future error-UX pass can find every
// transport-level message in one place.
const NETWORK_ERROR_MSG = "Network error — please check your connection";
const SERVER_ERROR_MSG = "Server error — please try again";

// The body is JSON.stringify'd below, which accepts any serializable
// value, so `unknown` is the precise type. (A narrower object type would
// reject named interfaces — they lack an index signature — forcing casts
// in every typed API wrapper.)
type JsonBody = unknown;

interface RequestOptions {
  method?: string;
  body?: JsonBody;
}

/**
 * Thin fetch wrapper used by every page:
 *  - prefixes API_BASE (from config.ts)
 *  - sends/expects JSON
 *  - interceptor: attaches `Authorization: Bearer <token>` if logged in
 *  - on 401: clears the token and emits UNAUTHORIZED_EVENT
 *  - on network failure (fetch throws): fires a sonner error toast
 *    NETWORK_ERROR_MSG, then re-throws so callers' catch blocks still run
 *  - on 5xx: fires a sonner error toast SERVER_ERROR_MSG (see handleResponse)
 *  - throws ApiError on non-2xx, surfacing the backend's `detail`
 *
 * Note: pages that already render inline error text on caught failures
 * will currently show both the toast AND their inline message — this
 * double-reporting is a known v1.0 caveat to be cleaned up in a later
 * polish pass (pages should drop their generic "Network error" inline
 * text and rely on the toast).
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (err) {
    toast.error(NETWORK_ERROR_MSG);
    throw err;
  }

  return handleResponse<T>(res);
}

/**
 * Shared post-fetch handling for both transports: 401 -> clear token +
 * emit UNAUTHORIZED_EVENT; 5xx -> fire a SERVER_ERROR_MSG toast;
 * parse JSON (tolerating empty 204 bodies); non-2xx -> ApiError carrying
 * the backend's `detail`.
 */
async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }

  if (res.status >= 500) {
    toast.error(SERVER_ERROR_MSG);
  }

  const raw = await res.text();
  const data: unknown = raw ? JSON.parse(raw) : null;

  if (!res.ok) {
    const detail =
      data && typeof data === "object" && "detail" in data
        ? String((data as { detail: unknown }).detail)
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, detail);
  }

  return data as T;
}

/**
 * Multipart sibling of apiFetch for /ai/parse-question (cropped image +
 * OCR text). Deliberately does NOT set Content-Type: the browser must
 * add the multipart boundary itself. Reuses the same auth header, 401
 * interceptor, ApiError contract, and the network/5xx toast side
 * effects (see apiFetch and handleResponse for the toast contract).
 */
export async function apiFetchForm<T = unknown>(
  path: string,
  form: FormData,
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers,
      body: form,
    });
  } catch (err) {
    toast.error(NETWORK_ERROR_MSG);
    throw err;
  }

  return handleResponse<T>(res);
}
