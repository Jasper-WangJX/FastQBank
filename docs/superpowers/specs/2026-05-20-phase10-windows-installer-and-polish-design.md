# Phase 10 — Windows Installer + Polish — Design

**Status:** Draft (awaiting user review)
**Date:** 2026-05-20
**Branch (planned):** `phase-10-polish`

Companion documents:
- Plan: `docs/superpowers/plans/2026-05-20-phase10-windows-installer-and-polish.md` (to be written next)
- Roadmap entry: `docs/Roadmap_EN.md` § "Phase 10 — Polish + Windows Installer"

---

## 1. Goal

Deliver the MVP as a Windows `.exe` installer that a non-developer can install and run, plus three small UX/docs items that bring the app to a "shippable v1.0" finish: app icon, global error toasts + offline banner, lightweight first-time empty-state guidance, and a refreshed README.

After this phase, the user can hand the installer to a friend who installs it, signs in, runs the full pipeline (manual entry / OCR / AI / flashcards / share-link / Google sign-in) without further help.

---

## 2. Scope

### In scope (5 Roadmap bullets + 1 Phase 4 carry-over)

1. **NSIS Windows installer** built via electron-builder (replaces the current `target: "dir"` boundary smoke from Phase 4). — *Roadmap bullet 1*
2. **Real app icon** generated from `resources/fastqbICON.png` (resolves the deferral noted in Phase 4 As-built). — *Phase 4 carry-over*
3. **Sidecar packaged-app end-to-end smoke** (handed over from Phase 5): verify that `electron-builder` copies the PyInstaller onedir into `resources/ocr-sidecar`, that the `app.isPackaged` branch of `sidecar.ts` resolves the bundled python exe, that offline screenshot → OCR → save works, and that no `ocr_server.exe` orphan remains after quit. — *Roadmap bullet 2*
4. **Error UX**: a global `sonner` toast for uncaught API failures (network / 5xx), and an offline banner driven by `window.online/offline`. — *Roadmap bullet 3*
5. **Lightweight empty-state onboarding**: when a logged-in user has zero tags and zero questions, the Question Bank page renders an inline guidance card pointing to "create a tag" and "add a question". — *Roadmap bullet 4*
6. **README refresh** + version bump to 1.0.0: rewrite root `README.md` to cover user download path + developer setup + packaging command. — *Roadmap bullet 5*


### Out of scope (YAGNI — deliberately excluded, see Section 9)

- Auto-update (`electron-updater`).
- Code signing (Authenticode); SmartScreen warning on first launch is accepted.
- Crash reporting (Sentry / electron-crash-reporter).
- Telemetry / analytics.
- An end-user manual (`docs/User_Guide_EN.md`) — README is enough for v1.
- Onboarding tracking field on the `users` table — empty-state is data-driven instead.

---

## 3. Architecture overview

```
apps/desktop/
├── assets/
│   ├── icon.ico         ← NEW: multi-resolution ICO (16..256) for installer + exe
│   ├── icon.png         ← NEW: 256×256 PNG (Linux / dev fallback)
│   └── tray.png         ← REGENERATED: 32×32 from real logo (replaces placeholder)
├── scripts/
│   └── gen-icons.cjs    ← REWRITTEN: sharp-based pipeline reading resources/fastqbICON.png
└── package.json         ← UPDATED: build.win.target=nsis, build.nsis config,
                                    version 1.0.0, scripts.dist, sharp devDep

apps/web/src/
├── lib/api.ts           ← UPDATED: apiFetch toasts network/5xx failures
├── components/
│   ├── OfflineBanner.tsx        ← NEW: window.online/offline banner
│   └── onboarding/
│       └── OnboardingEmpty.tsx  ← NEW: empty-state guidance card
├── pages/QuestionsPage.tsx      ← UPDATED: render OnboardingEmpty when tags=0 + questions=0
└── AppLayout.tsx                ← UPDATED: mount <Toaster/> + <OfflineBanner/>

README.md                ← REWRITTEN: user download + developer setup + packaging
```

No backend changes. No database migrations. No new endpoints. Existing Phase 5 sidecar code (`apps/desktop/src/sidecar.ts`) is exercised in the `app.isPackaged` branch for the first time — bugs found during smoke are bug-fix commits, not new features.

---

## 4. Detailed design

### 4.1 App icon pipeline

**Source**: `resources/fastqbICON.png` — 810×810, black "AC" mark with motion lines on white background, user-cropped to square from `fastqbLOGO.png`.

