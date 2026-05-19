# Phase 7 — Flashcards Review + Wrong-Question Set — Design

> Status: design approved via brainstorming on 2026-05-18. Implements
> Roadmap stage 7. Companion docs: `docs/Roadmap_CN.md`,
> `docs/Proposal_CN.md` §3.3.

## 1. Goal

Let the user build a custom set of questions, run through them as
flashcards (answer → reveal → next), record every attempt, and keep a
**persistent, manually-cleared wrong-question set**.

Exit criterion (Roadmap): run a 20-card session, the ones answered wrong
show up in the wrong-question set; marking one "mastered" removes it;
answering it wrong again brings it back.

## 2. Confirmed product decisions

These were resolved with the user during brainstorming and are binding:

1. **Wrong-set semantics — persistent, manual clear.** A question
   answered wrong enters the wrong set and stays. Answering it correctly
   later does **not** remove it. Only an explicit "mark as mastered"
   action removes it. Answering it wrong again after mastering
   re-activates it.
2. **Manual clear from two places.** Both the wrong-set list view (per
   row) and the flashcard (during a wrong-set review session).
3. **"Fast mode" toggle** (renamed from "auto-reveal"). OFF (default):
   the user picks, then clicks **Check** (single/judge) / **Submit**
   (multi) to reveal correctness. ON: single/judge reveal the instant an
   option is picked (no Check button); multi still needs Submit. Both
   modes score and write a ReviewLog.
4. **Navigation.** New top-nav item **Review**. The wrong set is *not* a
   separate nav item — it is a special entry at the top of the tag
   column inside the Review page.
5. **Entry page is a question picker** (not a tag+random form):
   - A **tag column** is the primary navigation. A special
     `⚠ Wrong questions (N)` entry sits at its top.
   - Clicking a tag lists, in the main area, **all questions in that
     tag's subtree**. Clicking the Wrong entry lists all active wrong
     questions.
   - Each question has a **green toggle button** (Selected / Select).
   - A **global Select all / Deselect all** button acts on the
     currently listed questions; its label reflects current state and
     updates as the user toggles questions by hand.
   - **Selection is a single global set of question IDs.** Default state
     when entering a tag is unselected, *except* questions already in
     the global set (e.g. selected under another tag) stay green —
     selection follows the question, not the tag. The "N selected"
     count is the deduplicated size of the global set.
   - Selection is **session-only**, not persisted.
6. **Bottom Submit bar** holds: `Random pick` + `count` (optional random
   cap drawn from the selected pool; off ⇒ run all selected in order),
   `Shuffle options` (per-card A/B/C/D shuffle; judge T/F never
   shuffled), `Fast mode`, and `Submit · Start review →`.
7. **End-of-session summary**: correct/wrong counts, list of the wrong
   ones, buttons "Review wrong now" and "Back to review home".

## 3. Architecture overview

Stateless, client-driven session (matches the existing "fetch then
operate" patterns; no server-side session state — explicitly rejected
GenSession-style management as YAGNI for personal v1).

```
Review page (picker)
  ├─ tag column  ──────────────► GET /questions?tag_id=  (reuse, subtree)
  │  └─ "⚠ Wrong (N)" entry ───► GET /review/wrong
  ├─ global selection set (client, Set<questionId>)
  └─ Submit ─► POST /review/deck {question_ids, limit?} ─► QuestionOut[]
                                                              │
Flashcard session (client-held deck) ◄────────────────────────┘
  per card: pick → reveal → POST /review/logs {question_id, correct}
                              └─ correct=false ⇒ upsert wrong_questions
  (wrong-set session only) "Mark as mastered" ─► POST /review/wrong/{id}/master
  end ─► summary
```

## 4. Data model

New Alembic migration `0003_wrong_questions`. `ReviewLog` already exists
from the stage-1 baseline (`id, user_id, question_id, correct,
answered_at`, `ix_review_logs_user_answered`) — no change, just start
writing rows.

```
wrong_questions
  id           uuid PK  default gen_random_uuid()
  user_id      uuid FK users.id        not null
  question_id  uuid FK questions.id    not null
  added_at     timestamptz not null default now()
  cleared_at   timestamptz null          -- NULL ⇒ active in the set
  UNIQUE(user_id, question_id)
  INDEX ix_wrong_user_active (user_id) WHERE cleared_at IS NULL
```

