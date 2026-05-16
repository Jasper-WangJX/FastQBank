import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError, apiFetch } from "../lib/api";

interface TokenOut {
  access_token: string;
  token_type: string;
}

export default function RegisterPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Register returns a token too (auto-login), so we land logged-in
      // in one step — same flow as login from here on.
      const data = await apiFetch<TokenOut>("/auth/register", {
        method: "POST",
        body: { email, password },
      });
      login(data.access_token);
      navigate("/", { replace: true });
    } catch (err) {
      // e.g. 409 "email already registered" or 422 password too short.
      setError(err instanceof ApiError ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <form
        onSubmit={onSubmit}
        className="w-[420px] rounded-xl border border-gray-200 bg-white px-6 py-5 shadow-sm"
      >
        <h1 className="text-lg font-semibold">AI Question Bank</h1>
        <p className="mt-1 text-sm text-gray-500">Create an account</p>

        {error && (
          <div className="mt-4 rounded-md border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <label className="mt-4 block text-sm font-medium text-gray-700">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
        </label>

        <label className="mt-3 block text-sm font-medium text-gray-700">
          Password
          <input
            type="password"
            required
            minLength={8}
            maxLength={72}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          <span className="mt-1 block text-xs font-normal text-gray-400">
            8–72 characters
          </span>
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="mt-5 w-full rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create account"}
        </button>

        <p className="mt-4 text-sm text-gray-500">
          Already have an account?{" "}
          <Link to="/login" className="text-slate-800 underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
