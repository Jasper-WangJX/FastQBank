# MVP Implementation Roadmap v1

> Companion document: `Proposal_EN.md` (feature and tech-stack baseline).
> Chinese counterpart: `Roadmap_CN.md`.

This roadmap breaks the MVP into 11 phases, each shaped as an **end-to-end vertical slice** that ends with something runnable and demonstrable.

---

## Guiding Principles

1. **Vertical slices first**: every phase ends with a working end-to-end path — do not finish all backend work before starting frontend
2. **De-risk early**: spend a 30-minute spike on OCR and on AI integration before committing them to the main path
3. **Web before Electron**: tune all UI in the browser; Electron is just a shell
4. **Stand up a minimal production environment early** (domain + HTTPS + DB) — avoid a deployment crunch at the end

---

## Phase Overview

| Phase | Status | Deliverable |
|---|---|---|
| 0 Scaffolding | ✅ Done (2026-05-16) | Repo layout, local frontend + backend + DB running |
| 1 Data foundation + auth | ✅ Done (2026-05-16) | Registration / login, JWT, schema migrations |
| 2 Question / tag CRUD (manual entry) | ✅ Done (2026-05-16) | Web client can create tags, enter questions, list them, render LaTeX |
| 3 Cloud sync + soft delete + minimal prod | ✅ Done (2026-05-17) | Deployed to VPS, domain reachable, cross-device consistency |
| 4 Electron shell | ✅ Done (2026-05-17) | Desktop app boots, reuses web build, tray icon |
| 5 OCR entry pipeline | ✅ Done (2026-05-17) | Region capture → OCR → split → confirmation page → save |
| 6 AI integration | ✅ Done (2026-05-17) | Tag suggestion + knowledge summary + rate limiting; on-demand vision AI for markerless split + LaTeX |
| 7 Flashcards + wrong-set | ✅ Done (2026-05-18) | Question picker → card drill → persistent wrong set; incl. 7.1 tag/card-view UX |
| 8 AI generation | ✅ Done (2026-05-19) | Pick seeds in Review entry → mixed/AI-only flashcards → on-card "Add to question bank" (with tags+analysis) |
| 9 Bulk ops + share-link transfer | ✅ Done (2026-05-19) | Multi-select on bank page → bulk delete / add tag / bundle into link; paste-link import (UUID dedup) |
| 10 Polish + Windows installer | ⬜ Todo | electron-builder packaging, productization |
| 11 Account security hardening | ✅ Done (2026-05-20) | Email verification on signup (Resend, console stub when unset), confirm-password input, Google sign-in on web + Electron desktop (loopback http server on 127.0.0.1) |

---

## Phase 0 — Project Scaffolding

> **Status: ✅ Done (2026-05-16).** Plain-subdir monorepo (`apps/web`, `apps/server`; `packages/` reserved). Vite + React 19 + TS + Tailwind 4 frontend, FastAPI backend, Postgres 16 via docker-compose, `/health` probe wired end to end.

### Tasks
- Set up a monorepo (pnpm workspaces or a plain git repo with three subdirs): `apps/web`, `apps/server`, `packages/shared`
- `apps/web`: Vite + React + TypeScript + Tailwind (or shadcn/ui)
- `apps/server`: FastAPI + uvicorn + pydantic + SQLAlchemy + Alembic
- `docker-compose.yml`: local Postgres
- Implement a `/health` endpoint and have the web home page call it

### Exit criteria
Locally `pnpm dev`, `uvicorn`, and `docker compose up postgres` all start cleanly, and the home page shows backend health status.

---

## Phase 1 — Data Foundation + Authentication

> **Status: ✅ Done (2026-05-16).** Exit criteria verified end to end (register → refresh stays logged in → protected `/me` returns email) against real Postgres + a browser walkthrough.

#### As-built notes (deviations from the original plan)
- **Backend stack**: async SQLAlchemy + asyncpg; dependencies pinned in `apps/server/requirements.txt` (no pyproject/pnpm-workspace — `packages/shared` deferred to Phase 4).
- **Schema**: one hand-written Alembic baseline migration (`0001_initial_schema`) creates all 6 tables — UUID PKs (`gen_random_uuid()`), JSONB `options`/`correct`, `ARRAY(UUID)`, CHECK constraints on `type`/`source`, composite PK on `question_tags`. Async Alembic env (`alembic init -t async`), DB URL injected from `.env` (kept out of `alembic.ini`).
- **Auth**: `bcrypt` (used directly, not passlib) + `PyJWT` HS256, 24h expiry, secret from `.env`. Login uses a **JSON body** (not OAuth2 form). **Register auto-issues a token** (register = auto-login). `/me` guarded via an **HTTPBearer** scheme so Swagger's Authorize button works; all auth failures return a uniform 401.
- **Frontend**: `react-router-dom` v7; `lib/api.ts` fetch wrapper (Authorization interceptor + 401 → window event); `AuthContext` rehydrates the token from localStorage (key `aqb_token`) so refresh keeps the session; `RequireAuth` guard + `PublicOnly` redirect.

