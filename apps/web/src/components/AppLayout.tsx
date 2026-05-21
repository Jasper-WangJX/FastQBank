// Authenticated app shell — "Sapphire Console" visual language.
// Top tab bar with FastQBank wordmark + command-bar trigger,
// CRT-style scan line behind content, sticky mono status footer.
// Child routes render into <Outlet/>. OCR wiring is unchanged.

import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Camera,
  Settings,
  LogOut,
  Plus,
  RefreshCw,
  Library,
  Circle,
} from "lucide-react";
import { Toaster } from "sonner";
import { useAuth } from "../auth/AuthContext";
import { getDesktop } from "../lib/desktop";
import { splitQuestion } from "../lib/ocr/splitter";
import WindowControls from "./WindowControls";
import SettingsModal from "./settings/SettingsModal";
import { DRAG_STYLE, NO_DRAG_STYLE } from "./windowChrome";
import OfflineBanner from "./OfflineBanner";

const BUILD_TAG = "v1.0.1";

function tabClass({ isActive }: { isActive: boolean }) {
  // Rectangular VSCode-style tab — sharp 2px corners, sapphire-800 top
  // border on the active one, subtle slate-50 fill, hairline left divider.
  return [
    "relative inline-flex items-center gap-2 border-l border-slate-200 px-4 py-3 text-sm font-medium transition-colors duration-150",
    "first:border-l-0",
    isActive
      ? "bg-slate-50 text-slate-900 before:absolute before:inset-x-0 before:top-0 before:h-[2px] before:bg-[#1E3A8A]"
      : "text-slate-600 hover:text-slate-900 hover:bg-slate-50/60",
  ].join(" ");
}