Write semantics (PG `ON CONFLICT` atomic upsert, mirrors the stage-6
`ai_usage` pattern):

- Wrong answer: `INSERT … ON CONFLICT (user_id, question_id) DO UPDATE
  SET cleared_at = NULL, added_at = now()` — first entry, or re-activate
  a previously mastered row.
- Correct answer: no-op against `wrong_questions`.
- Mark mastered: `UPDATE … SET cleared_at = now()` where active.

Soft-deleted questions are excluded from every read by joining
`questions.deleted_at IS NULL` (consistent with all existing read
paths); no cleanup job on `wrong_questions`.

## 5. Backend API

New `apps/server/app/routers/review.py`, registered in `main.py`.
Conventions follow `questions.py`: explicit paths, `user: CurrentUser`,
every query scoped to the user and `deleted_at IS NULL`, 404 (not 403)
on a non-owned/missing question id.

| Endpoint | Purpose |
|---|---|
| `POST /review/deck` | Body `{question_ids: UUID[], limit?: int}`. Returns the owned & live questions among `question_ids` as `QuestionOut[]`. If `limit` given, server returns a random sample of that size (`ORDER BY random()`); else all (cap 1000). |
| `POST /review/logs` | Body `{question_id, correct}`. Insert one `ReviewLog`; if `correct=false`, upsert `wrong_questions`. 204. |
| `GET /review/wrong` | Active wrong questions as `{items: QuestionOut[], total}` ordered by `added_at DESC`. Backs the tag-column "⚠ Wrong (N)" count and listing. |
| `POST /review/wrong/{question_id}/master` | Set `cleared_at=now()` where active; 404 if not in the active set. 204. |

Picker support: the tag column reuses the existing
`GET /questions?tag_id=` (already subtree + paginated). For "Select all"
of a large subtree the client needs every matching id, not just one
page — a lightweight `GET /review/tag-question-ids?tag_id=` returns just
the `UUID[]` of live questions in that tag's subtree. The subtree
predicate currently inlined in `questions.list_questions` is extracted
into a shared helper reused by both routers (incidental cleanup, scoped
to this work). Likewise the `QuestionOut` + batched-tags builder is
extracted so `/review/deck` and `/review/wrong` reuse it.

New typed client `apps/web/src/lib/review.ts` (`getDeck`,
`postReviewLog`, `getWrongSet`, `masterWrong`, `getTagQuestionIds`),
thin wrappers over `apiFetch`, same shape as `qbank.ts`.

## 6. Frontend

Routes added in `App.tsx` under the authenticated shell; `AppLayout`
gets a `Review` nav link:

- `/review` — `ReviewEntryPage` (the picker).
- `/review/session` — `ReviewSessionPage` (the card runner). Receives
  its config (deck question list + flags: randomCount, shuffleOptions,
  fastMode, isWrongSetSession) via router `state` (same pattern as the
  OCR prefill in `AppLayout`). Direct nav / refresh with no state ⇒
  redirect back to `/review`.

### 6.1 ReviewEntryPage (picker)

Two-pane layout:

- **Tag column** (left, primary): a special `⚠ Wrong questions (N)`
  entry on top (N from `GET /review/wrong`), then the tag tree (reuse
  the flattened-by-path tag list already used elsewhere). Selecting an
  entry sets the "active list source".
- **Main area**: header `Questions in "<tag>" (count)` + a global
  `Select all` / `Deselect all` button whose label reflects whether all
  currently-listed ids are in the global set. A list of questions, each
  with a green/grey toggle button. The list source is either a tag
  subtree (`GET /questions?tag_id=`, paginated) or the wrong set
  (`GET /review/wrong`).
- **Global selection** = `Set<questionId>` in component state. Toggling
  a question, Select all (adds the tag's full id set via
  `GET /review/tag-question-ids`), Deselect all (removes them) all
  mutate this one set. A question shows green whenever it is in the set,
  regardless of which tag is currently shown.
- **Bottom Submit bar**: `Random pick` checkbox + `count` number input
  (enabled only when Random pick on), `Shuffle options` checkbox,
  `Fast mode` checkbox with the explanatory note, and
  `Submit · Start review →` (disabled when the set is empty). Submit
  calls `POST /review/deck` with the selected ids (+ `limit` when Random
  pick on) and navigates to `/review/session` with the returned deck and
  flags.