**Generator**: `apps/desktop/scripts/gen-icons.cjs`, replacing the existing pure-zlib placeholder generator (which was a Phase 4 stopgap when there was no real source image).

**Implementation**:
- Add `sharp` to `apps/desktop/devDependencies`.
- `gen-icons.cjs` reads the source PNG, then:
  1. Pipes through `sharp().resize(...)` at sizes [16, 24, 32, 48, 64, 128, 256] → packs into a single `icon.ico` (use `png-to-ico` or `sharp-ico`; pick whichever is simpler — single dependency).
  2. Pipes through `sharp().resize(256)` → `icon.png`.
  3. Pipes through `sharp().resize(32)` → `tray.png`.
- Outputs land in `apps/desktop/assets/`.
- All three artifacts are **committed to the repo** so a fresh clone doesn't have to run sharp to package.

**Trade-off accepted**: the tray icon at 32×32 will lose the motion-line detail and degrade to a dense black blob. This is a logo-design constraint, not solvable in the generator, and acceptable for v1.

**.gitignore**: leave `apps/desktop/assets/` untracked-except-needed; the three generated files are explicitly tracked.

### 4.2 NSIS installer

**Why NSIS over portable**: Roadmap's exit-criteria language is "they install it"; NSIS gives a wizard, Start-menu entry, and a real "Uninstall" entry in Windows Settings. Per-user install avoids UAC elevation.

**`apps/desktop/package.json` `build` section delta**:

```jsonc
"win": {
  "target": "nsis",
  "icon": "assets/icon.ico"
},
"nsis": {
  "oneClick": false,
  "perMachine": false,
  "allowToChangeInstallationDirectory": true,
  "createDesktopShortcut": true,
  "createStartMenuShortcut": true,
  "shortcutName": "FastQBank"
}
```

**`scripts` delta**:
- `pack`: existing `electron-builder --dir` flow renamed from `package` (kept for quick local smoke).
- `dist`: NEW — `pnpm build:sidecar && pnpm build && electron-builder` (no `--dir`) — produces the NSIS installer in `apps/desktop/release/`.

**Produced artifact**: `apps/desktop/release/FastQBank Setup 1.0.0.exe`. Expected size 300–500 MB (PaddleOCR onedir dominates).

**Code signing**: not configured. Users will see Windows SmartScreen "unrecognized app" prompt on first run; clicking "More info → Run anyway" proceeds. Documented in README.

**`.gitignore`**: confirm `apps/desktop/release/` is ignored.

### 4.3 Sidecar packaged-app smoke (handed from Phase 5)

Phase 5's "As-built" notes say: *"The packaged sidecar exe is hard-verified offline ... The full electron-builder packaged-app end-to-end smoke is handed to Phase 10."* This phase pays that off.

This is a **manual checklist**, not a script. The checklist lives in this spec and in the plan; the executor (you) walks through it once on the produced installer and records pass/fail per item.

**Checklist (8 items)**:

1. `pnpm --dir apps/desktop dist` completes with no electron-builder errors.
2. Installer file size is within 300–500 MB.
3. Double-click installer → wizard completes → Desktop shortcut + Start menu entry both present.
4. Launch app **with network off** → app boots to login screen without crash (or, if a cached token rehydrates, to Question Bank with a network-failure toast surfacing once).
5. With network restored, log in. With network off again, trigger screenshot capture (`Ctrl+Shift+Q` or fallback hotkey) → OCR confirm page appears with correctly split stem + options.
6. Quit the app via tray menu → Task Manager → search `ocr_server.exe` → **0 processes**.
7. Settings → Apps → uninstall FastQBank → desktop shortcut and Start menu entry are removed.
8. Reinstall → log in → the user's previous token in AppData is gone (uninstaller cleared it) **OR** retained (uninstaller left it). Either is acceptable; observed behavior gets noted in plan.

**Pass condition**: 8/8.

**Risk areas the smoke specifically targets**:
- `app.isPackaged` branch of `apps/desktop/src/sidecar.ts` (path resolution — has never run before)
- `extraResources` copy of `packages/ocr-sidecar/dist/ocr_server` into `resources/ocr-sidecar` (electron-builder behavior on Windows)
- Child-process lifecycle on app quit (orphan prevention)

If any item fails, the fix happens in `sidecar.ts` / `package.json` and re-runs the affected subset of the checklist; no new feature work.

### 4.4 Global error toasts + offline banner

**Toast library**: `sonner` (~5 KB, headless, shadcn-ecosystem default).

