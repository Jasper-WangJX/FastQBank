# macOS In-App OCR Black-Flash — Diagnostic + H2 Defensive Fix

Date: 2026-05-22
Status: Draft (pending implementation)

Follow-up to the macOS sidecar port already staged on this worktree (B2
in `~/.claude/handoffs/FastQBank-MAC-BUILD-HANDOFF.md`). The
PyInstaller-frozen sidecar and `engine_vision.py` (Apple Vision) work
end-to-end when POSTed directly. What still fails is the **in-app
capture flow**: pressing `⌘⇧Q` flashes a black overlay for ~1 frame and
returns nothing, even after the user has granted Screen Recording in
System Settings → Privacy & Security and restarted the app.

The full hypothesis list and the symptoms are described in
`~/.claude/handoffs/FastQBank-OCR-IN-APP-PROBLEM.md`. This spec covers
the **next diagnostic round**, not the eventual final fix — we don't
yet have enough evidence to know which hypothesis is the real cause.

## 1. Goals

1. **One rebuild yields decisive evidence** for which hypothesis is the
   actual cause (H1 ad-hoc-signature TCC instability / H2 overlay
   `blur→finish(null)` race / H3 macOS 26.4 `desktopCapturer`
   regression / H4 silently-swallowed error).
2. **Defensively fix H2 in the same rebuild.** Even if H2 is not
   today's cause, `win.on("blur", () => finish(null))` on macOS is a
   known footgun (system animations, dock-icon swap, ScreenCaptureKit
   picker UI can all transiently steal focus from a freshly-shown
   overlay), and removing it cannot break the cancel path because Esc
   and IPC-cancel already cover user-initiated cancellation.
3. **Persistent, double-click-friendly log delivery.** The user
   typically launches the .app by double-clicking, where stderr goes
   nowhere visible. Logs must land somewhere the user can `cat` and
   send back without needing to remember a launch incantation.

## 2. Scope and non-goals

In scope:
- New `apps/desktop/src/debug-log.ts` helper module.
- Instrumentation of `captureAndRecognize` in `apps/desktop/src/main.ts`
  with `getMediaAccessStatus`, stage markers, and a one-shot
  thumbnail dump.
- Instrumentation of `apps/desktop/src/overlay.ts` and the H2
  platform-branch on `win.on("blur", ...)`.
- A written verification protocol the user follows after the rebuild.

Out of scope (deferred until diagnostic evidence is in):
- The actual targeted fix for whichever of H1 / H3 turns out to be the
  cause. H1 may require switching from ad-hoc to a self-signed
  Keychain identity (stable cdhash); H3 may require a `desktopCapturer`
  call-site adjustment. We do **not** speculatively implement either.
- Touching `apps/desktop/src/capture.ts`. It is shared with Windows
  and works there; the thumbnail dump is done in the main.ts caller
  to keep capture.ts platform-clean.
- Committing the previously-staged B2 sidecar files
  (`engine_vision.py`, `ocr_sidecar_mac.spec`, `requirements-mac.txt`,
  etc.). They are unrelated to today's bug; they get bundled into the
  same commit at the end only because they're already staged.
- Changing anything in `engine_paddle.py` / the original
  `ocr_sidecar.spec` / Windows codepaths.

## 3. Component design

### 3.1 `apps/desktop/src/debug-log.ts` (new, ~20 LOC)

Single export: `dlog(area: string, msg: string, fields?: Record<string, unknown>): void`.

Behavior:
- On `process.platform === "darwin"`: append one NDJSON line to
  `path.join(app.getPath("logs"), "ocr-debug.log")` using
  `fs.appendFileSync` (synchronous, so a crash doesn't drop the line
  immediately preceding it).