### Tasks
- Write Alembic migrations creating all tables listed in section 6 of the proposal (User / Tag / Question / QuestionTag / ReviewLog / GenSession), even though only User is used this phase
- Backend: `POST /auth/register`, `POST /auth/login`, bcrypt + JWT, `current_user` dependency
- Frontend: login/register pages, token stored in localStorage, fetch/axios interceptor auto-attaches the Authorization header

### Exit criteria
Register an account in the browser, refresh, remain logged in, and a protected `/me` endpoint returns the email.

---

## Phase 2 — Question / Tag CRUD (Manual Entry)

> **Status: ✅ Done (2026-05-16).** Exit criteria verified end to end: backend automated via httpx ASGITransport (pagination / keyword / tag-subtree / parent-tag-delete semantics, 23 assertions passing) and a 17-step browser walkthrough (build tree, enter 10 LaTeX questions, filter & search, edit & delete).

The largest phase but the most valuable — everything later builds on it.

#### As-built notes (deviations from the original plan)
- **No new migration**: all 6 tables were created by the Phase 1 baseline migration, so Phase 2 is purely new Pydantic schemas + routers + three frontend pages; the DB schema is unchanged.
- **Tag `path` is ID-based** (`<parent.path>/<self.id>`): rename only touches `name` — path and descendants are stable; only *move* recomputes the subtree paths, and cycle prevention degrades to a pure prefix check. Max depth 6.
- **Tag delete**: cascades the whole subtree + unlinks questions (clears `question_tags`); questions themselves are kept. Physical delete in Phase 2, but every read query already filters `deleted_at IS NULL` — Phase 3 soft-delete is then a zero read-path change.
- **Type validation** lives in one `QuestionIn` `model_validator` (single = exactly 1, multi ≥ 1, judge = T·F and exactly 1, unique labels, correct ⊆ labels), returning a single clear 422 instead of relying on DB CHECK constraints.
- **Tag filter is subtree match** (by `path` prefix, includes descendant-tagged questions) — confirmed with the user as non-exact; question update ignores `source` so an OCR/AI origin is never rewritten.
- **LaTeX**: raw `katex` + a hand-written `Latex` component (splits `$…$`/`$$…$$`, plain text via React nodes for XSS safety, unterminated `$` degrades gracefully); CSS imported once globally.
- **Frontend**: `lib/qbank.ts` typed wrappers reuse the existing `apiFetch` (its body type widened to `unknown` to accept named types); new `AppLayout` nav shell + nested routes under `RequireAuth`; `/` redirects to `/questions`; the now-unused `HomePage` was removed. Refetch after every mutation; list keyword debounced 300ms.

### Tasks
- Backend: full CRUD for `Tag` (with `parent_id` for tree structure) and `Question` (options, correct, three types)
- Three frontend pages:
  - **Tag management**: tree view, create, rename, move, delete
  - **Question entry form**: type selector (single / multi / true-false), dynamic option add/remove, correct-answer picker, multi-tag attach, LaTeX input field (string `$...$` with a KaTeX-rendered preview)
  - **Question library**: pagination, tag filter, keyword search, row actions (edit / delete)

### Exit criteria
Build a tag tree from scratch on the web, enter 10 questions with LaTeX, filter and search them in the list.

---

## Phase 3 — Cloud Sync + Soft Delete + Minimal Production

> **Status: ✅ Done (2026-05-17).** Split into 3a (soft delete + sync
> semantics, locally verifiable) / 3b (production deploy). Exit criteria accepted on the real production
> domain `https://fastqbank.com` from two clients: create/edit/delete
> propagate across devices, LWW, and soft-delete (rows still present,
> confirmed via psql) all pass; plus 39 backend httpx assertions.

#### As-built notes (deviations from the original plan)
- **Soft delete**: the `deleted_at` columns on `tags`/`questions` already
  existed (Phase 1 baseline); this phase only switched delete endpoints to
  `UPDATE deleted_at=now()`. Read paths already filtered
  `deleted_at IS NULL` (Phase 2) — zero changes. `delete_tag` soft-deletes
  the whole subtree and **keeps** `question_tags` links (the
  `_tags_for`/subtree-filter joins already exclude soft-deleted tags, so
  questions just stop showing them — reversible).
