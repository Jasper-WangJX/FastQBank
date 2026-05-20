# Phase 9 — Share-Link Cross-Account Transfer + Bulk Operations — Design

> Status: design approved via brainstorming on 2026-05-19. Implements
> Roadmap stage 9 (**replaces** the original "JSON import / export"
> scope — see §3). Companion docs: `docs/Roadmap_CN.md` §9,
> `docs/Roadmap_EN.md` §9, `docs/Proposal_CN.md` §3.6,
> `docs/Proposal_EN.md` §3.6.
> Branch: `phase-9-share-link` (all phase-9 work commits here, merged to
> `main` only after the exit criteria pass — same workflow as phases 7
> and 8).

## 1. Goal

On the question-bank list, let the user multi-select questions (per-row
checkbox + page-level select-all + "select all N filtered") and act on
the selection in bulk: **delete**, **add a tag set** uniformly, or
**bundle the selection into a shareable link**. A separate **Import**
control lets the user paste a share link from anyone (or themselves on
another account) and pull those questions in, deduplicated by UUID.

Exit criterion: from the bank page, tick 3 questions + click "select all
N filtered" to add the remaining 7 → 10 selected → click "Bundle as
link" → copy the URL. Sign in as another account → click Import →
paste the URL → see a preview of 10 questions and the tag set that
will be created/reused → confirm → list shows the 10 questions with
their tags resolved by name (match-or-create) under the new account.
Revoke the link from "My shares" → re-attempting import returns
410. Bulk-deleting 3 questions on account A leaves account B's import
intact (the share payload is a value snapshot).

## 2. Confirmed product decisions

Resolved with the user during brainstorming; binding:

1. **Link mechanism = server-side share token.** `POST /shares` returns
   a short URL (`https://fastqbank.com/s/<token>`); the snapshot lives
   server-side. **Not** a URL-encoded client payload, **not** a
   reference-by-id link (the latter is impossible cross-account — the
   importer can't read the creator's `question_id`).
2. **Lifecycle = permanent + no access logging + revocable by creator.**
   No TTL field, no cleanup job. Soft-deleted (revoked) shares respond
   `410` to GET / import. No analytics on who pulled or how often.
3. **Dedup = by source question UUID, tracked via a new
   `questions.imported_from_id` column.** The share payload carries the
   creator's `question.id` as `source_id`. On import the row is INSERTed
   with a **fresh** `id` (the `questions.id` PK is globally unique, so
   we cannot reuse it across accounts) and `imported_from_id = source_id`.
   Dedup check: skip if the importer already owns a row where
   `id = source_id` (self-import, e.g. testing) OR
   `imported_from_id = source_id` (re-import of a previous import) —
   matched across `deleted_at` (re-importing one the user previously
   deleted does NOT undelete).
4. **Tag passing = by name, match-or-create.** The snapshot carries
   `tag_names: string[]`, not tag ids. On import, names are looked up
   case-sensitively under the importer's account; missing names get a
   new tag created (a flat name, consistent with Phase 8.5).
5. **Select-all = all filtered results.** "Select all" picks every
   question matching the current filter (potentially across pages), not
   just the current page. The current page also has a 3-state header
   checkbox for page-level selection — the full-filter expansion is a
   prompt link shown when the page is fully selected.
6. **Selection state survives paging and filter changes; cleared by
   refresh.** Selection is a `Set<string>` of question ids in React
   state; no localStorage. (E.g. user can filter `math`, pick 5, change
   filter to `physics`, pick 3, end with 8 selected.)
7. **Share size cap = 99 questions per share** (hard limit, returns
   `400` over). Picked over 50 / unlimited / 200 — fits a typical
   "share a quiz set" without DoS-shaped payloads.
8. **Import entry = a paste-link input on the bank page only.** No
   `/import?token=…` deep-link route. Pasted text accepts both a full
   URL (regex-extract the last `/s/<token>` segment) and a bare token.