- On all other platforms: no-op. This keeps Windows behavior bit-exact.
- Line shape: `{"t":"2026-05-22T...","area":"capture","msg":"trigger","fields":{...}}\n`.
- The log directory is created lazily on first call (the parent
  `~/Library/Logs/FastQBank/` is created by Electron itself on first
  `getPath("logs")`, but we use `fs.mkdirSync(..., { recursive: true })`
  as a belt-and-braces because the spec also writes a sibling PNG
  (§3.2) before `dlog` may run).

### 3.2 `apps/desktop/src/main.ts` — instrumentation

Additions only; nothing removed.

- New imports at top: add `systemPreferences` to the existing
  `electron` import; add `writeFileSync` to the existing
  `import { promises as fsp, statSync } from "node:fs";` (becoming
  `import { promises as fsp, statSync, writeFileSync } from "node:fs";`);
  new line `import { dlog } from "./debug-log";`.
- Inside `captureAndRecognize`, just after the `capturing = true` line:
  ```ts
  dlog("capture", "trigger", {
    sidecar: st,
    screenPerm: systemPreferences.getMediaAccessStatus("screen"),
  });
  ```
- After `const { display, thumbnail } = await grabScreen();`:
  ```ts
  dlog("capture", "grab ok", {
    displayId: display.id,
    scale: display.scaleFactor,
    bounds: display.bounds,
    bitmap: thumbnail.getSize(),
  });
  if (process.platform === "darwin") {
    const thumbPath = path.join(app.getPath("logs"), "last-thumb.png");
    try {
      writeFileSync(thumbPath, thumbnail.toPNG());
      dlog("capture", "thumb dumped", { thumbPath });
    } catch (e) {
      dlog("capture", "thumb dump failed", {
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }
  ```
- Around `captureRegion(...)`: `dlog("capture", "overlay before")`
  before, `dlog("capture", "overlay after", { rect })` after.
- Around `ocrImage(png)`: `dlog("capture", "ocr before", { bytes: png.length })`
  before, `dlog("capture", "ocr after", { engine: result.engine, lines: result.lines.length, elapsed: result.elapsed_ms })` after.
- In the `catch (err)` branch: `dlog("capture", "error", { err: ... })`.

Total additions: ~12 lines of instrumentation + 3 imports. No behavior
change in the happy path beyond the synchronous file writes (file is
small, one-per-frame).

### 3.3 `apps/desktop/src/overlay.ts` — H2 fix + instrumentation

New import: `dlog` from `./debug-log`.

Event instrumentation (each is one line, all inside `captureRegion`):
- After the `setBounds`/`setMinimumSize` block, log
  `dlog("overlay", "constructed", { bounds: b, scale: opts.scaleFactor })`.
- Inside `onReady`, `onRegion`, `onCancel`, `did-finish-load`, `closed`
  handlers, prepend a `dlog("overlay", "<event>", {...})` line.

H2 fix — replace the current line 109:
```ts
win.on("blur", () => finish(null));
```
with a platform branch:
```ts
if (process.platform !== "darwin") {
  win.on("blur", () => {
    dlog("overlay", "blur -> finish(null)");
    finish(null);
  });
} else {
  // macOS: a stray focus loss right after show() (system overlay
  // animations, dock icon swap, ScreenCaptureKit picker) used to
  // instantly close the overlay before the user could draw. Esc and
  // IPC cancel are sufficient on this platform.
  win.on("blur", () => dlog("overlay", "blur (ignored on darwin)"));
}
```

`win.on("closed", () => finish(null))` is kept on all platforms — it's
the bottom-of-stack guarantee that `finish` resolves if the overlay
window is destroyed for any reason.

### 3.4 No changes elsewhere

- `apps/desktop/src/capture.ts` — unchanged. The thumbnail dump lives
  in main.ts so capture.ts stays a pure, platform-agnostic helper.
- `apps/desktop/src/sidecar.ts` — unchanged. Sidecar lifecycle is
  proven OK by direct POST tests; instrumenting it would only add
  noise to this diagnostic round.