**Mount point**: `apps/web/src/AppLayout.tsx` (already the layout wrapping all authed routes). Add `<Toaster position="top-right" richColors />` near the layout root. Toaster is mounted unconditionally — public pages (login/register/forgot-password) won't use it, but mounting once globally is simpler than per-route.

**`lib/api.ts` `apiFetch` policy**:
- On `fetch` throwing (network failure / DNS / aborted): catch → `toast.error("Network error — please check your connection")` → re-throw so callers still see the error.
- On HTTP 5xx response: `toast.error("Server error — please try again")` → still return the response (or throw) per existing apiFetch contract.
- On HTTP 4xx: no toast — leave to caller (form validation, expected business errors).
- On HTTP 401: existing behavior unchanged (dispatch window event → redirect to login). No toast — the redirect is the feedback.

**Offline banner**: `apps/web/src/components/OfflineBanner.tsx`.
- Subscribes to `window.addEventListener('online' / 'offline', ...)` on mount.
- When offline: renders a yellow strip at the top: `Offline — changes may not save`.
- When online: renders nothing.
- Mounted once in `AppLayout` above `<Outlet />`.

**Trade-offs accepted**:
- No active backend `/health` probe — `navigator.onLine` is enough; on Electron + VPN it can lie, but a real failed request will surface as a toast.
- Existing inline error UI (login error red text, form validation) is unchanged — toasts only cover **uncaught** failures.

### 4.5 Empty-state onboarding

**Trigger condition** (data-driven):
```
QuestionsPage shows OnboardingEmpty
  when: tag list is empty AND question list is empty
        (both already fetched on page mount in existing code)
```

**Why no `users.onboarded_at` field**:
- No new migration, no new schema risk.
- Cross-device consistent (showing on a fresh browser tab is correct).
- If a user deletes everything, getting the guidance again is appropriate behavior, not a bug.

**Component**: `apps/web/src/components/onboarding/OnboardingEmpty.tsx`. Pure presentational, no data fetching.

**Visual** (final wording TBD during implementation, conceptually):

```
┌─────────────────────────────────────────────┐
│  Welcome to FastQBank                       │
│                                             │
│  Your question bank is empty. Two steps     │
│  to get going:                              │
│                                             │
│   1️⃣  Create a tag — in the Tags panel on  │
│       the left                              │
│                                             │
│   2️⃣  Add your first question — Add button │
│       at the top right                      │
│                                             │
│  Or import a shared link via [Import].      │
└─────────────────────────────────────────────┘
```

**Behavior**:
- Rendered inline inside `QuestionsPage` content area, above the (empty) question list.
- No DOM-targeting arrows / highlights — fragile, and the language already names the locations.
- No dismiss button — disappears automatically once tags or questions become non-empty (next refresh / refetch).
- No third-party tour library.

### 4.6 Version + README

