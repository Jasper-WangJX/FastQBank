// Preload runs in an isolated context with access to a minimal Electron
// surface. Phase 4 only needs a capability flag the web app could
// feature-detect on (e.g. to show desktop-only affordances). Phase 5
// will extend this same bridge with OCR / screenshot / global-shortcut
// IPC — keeping the exposed surface tiny now avoids reworking it later.

import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("desktop", {
  isDesktop: true,
});
