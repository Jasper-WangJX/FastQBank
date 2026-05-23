# FastQBank

A personal AI-assisted question bank: capture multiple-choice questions
from screenshots, tag them, drill with flashcards, generate new ones
with AI, and share via short links. Web + Windows + macOS desktop, all
backed by the same FastAPI server.

## For users (Windows)

1. Download `FastQBank Setup 1.0.2.exe` from the latest GitHub Release
   (link: https://github.com/Jasper-WangJX/FastQBank/releases/latest).
2. Double-click the installer. 
3. Step through the NSIS wizard. The app installs per-user; no administrator rights needed.
4. Launch FastQBank from the Start menu. Sign up with email + code, or sign in with Google.

The web version is also available at https://fastqbank.com — same
account works on both.

## For users (macOS, Apple Silicon)

1. Download `FastQBank-1.0.2-arm64.dmg` from the latest GitHub Release
   (link: https://github.com/Jasper-WangJX/FastQBank/releases/latest).
   The DMG is **Apple Silicon only** (M1/M2/M3/M4/M5) — Intel Macs are
   not currently supported.
2. Double-click the DMG → drag `FastQBank` into Applications.
3. Launch FastQBank from Launchpad. The build is signed with Apple
   Developer ID and notarized, so no "unidentified developer" warning.
4. Sign up with email + code, or sign in with Google.
5. **First time using screenshot OCR** (`⌘⇧Q`): macOS will ask for
   Screen Recording permission. Approve it in
   *System Settings → Privacy & Security → Screen Recording*, then
   fully quit FastQBank from the menu-bar tray and reopen — permission
   only takes effect after restart.

## For developers

### Repository layout

```text
apps/
  server/         FastAPI + SQLAlchemy + Alembic (Python 3.12)
  web/            Vite + React 19 + TypeScript + Tailwind 4
  desktop/        Electron shell — reuses the web build
packages/
  ocr-sidecar/    Local OCR HTTP server (PaddleOCR on Windows, Apple
                  Vision on macOS — engines split per platform, see
                  packages/ocr-sidecar/engine_paddle.py + engine_vision.py)
deploy/           docker-compose.prod.yml + Caddy + .env templates
docs/             Roadmap, proposal, brainstorming specs/plans
```

### Local development

> Commands below use PowerShell syntax. On macOS substitute `\` with `/`
> and use `.venv/bin/python` in place of `.venv\Scripts\python.exe`.

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

OCR sidecar (one-time setup) — Windows / PaddleOCR:
```powershell
cd packages\ocr-sidecar
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
# Phase 5 onedir build (~3 min, produces dist/ocr_server/ocr_server.exe)
.venv\Scripts\python.exe build.py
```

OCR sidecar (one-time setup) — macOS / Apple Vision:
```bash
cd packages/ocr-sidecar
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements-mac.txt pyinstaller
# No model staging needed on macOS — Vision is a system framework.
# Produces dist/ocr_server/ocr_server (no .exe).
.venv/bin/python build.py
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

Produces `apps\desktop\release\FastQBank Setup 1.0.2.exe` (300–500 MB —
the PaddleOCR sidecar dominates).

`pnpm --dir apps\desktop pack` (note: `pack`, not `dist`) does a faster
`--dir` build for local smoke without producing an installer.

### Packaging the macOS DMG

Signing + Apple notarization needs an active Apple Developer Program
membership and three environment variables set in your shell (e.g.
`~/.zshrc`, `chmod 600`, never committed):

```bash
export APPLE_ID="your@apple-id.email"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # appleid.apple.com → app-specific password
export APPLE_TEAM_ID="ABCDEFGHIJ"                          # 10-char Team ID from developer.apple.com
```

Plus a `Developer ID Application` certificate imported into the login
keychain (with its private key) and the Apple `Developer ID - G2`
intermediate CA installed (download from
https://www.apple.com/certificateauthority/). Verify with
`security find-identity -v -p codesigning` — you should see exactly
one valid identity.

Then:
```bash
pnpm --dir apps/desktop run dist
```

Produces `apps/desktop/release/FastQBank-1.0.2-arm64.dmg` (~100 MB —
Apple Vision adds no model weights, so the macOS bundle is far smaller
than Windows). Notarization typically adds 3–20 minutes of waiting on
Apple's service. The resulting DMG is double-clickable on any Apple
Silicon Mac with no Gatekeeper warning.

`pnpm --dir apps/desktop run pack` does a faster `--dir` build that
skips notarization; the resulting `.app` runs locally but you must
manually `codesign --deep --force -s - release/mac-arm64/FastQBank.app`
to ad-hoc sign it (arm64 macOS refuses to run a completely unsigned
binary).

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
