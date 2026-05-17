// Global hotkey to start a capture. Roadmap flags this as a real risk:
// the preferred combo can be taken by another app. We try a list in
// order and keep the first that actually registers; main reports which
// one won so the UI can show it (and fall back to the in-app button if
// none stick).

import { globalShortcut } from "electron";

// Order matters — most-preferred first.
const CANDIDATES = ["CommandOrControl+Shift+Q", "Alt+Q", "F8"];

let active: string | null = null;

/** Returns the accelerator that registered, or null if all were taken. */
export function registerShortcut(onTrigger: () => void): string | null {
  for (const acc of CANDIDATES) {
    try {
      if (globalShortcut.register(acc, onTrigger) && globalShortcut.isRegistered(acc)) {
        active = acc;
        return acc;
      }
    } catch {
      /* try the next candidate */
    }
  }
  active = null;
  return null;
}

export function unregisterShortcut(): void {
  if (active) {
    globalShortcut.unregister(active);
    active = null;
  }
}