### 6.2 ReviewSessionPage (flashcard)

Client holds the deck array and an index. Per card state machine:

```
answering ──pick──► (Fast mode && type∈{single,judge}) ──► revealed
        └─ else: pick enables Check/Submit ──click──► revealed
revealed: highlight your pick (red if wrong) + correct (green)
          + knowledge_summary if present
          + [Mark as mastered] (wrong-set session only)
          + [Next →] / [Finish] on last card
```

- Selection model: single/judge = one label; multi = a set of labels
  (Submit enabled when ≥1 chosen). Correctness = exact set equality vs
  `correct` (order-independent). Judge options are locked T/F.
- On the first transition to `revealed` for a card, POST
  `/review/logs {question_id, correct}` exactly once (guard against
  double-post). `Shuffle options`: option order is shuffled once per
  card at deck-build time (stable for the session); judge T/F kept in
  natural order. Card order: random when `Random pick` was on (server
  already sampled randomly), otherwise selection order.
- Forward-only. A `Quit` link returns to `/review` (already-answered
  cards are saved, since logs post incrementally).
- End: summary screen — `X / N correct`, `Y wrong`, the wrong stems
  listed; buttons `Review wrong now` (start a wrong-set session) and
  `Back to review home`.

### 6.3 Wrong-set list & review

- "Browse" the wrong set = selecting the `⚠ Wrong questions` entry in
  the picker; each row's green toggle plus a per-row `Mastered` action
  (calls `POST /review/wrong/{id}/master`, drops it from the list and
  decrements N).
- "Review these" = Submit with the wrong set selected; the resulting
  session is flagged `isWrongSetSession` so each card shows
  `Mark as mastered`.

## 7. Edge cases & error handling

- **Empty selection**: Submit disabled; helper text.
- **Deck endpoint returns 0** (all selected were deleted meanwhile):
  session page shows "No questions to review" and a link back.
- **ReviewLog POST fails**: non-blocking top banner
  "Couldn't save result · Retry"; the session continues (results are
  best-effort but the retry is offered because the exit criterion
  depends on them). Reveal/Next are not blocked.
- **Refresh mid-session**: in-memory deck is lost, user returns to
  `/review`; cards already answered are saved (logs posted per card).
  Documented v1 limitation (no resume).
- **Question soft-deleted** after entering the wrong set: excluded from
  `GET /review/wrong`, `/review/deck`, and tag listings via the
  `deleted_at IS NULL` join.
- **Mastering a question not in the active set**: 404, surfaced as a
  toast; the list refreshes.

## 8. Testing

- **Backend** (httpx ASGITransport, matching prior stages): wrong log ⇒
  appears in `/review/wrong`; correct log ⇒ not added and does not
  remove; master ⇒ leaves the set; wrong again after master ⇒
  reactivates; soft-deleted question excluded; `/review/deck` respects
  ownership, `limit` sampling, and skips foreign/deleted ids;
  `tag-question-ids` returns the full subtree; ownership scoping returns
  404 for other users' ids.
- **Frontend** (vitest, unit-focused like `splitter.test.ts`): pure
  helpers — global selection set add/remove/Select-all/Deselect-all and
  the global-button state, correctness comparison (single/multi/judge
  exact-set), option-shuffle determinism per card, random-cap selection.
- **Manual exit-criterion walkthrough**: build a set, run 20 cards, get
  some wrong, see them under `⚠ Wrong questions`, mark one mastered (it
  leaves), answer it wrong again (it returns).

## 9. Out of scope (deferred)

- SRS / spaced repetition (v2, Proposal §10).
- AI-only / mixed review modes and the AI generation preview — Roadmap
  stage 8.
- Session resume after refresh.
- Persisting a saved selection / named decks.

## 10. Exit criteria

1. From the Review page, build a selection by tag-subtree, individual
   toggles, and the wrong-set entry; the global count is correct across
   tags including multi-tagged questions.
2. Submit (optionally Random-capped) runs a flashcard session; Fast mode
   on/off behaves as specified; every answered card writes a ReviewLog.
3. A 20-card run's wrong answers appear under `⚠ Wrong questions`.
4. `Mark as mastered` (card or list) removes a question; answering it
   wrong again re-adds it.
