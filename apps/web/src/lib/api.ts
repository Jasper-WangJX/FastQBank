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

type JsonBody = Record<string, unknown> | unknown[];

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
 *  - throws ApiError on non-2xx, surfacing the backend's `detail`
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

  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }

  // Tolerate empty bodies (e.g. 204) — only parse when there is content.
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
