# Phase 8 — AI Question Generation in Review — Design

> Status: design approved via brainstorming on 2026-05-19. Implements
> Roadmap stage 8 (adapted — see §3). Companion docs:
> `docs/Roadmap_CN.md` §8, `docs/Proposal_CN.md`.
> Branch: `phase-8-ai-generation` (all phase-8 work commits here, merged
> to `main` only after the exit criteria pass — same workflow as phase 7).

## 1. Goal

From the existing Review entry page, let the user generate fresh AI
questions seeded by the questions they pick, then review them as
flashcards mixed with — or instead of — their own bank questions. AI
questions are **ephemeral**: they never enter the bank automatically
(not even when answered wrong); the user keeps the good ones via an
explicit **"Add to question bank"** button during the session. Every
generated question ships with its own tags and a knowledge-summary
("analysis").

Exit criterion (Roadmap §8, adapted): pick 3 seed questions → generate 5
→ review them; in "AI only" mode the session contains purely AI
questions; "Add to question bank" on 2 of them lands them in the bank
(`source=ai`, with tags + analysis) and they are editable via the
existing form. AI questions answered wrong do **not** enter the wrong
set.

## 2. Confirmed product decisions

Resolved with the user during brainstorming; binding:

1. **Seed source = picker selection.** The questions ticked in the
   existing Review picker are BOTH the AI generation seeds AND (in mixed
   mode) the bank questions reviewed this session. Zero new selection
   UI. AI modes require ≥1 selected question (the backend
   `/ai/generate` mandates `seed_question_ids` ≥ 1).
2. **Tag strategy = existing tags only.** The model picks tag names
   FROM the user's existing tag list only (same safe constraint as
   `/ai/suggest-tags`); it never invents tags. "Add to question bank"
   resolves names → existing tag ids; unmatched names are dropped; no
   tag is ever created.
3. **AI question count = a number input, 1–10, default 5** (matches the
   backend per-call cap). Used by both mixed and AI-only modes.
4. **No inline editing.** The review/add flow has no editor. Added AI
   questions are edited later via the existing question form. (This
   intentionally diverges from the Roadmap §8 "preview page with
   per-question edit" wording — it matches the user's described
   review-first flow.)
5. **AI questions are ephemeral and never auto-banked.** They carry no
   DB id, so they cannot write a ReviewLog and cannot enter the wrong
   set — answering one wrong has no persistent effect. Only the explicit
   "Add to question bank" button persists one.
6. **Three AI modes on the entry page:** `Off` (default; current
   bank-only behavior, untouched path) / `Mixed` (selected bank
   questions + N AI questions in one deck) / `AI only` (only the N AI
   questions; the selected questions act purely as seeds).

## 3. Relationship to Roadmap §8

Roadmap §8 originally described: multi-select on the question-bank list →
a generation preview page with per-question edit/checkbox → bulk import,
plus a review-mode selector. The user's phase-8 brief reshapes this into
a **review-first** flow driven from the existing Review picker, with the
keep-decision made live during the session via "Add to question bank"
instead of a separate preview/import page. The Roadmap exit criterion
(3 seeds → 5 generated → keep some → review AI-only) is preserved; the
"edit two before import" step becomes "edit later in the bank" per
decision §2.4.

## 4. Chosen approach (Route A)

AI drafts get **client-side synthetic ids** (`crypto.randomUUID()`),
wrapped into objects shaped exactly like `Question` plus an `__ai`
marker carrying the already-filled `knowledge_summary` and the
name→existing-`Tag[]`-resolved tags. The picker calls `/ai/generate`,
builds the AI cards client-side, merges them into the deck, and passes
them through the existing router-state path to `ReviewSessionPage`. The
session gets one branch: an AI card skips `postReviewLog` / wrong-set
and renders the "Add to question bank" button.

Rejected alternatives:
- **Persist-first then review** (Roadmap-ish): violates decision §2.5
  (no auto-banking, even on wrong); pollutes the bank with unwanted
  drafts.
- **Separate AI review route/runner:** duplicates the entire flashcard
  runner and makes mixed mode (bank + AI in one deck) awkward.

