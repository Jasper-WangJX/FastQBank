# AI-Assisted Question Bank — Proposal v2

> Chinese counterpart: `策划案_v2.md`.

---

## 1. Overview

A multi-platform tool that helps users **collect, organize, and review multiple-choice questions** efficiently. Key differentiators:

- **Screen-region OCR capture** for question entry (desktop only)
- **AI-assisted tagging and knowledge summarization**
- **AI question generation** that produces similar questions from seed items
- **Cloud sync** across devices

MVP target platforms: **Windows desktop + Web**. Other platforms are deferred.

---

## 2. Target Users

- Students, exam preppers, and self-learners
- Typical usage: enter and drill questions on PC; review wrong answers on mobile (future)
- Scale positioning: **personal use plus small circle**, not a large public service

---

## 3. Core Features

### 3.1 Question Entry (desktop only)

- **Screen-region OCR**
  - Entry points: tray icon / floating pet widget / global hotkey (default `Ctrl+Shift+Q`)
  - Flow: trigger overlay → user drags selection → OCR extracts text → regex splits stem and options → user lands on a confirmation page to verify, edit, and pick the question type
  - OCR engine: **PaddleOCR** (local subprocess, free, strong Chinese recognition)
  - Splitting logic: regex for common formats `A. B. C. D.` / `A)` / `①②③④` / `（A）（B）`; LLM fallback when regex misses
- **Manual input**: standard form with LaTeX string support (`$...$`)
- **Question types**: single-choice / multi-choice / true-false (no fill-in-the-blank)
- **Out of scope for v1**: error-prone option marking, AI explanations, images inside options

### 3.2 Tag System

- **Hierarchical + multi-tag**: tags form a tree (e.g. `Math/Calculus/Limits`); **one question may carry multiple hierarchical paths**
- **AI tag suggestion**: at entry time, AI recommends top-3 matches from the user's existing tag set based on the stem
- **AI knowledge summary**: at entry time, AI auto-generates a `knowledge_summary` field (1-2 sentences) used later for question generation — avoids paying for inference on every generation run

### 3.3 Review

- **Flashcard mode**
  - Filter a question set (by tag / status / source) → enter card-by-card mode
  - Toggle: shuffle options
  - Toggle: reveal/hide the answer
  - v1: simple shuffled traversal; **SRS spaced repetition deferred to v2**
- **Wrong-answer set**: questions answered incorrectly are auto-collected into a virtual "wrong set" for targeted review

### 3.4 AI Question Generation

- User **selects a batch of questions as "seeds"** → confirms → enters a generation preview page
- Default: 5 new questions per run (adjustable)
- Preview page allows editing and selecting which generated items to keep → bulk import
- Imported AI questions carry `source: "ai"` for later filtering / removal
- Three drill modes: **library only / AI only / mixed**

### 3.5 Multi-Device Sync

- Single source of truth: **overseas cloud server**
- **Sync strategy**: refresh-on-open; edit conflicts resolved by last-write-wins on `updated_at`
- **Soft delete**: deletion sets `deleted_at` to prevent one device from resurrecting another's deletion
- **No offline entry**: when offline, the desktop entry button is disabled — avoids the complexity of a local sync queue

### 3.6 Import / Export

- Custom **JSON** format
- On import, duplicate detection by question UUID; **default behavior: skip duplicates** (other strategies may be added later)
- Export includes full question content, options, answers, tags, and knowledge summaries

---

## 4. Platform Roadmap

| Platform | v1 | v2+ |
|---|---|---|
| Windows desktop | Yes | |
| Web | Yes | |
| macOS desktop | | Yes |
| Android | | Yes |
| iOS | | Yes |
| Chrome extension | | Optional |

---

## 5. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend UI | React + TypeScript + Vite | Single codebase shared by Web and Electron |
| Desktop shell | **Electron** | Mature support for screen capture, floating widgets, subprocesses |
| Backend | **FastAPI (Python)** | Async, strong ecosystem, auto-generated OpenAPI |
| Database | **PostgreSQL** | JSON columns + full-text search + relational modeling |
| OCR | **PaddleOCR** (Python sidecar subprocess) | Markedly better Chinese recognition than Tesseract |
| LaTeX rendering | **KaTeX** | Shared between Web and Electron |
| AI model | **DeepSeek-V3** default + provider abstraction | Cheap, strong on Chinese |
| Rate limiting | **slowapi** + Redis (or Postgres counter table) | Per-user daily token + per-minute request quotas |
| Auth | **JWT + bcrypt**, email + password | Email verification not enforced in MVP |
| Deployment | Overseas VPS + Docker Compose + Caddy | Automatic HTTPS |

