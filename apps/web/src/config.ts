// Backend base URL.
// Falls back to local FastAPI during stage-0 development; in production
// this comes from a build-time env var (VITE_API_BASE_URL).
export const API_BASE =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