Why Route A: maximum reuse of the existing deck/session/scoring
machinery, minimal backend change (extend one endpoint), no new
tables/endpoints, and "no auto-bank / no wrong-set on wrong" falls out
for free from AI cards having no DB id.

## 5. Architecture & data flow

### 5.1 Review entry page → session

1. **New controls** in the bottom Submit bar, alongside the existing
   Random pick / Shuffle options / Fast mode:
   - AI mode segmented selector: `Off | Mixed | AI only` (reuses the
     List/Cards segmented-button style).
   - "AI count" number input (1–10, default 5; disabled when mode =
     Off).
   - Hint text: AI modes need ≥1 selected question as seed; AI
     questions are not auto-saved to the bank.

2. **On Submit:**
   - **Off:** existing logic verbatim (`/review/deck` → session). Zero
     change to this path.
   - **Mixed / AI only:** validate `selected.size ≥ 1` (else
     `setError`, no navigation). `setBusy(true)`, button shows
     "Generating…". Call `POST /ai/generate`
     (`seed_question_ids = selected ids`, `count = AI count`).
     - Filter out `valid === false` drafts (no inline edit ⇒ a
       malformed question cannot be reviewed/scored).
     - Wrap valid drafts into AI cards (`buildAiCards`).
     - **Mixed:** deck = bank questions from `/review/deck`
       (selected ids) + AI cards; `requestedOrder = [...ids,
       ...aiCardIds]`; existing shuffle/order rules apply.
     - **AI only:** deck = AI cards only; `requestedOrder =
       aiCardIds` (selected questions are seeds, not reviewed).
   - Navigate to `/review/session` via the existing `reviewConfig`
     router-state structure (`isWrongSetSession: false`).

### 5.2 Session behavior (`ReviewSessionPage`)

- **Bank card:** 100% unchanged (scores, writes ReviewLog, feeds wrong
  set).
- **AI card:** counts toward the session tally and summary, but **no
  ReviewLog, no wrong set** (no DB id ⇒ inherently so — satisfies
  "wrong answer doesn't enter the set either"). Shows an "Add to
  question bank" button (available before and after reveal).
- **"Add to question bank":** calls the existing `POST /questions`
  (`source="ai"`, resolved `tag_ids`, `knowledge_summary`). On success
  the button becomes "Added ✓" disabled. The card stays ephemeral for
  the rest of the session (no backfilled log, id unchanged) — it only
  takes the normal path when next selected from the bank. This avoids
  mid-session id-swap complexity.

### 5.3 Tag resolution data flow

The model returns tag **names** (constrained to the user's existing tag
names). The entry page already loads `tags`; reuse it as the
name→`Tag` map. `buildAiCards` resolves names to existing `Tag` objects
(case-insensitive, deduped, ≤3); unmatched names are dropped. "Add to
question bank" sends those resolved tag ids. No tag is ever created.

## 6. Backend changes

All changes are in `/ai/generate` — one call produces tags + analysis
together (lowest cost, no extra round-trips). No new endpoint, no new
table, no migration (`source="ai"` is already allowed by the DB CHECK;
"Add to question bank" reuses the existing `POST /questions`).

### 6.1 Schemas (`schemas.py`)

- `GeneratedQuestion` gains:
  - `knowledge_summary: str` — 1–2 sentence analysis; reuses the
    stage-6 LaTeX rule.
  - `tags: list[str]` — tag names chosen ONLY from the existing-tag
    list passed in the prompt, ≤3, model must not invent any.
- `GenerateOut` unchanged (`questions: list[GeneratedQuestion]`).

### 6.2 Router (`ai.py` `generate`)

- Additionally load the user's live tag names (reuse the
  `select(Tag).where(user_id, deleted_at IS NULL).order_by(path)`
  pattern from `suggest_tags`); pass the names into the prompt.
- Per returned question, normalize:
  - `knowledge_summary`: missing → `""`, with the same type-guarding
    as the existing stem/options handling.
  - `tags`: keep only items that **exactly** match an existing tag name
    (case-insensitive, deduped, ≤3); drop the rest. The endpoint
    returns tag **names only**, not ids (name→id resolution happens at
    "Add to question bank" time, keeping `/ai/generate` side-effect-free
    and consistent with the existing `GenSession` write).
  - `valid`: unchanged (still the `QuestionIn` stem/type/options/correct
    consistency check; `knowledge_summary`/`tags` do not affect `valid`
    — missing either is non-fatal).
