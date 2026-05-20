import { useEffect, useState } from "react";
import { API_BASE } from "../config";

type Status = "loading" | "ok" | "error";

/**
 * Stage-0 integration probe: on mount, calls the backend `/health`
 * endpoint and shows whether the front-end ↔ back-end link works.
 * A red "error" state is expected until the FastAPI server is running.
 */
export default function HealthCheck() {
  const [status, setStatus] = useState<Status>("loading");
  const [detail, setDetail] = useState<string>("");

  useEffect(() => {
    // Guard against React 19 StrictMode double-invoke in dev.
    let cancelled = false;

    fetch(`${API_BASE}/health`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setStatus("ok");
          setDetail(JSON.stringify(data));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setStatus("error");
          setDetail(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const styles: Record<Status, string> = {
    loading: "bg-gray-100 text-gray-600 border-gray-300",
    ok: "bg-green-50 text-green-700 border-green-400",
    error: "bg-red-50 text-red-700 border-red-400",
  };

  const label: Record<Status, string> = {
    loading: "Checking backend…",
    ok: "Backend connected",
    error: "Backend unreachable",
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div
        className={`rounded-xl border px-6 py-5 shadow-sm w-[420px] ${styles[status]}`}
      >
        <h1 className="text-lg font-semibold">FastQBank</h1>
        <p className="mt-1 text-sm opacity-80">Stage 0 — health check</p>

        <div className="mt-4 flex items-center gap-2">
          <span
            className={`inline-block h-3 w-3 rounded-full ${
              status === "ok"
                ? "bg-green-500"
                : status === "error"
                  ? "bg-red-500"
                  : "bg-gray-400 animate-pulse"
            }`}
          />
          <span className="font-medium">{label[status]}</span>
        </div>

        <p className="mt-3 text-xs font-mono break-all opacity-70">
          {API_BASE}/health
          {detail && <> → {detail}</>}
        </p>
      </div>
    </div>
  );
}
