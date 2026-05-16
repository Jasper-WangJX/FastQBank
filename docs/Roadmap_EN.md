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

| Phase | Deliverable | Rough effort\* |
|---|---|---|
| 0 Scaffolding | Repo layout, local frontend + backend + DB running | 1-2 days |
| 1 Data foundation + auth | Registration / login, JWT, schema migrations | 2-3 days |
| 2 Question / tag CRUD (manual entry) | Web client can create tags, enter questions, list them, render LaTeX | 4-6 days |
| 3 Cloud sync + soft delete + minimal prod | Deployed to VPS, domain reachable, cross-device consistency | 2-3 days |
| 4 Electron shell | Desktop app boots, reuses web build, tray icon | 2-3 days |
| 5 OCR entry pipeline | Region capture → OCR → split → confirmation page → save | 5-7 days |
| 6 AI integration | Tag suggestion + knowledge summary + rate limiting | 3-4 days |
| 7 Flashcards + wrong-set | Card-based drill, reveal/hide, shuffle, auto-collected wrong set | 3-4 days |
| 8 AI generation | Seed selection → preview page → import + three drill modes | 3-4 days |
| 9 JSON import / export | Full export, dedup-by-UUID import | 1-2 days |
| 10 Polish + Windows installer | electron-builder packaging, productization | 2-3 days |

\*Effort estimates assume focused full-time work and familiarity with the framework in question. Double these for any layer you are touching for the first time.

---

## Phase 0 — Project Scaffolding

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

### Tasks
- Write Alembic migrations creating all tables listed in section 6 of the proposal (User / Tag / Question / QuestionTag / ReviewLog / GenSession), even though only User is used this phase
- Backend: `POST /auth/register`, `POST /auth/login`, bcrypt + JWT, `current_user` dependency
- Frontend: login/register pages, token stored in localStorage, fetch/axios interceptor auto-attaches the Authorization header

### Exit criteria
Register an account in the browser, refresh, remain logged in, and a protected `/me` endpoint returns the email.

---

## Phase 2 — Question / Tag CRUD (Manual Entry)

The largest phase but the most valuable — everything later builds on it.

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

### Tasks
- Create `apps/desktop`, scaffold with electron-vite or electron-forge
- Load the `apps/web` production build (point at `localhost:5173` during dev)
- System tray icon with a right-click menu (open main window / quit)
- Main window content matches the web app exactly

### Exit criteria
Launching the desktop icon opens the app, all features behave identically to the web build, closing the window minimizes to tray.

---

## Phase 5 — OCR Entry Pipeline (the hardest part of v1)

**Strongly recommended: do a 30-minute spike first** — a standalone Python script invoking PaddleOCR on a real screenshot. If accuracy is poor, evaluate alternatives (e.g. calling a GPT-4o vision API directly) immediately.

### Tasks
- `packages/ocr-sidecar`: Python script taking an image path, outputting JSON (text + coordinates)
- Electron spawns this Python subprocess on startup, communicates over stdio or `localhost:port`
- Capture overlay: a transparent fullscreen Electron window + Canvas for region selection + `desktopCapturer.getSources()` to grab the screen image
- Global hotkey: `globalShortcut.register('Ctrl+Shift+Q', ...)`
- Splitting logic: regex matching common formats `A. B. C. D.`, `①②③④`, `（A）（B）`; on miss, drop the entire text into the form for manual edits
- Confirmation page: pre-fills the Phase 2 entry form for the user to edit, pick type, attach tags, save

### Exit criteria
Open any quiz screenshot on screen, press the hotkey, drag a region; the confirmation page shows split stem and options; confirm and the question is saved.

---

## Phase 6 — AI Integration

### Tasks
- Backend: a `llm_provider.py` interface + DeepSeek implementation; API key via env var
- Three endpoints:
  - `POST /ai/suggest-tags`: stem + user's tag list → top-3
  - `POST /ai/knowledge-summary`: stem + options → summary string
  - `POST /ai/generate`: array of seed questions → array of new questions as JSON
- **Rate limiting**: slowapi (per-user request rate) + a counter table (or Redis) tracking daily token consumption
- Frontend: entry form auto-calls `suggest-tags` and `knowledge-summary` before submission; results populate fields the user can still edit

### Exit criteria
Enter a new question; AI auto-suggests tags and writes a knowledge summary; the token counter on the backend increments.

---

## Phase 7 — Flashcards + Wrong-Answer Set

### Tasks
- Review entry page: tag filter, count, toggles (shuffle options / auto-reveal)
- Card component: stem + options → user picks → reveal correctness → next card
- POST a `ReviewLog` after each answer
- "Wrong set" as a virtual filter: `GET /questions?wrong=true`, backend aggregates the latest N incorrect entries from ReviewLog

### Exit criteria
Drill 20 cards in one session; the ones answered incorrectly show up in the wrong set.

---

## Phase 8 — AI Generation + Three Drill Modes

### Tasks
- Add multi-select to the library list; a footer button "generate using selected as seeds"
- Generation preview page: call `/ai/generate`, show items one by one, each editable and checkable; a "bulk import checked" button
- Review entry page gains mode selector: library only / AI only / mixed (with ratio)

### Exit criteria
Select 3 seeds → generate 5 → edit 2 → check 4 and import; the drill page can run AI-only mode.

---

## Phase 9 — Import / Export

### Tasks
- Define the JSON schema (suggest a separate `Docs/JSON_Schema.md`)
- Backend export endpoint: stream or return the full JSON
- Backend import endpoint: parse + UUID dedup + skip duplicates + bulk insert
- Frontend: "Export" and "Import" buttons on the library page

### Exit criteria
Export to JSON, wipe the questions from DB, re-import, everything restored.

---

## Phase 10 — Polish + Windows Installer

### Tasks
- Configure electron-builder → `.exe` installer (code signing optional for personal projects)
- Error UX: API failure toasts, offline notice
- Lightweight onboarding (first-time login guides through creating a tag and entering one question)
- README with development, deployment, and env-var documentation

### Exit criteria
Hand the `.exe` to a friend; they install it, log in, enter and review questions successfully.

---

## Risks and Early Validation

| Risk | When to validate | How |
|---|---|---|
| PaddleOCR accuracy on your typical question sources | During phases 0-1, 30-minute spike | Run it locally on 10 real quiz screenshots, measure accuracy |
| Electron spawning a Python subprocess after packaging | End of phase 4 with a minimal echo demo | Subprocess just returns "hello" — verify IPC, not business logic |
| DeepSeek API latency from the overseas server | Before phase 6, a single curl test | One curl call to the API, observe RTT and success rate |
| Global hotkey collisions on different Windows setups | Phase 5 | Try Ctrl+Shift+Q, Alt+Q, F8 and a few fallbacks |

---

## Recommended First Step

1. Generate the Phase 0 scaffolding (monorepo layout, `docker-compose.yml`, an empty FastAPI + React app, health check endpoint)
2. In parallel, run the PaddleOCR spike (standalone Python script + a few test images) to confirm OCR feasibility as early as possible