9. **Bulk "Add tag" UI = a modal reusing the existing `TagPicker`.**
   Append-only semantics: the picked tag set is unioned into each
   selected question's existing tags. No "remove tag" mode.

## 3. Relationship to Roadmap §9

The previous Roadmap §9 entry described "Full JSON export + UUID-dedup
JSON import + library-page Export/Import buttons". **This phase removes
local JSON entirely from v1** (per user direction). The cross-account
transfer use case is satisfied by the share-link mechanism instead.
Local JSON export/import — should it ever be needed — moves to v2 (or
out of scope altogether).

What stays from the original §9:

- UUID-based dedup (kept).
- An "Import" button on the library page (kept; mechanism differs —
  paste a link instead of pick a file).

What changes:

- No JSON schema document. The share payload schema lives only in this
  design + the `0005_shares` migration (no public schema commitment, no
  client-readable file format).
- No Export button (you don't export to disk; you share a link).
- No file picker, no streaming, no batch insert from a file.

## 4. Architecture

### 4.1 Selection state (frontend)

`QuestionListPage` adds:

- `selected: Set<string>` — selected question ids; survives paging and
  filter changes, cleared on hard refresh.
- A per-row icon-only checkbox (rendered in both List and Cards views).
- A list-header 3-state checkbox: unchecked / mixed / current-page
  fully selected (clicking toggles only the visible page's ids).
- A banner that surfaces when the current page is fully selected **and**
  `selected.size < total`: "Selected 10 questions on this page. **Select
  all N filtered**" — clicking the link calls
  `GET /review/tag-question-ids` (existing endpoint, returns all matching
  ids) and unions them into `selected`.
- When `selected.size >= 1`, an action bar above the list:
  `N selected · [Clear] · [Bulk delete] · [Add tag] · [Bundle as link]`.

The bar is **not** sticky — it sits between the filter row and the list,
matching the page's existing layout. (Sticky-on-scroll can be a Phase 10
polish if needed.)

### 4.2 Schema changes

Two changes in **a single migration `0005_shares_and_imported_from.py`**:

**(a) New column `questions.imported_from_id`**

```
ALTER TABLE questions
  ADD COLUMN imported_from_id UUID NULL;
CREATE INDEX questions_imported_from_id_idx
  ON questions (user_id, imported_from_id)
  WHERE imported_from_id IS NOT NULL;
```

No FK constraint — `imported_from_id` references "the original creator's
`question.id`", which may be soft-deleted or even hard-deleted on the
creator's side. The column is purely a dedup tag, written once at
import, never updated.

**(b) New table `shares`:**

```
id          UUID PK
creator_id  UUID FK -> users(id) ON DELETE CASCADE
token       VARCHAR(16) UNIQUE NOT NULL    -- nanoid 12 URL-safe chars (~71 bits)
payload     JSONB NOT NULL                 -- self-contained snapshot
created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
deleted_at  TIMESTAMPTZ                    -- soft-delete = revoke; NULL = active
```

Indexes: `UNIQUE(token)` (already), `INDEX(creator_id, deleted_at)`
(for the "My shares" list).

`payload` schema (versioned to allow future migration without a DB
column rename):

```jsonc
{
  "version": 1,
  "questions": [
    {
      "source_id": "<original question UUID — used for UUID dedup on import; the import row gets a NEW id>",
      "stem": "...",
      "type": "single|multi|judge",
      "options": [{"label": "A", "content": "..."}, ...],
      "correct": ["A"],
      "knowledge_summary": "...",
      "source": "manual|ocr|ai",
      "tag_names": ["math", "calculus"]
    }
  ]
}
```

Notes:

- The payload is **self-contained**: deleting the source question after
  creating a share does NOT affect the share's contents. Likewise,
  editing the source question after share creation does NOT propagate.
- The `source` field is preserved verbatim — an OCR-origin question
  imported under another account still shows `source=ocr`. No new
  `import` source value is introduced; **no `questions.source` CHECK
  change, no migration**.
- Tags are passed by name only. `tag_id` from the creator's account is
  meaningless under the importer's account and is intentionally
  omitted.
- `knowledge_summary` is preserved (may be empty string).

### 4.3 Endpoints

| Endpoint | Auth | Behavior |
|---|---|---|
| `POST /shares` body `{question_ids: [uuid]}` (1..99) | required | Verify every id belongs to the current user (`deleted_at IS NULL`); error 404 if any miss. Build the payload (joining tag names). Insert row; return `{token, share_url}` (URL = `<FRONTEND_BASE_URL>/s/<token>`). 99-cap returns 400. |
| `GET /shares/{token}` | none | Return `{payload, created_at}` if active. 404 if no row, 410 if `deleted_at IS NOT NULL`. **The creator's identity is NOT exposed** (no email, no user_id) — consistent with the "no access logging / anonymous-ish" stance from §2.2. |
| `POST /shares/{token}/import` | required | Validate active. For each `payload.questions[*]`: dedup-skip if importer owns any row where `id = source_id` OR `imported_from_id = source_id` (matched across `deleted_at`). Otherwise INSERT under the importer's `user_id` with a **fresh `id`**, `imported_from_id = source_id`, `created_at=now()`, `updated_at=now()`; copy `stem` / `type` / `options` / `correct` / `knowledge_summary` / `source` verbatim. Tags: for each `tag_names[*]`, find-or-create under the importer's account; link via `question_tags`. Returns `{imported, skipped, tags_created, tags_reused}`. |
| `GET /shares/me` | required | List the current user's active shares: `{id, token, question_count, created_at}[]`. |
| `DELETE /shares/{id}` | required | Soft-delete (`deleted_at=now()`). Only the creator can revoke. 404 if not theirs. |

Validation details:

- The `POST /shares` request body schema validates `question_ids` is a
  list of 1..99 UUIDs.
- The token format is validated server-side on `GET`/`POST .../import`
  (length 12, URL-safe charset) before DB lookup.
- All endpoints share the existing slowapi per-user rate limiter; no new
  ratelimit tier.

### 4.4 Frontend additions

**On the question-bank page header** (next to existing
`[OCR capture] [+ New question]`):

- `[Import]` button — opens an Import modal.
- `[My shares]` text-link button — opens a My-Shares modal listing the
  current user's shares with per-row `[Copy link]` and `[Revoke]`.

**Action bar** (visible when `selected.size >= 1`):

- `N selected` counter
- `[Clear]` → empties the Set
- `[Bulk delete]` → `confirm()` "Delete N questions?" → fire
  `DELETE /questions/{id}` for each id (in parallel, capped concurrency
  10); on completion refetch the list and drop deleted ids from the
  Set.
- `[Add tag]` → opens a Tag modal with the existing `TagPicker`. On
  Apply: for each selected question, `PATCH /questions/{id}` with the
  union of its current tag ids and the newly picked tag ids (tag ids
  are resolved client-side from `TagPicker`'s output). The patch is
  guarded against accidentally overwriting other fields by sending only
  `tag_ids`.
- `[Bundle as link]` → `POST /shares` with `{question_ids: [...selected]}`;
  on success show a Modal with the full URL + a `[Copy]` button + a
  short "Anyone with this link can import these N questions until you
  revoke it" hint. **Does not clear the selection** — the user often
  wants to share twice (e.g. send to two friends), and clearing would
  cost them.

**Import modal**:

1. Step 1: a textarea labelled "Paste share link or token". Extract
   token via `/\/s\/([A-Za-z0-9_-]{12})\b/` or accept a bare 12-char
   token. Disable [Next] until a token is found.
2. Step 2: server roundtrip `GET /shares/{token}` → render a compact
   list of question stems (truncated to 80 chars each, no LaTeX
   render — keeps the modal cheap) + a tag summary "N tags total — X
   will be reused, Y will be created". Buttons: `[Cancel]` /
   `[Import]`.
3. On `[Import]` → `POST /shares/{token}/import` → toast
   `Imported X · Skipped Y · Tags reused Z, created W`; close the modal;
   refetch the question list.

Errors are surfaced inline in the modal: 410 → "This link has been
revoked." 404 → "Link not found." 422 → "Couldn't read this link's
contents." Network → "Network error — retry?".

**My-shares modal**:

- Lists `[Copy] <token> · <count> questions · <created_at relative> ·
  [Revoke]` per active share. `[Revoke]` triggers `confirm()` and on
  confirm `DELETE /shares/{id}` then drops the row from the list. The
  modal is read-only otherwise — no rename, no payload preview (defer
  to v2 if ever wanted).

### 4.5 Where things live

```
apps/server/
  alembic/versions/0005_shares_and_imported_from.py  # NEW (shares table + questions.imported_from_id column)
  app/models.py                     # +Share model; Question gets imported_from_id field
  app/schemas.py                    # +ShareCreateIn / ShareOut / SharePayload / SharePreviewOut / ShareImportOut / MyShareRow
  app/routers/shares.py             # NEW: 5 endpoints
  app/main.py                       # mount the new router

apps/web/src/
  lib/qbank.ts                      # +createShare, getSharePreview, importShare, listMyShares, revokeShare
  pages/QuestionListPage.tsx        # add selection state, header, action bar, modals
  components/share/
    ImportModal.tsx                 # NEW (paste → preview → import)
    BundleResultModal.tsx           # NEW (shows URL + Copy)
    MySharesModal.tsx               # NEW
    BulkAddTagModal.tsx             # NEW (wraps TagPicker)
```

No changes to existing tag / question CRUD endpoints; `PATCH
/questions/{id}` already accepts `tag_ids` and is reused as-is. No
changes to `/review/tag-question-ids` — reused as-is for "select all
filtered". No changes to Phase 8 AI generation or Phase 7 review.

## 5. UX edge cases (binding)

- **Empty selection after bulk delete.** When `selected.size > 0` and a
  delete completes, drop deleted ids from the Set. If the Set empties,
  the action bar disappears as usual.
- **Selection across filters.** Switching filters does NOT clear the
  Set. Items in the Set that aren't on screen still count toward `N
  selected`. The header checkbox state is computed against the current
  page only.
- **Refresh.** `selected` is in-memory React state. A hard refresh
  empties it. Deliberate — avoids stale ids after deletes performed in
  another tab.
- **Selected items deleted in another tab.** Bulk operations send the
  current id list to the server; the backend silently skips ids the
  user no longer owns (matches existing single-question DELETE
  semantics, which also 404s — we just swallow the 404). The list
  refetch after the operation will reconcile.
- **Bundle with a tag the creator soft-deleted between selection and
  bundle.** The payload's `tag_names` is built from a JOIN that already
  filters soft-deleted tags (existing `question_tags` join behavior
  from Phase 3); such tags drop out silently. No error.
- **Importing under the SAME account that created the share.** Allowed
  (e.g. for testing). The dedup's `id = source_id` clause kicks in →
  every question is skipped → toast "Imported 0 · Skipped N". Not a
  failure case.
- **Re-importing a previously soft-deleted question.** The dedup check
  ignores `deleted_at` (matches live + soft-deleted rows) → the
  question is skipped. The previously-deleted row is **not** undeleted
  by import. Resurrecting a soft-deleted item is a separate concern
  (not in scope this phase).
- **Re-importing the same share under the same account a second time.**
  Round 1 inserts rows with `imported_from_id = source_id`. Round 2's
  dedup catches those via the `imported_from_id = source_id` clause →
  all skipped.
- **Pasting a malformed link.** Token regex fails → Step 1 stays
  disabled and shows an inline hint "Couldn't find a share token in
  this text".
- **Self-bundling with no selection.** `[Bundle as link]` is hidden
  when `selected.size === 0`, so this isn't reachable from UI; backend
  validates 1..99 anyway.

## 6. Out of scope (deferred)

- Local JSON file export / import (was the original Phase 9 plan).
- Share expiration / TTL.
- Share access analytics (who pulled, how many times).
- Password-protected shares.
- Bulk operations beyond delete / add-tag / share (no bulk rename, no
  bulk source change, no bulk remove-tag).
- A dedicated `/import?token=...` deep-link route (you paste the link
  into the modal instead).
- A standalone "My shares" full-page UI (modal is enough for v1).
- Sticky action bar on scroll (acceptable polish if requested; not
  blocking).

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Payload bloat — 99 questions with long stems / LaTeX can be sizable JSONB. | 99 is a hard cap; rough math: 99 × ~2KB ≈ 200KB JSONB row, comfortably under Postgres limits. No streaming needed. |
| Importing 99 questions sequentially is slow. | Run the per-question INSERT and tag-link batch inside a single transaction; tag find-or-create batched by name before any insert. Expected ≤300ms for 99 items. |
| Token guessing. | 12-char URL-safe nanoid ≈ 71 bits ≈ infeasible. No additional per-IP rate limit needed (slowapi already covers the import endpoint per user). |
| Anonymous flood on `GET /shares/{token}`. | The existing slowapi config keys on `get_remote_address` for unauthenticated requests; reuse it with a generous per-IP cap (e.g. 60/min) on this path. No new ratelimit tier added. |
| Snapshot grows stale (creator edits the question after sharing). | Documented in the share-creation modal: "links capture the questions as they are now." No auto-refresh of payloads. |
| Tag name collision under the importer's account (importing creates a tag the user already has under a different casing). | Case-sensitive match in v1 (intentional simplicity, matches `tags.name` UNIQUE constraint behavior). If users hit this, v2 can add a normalize-on-match step. |

## 8. Verification (exit-criterion script)

Backend verification will live in `scripts/verify_phase9.py` — same
httpx-ASGITransport pattern as `verify_review.py`. Coverage at minimum:

1. **Create share, 99-cap, ownership.** Owner can create with 1 / 99
   ids; ≥100 returns 400; including a non-owned or soft-deleted id
   returns 404. Token format is 12 chars, URL-safe.
2. **GET token returns payload; soft-delete returns 410.** Anonymous
   GET works; revoked → 410; nonexistent → 404.
3. **Import under another account.** All N inserted; tags created /
   reused by name; counters match. `question.source` preserved
   verbatim. Each new row gets a **fresh `id`** and
   `imported_from_id = source_id`. `user_id` is the importer's.
4. **UUID dedup.** Importing the same share twice under the same
   account: round 2 is all skipped (via `imported_from_id`). Importing
   under the creator's own account: all skipped (via `id = source_id`).
   Importing after a soft-delete on the imported row: still skipped
   (deleted_at-agnostic match; does not undelete).
5. **My-shares + revoke.** `GET /shares/me` lists only own active rows.
   `DELETE` only by creator. Revoked then re-import → 410.

Frontend verification (manual + `pnpm test` for any new pure helpers,
e.g. token-extraction regex):

- Selection state: page checkbox / per-row / cross-page / "select all
  N filtered" expansion / Clear button / refresh clears.
- Bulk delete: confirms count, deletes all, refetches, drops from Set.
- Add tag: applies union, no other fields change (assert by editing one
  of the affected questions and checking its other fields untouched).
- Bundle: returns URL, [Copy] writes to clipboard, selection retained.
- Import modal: full URL accepted, bare token accepted, malformed
  rejected with inline hint, preview shows counts, import toasts and
  refetches.
- My-shares modal: lists own shares, Copy works, Revoke confirms then
  removes the row; an active token then 410s on import.
