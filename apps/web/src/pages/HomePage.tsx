import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError, apiFetch } from "../lib/api";

interface Me {
  id: string;
  email: string;
  created_at: string;
}

export default function HomePage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Guard against React 19 StrictMode double-invoke in dev (same
    // pattern as HealthCheck.tsx).
    let cancelled = false;
    apiFetch<Me>("/me")
      .then((me) => {
        if (!cancelled) setEmail(me.email);
      })
      .catch((err: unknown) => {
        // A 401 here is already handled by api.ts (token cleared +
        // event) → AuthContext → redirect to /login. This catch only
        // surfaces other failures (e.g. backend down).
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Network error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function onLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-[420px] rounded-xl border border-gray-200 bg-white px-6 py-5 shadow-sm">
        <h1 className="text-lg font-semibold">AI Question Bank</h1>
        <p className="mt-1 text-sm text-gray-500">Stage 1 — authenticated</p>

        {error ? (
          <div className="mt-4 rounded-md border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : (
          <p className="mt-4 text-sm text-gray-700">
            Logged in as{" "}
            <span className="font-medium">{email ?? "…"}</span>
          </p>
        )}

        <button
          onClick={onLogout}
          className="mt-5 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50"
        >
          Log out
        </button>
      </div>
    </div>
  );
}