export default function AppLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  // Clock in the status bar — refreshed each minute, monospace.
  const [now, setNow] = useState(() => new Date());
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Resolve the Electron bridge once per render. Undefined in the
  // browser; truthy inside the desktop shell — drives both the OCR
  // wiring and the custom titlebar (drag region + window controls).
  const desktop = getDesktop();

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

  // Tick the status-bar clock once per minute (cheap; no setInterval drift
  // worries at this granularity).
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const clock = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div className="relative min-h-dvh bg-white text-slate-900">
      {/* Vertical guide-line texture: 1px sapphire lines every 96px at
          ~6% opacity. Pure CSS, no DOM cost. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(11,59,140,0.06) 1px, transparent 1px)",
          backgroundSize: "96px 100%",
        }}
      />
      {/* CRT-style sweep line — single 1px sapphire line drifting top→bottom
          over 18s. Respects prefers-reduced-motion via global keyframes. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-0 h-px bg-[#60A5FA]/40 motion-reduce:hidden"
        style={{
          animation: "fqb-sweep 18s linear infinite",
        }}
      />

      {/* Inline keyframes — global stylesheet stays untouched. */}
      <style>{`
        @keyframes fqb-sweep {
          0% { transform: translateY(0vh); opacity: 0; }
          8% { opacity: 0.5; }
          92% { opacity: 0.5; }
          100% { transform: translateY(100vh); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="fqb-sweep"] { animation: none !important; }
        }
        @keyframes fqb-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        @keyframes fqb-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      {/*
        Header. In the Electron shell `frame: false` is set, so this strip
        doubles as the OS-level drag region (-webkit-app-region: drag).
        Interactive children opt out via NO_DRAG_STYLE.
        `sticky top-0 z-20` keeps the bar pinned while the page scrolls;
        z-20 matches the status footer and stays below drawers (z-30)
        and modals (z-50) so they cleanly cover it when open.
      */}
      <header
        className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur-sm"
        style={desktop ? DRAG_STYLE : undefined}
      >
        {/* On desktop the header strip spans the full window so the
            window controls hug the right edge (Windows convention).
            In the browser we keep the same flush layout — content
            below still uses `max-w-5xl` to stay readable. */}
        <div className="flex items-stretch gap-0 pl-4">
          {/* Brand cluster */}
          <div className="flex items-center gap-2 py-3 pr-4">
            <img
              src="/fastqb-logo.png"
              alt=""
              // 28x28 (h-7) matches the icon-button height in the right
              // cluster so the brand sits on the same visual baseline.
              // `object-contain` keeps the LOGO centered inside its box
              // even when the source PNG has whitespace around it.
              className="h-7 w-7 shrink-0 select-none rounded-sm object-contain"
              draggable={false}
            />
            <span className="font-semibold tracking-tight text-slate-900">
              FastQBank
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">
              {BUILD_TAG}
            </span>
          </div>

          {/* Rectangular tabs — IDE-style */}
          <nav
            className="flex items-stretch border-l border-slate-200"
            style={desktop ? NO_DRAG_STYLE : undefined}
          >
            <NavLink to="/questions" end className={tabClass}>
              <Library size={14} strokeWidth={1.5} />
              Question Bank
            </NavLink>
            <NavLink to="/questions/new" className={tabClass}>
              <Plus size={14} strokeWidth={1.5} />
              New
            </NavLink>
            <NavLink to="/review" className={tabClass}>
              <RefreshCw size={14} strokeWidth={1.5} />
              Review
            </NavLink>
          </nav>

          {/* Right cluster: OCR (if desktop), help, logout */}
          <div
            className="ml-auto flex items-center gap-2 py-3 pl-4 pr-4"
            style={desktop ? NO_DRAG_STYLE : undefined}
          >
            {desktop && (
              <button
                type="button"
                onClick={() => desktop.ocr.trigger()}
                title="Screenshot a question on screen and import it via OCR. Global shortcut: Ctrl+Shift+Q (falls back to Alt+Q or F8 if the first combo is taken by another app)."
                className="inline-flex items-center gap-1.5 rounded-sm border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 transition-colors duration-150 hover:border-[#1E3A8A] hover:text-[#1E3A8A]"
              >
                <Camera size={14} strokeWidth={1.5} />
                OCR
                <span
                  aria-hidden
                  className="ml-0.5 hidden font-mono text-[10px] uppercase tracking-[0.08em] text-slate-400 sm:inline"
                >
                  Ctrl+Shift+Q
                </span>
              </button>
            )}
            <button
              type="button"
              title="Settings"
              aria-label="Settings"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-slate-200 text-slate-500 transition-colors duration-150 hover:border-[#1E3A8A] hover:text-[#1E3A8A]"
            >
              <Settings size={14} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onClick={onLogout}
              title="Log out"
              aria-label="Log out"
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-slate-200 text-slate-500 transition-colors duration-150 hover:border-[#1E3A8A] hover:text-[#1E3A8A]"
            >
              <LogOut size={14} strokeWidth={1.5} />
            </button>
          </div>

          {/* Desktop-only Windows-style window controls (min / max / close).
              Sit flush-right against the viewport edge — the surrounding
              page is `max-w-5xl`, but these controls live OUTSIDE that
              column so they hug the actual window's edge. */}
          {desktop && <WindowControls desktop={desktop} />}
        </div>
      </header>

      <OfflineBanner />

      {ocrBusy && (
        <div className="relative border-b border-[#DBEAFE] bg-[#EFF6FF] px-4 py-2 text-center font-mono text-xs text-[#1E3A8A]">
          [ OCR ] · Recognizing screenshot…
        </div>
      )}
      {ocrError && (
        <div className="relative flex items-center justify-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2 font-mono text-xs text-red-700">
          <span>[ OCR ] · {ocrError}</span>
          <button
            type="button"
            onClick={() => setOcrError(null)}
            className="rounded-sm border border-red-300 px-2 py-0.5 text-[11px] hover:bg-red-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* No z-index here on purpose — assigning one would create a stacking
          context that traps drawers/modals (z-30) below the z-20 footer. */}
      <main className="relative mx-auto max-w-5xl px-4 py-6 pb-16">
        <Outlet />
      </main>

      {/* Sticky mono status bar — the signature element. Kept at z-20 so
          page-level drawers/modals (z-30+) cleanly cover it when open. */}
      <footer
        className="fixed inset-x-0 bottom-0 z-20 flex h-7 items-center gap-4 border-t border-[#1E40AF] bg-[#1E3A8A] px-4 font-mono text-[11px] text-white/90"
        role="contentinfo"
      >
        <span className="flex items-center gap-1.5">
          <Circle
            size={8}
            strokeWidth={0}
            fill="currentColor"
            className="text-[#60A5FA]"
            style={{ animation: "fqb-pulse 1.6s ease-in-out infinite" }}
          />
          READY
        </span>
        <span className="ml-auto flex items-center gap-3">
          <span className="hidden md:inline">sync {clock}</span>
          <span className="text-white/60">FastQBank · {BUILD_TAG}</span>
        </span>
      </footer>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Toaster position="top-right" richColors closeButton />
    </div>
  );
}
