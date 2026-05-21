# FastQBank

A personal AI-assisted question bank: capture multiple-choice questions
from screenshots, tag them, drill with flashcards, generate new ones
with AI, and share via short links. Web + Windows desktop, both backed
by the same FastAPI server.

## For users (Windows)

1. Download `FastQBank Setup 1.0.1.exe` from the latest GitHub Release
   (link: https://github.com/Jasper-WangJX/FastQBank/releases/latest).
2. Double-click the installer. 
3. Step through the NSIS wizard. The app installs per-user; no administrator rights needed.
4. Launch FastQBank from the Start menu. Sign up with email + code, or sign in with Google.

The web version is also available at https://fastqbank.com — same
account works on both.

## For developers

### Repository layout

```text
apps/
  server/         FastAPI + SQLAlchemy + Alembic (Python 3.12)
  web/            Vite + React 19 + TypeScript + Tailwind 4
  desktop/        Electron shell — reuses the web build
packages/
  ocr-sidecar/    Local PaddleOCR HTTP server (Python, PyInstaller)
deploy/           docker-compose.prod.yml + Caddy + .env templates
docs/             Roadmap, proposal, brainstorming specs/plans
```

### Local development

Backend:
```powershell
docker compose up -d postgres
cd apps\server
.venv\Scripts\activate.bat
uvicorn main:app --reload --port 8000
```

Web:
```powershell
pnpm --dir apps\web install
pnpm --dir apps\web dev   # serves on http://localhost:5173
```

Desktop (dev, reuses Vite dev server):
```powershell
pnpm --dir apps\desktop install
pnpm --dir apps\desktop dev   # ELECTRON_DEV=1, points at localhost:5173
```

OCR sidecar (one-time setup):
```powershell
cd packages\ocr-sidecar
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
# Phase 5 onedir build (~3 min, produces dist/ocr_server/ocr_server.exe)
.venv\Scripts\python.exe build.py
```

### Environment variables

`.env` at the repo root (template: `.env.example`):

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `JWT_SECRET` | yes | Auth token signing key |
| `DEEPSEEK_API_KEY` | optional | Text AI (tag suggestion, summaries, generation). 503 if unset. |
| `VISION_API_KEY` | optional | Vision AI (Improve with AI, parse-question). 503 if unset. |
| `GOOGLE_WEB_CLIENT_ID` / `GOOGLE_WEB_CLIENT_SECRET` | optional | Web Google sign-in. Button hidden if unset. |
| `GOOGLE_DESKTOP_CLIENT_ID` / `GOOGLE_DESKTOP_CLIENT_SECRET` | optional | Desktop loopback Google sign-in. |
| `RESEND_API_KEY` | optional | Email verification + password-reset codes. If unset, codes print to the uvicorn log. |

See `deploy/env.prod.example` for the full production list.

### Packaging the Windows installer

```powershell
pnpm --dir apps\desktop dist
```

Produces `apps\desktop\release\FastQBank Setup 1.0.1.exe` (300–500 MB —
the PaddleOCR sidecar dominates).

`pnpm --dir apps\desktop pack` (note: `pack`, not `dist`) does a faster
`--dir` build for local smoke without producing an installer.

## Deployment

Production runs on a small VPS via `deploy\docker-compose.prod.yml`:
Postgres + the FastAPI server + Caddy fronting both `https://fastqbank.com`
(static SPA build) and `https://api.fastqbank.com` (reverse-proxy to
`server:8000`, automatic HTTPS).

```powershell
git pull
docker compose -f deploy\docker-compose.prod.yml up -d --build
```

Schema migrations are applied automatically on container start
(`alembic upgrade head` in the server Dockerfile CMD).

## Documentation

- [Roadmap (English)](docs/Roadmap_EN.md) — phases 0–11 with as-built notes
- [Proposal (English)](docs/Proposal_EN.md) — feature + tech-stack baseline
- [Brainstorming specs](docs/superpowers/specs/) — design docs per phase
- [Implementation plans](docs/superpowers/plans/) — step-by-step plans
