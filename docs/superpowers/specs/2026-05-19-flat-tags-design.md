# Flat tags + tag search across pages — design

> **Status:** Designed 2026-05-19. Lives between Phase 8 (AI generation, shipped)
> and Phase 9 (JSON import/export). Single self-contained increment; the goal is
> to make Phase 9 tag round-tripping trivial and to keep tag UX usable as the
> tag count grows.

---

## 1. Motivation

Today every `Tag` has a `parent_id` and an id-based materialized `path` (e.g.
`uuid/uuid/uuid`), letting questions filter by subtree prefix. Two problems
upstream of Phase 9:

1. **Import/export with hierarchy is fragile.** Questions reference tags by
   UUID, so a round-trip either has to carry every ancestor tag too, or
   reconstruct parents by name (collisions, parent-of-same-name, etc.).
   A flat `["微积分", "极限"]` per question is much simpler.
2. **UI scales poorly.** TagManagePanel and the question form both render a
   tree with checkbox/indent UI. Even a few dozen tags become tedious; there is
   no search.

This spec removes hierarchy entirely and adds a unified "search + multi-select
+ AND/OR" tag picker shared by the three tag-aware pages.

## 2. Scope

**In scope**

- Tag data model becomes flat (drop `parent_id`, `path`).
- Enforce `(user_id, name)` uniqueness at the DB layer for live tags.
- Tag filter on **QuestionListPage** and **ReviewEntryPage**: multi-select with
  an AND/OR toggle (default AND).
- Tag picker on **QuestionFormPage**: searchable, flat, with selected-chips.
- New **Manage tags drawer** for create/rename/delete (no parent UI).
- AI tag suggestion endpoint continues to return existing tags only (already
  the case; spec just confirms it survives the flattening).
- One Alembic migration; existing tag data is wiped on upgrade (questions kept).

**Out of scope**

- Phase 9 itself (JSON import/export). This spec only ensures the schema is
  ready for it.
- Any change to questions, review session, AI generation, OCR pipeline, or
  desktop shell.

## 3. User-facing effects

### 3.1 QuestionListPage filter row

Replaces the current tree-style TagManagePanel with a single horizontal row:

```
[search tag…………………………]   AND ⏐ OR   [Manage tags]
Selected: [微积分 ×] [极限 ×] [Clear]
```

- Search filters the candidate-tag list in real time (case-insensitive). The
  candidate list is a popover that appears below the search input on focus or
  while it has text; click outside (or Esc) closes it.
- Inside the popover, candidates render as checkbox rows (consistent with
  §3.3); ticking a checkbox toggles the tag in the **Selected** chip row.
  Clicking the chip's × removes it. The chip row is hidden when nothing is
  selected.
- **AND** (default) = question must carry *every* selected tag; **OR** = at
  least one. The toggle does not clear chips.