- **LWW**: server-stamped, last-writer-wins (`update/rename/move` all set
  `updated_at=func.now()`); no client-timestamp comparison.
- **Sync**: minimal — full refetch on app open; no `?since=`
  increment / tombstones (pages fetch on mount; a shared backend gives
  cross-device consistency).
- **Deploy structure**: api-subdomain — frontend `https://fastqbank.com`
  (Caddy serves the static SPA), backend `https://api.fastqbank.com`
  (Caddy reverse-proxies `server:8000`). No backend route changes, no
  SPA/API path collision.
- **Orchestration**: `apps/server/Dockerfile` (runs `alembic upgrade head`
  on start) + a multi-stage frontend image (node:22 build → caddy:2, bakes
  `VITE_API_BASE_URL`) + `deploy/docker-compose.prod.yml`
  (postgres+server+caddy, automatic HTTPS, cert volume persisted). Config
  via git-ignored `deploy/.env.prod`; CORS injected via the
  `CORS_ORIGINS` JSON env var — **no code change**.
- **Fixed during deploy**: `settings.py` hard-indexed `parents[3]` to find
  the repo-root `.env`; the image's shallower layout made that
  `IndexError` at startup. Changed to take `parents[3]` only when
  `len(parents) > 3`, else fall back to environment variables (local dev
  behaviour unchanged, verified).
- **Verification**: a local prod-shaped dry run (compose postgres+server;
  migration/health/register all green) + a two-client browser acceptance
  on the production VPS, all passing.

### Tasks
- Add `deleted_at` column to every model; all queries filter `WHERE deleted_at IS NULL`
- Delete endpoints become `UPDATE deleted_at = now()`
- Sync strategy: on app open, frontend pulls latest via `GET /questions?since=<timestamp>` (incremental)
- LWW: update endpoint rejects writes whose client `updated_at` is older than the DB row's `updated_at` (or simply server-stamps `updated_at = now()`)
- **Key**: provision an overseas VPS (Hetzner is cheapest at ~€4/mo; Vultr also fine), run server + Postgres + Caddy via Docker Compose, point a domain at it, get HTTPS automatically

### Exit criteria
From two browsers on two machines, log in as the same user; create a question on A, refresh B, see it; delete on A, refresh B, it disappears.

---

## Phase 4 — Electron Shell

> **Status: ✅ Done (2026-05-17).** Approach A (custom `app://aqb` scheme loading the `apps/web` production build). Build / packaging / headless boot auto-verified; a two-context user GUI walkthrough (login against the prod backend, web↔desktop data parity, no blank screen on refresh, session kept across restart, close-to-tray / recall / quit, second-launch focus) all pass.