### Desktop Architecture Highlights

- **Main management window**: question library browsing, editing, tag management, review entry
- **System tray icon**: always present
- **Floating pet widget** (toggleable): always-on-top circular button, draggable position
- **Global hotkey**: triggers the screen-region OCR overlay
- **OCR subprocess**: Electron spawns a Python PaddleOCR process on startup, communicating via stdio or local HTTP

### Suggested Project Layout

```
ai-question-bank/
├── apps/
│   ├── web/          # React + Vite, web entry
│   ├── desktop/      # Electron shell, reuses web build output
│   └── server/       # FastAPI backend
├── packages/
│   ├── shared/       # Shared TS types + API client
│   └── ocr-sidecar/  # Python PaddleOCR service
└── Docs/
```

---

## 6. Data Model Overview

Core tables:

```
User        (id, email, password_hash, created_at)
Tag         (id, user_id, name, parent_id, path, created_at, updated_at, deleted_at)
Question    (id, user_id, stem, type, options[], correct[], knowledge_summary,
             source, created_at, updated_at, deleted_at)
QuestionTag (question_id, tag_id)
ReviewLog   (id, user_id, question_id, correct, answered_at)
GenSession  (id, user_id, seed_question_ids[], created_at)
```

Field notes:

- `Question.type`: `single` / `multi` / `judge`
- `Question.options`: JSON array, `[{"label":"A","content":"..."}, ...]`
- `Question.correct`: array of correct option labels (multiple for multi-choice)
- `Question.source`: `manual` / `ocr` / `ai`
- `Tag.path`: materialized path (e.g. `Math/Calculus/Limits`) for prefix queries
- `ReviewLog`: per-attempt record; the wrong-answer set is aggregated from this table

---

## 7. AI Strategy

**Default model**: DeepSeek-V3
- Input pricing ~CNY 1 per million tokens, strong Chinese, accessible from mainland
- Calling from an overseas server adds ~200 ms cross-border latency — acceptable

**Abstraction layer**: define a `LLMProvider` interface so OpenRouter / Qwen / GPT can be swapped in.

**Three call scenarios**:

| Scenario | When | Cost weight | Prompt essentials |
|---|---|---|---|
| Tag suggestion | At entry time | Light | Stem + existing tag list → top-3 |
| Knowledge summary | At entry time | Light | Stem → 1-2 sentence summary |
| Question generation | User-triggered | Heavy | Seed questions + knowledge → N new items as JSON |

---

## 8. Security & Rate Limiting

- **API keys never leave the server** — all AI calls proxied through the backend
- **Rate limiting dimensions**: per-user daily token quota + per-minute request count
- **Passwords**: bcrypt hashed
- **HTTPS**: Caddy with automatic certificate issuance
- **CORS**: allowlist (frontend domain + Electron protocol)

---

## 9. Roadmap

**v1 (MVP)**

- Windows + Web dual platform
- Question entry (manual + screen-region OCR)
- Hierarchical + multi-tag system + AI suggestion
- AI knowledge summary
- Question library management (CRUD, filter, search)
- Flashcard review + automatic wrong-set collection
- AI question generation (5 per run, edit-and-confirm before import)
- Cloud sync (LWW + soft delete)
- JSON import / export
- DeepSeek integration + server-side rate limiting

**v2**

- Floating pet widget + customizable hotkeys
- SRS spaced repetition
- OCR for math formulas (Pix2Text)
- Targeted wrong-answer review mode
- macOS desktop

**v3**

- Android / iOS
- Question-set sharing / public libraries
- Chrome extension
- Team collaboration / public service capability

---

## 10. Explicitly Out of Scope in v1

- Fill-in-the-blank questions
- Images embedded in options
- Error-prone option marking
- AI-generated explanations
- Offline question entry
- Multi-user collaboration
- Mandatory email verification
- Mobile platforms
- SRS algorithm

---

## 11. Open Items

To be confirmed before implementation:

1. Concrete rate-limit thresholds (daily token cap, per-minute request cap)
2. Specific VPS provider (Vultr / Hetzner / DigitalOcean / AWS Lightsail / …) and initial sizing
3. UI sketches for the desktop main window and pet widget
4. JSON import/export schema details
5. Maximum tag hierarchy depth (5 levels suggested as ample)
