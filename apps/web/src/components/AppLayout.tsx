// Authenticated app shell: top nav + logout, renders the matched child
// route via <Outlet/>. Mounted once under RequireAuth in App.tsx so the
// stage-2 pages share one chrome (and one place for the logout action).
//
// It also owns the desktop OCR wiring: while running in the Electron
// shell it listens for capture results, splits them, and routes to the
// prefilled confirm form. In a plain browser the bridge is absent so
// this is entirely inert.

import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { getDesktop } from "../lib/desktop";
import { splitQuestion } from "../lib/ocr/splitter";

const linkBase = "rounded-md px-3 py-1.5 text-sm font-medium";

function navClass({ isActive }: { isActive: boolean }) {
  return isActive
    ? `${linkBase} bg-slate-800 text-white`
    : `${linkBase} text-gray-600 hover:bg-gray-100`;
}

export default function AppLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);

  // Clear the token and bounce to login.
  function onLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  useEffect(() => {
    const desktop = getDesktop();
    if (!desktop) return;

    const offResult = desktop.ocr.onResult((r) => {
      const draft = splitQuestion(r.lines.map((l) => l.text));
      setOcrError(null);
      navigate("/questions/new", {
        state: {
          ocrPrefill: {
            stem: draft.stem,
            type: draft.type,
            options: draft.options,
            matched: draft.matched,
            // Carried for the confirm form's "Improve with AI" button
            // (stage-6 vision fallback): original crop + raw OCR text.
            imageB64: r.image_b64,
            ocrText: r.lines.map((l) => l.text).join("\n"),
          },
        },
      });
    });
    const offError = desktop.ocr.onError((e) => setOcrError(e.error));
    const offBusy = desktop.ocr.onBusy((busy) => {
      setOcrBusy(busy);
      if (busy) setOcrError(null);
    });

    return () => {
      offResult();
      offError();
      offBusy();
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
          <span className="mr-3 text-sm font-semibold">
            AI Question Bank
          </span>
          <nav className="flex items-center gap-1">
            {/* `end` so it isn't kept active on /questions/new. */}
            <NavLink to="/questions" end className={navClass}>
              Question Bank
            </NavLink>
            <NavLink to="/questions/new" className={navClass}>
              New Question
            </NavLink>
            <NavLink to="/review" className={navClass}>
              Review
            </NavLink>
          </nav>
          <button
            onClick={onLogout}
            className="ml-auto rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
          >
            Log out
          </button>
        </div>
      </header>

      {ocrBusy && (
        <div className="border-b border-sky-200 bg-sky-50 px-4 py-2 text-center text-sm text-sky-700">
          Recognizing screenshot…
        </div>
      )}
      {ocrError && (
        <div className="flex items-center justify-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          <span>OCR: {ocrError}</span>
          <button
            onClick={() => setOcrError(null)}
            className="rounded border border-red-300 px-2 py-0.5 text-xs hover:bg-red-100"
          >
            Dismiss
          </button>
        </div>
      )}

      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