## 4. Diagnostic decision table

After the user reproduces the issue once and reports
`~/Library/Logs/FastQBank/ocr-debug.log` + `last-thumb.png`:

| Observation                                              | Conclusion           | Next step                                                              |
|----------------------------------------------------------|----------------------|------------------------------------------------------------------------|
| `screenPerm: "denied"` or `"not-determined"`             | **H1 hard**          | Move to stable signing identity (self-signed Keychain cert or Dev ID). |
| `screenPerm: "granted"`, `last-thumb.png` is fully black | **H1 soft** (TCC record exists but is bound to a stale cdhash) | Same as H1 hard. |
| `screenPerm: "granted"`, thumb is the real desktop, log shows `overlay blur (ignored on darwin)` then `region` arrives | **H2 was real, fix worked** | Stop. Just clean up logs (keep them or env-gate them). |
| `screenPerm: "granted"`, thumb is real, but `overlay constructed` is followed only by `closed` or by no events at all | overlay renderer never painted (likely `app://aqb/?overlay=1` SPA-fallback misfire) | Investigate the `?overlay=1` branch in `apps/web/src/main.tsx`. |
| Log stops mid-stage with no `error` entry                | **H4** (Promise rejected without going through the catch — unlikely but possible) | Add try/catch around the missing segment. |
| Any other shape                                          | Read the log inline and adapt. | — |

## 5. Verification protocol (user-executed)

After the implementation lands:

1. From repo root, `cd apps/desktop && pnpm run pack`.
2. `codesign --deep --force -s - release/mac-arm64/FastQBank.app`
   (re-apply ad-hoc signature; the rebuild invalidated it).
3. **🧑** System Settings → Privacy & Security → Screen Recording:
   select the existing `FastQBank` entry and click **−** to remove it.
   (The cdhash may have changed; the old TCC record is now bound to a
   stale hash.)
4. Open `release/mac-arm64/FastQBank.app` (double-click is fine; we
   no longer need stderr capture).
5. Press `⌘⇧Q` once. macOS should pop the "FastQBank wants to record
   the screen" dialog the first time → Allow → fully Quit from the
   tray → reopen → press `⌘⇧Q` again.
6. Report back:
   - `cat ~/Library/Logs/FastQBank/ocr-debug.log` (or attach the file).
   - `open ~/Library/Logs/FastQBank/last-thumb.png` — is it the real
     desktop or fully black?

The next session decides the targeted fix from the §4 decision table.

## 6. Risk and rollback

- **Risk:** synchronous `appendFileSync` on the OCR hot path. Mitigation:
  ~10 lines per capture; user-initiated, not continuous; on user's local
  SSD. Not a concern.
- **Risk:** the H2 platform-branch breaks a use case on Windows.
  Mitigation: the branch only changes macOS behavior; Windows still
  hits the original `win.on("blur", () => finish(null))`.
- **Rollback:** all changes are additive (the `debug-log.ts` module
  plus a few `dlog(...)` calls) except for one replaced line in
  `overlay.ts:109`. `git revert` of the implementation commit cleanly
  restores prior behavior.

## 7. Commit shape

The implementation commit is small and additive:

- `apps/desktop/src/debug-log.ts` (new)
- `apps/desktop/src/main.ts` (instrumented)
- `apps/desktop/src/overlay.ts` (H2 branch + log lines)

The previously-staged B2 sidecar files (`engine_vision.py`,
`ocr_sidecar_mac.spec`, `requirements-mac.txt`, the existing
modifications to `ocr_server.py` / `build.py` / `requirements.txt` /
`engine_paddle.py` / pnpm files) are independently committable. The
implementation plan decides whether they ship in the same commit as
this diagnostic round or as a separate prior commit.

Suggested message for the diagnostic commit (English, per CLAUDE.md):
`fix(desktop): instrument macOS OCR capture flow and skip overlay blur-close on darwin`