- Everything else unchanged: daily-cap pre-check, `record_usage`,
  `GenSession` write, `temperature=0.8`, 502/503/429 semantics, slowapi
  rate limit.

### 6.3 Prompts (`prompts.py`)

- `GENERATE_SYSTEM` appends, per question:
  - `knowledge_summary`: 1–2 sentence concept analysis; does not restate
    the question or reveal the answer (mirrors
    `KNOWLEDGE_SUMMARY_SYSTEM` plus `LATEX_RULE`).
  - `tags`: choose ≤3 most-relevant names FROM the given existing-tag
    list only; empty list or no good fit ⇒ `[]`; never invent a tag
    (mirrors `SUGGEST_TAGS_SYSTEM`'s safety wording).
- New JSON shape:
  `{"questions":[{"stem","type","options","correct","knowledge_summary","tags"}, ...]}`.
- `generate_user(seeds_json, n, tag_names)`: add `tag_names` (JSON) into
  the user prompt (same style as `suggest_tags_user`).

## 7. Frontend changes

### 7.1 AI client (`lib/ai.ts`)
- Add `GeneratedQuestion` (`stem/type/options/correct/valid/
  validation_error/knowledge_summary/tags:string[]`) and `GenerateOut`.
- Add `generate(seedQuestionIds, count): Promise<GenerateOut>` →
  `POST /ai/generate`.

### 7.2 Question client (`lib/qbank.ts`)
- Widen `QuestionPayload.source` from `"manual" | "ocr"` to
  `"manual" | "ocr" | "ai"` (backend already accepts it; frontend type
  gap only).

### 7.3 AI-card pure module (new `lib/review/aiDraft.ts` + vitest)
- `buildAiCards(drafts, tagsByName): AiCard[]`
  - Keep only `valid === true` drafts; per card
    `id = crypto.randomUUID()`; attach `__ai` marker carrying
    `knowledge_summary` and the resolved existing `Tag[]` (name→id hit
    kept, miss dropped, never created).
  - The object is `Question`-shaped (`id/stem/type/options/correct/
    knowledge_summary/tags/source:"ai"` + `__ai:true`) so existing
    `buildDeck` / card rendering reuse it unchanged.
- `isAiCard(q)` helper (reads `__ai`) — the single source of truth the
  session uses.

### 7.4 Review entry page (`ReviewEntryPage.tsx`)
- Bottom bar: AI mode segmented selector `Off | Mixed | AI only` +
  "AI count" number input (1–10, default 5; disabled when Off).
- Reuse the already-loaded `tags` as the name→id source (no extra
  request).
- `onSubmit` branch as in §5.1. Failures keep the user on the page
  (§8).

### 7.5 Session page (`ReviewSessionPage.tsx`)
- `doReveal`: `if (isAiCard(q))` → skip `postReviewLog` (and the
  log-retry banner); still `setResults` (counts in the tally/summary).
- AI card: render an "Add to question bank" button (next to Quit,
  available before & after reveal):
  - Calls `createQuestion({ stem,type,options,correct,
    knowledge_summary, tag_ids: resolved existing ids, source:"ai" })`.
  - Success → button "Added ✓" disabled, tracked in an
    `added: Set<cardId>` keyed by synthetic id. Failure → inline red
    "Couldn't add — click to retry".
- Wrong-set UI (Mark as mastered etc.) never appears for AI cards
  (`isWrongSetSession` is false and there is no DB-id path).
- Summary page: unchanged; AI and bank cards both count.

### 7.6 Routing
- No new routes (`/review`, `/review/session` reused). `App.tsx`
  unchanged.

## 8. Error handling & edge cases

1. **Generation failure (on entry page, before navigation):**
   `503` → "AI is not configured."; `502`/`429` → show
   `ApiError.message` (existing `e instanceof ApiError ? e.message :
   "Network error"` pattern). No navigation; `setBusy(false)` restores
   the button; the user can adjust and retry.
2. **Empty / all-invalid result:** model returns 0, or 0 valid after
   filtering:
   - **AI only:** error "AI returned no usable questions. Try different
     seeds or try again."; no navigation.
   - **Mixed:** non-blocking warning ("AI generation produced no usable
     questions; continuing with your selected questions.") then proceed
     with the bank-only deck — one AI failure shouldn't waste the
     selection.
3. **Partial invalid drafts:** `valid=false` ones are dropped (no
   inline edit). Fewer AI cards than requested in mixed mode is normal,
   not an error.
4. **Add to question bank:** duplicate clicks prevented (button
   disabled + `added` set after success). Failure → inline retry, does
   not block continuing. All tag names unmatched → still saved with
   `tag_ids=[]`. After success the card stays ephemeral this session
   (no backfilled log, id unchanged).
5. **Refresh / deep link:** AI deck is in-memory like today's deck; a
   refresh of `/review/session` with no router state bounces to
   `/review` (not persisted in v1, consistent with phase 7).
6. **Daily token / rate limit:** generation is a text task reusing
   stage-6 `assert_under_daily_cap` + slowapi; over-quota → 429 (see
   §8.1). No new mechanism.
7. **Security / ownership:** seed ids filtered server-side by
   `user_id + deleted_at IS NULL` (existing); "Add to question bank"
   reuses the existing `POST /questions` ownership/validation path. No
   new exposure surface.

## 9. Testing strategy

Follows the project's established pattern: frontend pure logic via
vitest (TDD); backend via an httpx ASGITransport verification script
(no committed pytest, consistent with stages 1–7).

### 9.1 Frontend unit tests (vitest, new `lib/review/aiDraft.test.ts`)
- Only `valid=true` drafts kept; `valid=false` dropped.
- Each card has a unique synthetic id, `source:"ai"`, `__ai:true`.
- Tag name→existing `Tag` resolution: hit kept; miss dropped;
  case-insensitive; deduped; >3 truncated.
- `knowledge_summary` passed through; missing → `""` without crashing.
- `isAiCard` true for AI cards, false for a plain `Question`.

### 9.2 Frontend build/lint/test gate
- `pnpm --dir apps/web build` + `lint` + `vitest` all green (existing
  34 tests must not regress).

### 9.3 Backend verification script (extend `scripts/verify_review.py`
or add `scripts/verify_ai_generate.py`)
Real Postgres + httpx, asserting:
- `/ai/generate` returns, per question, a `knowledge_summary` string
  (present; non-empty for a real generation) and a `tags` array where
  every name is one of the user's existing tags (no invented tags).
- `valid` still correctly reflects `QuestionIn` rules (construct an
  invalid-by-design case).
- All-illegal seeds → 400; empty seeds → 422 (existing schema behavior
  must not regress).
- No AI key → 503 (reuse the stage-6 mock/skip strategy).
- "Add to question bank" path: `POST /questions` (`source="ai"` +
  tag_ids + knowledge_summary) succeeds; `GET /questions` shows it with
  `source=="ai"` and the tags correctly attached.

### 9.4 User GUI walkthrough (exit-criteria acceptance)
- Pick 3 seeds → Mixed, count 5 → session shows bank + AI questions
  interleaved (AI marked, with "Add to question bank" + its own
  analysis).
- AI only: session contains only AI questions.
- Answer an AI question wrong: it does NOT enter the wrong set (count
  unchanged); an un-added AI question never reaches the bank.
- "Add to question bank" on 2: the bank shows them (`source=ai`, with
  tag, with analysis) and they open in the existing edit form.

## 10. Out of scope (YAGNI)

- Inline editing of AI questions in the review/add flow (decision §2.4
  — edit later in the bank).
- Persisting / resuming an AI deck across refreshes (consistent with
  phase 7's in-memory deck).
- Creating new tags from AI suggestions (decision §2.2 — existing tags
  only).
- A separate generation preview/import page (replaced by the
  review-first "Add to question bank" flow).
- Multi-select on the question-bank list page (the Review picker's
  selection is the seed source instead).
