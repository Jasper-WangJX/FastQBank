// Shared Windows-style window controls (minimize / maximize / close) for
// the frameless Electron shell. Used by the authenticated AppLayout and
// the unauthenticated Login / Register pages so the desktop chrome is
// consistent regardless of which screen the user lands on.
//
// The web build never reaches this — callers conditionally render it
// only when `getDesktop()` returns a bridge.

import { useEffect, useState } from "react";
import { getDesktop } from "../lib/desktop";
import { NO_DRAG_STYLE } from "./windowChrome";

interface Props {
  desktop: NonNullable<ReturnType<typeof getDesktop>>;
}

export default function WindowControls({ desktop }: Props) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    // Seed from the current OS state, then keep it in sync if the user
    // double-clicks the drag area or uses Win+Up / Win+Down.
    let cancelled = false;
    void desktop.window
      .isMaximized()
      .then((m) => {
        if (!cancelled) setMaximized(m);
      })
      .catch(() => {
        /* feature-detect: ignore if the bridge is unexpectedly absent */
      });
    const off = desktop.window.onMaximizedChange((m) => setMaximized(m));
    return () => {
      cancelled = true;
      off();
    };
  }, [desktop]);

  // h-7 matches every icon-button in the surrounding chrome so all
  // controls sit on the same vertical baseline. Wider than tall to
  // follow the Windows convention.
  const btn =
    "inline-flex h-7 w-10 items-center justify-center rounded-sm text-slate-600 transition-colors duration-100 hover:bg-slate-100";
  const closeBtn =
    "inline-flex h-7 w-10 items-center justify-center rounded-sm text-slate-600 transition-colors duration-100 hover:bg-[#E81123] hover:text-white";

  return (
    // py-3 matches the right cluster in AppLayout (and the auth
    // headers), keeping the buttons vertically centered with the rest
    // of the header chrome.
    <div className="flex items-center gap-0 py-3 pr-2" style={NO_DRAG_STYLE}>
      <button
        type="button"
        onClick={() => desktop.window.minimize()}
        title="Minimize"
        aria-label="Minimize"
        className={btn}
      >
        {/* Minimize: single horizontal stroke */}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => desktop.window.maximizeToggle()}
        title={maximized ? "Restore" : "Maximize"}
        aria-label={maximized ? "Restore" : "Maximize"}
        className={btn}
      >
        {maximized ? (
          // Restore: two overlapping squares
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <rect
              x="2.5"
              y="0.5"
              width="7"
              height="7"
              fill="none"
              stroke="currentColor"
            />
            <rect
              x="0.5"
              y="2.5"
              width="7"
              height="7"
              fill="white"
              stroke="currentColor"
            />
          </svg>
        ) : (
          // Maximize: single square outline
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <rect
              x="0.5"
              y="0.5"
              width="9"
              height="9"
              fill="none"
              stroke="currentColor"
            />
          </svg>
        )}
      </button>
      <button
        type="button"
        onClick={() => desktop.window.close()}
        title="Close"
        aria-label="Close"
        className={closeBtn}
      >
        {/* Close: ✕ as two crossing strokes */}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path
            d="M0 0l10 10M10 0L0 10"
            stroke="currentColor"
            strokeWidth="1"
          />
        </svg>
      </button>
    </div>
  );
}