- Zero selected tags = no tag filter (today's "All tags" behaviour).
- `Manage tags` opens the drawer (see §3.4).

### 3.2 ReviewEntryPage left column

Same filter UX as §3.1, but laid out vertically inside the 264-px left rail and
co-existing with the two fixed entries:

```
⚠ Wrong questions (12)         (single-select; mutually exclusive with tag filter)
☐ All questions                 ← default
─────────────────────────────
[search tag…………………………]
 AND ⏐ OR
Selected: [微积分 ×] [极限 ×] [Clear]
candidate list (scrollable)
```

- Because the rail is fixed-width and vertical, the candidate list is
  **always visible** below the AND/OR row (no popover). Same checkbox-row
  rendering as §3.1.
- When **Wrong** or **All** is the active source, the tag filter region is
  visually disabled with the hint *"Cancel All / Wrong to filter by tag."*
- Otherwise the right-side question list updates as the user adds/removes chips
  or flips AND/OR.
- `Select all` on the right side keeps its existing semantic — operates on the
  *whole filtered source*, not just the visible page.

### 3.3 QuestionFormPage tags region

Replaces the indented checkbox list:

```
Tags
Selected: [微积分 ×] [极限 ×]        (shown only when ≥ 1 selected)
─────────────────────────────────
[search tag…………………………]
 ☑ 微积分
 ☑ 极限
 ☐ 数列
 ☐ 概率
─────────────────────────────────
[new tag name………] [+ Create & select]
```

- No AND/OR (this is *attach to question*, not *filter*).
- Search + flat checkbox list + chip row are identical to §3.1's interaction.
- **Create & select** keeps the current confirm dialog ("Tags can only be
  renamed or deleted from the Question Bank page"), creates a root-level (now
  the only level) tag, and auto-selects it. If the typed name collides with an
  existing tag, the button is disabled with a hint *"Tag already exists —
  tick it in the list below."*
- AI **suggest tags + summary** continues to work and adds chips to the
  selected row.

### 3.4 Manage tags drawer

Right-side drawer triggered from §3.1 / §3.2's `Manage tags` button; closes on
overlay click / Esc.

```
Manage tags                                                  ✕
─────────────────────────────────
[search tag…………………………]

 微积分                  [✎][🗑]
 极限                    [✎][🗑]
 数列                    [✎][🗑]
 概率                    [✎][🗑]
 …  (scroll)
─────────────────────────────────
[new tag name………] [+ Create]
```

- Search field filters the list in real time.
- **Rename**: clicking ✎ turns the row into inline `[input] [Save][Cancel]`;
  duplicate-name conflict surfaces inline on Save.
- **Delete**: clicking 🗑 triggers `confirm("Delete \"X\"? Questions that used
  it lose this tag.")`, then soft-deletes (`deleted_at = now()`).
- **Create**: the bottom input + button; duplicate name disables the button
  with the same hint as §3.3.
- On close, the parent page refreshes its candidate tag list. Any selected
  chip whose tag was deleted disappears from the chip row.

### 3.5 Edge-cases

- **Zero selected tags** in §3.1 / §3.2: no tag filter; AND/OR toggle is
  visually present but has no effect.
- **One selected tag**: AND and OR produce identical results.
- **Clear** button: empties the chip row *and* the search input; does not
  reset the AND/OR toggle.
- **AI suggested tag missing**: the AI endpoint only returns the user's own
  live tags by id, so this can't happen; no client-side filtering needed.

## 4. Data model & migration

`Tag` table after the change:

| column        | type        | notes                                        |
|---------------|-------------|----------------------------------------------|
| id            | uuid pk     | unchanged                                    |
| user_id       | uuid fk     | unchanged                                    |
| name          | text        | unchanged                                    |
| created_at    | timestamptz | unchanged                                    |
| updated_at    | timestamptz | unchanged                                    |
| deleted_at    | timestamptz | unchanged                                    |

- **Dropped:** `parent_id` column, `path` column, `ix_tags_parent_id`,
  `ix_tags_path`.
- **Added:** `CREATE UNIQUE INDEX uq_tags_user_name ON tags (user_id, name)
  WHERE deleted_at IS NULL;` — duplicate names allowed only across
  soft-deleted rows.

Single Alembic migration `0004_flatten_tags`:

1. `TRUNCATE TABLE question_tags;` (CASCADE not needed — no FKs in)
2. `TRUNCATE TABLE tags;`
3. Drop `parent_id` FK, `parent_id` column, `path` column, related indexes.
4. Create the partial unique index.

`downgrade()` recreates the columns + indexes but explicitly documents that
data is not restored. This is a one-way migration in practice (the project is
pre-launch; only the developer's data is affected).

## 5. Backend API

### 5.1 Tag router (`apps/server/app/routers/tags.py`)

- `POST /tags` — body `{ name }` only. 409 on duplicate, 201 with the new tag.
- `PATCH /tags/{id}` — body `{ name }`. 409 on duplicate.
- `DELETE /tags/{id}` — soft-delete the single row. No subtree concept any
  more; `question_tags` links are kept (harmless, hidden by reads).
- `GET /tags` — flat list ordered by `name`.
- **Removed:** `PUT /tags/{id}/move` (no parent). `parent_id` removed from
  every request/response schema.
- **Removed:** depth/path helpers, `MAX_DEPTH` constant, cycle-prevention code.

### 5.2 Question list filter (`/questions?...`)

- New query params replace the single `tag_id`:
  - `tag_id[]` (repeatable, zero or more uuids).
  - `tag_match` = `all` (default) | `any`.
- Server-side semantics:
  - `tag_match=all` → for every `tag_id`, an `EXISTS` subquery on
    `question_tags` (or one join with `GROUP BY question.id HAVING COUNT
    (DISTINCT tag_id) = N`).
  - `tag_match=any` → single `EXISTS` with `tag_id IN (...)`.
- Validation: any unknown / not-owned / soft-deleted tag id ⇒ 400.
- `subtree_question_predicate` and the path-based code in
  `apps/server/app/question_query.py` go away.

### 5.3 Endpoints unaffected (just behavioural confirmation)

- `/ai/suggest-tags`, `/ai/knowledge-summary`, `/ai/generate` — no behaviour
  change; they already return tags by id and don't rely on `path` semantics.
  Internal ordering switched from `Tag.path` to `Tag.name`.
- `/review/*`, `/ai/usage`, auth — untouched.

## 6. Frontend

### 6.1 New components (all under `apps/web/src/components/tags/`)

- `TagFilter.tsx` — the shared "search + chips + AND/OR" filter used by
  QuestionListPage and ReviewEntryPage. Props:
  - `tags: Tag[]`, `selectedIds: string[]`, `onChangeSelected(ids)`,
    `match: 'all' | 'any'`, `onChangeMatch(m)`, `onOpenManage()`,
    `showMatchToggle?: boolean` (false for the form), `disabled?: boolean`.
- `TagPicker.tsx` — the "search + chips + create" picker used by
  QuestionFormPage. Same internals as TagFilter but no AND/OR and an inline
  create row. Wraps `TagFilter` internally when convenient, or shares a
  lower-level `<TagSearchList>` primitive — implementation detail.
- `TagManageDrawer.tsx` — the right-side drawer with search + per-row
  rename/delete + bottom create. Calls the existing tag REST endpoints.

### 6.2 Removed / replaced

- `TagManagePanel.tsx` — deleted; its filter+CRUD duties move into
  `TagFilter` (filter) + `TagManageDrawer` (CRUD).
- `tagTree.ts` — deleted along with its tests (`depthOf`, `byParent`,
  `flattenInTreeOrder`, `inSubtree`, `sortByPath` are all hierarchy helpers).
  A small `sortByName(tags)` helper replaces them where needed.
- All `flattenInTreeOrder` / `depthOf` callers (QuestionFormPage,
  ReviewEntryPage's `tagDepth`) drop the depth-driven indentation and pass to
  the shared components.

### 6.3 Page integrations

- **QuestionListPage**: replace the `<TagManagePanel>` block with
  `<TagFilter>` and add a `<TagManageDrawer>` whose `open` state is held in
  the page. `tagId` state becomes `tagIds: string[]` + `tagMatch: 'all' |
  'any'`. The `listQuestions()` client helper grows
  `{ tagIds?: string[]; tagMatch?: 'all' | 'any' }`.
- **ReviewEntryPage**: the left rail loses the per-tag buttons in favour of
  the same `<TagFilter>`. `activeId` keeps the `ALL` / `WRONG` sentinels for
  the two fixed entries; when neither sentinel is active, the tag filter
  drives a new fetch that uses `{ tagIds, tagMatch }`. `getTagQuestionIds`
  grows the same params (used by Select-all to cover the whole filtered set).
- **QuestionFormPage**: the Tags region becomes `<TagPicker>`. The "+ Create
  & select" button calls `createTag({ name })` (no `parent_id`) inside the
  existing confirm; on success the new id is appended to `selectedTagIds`
  and `listTags()` is refreshed.

### 6.4 API client (`apps/web/src/lib/qbank.ts`)

- `Tag` type loses `parent_id` and `path`; gains nothing.
- `createTag({ name })` — body is just `{ name }`.
- `moveTag` — deleted.
- `listQuestions` and `getTagQuestionIds` accept `tagIds: string[]` +
  `tagMatch: 'all' | 'any'` (the previous single `tagId` param is removed).

## 7. Testing

Backend (pytest + httpx, mirroring stage-2 style):

- Migration up/down on a fresh DB (down recreates columns, leaves rows empty).
- `POST /tags { name }` 201; duplicate name 409; soft-deleted name reusable.
- `PATCH /tags/{id}` rename 200; duplicate 409.
- `DELETE /tags/{id}` soft-deletes; subsequent list omits it.
- `GET /questions?tag_id=A&tag_id=B&tag_match=all` returns only questions
  carrying both; `=any` returns the union; unknown id ⇒ 400.

Frontend (vitest + RTL where present, otherwise smoke):

- `TagFilter` interaction: typing filters the list; clicking adds chip;
  removing chip updates `onChangeSelected`; toggle calls `onChangeMatch`.
- `TagPicker`'s create-new flow: typing an existing name disables the button;
  typing a new name + confirming calls `createTag` and selects the new id.
- `TagManageDrawer`: rename inline, delete confirm, create row; duplicate-name
  surface.

End-to-end manual checklist (live in the spec's PR description):

1. Migrate the dev DB → all tags gone, all questions intact, no error.
2. Manage tags drawer: create three flat tags, rename one, delete one.
3. Attach two tags to a question via the form.
4. Question bank: AND filter shows only that one question; OR with another
   tag adds matching questions.
5. Review entry: same tag filter; switch to "All questions" and confirm the
   tag region disables.

## 8. Risks

- **Data loss on upgrade.** Mitigated by it being acceptable per the user's
  explicit instruction (project is pre-launch, single developer).
- **AND query performance.** `EXISTS` per tag scales linearly with the number
  of selected tags. With realistic tag counts per filter (≤ 5) this is fine on
  a single-user Postgres; no special index work needed beyond the existing
  `ix_question_tags_tag_id`.
- **AI suggest-tags ordering.** Switching from `path` to `name` may surface
  ties; deterministic-enough for personal use, no caller assumes a stable
  order.

## 9. Forward link: Phase 9

After this lands, a question's exported JSON tag field is just a string array
of names (e.g. `["微积分", "极限"]`). Import dedupes per user by
`(user_id, name)` (already enforced by the partial unique index), creating
tags that don't yet exist. No parent/path reconstruction.