**Version bump**:
- `apps/desktop/package.json` → `1.0.0`.
- `apps/web` and `apps/server` versions unchanged (they're decoupled from the desktop release).
- The installer filename `FastQBank Setup 1.0.0.exe` is the user-visible reflection.

**README rewrite** (root `README.md`) — new structure:

1. **Header**: one-line product description, one screenshot of the Question Bank page (PNG in `resources/` or `docs/` — added during implementation).
2. **For users**: "Download `.exe` from the latest GitHub Release, run installer, sign in." Link is `TBD` placeholder during this phase; replaced with a real Release URL when v1.0.0 is cut.
3. **For developers**:
   - Monorepo layout (`apps/{web,server,desktop}`, `packages/ocr-sidecar`).
   - Local dev: `pnpm install` → web `pnpm --dir apps/web dev` → server `uvicorn ...` → `docker compose up postgres`.
   - Environment variables: a short table covering `DATABASE_URL`, `JWT_SECRET`, AI keys, Google OAuth pair, Resend key — referring to `deploy/env.prod.example` as the source of truth.
   - Packaging: `pnpm --dir apps/desktop dist` produces the NSIS installer.
4. **Deployment**: one paragraph linking `deploy/docker-compose.prod.yml`.
5. **Links**: `docs/Roadmap_EN.md`, `docs/Proposal_EN.md`.

**Not included**: end-user manual, contribution guide, API documentation.

---

## 5. Sub-task execution order

```
1. Icons         (~ 0.5 day) — independent, unblocks installer
2. NSIS config   (~ 0.5 day) — local test install
3. Sidecar smoke (~ 0.5 day) — fix any orphan/path issues found
4. Toasts + offline banner (~ 0.5 day) — pure web
5. Onboarding empty-state  (~ 0.5 day) — pure web
6. Version + README        (~ 0.5 day) — finish
```

Each is a separate commit on `phase-10-polish`. Steps 4 and 5 are independent of 1–3 and can be done in any order; recommended order keeps frontend-vs-desktop context-switches minimized.

---

## 6. Exit criteria

The phase is complete when **all** of the following hold:

- `pnpm --dir apps/desktop dist` produces `FastQBank Setup 1.0.0.exe` in `apps/desktop/release/` with size 300–500 MB.
- Installer installs cleanly to a fresh Windows machine (or a clean user profile on the dev box).
- Section 4.3's 8-item sidecar smoke checklist all PASS.
- A fresh logged-in account on the desktop app shows the empty-state onboarding card; after creating one tag and one question, the card disappears on next refresh.
- With network off, the yellow offline banner appears in the AppLayout; with network on, it disappears.
- Triggering any failed request (5xx or network) surfaces a `sonner` toast in the top-right.
- Root `README.md` includes the user-download section, developer setup, and `pnpm dist` packaging command; the Roadmap link still works.
- Full end-to-end smoke through the **installed** app: manual entry, OCR capture, AI suggest-tags, flashcard drill, share-link create+import, Google sign-in, forgot-password, settings → reset password, settings → delete account.
- Tray icon visible; close-to-tray + tray menu open/quit work; second-launch focuses the running window (carry-over from Phase 4).
- App version `1.0.0` reflected in installer name, `package.json`, and any About surface (if present).

---

## 7. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Installer first-run blocked by Windows SmartScreen | High | Documented in README; user clicks "More info → Run anyway". Not solvable without code signing (out of scope). |
| Sidecar packaged-path branch (`app.isPackaged`) has a bug never exercised before | Medium | Section 4.3 smoke runs it explicitly; fixes happen during this phase. |
| Sharp `sharp` binary doesn't install on Windows under pnpm | Low | `apps/desktop/.npmrc` already has `verify-deps-before-run=false` from Phase 4; sharp has pre-built binaries for win32-x64. Fallback: `png-to-ico` (pure JS) for ICO assembly, sharp only for resize. |
| Installer size exceeds 500 MB (rejected by GitHub Release file size limits? — no, GitHub allows up to 2 GB per file) | Low | None needed; documented as expected. |
| `sonner` conflicts with existing Tailwind config | Low | Sonner is headless; uses inline styles. Tested during step 4. |
| Tray icon at 32×32 looks like a black blob | Accepted | Trade-off acknowledged in 4.1. Real fix would be a separate simplified tray-mark, out of scope for v1. |

---

## 8. Testing strategy

This phase has minimal automated test additions because every deliverable is either build-config, UI presentation, or manual smoke:

- **Icon pipeline**: no test; regenerate locally, eyeball the output.
- **NSIS installer**: no test; manual install on dev box.
- **Sidecar smoke**: manual checklist (Section 4.3).
- **Toasts + offline banner**: no test; trigger network failures in dev and observe.
- **Empty-state onboarding**: a `vitest` unit test asserting `<OnboardingEmpty>` renders when given `tags=[]` and `questions=[]`, and does **not** render when either is non-empty.
- **README**: no test; lint markdown by reading.

The existing `apps/web` `vitest` suite must still pass green; the existing `scripts/verify_review.py` and `scripts/verify_phase9.py` must still pass green.

---

## 9. What's deliberately excluded and why

- **Auto-update (`electron-updater`)**: needs a host (GitHub Releases or self-hosted) + version-check logic + UI for "update available". User confirmed: not a one-way door — can be added as a Phase 12 increment without retracting any Phase 10 work.
- **Code signing**: requires an OV/EV certificate (paid annually). SmartScreen warning on first launch is a tolerable v1 friction for a friends-and-family release.
- **Crash reporter**: requires either a hosted Sentry or running our own server endpoint. Premature for a single-developer MVP.
- **Telemetry**: same. Also at odds with the "personal project, cost-conscious" stance from Phase 6.
- **End-user manual**: README's "For users" section is enough; if users hit specific friction, write targeted docs from real questions, not anticipated ones.
- **`users.onboarded_at` field**: empty-state trigger is data-driven (Section 4.5). One fewer migration, one fewer schema invariant to maintain.

---

## 10. Hand-off

After this spec is approved by the user, the next step is to invoke the `superpowers:writing-plans` skill to produce a step-by-step implementation plan at `docs/superpowers/plans/2026-05-20-phase10-windows-installer-and-polish.md`.