#### As-built notes (deviations from the original plan)
- **Scaffold**: no electron-vite/electron-forge; `apps/desktop` is a standalone package (still no monorepo workspace — consistent with the `packages/shared` deferral noted in Phase 1; not introduced here either), reusing the existing `apps/web` Vite build with zero renderer changes. Main/preload compiled with `tsc` (`module`/`moduleResolution: node16`, off TS6's deprecated classic `node`).
- **Approach-A loading**: main registers a standard + secure custom `app://` scheme; `protocol.handle` serves files from `dist` and falls back to `index.html` for unmatched paths (equivalent to Caddy's `try_files`), fixed origin `app://aqb`. This keeps `BrowserRouter`, no blank screen on refresh/deep-link, a persistent localStorage session, and a single fixed CORS origin. Vite's default `base:"/"` absolute asset paths are handled naturally by mapping the URL pathname — **zero web-side changes**.
- **Dev/prod branch**: `ELECTRON_DEV=1` → loads `http://localhost:5173` (Vite dev server, origin already whitelisted); otherwise `app://aqb/`.
- **Backend CORS**: `app://aqb` added to the `settings.py` default list + `deploy/env.prod.example`; the real `deploy/.env.prod` on the VPS updated and verified by the user (prod desktop login confirmed).
- **Tray/lifecycle**: `Tray` + menu (open main window / quit), left-click toggles visibility, window close intercepted to hide (`isQuitting` flag distinguishes a real quit), `requestSingleInstanceLock` + `second-instance` focuses the existing window. `window-all-closed` is intentionally a no-op (tray-resident).
- **Icons**: a dependency-free pure-`zlib` PNG generator (`scripts/gen-icons.cjs`) produces placeholder `icon.png`(256)/`tray.png`(32) in `apps/desktop/assets/` (not the planned `build/` — root `.gitignore` ignores `build/`). Real icon deferred to Phase 10.
- **Packaging boundary**: no real installer this phase; `electron-builder --dir` only validates the "double-clickable" criterion, `extraResources` copies `apps/web/dist` into `resources/web-dist`, and main switches the dist path on `app.isPackaged`. The Windows installer is Phase 10.
- **Environment gotcha (fixed durably)**: pnpm 11 blocks Electron's binary postinstall → `package.json` `pnpm.onlyBuiltDependencies` + `apps/desktop/.npmrc` `verify-deps-before-run=false`; binary fetched via `node node_modules/electron/install.js`.
- **Verification**: `pnpm build` (web bakes `VITE_API_BASE_URL=https://api.fastqbank.com`, no localhost leak) + `electron-builder --dir` + headless boot of the packaged exe with no crash; the user's GUI walkthrough of the 4 behaviors all pass.

### Tasks
- Create `apps/desktop`, scaffold with electron-vite or electron-forge
- Load the `apps/web` production build (point at `localhost:5173` during dev)
- System tray icon with a right-click menu (open main window / quit)
- Main window content matches the web app exactly

### Exit criteria
Launching the desktop icon opens the app, all features behave identically to the web build, closing the window minimizes to tray.

---

## Phase 5 — OCR Entry Pipeline (the hardest part of v1)

> **Status: ✅ Done (2026-05-17).** Dev end-to-end accepted (hotkey/button → overlay selection → OCR → split → prefilled confirm page → save with `source='ocr'`); the packaged sidecar exe is **hard-verified offline** (`model_loaded:true`, test1/test3 recognized, bad token → 401, ~0.5s warm). **The full electron-builder packaged-app end-to-end smoke is handed to Phase 10** (see its tasks).

#### As-built notes (deviations from the original plan)
- **Decision-gate spike**: PaddleOCR 3.x's oneDNN crashes under the new executor → downgraded to **pinned paddlepaddle 2.6.2 + paddleocr 2.9.1**, `enable_mkldnn=True` gives 0.2–0.55s/image warm; `lang="en"` (target users have English questions; i18n scope fixed as **English-only, no i18n framework**).
- **Sidecar**: `packages/ocr-sidecar/ocr_server.py`, local `127.0.0.1` HTTP (not stdio — paddle's logging corrupts stdio framing), `/healthz` + `/ocr`, random `X-OCR-Token`, background model preload, reading-order sorted output.
- **Splitter**: a pure frontend function `apps/web/src/lib/ocr/splitter.ts` (English markers `A.`/`A)`/`(A)`/`1.`, takes the first question in a multi-question shot, **honest fallback** `matched:false` dumping the whole text into the confirm page when there are no reliable markers — no forced mis-split for the user to undo); **vitest** introduced, 14 tests green (`apps/web` pnpm-workspace adjusted).
- **Electron**: `main.ts` split into `sidecar/capture/overlay/shortcut/ipc` modules; three-tier global hotkey fallback `Ctrl+Shift+Q → Alt+Q → F8`; screenshot grabbed at physical px, crop using the **real bitmap ratio + padding** (fixed a selection/crop ratio mismatch that dropped the last line); overlay window made **opaque + forced full-screen** (fixed the Windows transparent-window work-area clamp that caused "two taskbars / squashed screen"); `preload.ts` gained the `ocr`/`overlay` IPC bridge (sandbox kept on); tray menu de-Chinesed to English.
- **Confirm page**: reuses the Phase 2 `QuestionFormPage`, prefilled via React Router `state` (never hits the URL, zero impact on edit/manual paths), `source:'ocr'`, a "Draft from OCR" banner + an unmatched hint. **The only backend change**: `schemas.py` widened `source` to `Literal["manual","ocr","ai"]` (the DB CHECK already allowed all three — **no migration**).
- **Packaging**: PyInstaller **onedir** (paddle is hundreds of MB; onedir is more reliable and faster), models staged into the bundle and read at runtime from `sys._MEIPASS/models` — offline, zero download; iteratively filled PyInstaller misses (Cython data / the `tools`·`ppocr`·`ppstructure` top-level packages); electron-builder `extraResources` + `package.json` `build:sidecar` wired, path-consistent with `sidecar.ts`'s packaged branch.
- **Deferred**: markerless auto-splitting + formula/LaTeX recognition are handled by **Phase 6's on-demand vision AI** as planned (this phase is regex + manual fallback only).

---

**Strongly recommended: do a 30-minute spike first** — a standalone Python script invoking PaddleOCR on a real screenshot to gauge text accuracy. Note this phase **only** handles ordinary "lettered, no-formula" questions; **markerless option splitting and formula / LaTeX recognition are out of scope here** and deferred to Phase 6's "on-demand vision AI" (see Phase 6).

### Tasks
- `packages/ocr-sidecar`: Python script taking an image path, outputting JSON (text + coordinates)
- Electron spawns this Python subprocess on startup, communicates over stdio or `localhost:port`
- Capture overlay: a transparent fullscreen Electron window + Canvas for region selection + `desktopCapturer.getSources()` to grab the screen image
- Global hotkey: `globalShortcut.register('Ctrl+Shift+Q', ...)`
- Splitting logic: regex matching common **English** formats `A. B. C. D.` / `A)` / `(A)` / `1. 2.` (target users have English questions — CJK-only markers dropped); on miss, drop the entire text into the confirmation page for manual edits. **Markerless auto-splitting and LaTeX recognition are NOT in this phase — deferred to Phase 6's on-demand vision AI**
- Confirmation page: pre-fills the Phase 2 entry form for the user to edit, pick type, attach tags, save

### Exit criteria
Open any quiz screenshot on screen, press the hotkey, drag a region; the confirmation page shows split stem and options; confirm and the question is saved.

---

## Phase 6 — AI Integration

> **Status: ✅ Done (2026-05-17).** All 5 backend endpoints verified live against real DeepSeek/Gemini: `/ai/suggest-tags`, `/ai/knowledge-summary`, `/ai/generate`, `/ai/parse-question` (vision), `/ai/usage` (token counter, added for the exit criterion). The access layer lives in `apps/server/app/llm/` (a **deliberate deviation** from the roadmap's literal `packages/llm_provider.py` — purely server-side, isomorphic to `app/security.py`, directly importable): one `OpenAICompatProvider` drives both DeepSeek-V3 (text) and Gemini (vision) over OpenAI-compatible APIs; a missing key → 503, the app still boots. **Vision-model deviation**: the roadmap's bare `gemini-2.0-flash` alias is retired by Google for new API keys (completions 404), so the default is `gemini-2.5-flash-lite` (cheapest, free quota, vision-capable), overridable via `VISION_MODEL` with no code change. Metering & limits: new `ai_usage` table (migration `0002`, per-user-per-day atomic PG `ON CONFLICT` upsert) + a daily token cap + slowapi per-user per-minute rate limit, both 429 on excess. Both frontend buttons are **click-triggered, never auto-spend**: "AI: suggest tags + summary" fills editable fields; "Improve with AI" sends the desktop's carried crop to the vision endpoint to split markerless options + recover LaTeX. Prompts enforce **strict LaTeX** (every formula in `$...$` except a bare standalone number). `.env` is at the repo root; new deps `openai`/`slowapi`/`Pillow`/`python-multipart`. Verified: four text + vision endpoints live, token accrual, rate-limit/daily-cap 429, no-key 503; frontend `tsc`/`vitest` (16 green)/`build`/`lint` all pass. **Handed off**: `/ai/generate` is backend-only — the generation preview UI → Phase 8; the real GUI button + desktop-screenshot walkthrough → re-checked in Phase 10 polish.

> User location: **Canada, no access restrictions** (DeepSeek / OpenAI / Gemini all reachable).
> Design principle: local PaddleOCR stays the OCR default (free, offline, fast); **AI is on-demand only**, keeping cost negligible for a personal project.

### Tasks
- Backend: a `llm_provider.py` interface; **text tasks** use DeepSeek-V3, **vision tasks** use a budget vision model (default **Gemini 2.0 Flash**, has a free tier; alternative **GPT-4o-mini**); API keys via env vars
- Four endpoints:
  - `POST /ai/suggest-tags`: stem + user's tag list → top-3 (text)
  - `POST /ai/knowledge-summary`: stem + options → summary string (text)
  - `POST /ai/generate`: array of seed questions → array of new questions as JSON (text)
  - `POST /ai/parse-question`: a **cropped screenshot** (downscaled + grayscale) + the PaddleOCR text as a hint → structured `{stem, type, options[]}` with **LaTeX preserved**. One vision call solves both: ① option splitting when there are no A/B/C/D markers; ② formula / LaTeX that OCR loses
- **On-demand trigger (the cost lever)**: `/ai/parse-question` is called only when regex splitting failed (`matched=false`), a formula is likely, or the user clicks "Improve with AI" on the confirmation page; ordinary questions stay on local PaddleOCR + regex with zero API spend
- **Cost controls**: downscale + grayscale before upload (long side ≤ ~1000px); pass the OCR text as a hint to shrink tokens / allow a text-only path when there are no formulas; cap `max_tokens`; reuse the rate limit + daily token cap below
- **Rate limiting**: slowapi (per-user request rate) + a counter table (or Redis) tracking daily token consumption
- Frontend: entry form auto-calls `suggest-tags` and `knowledge-summary` before submission (user-editable); the confirmation page gains an "Improve with AI" button that triggers `parse-question`, with editable results

### Exit criteria
Enter a new question; AI auto-suggests tags and writes a knowledge summary; the backend token counter increments. For a screenshot with **no A/B/C/D markers** or **containing formulas**, clicking "Improve with AI" yields a confirmation page with correctly split options and correct LaTeX.

---

## Phase 7 — Flashcards + Wrong-Answer Set

> **Status: ✅ Done (2026-05-18).** Delivered via brainstorming → spec → plan → subagent-driven execution (task-by-task with two-stage spec/quality review), plus a 7.1 UX addendum and follow-up refinements. Exit criteria accepted by `scripts/verify_review.py` (httpx ASGITransport, real Postgres, ALL PASS) + frontend `build`/`lint`/`vitest`(34) + the user's GUI walkthrough. Spec/plans under `docs/superpowers/specs|plans/`.

#### Actual implementation notes (deviations from the original plan)
- **Wrong-set semantics upgraded.** The roadmap said "`GET /questions?wrong=true` aggregating the latest N ReviewLog rows"; this was changed (confirmed with the user) to a **persistent, manually-cleared** set: new `wrong_questions` table (migration `0003`) + `WrongQuestion` model. A wrong answer upserts active (PG `ON CONFLICT`); a correct answer is a no-op; "Mark as mastered" sets `cleared_at` (leaves the set); answering wrong again reactivates the same row; soft-deleted questions are excluded by the `deleted_at IS NULL` read joins.
- **Dedicated `/review` router** (not `?wrong=true` on `/questions`): `POST /review/deck`, `GET /review/tag-question-ids` (`tag_id` optional → all live owned ids), `POST /review/logs`, `GET /review/wrong`, `POST /review/wrong/{id}/master`. Shared `app/question_query.py` extracted (de-dups the subtree/tag-loading logic in `questions.py`). No committed pytest suite — same httpx verification-script pattern as stages 1–6.
- **"auto-reveal" toggle → renamed Fast mode.** OFF: pick then Check (Submit for multi) to reveal. ON: single/judge reveal the moment you pick (the Check button is hidden), multi still needs Submit, and after reveal it lingers **0.8s then auto-advances**. Both modes score and write a ReviewLog.
- **Entry page is a question picker** (not the roadmap's tag+count form): one **global selection Set across tags** (multi-tag safe), a tag column with "All questions" and "⚠ Wrong questions" entries, optional Random-pick cap, Shuffle-options, session-only. One ReviewLog per card (idx-idempotent, non-blocking failure + Retry); end summary with "Review wrong now". Pure logic in `lib/review/session.ts` built test-first (vitest).
- **Wrong-set clearable from two places**: a per-row `Mastered` in the wrong-set listing + `Mark as mastered` on the wrong-set card (shown only when **this attempt was correct** — a still-wrong redo doesn't offer it).
- **7.1 UX addendum**: full tag CRUD (`TagManagePanel`, a "⋯" actions menu, move-parent removed) moved into the **Question Bank page**; the standalone `/tags` page + nav + `TagManagerPage` removed; the question form gets a hierarchical attach checklist + "add a sub-tag under a parent (with confirm)"; hierarchical tag controls unified app-wide (shared `components/tags/tagTree.ts`); a List/Cards preview view for the Question Bank and the review picker (shared `QuestionCard`); the review picker defaults to "All questions" and uses an icon-only per-question select; review page size is 10.
- **Branch** `phase-7-flashcards`, committed task-by-task, merged into `main` after acceptance.

### Tasks
- Review entry page: tag filter, count, toggles (shuffle options / auto-reveal)
- Card component: stem + options → user picks → reveal correctness → next card
- POST a `ReviewLog` after each answer
- "Wrong set" as a virtual filter: `GET /questions?wrong=true`, backend aggregates the latest N incorrect entries from ReviewLog

### Exit criteria
Drill 20 cards in one session; the ones answered incorrectly show up in the wrong set.

---

## Phase 8 — AI Generation + Three Drill Modes

> **Status: ✅ Done (2026-05-19).** Delivered via brainstorming → spec → plan →
> subagent-driven execution (task-by-task with two-stage spec/quality review).
> Reuses the Review-entry selection set as AI generation seeds; extends
> `/ai/generate` to also emit existing-tags-only tag suggestions and a
> knowledge_summary (analysis); AI cards are ephemeral (synthetic id) — drill
> does not write ReviewLog or add to the wrong set (even on wrong answer); the
> on-card "Add to question bank" button reuses `POST /questions`
> (`source=ai`). Two sub-options: mixed / AI-only. No new tables, endpoints,
> or migrations. Spec at
> `docs/superpowers/specs/2026-05-19-phase8-ai-generation-design.md`.

### Tasks
- Add multi-select to the library list; a footer button "generate using selected as seeds"
- Generation preview page: call `/ai/generate`, show items one by one, each editable and checkable; a "bulk import checked" button
- Review entry page gains mode selector: library only / AI only / mixed (with ratio)

### Exit criteria
Select 3 seeds → generate 5 → edit 2 → check 4 and import; the drill page can run AI-only mode.

---

## Phase 9 — Bulk Operations + Share-Link Transfer

> **Status: ✅ Done (2026-05-19).** Delivered via brainstorming → spec →
> plan → subagent-driven execution (task-by-task spec/quality reviews +
> a final whole-branch review). `scripts/verify_phase9.py` ALL PASS
> (covers create / GET / import / UUID dedup four cases / my-shares /
> revoke / IDOR / bulk-tags negative branches) + frontend `tsc`/`lint`/
> `vitest`(46)/`build` clean + two-account GUI walkthrough (create →
> select-all filtered → bundle → cross-account paste-import → revoke →
> re-import returns 410 → bulk delete / add tag are account-scoped) all
> green. Spec at
> `docs/superpowers/specs/2026-05-19-phase9-share-link-bulk-ops-design.md`,
> plan at
> `docs/superpowers/plans/2026-05-19-phase9-share-link-bulk-ops.md`.

#### As-built notes (deviations from the original plan)
- **Share token**: `secrets.token_urlsafe(9)` → 12 URL-safe chars (~72 bits); no `nanoid` dependency. `is_valid_share_token` lets routes 404 obviously-malformed tokens before any DB query.
- **Route-order gotcha (fixed)**: FastAPI matches in declaration order, so the static `/shares/me` route must be declared BEFORE the parametric `/shares/{token}` — otherwise `me` is treated as a 2-char token, fails the length check, and 404s. An explicit comment guards against regression.
- **Three race-safe write paths**: (a) token-collision retry with `IntegrityError` (narrowed from `Exception`); (b) tag find-or-create under concurrent same-user import uses `pg_insert(...).on_conflict_do_nothing(...)` + re-SELECT; (c) bulk-tags uses composite-PK `ON CONFLICT DO NOTHING` + `RETURNING` for honest counters.
- **`/review/tag-question-ids` gained `q`**: the bank page banner reads "Select all N matching" where N includes the keyword filter — caught in review that the endpoint only knew tags, leading to a silent over-select. Extended endpoint + client wrapper + caller now thread the keyword all the way through.
- **Anonymous GET is rate-limited**: `/shares/{token}` is the only un-authed endpoint; per spec §7 it gets `@limiter.limit("60/minute")` keyed on `get_remote_address`.
- **`SharePreviewOut` exposes no creator identity** — only payload + created_at — consistent with the "no access logging" stance from spec §2.2.
- **Schema delta is minimal**: new `shares` table + `questions.imported_from_id` (no FK, write-once dedup tag), bundled into one migration `0005_shares_and_imported_from`.
- **Intentionally deferred to v2**: `/s/<token>` browser deep-link route (the recipient pastes into the modal today); same-user concurrent-import question dedup (only the Modal busy state mitigates today); share TTL / access analytics / password protection.
- **Branch**: `phase-9-share-link`, 22 commits (incl. 3 review-driven fix commits), merged into `main` after the exit-criterion GUI walkthrough.

### Tasks
- Add multi-select to the bank page: icon-only checkbox per row/card; 3-state header checkbox (current-page select-all); when the current page is fully selected, surface a "Select all N filtered" expansion link; selection state survives paging and filter changes, cleared on hard refresh
- When `selected.size >= 1`, show an action bar above the list: `N selected · Clear · Bulk delete · Add tag · Bundle as link`
  - Bulk delete: confirm count, fire `DELETE /questions/{id}` in parallel, refetch
  - Add tag: modal reusing the existing `TagPicker`; append-only (union into each question's existing tag set, no replace)
  - Bundle as link: `POST /shares` → modal shows the URL + a Copy button; selection retained
- Header buttons: `[Import]` and a small `[My shares]` link
  - Import modal: paste a full URL or a bare token → preview (truncated stems + tag reuse/create counts) → confirm → import
  - My-shares modal: list own active shares, per-row Copy / Revoke (soft-delete = revoke)
- New table `shares` + new column `questions.imported_from_id UUID NULL` (single migration `0005_shares_and_imported_from.py`); `shares` columns: `id / creator_id / token (12-char URL-safe nanoid UNIQUE) / payload (self-contained JSONB snapshot) / created_at / deleted_at`
- 5 backend endpoints: `POST /shares` (1..99 hard cap) / `GET /shares/{token}` (no auth; 410 on soft-delete) / `POST /shares/{token}/import` (UUID dedup; tag match-or-create by name) / `GET /shares/me` / `DELETE /shares/{id}` (creator only)
- Verification: `scripts/verify_phase9.py` (httpx ASGITransport — covers the 5 endpoints + cross-account import + revoke)

### Exit criteria
On the bank page, tick 3 questions + click "Select all N filtered" to add the remaining 7 → 10 selected → click "Bundle as link" → copy the URL. Sign in as another account → Import → paste URL → preview → confirm → 10 questions land with tags resolved by name (created or reused). Revoke the link → re-attempting import returns 410. Bulk-deleting 3 questions on account A does not affect account B's imported copies (the share payload is a value snapshot).

---

## Phase 10 — Polish + Windows Installer

### Tasks
- Configure electron-builder → `.exe` installer (code signing optional for personal projects)
- **Packaged-app end-to-end smoke (handed over from Phase 5)**: run the full `pnpm --dir apps/desktop package` and verify ① electron-builder copies the onedir sidecar into `resources/ocr-sidecar`; ② the packaged app starts the sidecar via the `app.isPackaged` path (dev uses venv python — this path has never run); ③ offline screenshot → OCR → save; ④ no orphan `ocr_server.exe` process tree after quit
- Error UX: API failure toasts, offline notice
- Lightweight onboarding (first-time login guides through creating a tag and entering one question)
- README with development, deployment, and env-var documentation

### Exit criteria
Hand the `.exe` to a friend; they install it, log in, enter and review questions successfully.

---

## Phase 11 — Account security hardening

> **Status: ✅ Done (2026-05-20).** Design and plan: `docs/superpowers/specs/2026-05-20-account-security-hardening-design.md` and `docs/superpowers/plans/2026-05-20-account-security-hardening.md`.

### Tasks
- Backend: new tables `email_verifications` / `oauth_states` + `users.google_id` (migration 0006); new endpoints `/auth/request-code`, `/auth/providers`, `/auth/google/start`, `/auth/google/callback`; `/auth/register` now requires a 6-digit code, `/auth/login` rejects Google-only accounts with the same 401 (no enumeration).
- Mail: `apps/server/app/mail.py` posts to Resend over HTTPS; stub-prints to stdout when `RESEND_API_KEY` is unset.
- Google: `google-auth[requests]` verifies id_token locally + PKCE; auto-merges a Google sign-in into an existing password account when the email matches.
- Frontend: `AuthContext` fetches `/auth/providers` once and uses it to gate the Google button; `RegisterPage` rewritten as a two-step state machine (request code → code + password + confirm); `GoogleSignInButton` shared between login and register; new `/oauth/callback` web route.
- Desktop: Electron main process binds a single-use `http.createServer` on `127.0.0.1:0` per attempt; IPC channels `oauth:start-loopback` + `oauth:open-external` + `oauth:callback`; `shell.openExternal` whitelist restricts to `https://accounts.google.com`.

### Exit criteria
Password confirm-field reports a mismatch on blur; the same email cannot request a new code within 60s; five wrong codes drop the verification row; with no `RESEND_API_KEY`, the code prints to the uvicorn log; with no `GOOGLE_CLIENT_ID`, neither auth page renders the Google button; web Google flow lands at `/oauth/callback` and forwards to the question bank logged in; desktop Google flow completes via the default browser and the Electron app auto-logs-in; a password account and a same-email Google sign-in auto-merge into a single user row, after which the password login still works.

---

## Risks and Early Validation

| Risk | When to validate | How |
|---|---|---|
| PaddleOCR accuracy on your typical question sources | During phases 0-1, 30-minute spike | Run it locally on 10 real quiz screenshots, measure accuracy |
| Electron spawning a Python subprocess after packaging | End of phase 4 with a minimal echo demo | Subprocess just returns "hello" — verify IPC, not business logic |
| LLM / vision API latency and cost | Before phase 6, one curl test each | Call text (DeepSeek-V3) and vision (Gemini 2.0 Flash / GPT-4o-mini) once each; observe RTT, success rate, per-question token cost |
| Global hotkey collisions on different Windows setups | Phase 5 | Try Ctrl+Shift+Q, Alt+Q, F8 and a few fallbacks |

