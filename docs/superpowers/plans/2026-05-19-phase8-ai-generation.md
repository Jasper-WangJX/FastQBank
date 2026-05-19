# Phase 8 — AI Question Generation in Review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the Review picker, generate AI questions seeded by the picked questions, review them as ephemeral flashcards (Mixed or AI-only), and let the user keep good ones via an "Add to question bank" button — generated questions ship with tags + a knowledge-summary.

**Architecture:** Route A (see spec §4). Backend: extend the existing `/ai/generate` to also emit `tags` (existing-tag names only) + `knowledge_summary`. Frontend: a pure `aiDraft` module wraps valid drafts into `Question`-shaped cards with synthetic ids + an `__ai` marker; the existing deck/session machinery is reused; the session skips ReviewLog/wrong-set for AI cards and shows an "Add to question bank" button (reuses `POST /questions`, `source="ai"`). No new tables/endpoints/migrations.

**Tech Stack:** FastAPI + async SQLAlchemy + Postgres (backend); React 19 + TS + Vite + Tailwind (web); vitest (web pure-logic tests); httpx ASGITransport verification script (backend, project convention — no committed pytest).

**Branch:** `phase-8-ai-generation` (already created off `3753bb6`; all phase-8 work commits here, merged to `main` only after exit criteria pass — same workflow as phase 7). Spec: `docs/superpowers/specs/2026-05-19-phase8-ai-generation-design.md`.

---

## File structure

**Backend (modify):**
- `apps/server/app/schemas.py` — add `knowledge_summary` + `tags` to `GeneratedQuestion`.
- `apps/server/app/llm/prompts.py` — `GENERATE_SYSTEM` text + `generate_user(seeds_json, n, tag_names)` signature.
- `apps/server/app/routers/ai.py` — `generate`: load owned tag names, pass to prompt, normalize `knowledge_summary` + `tags` (existing-name match only).

**Backend (create):**
- `apps/server/scripts/verify_ai_generate.py` — httpx verification script (acceptance test for this phase; mirrors `verify_review.py`).

**Frontend (modify):**
- `apps/web/src/lib/ai.ts` — `GeneratedQuestion`, `GenerateOut` types + `generate()`.
- `apps/web/src/lib/qbank.ts` — widen `QuestionPayload.source` to include `"ai"`.
- `apps/web/src/pages/ReviewEntryPage.tsx` — AI mode controls + `onSubmit` branch.
- `apps/web/src/pages/ReviewSessionPage.tsx` — AI-card branch (skip log/wrong-set) + "Add to question bank" + optional `notice` banner.
- `docs/Roadmap_CN.md`, `docs/Roadmap_EN.md` — mark phase 8 done.

**Frontend (create):**
- `apps/web/src/lib/review/aiDraft.ts` — pure: `tagsByLowerName`, `buildAiCards`, `isAiCard`, `AiCard`.
- `apps/web/src/lib/review/aiDraft.test.ts` — vitest for the above.

---

## Task 1: Backend — `/ai/generate` emits tags + knowledge_summary

**Files:**
- Create: `apps/server/scripts/verify_ai_generate.py`
- Modify: `apps/server/app/schemas.py` (`GeneratedQuestion`, ~line 253)
- Modify: `apps/server/app/llm/prompts.py` (`GENERATE_SYSTEM` ~line 67, `generate_user` ~line 80)
- Modify: `apps/server/app/routers/ai.py` (`generate` ~lines 241-342)

Run all backend commands from `apps/server` using the venv python:
`apps/server/.venv/Scripts/python.exe`.

- [ ] **Step 1: Write the verification script (the failing acceptance test)**

Create `apps/server/scripts/verify_ai_generate.py`:

```python
"""Phase-8 verification: /ai/generate now emits tags + knowledge_summary.

The text provider is monkeypatched with a deterministic fake (no API key
needed). Prereqs: docker compose up -d postgres && alembic upgrade head.
Run from apps/server: .venv/Scripts/python.exe scripts/verify_ai_generate.py
Exits 0 on success; raises AssertionError (non-zero) on first failure.
"""

import asyncio
import json
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402
from httpx import ASGITransport  # noqa: E402

import app.routers.ai as ai_router  # noqa: E402
from app.llm import AINotConfigured  # noqa: E402
from main import app  # noqa: E402

# Fake model output: q0 valid (1 known tag "Algebra" via mixed case, 1
# unknown tag dropped, 1 dup dropped, knowledge_summary present); q1
# invalid (single with 2 correct -> QuestionIn fails -> valid False).
FAKE_JSON = json.dumps(
    {
        "questions": [
            {
                "stem": "What is $1+1$?",
                "type": "single",
                "options": [
                    {"label": "A", "content": "2"},
                    {"label": "B", "content": "3"},
                ],
                "correct": ["A"],
                "knowledge_summary": "Tests basic addition of integers.",
                "tags": ["algebra", "Nope", "ALGEBRA"],
            },
            {
                "stem": "Broken",
                "type": "single",
                "options": [
                    {"label": "A", "content": "x"},
                    {"label": "B", "content": "y"},
                ],
                "correct": ["A", "B"],
                "knowledge_summary": "",
                "tags": [],
            },
        ]
    }
)


class FakeProvider:
    async def complete_text(
        self, messages, max_tokens, *, temperature=0.3, json_mode=False
    ):
        return FAKE_JSON, 42


async def main() -> None:
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as c:
        email = f"phase8+{uuid.uuid4().hex[:8]}@example.com"
        r = await c.post(
            "/auth/register",
            json={"email": email, "password": "password123"},
        )
        assert r.status_code == 201, r.text
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}

        tag = (
            await c.post("/tags", json={"name": "Algebra"}, headers=h)
        ).json()

        seed = (
            await c.post(
                "/questions",
                json={
                    "stem": "Seed",
                    "type": "single",
                    "options": [
                        {"label": "A", "content": "a"},
                        {"label": "B", "content": "b"},
                    ],
                    "correct": ["A"],
                    "tag_ids": [tag["id"]],
                },
                headers=h,
            )
        ).json()

        # --- happy path with the fake provider ---
        ai_router.get_text_provider = lambda: FakeProvider()
        g = await c.post(
            "/ai/generate",
            json={"seed_question_ids": [seed["id"]], "count": 2},
            headers=h,
        )
        assert g.status_code == 200, g.text
        qs = g.json()["questions"]
        assert len(qs) == 2, qs

        q0 = qs[0]
        assert q0["valid"] is True, q0
        assert q0["knowledge_summary"] == (
            "Tests basic addition of integers."
        ), q0
        # case-insensitive match -> canonical name; unknown + dup dropped
        assert q0["tags"] == ["Algebra"], q0["tags"]

        q1 = qs[1]
        assert q1["valid"] is False, q1
        assert q1["validation_error"], q1
        assert q1["knowledge_summary"] == "", q1
        assert q1["tags"] == [], q1

        # --- "Add to question bank" reuses POST /questions ---
        add = await c.post(
            "/questions",
            json={
                "stem": q0["stem"],
                "type": q0["type"],
                "options": q0["options"],
                "correct": q0["correct"],
                "knowledge_summary": q0["knowledge_summary"],
                "tag_ids": [tag["id"]],
                "source": "ai",
            },
            headers=h,
        )
        assert add.status_code == 201, add.text
        added = add.json()
        assert added["source"] == "ai", added
        assert [t["id"] for t in added["tags"]] == [tag["id"]], added
        assert added["knowledge_summary"] == q0["knowledge_summary"]

        # --- schema guards must not regress ---
        empty = await c.post(
            "/ai/generate", json={"seed_question_ids": []}, headers=h
        )
        assert empty.status_code == 422, empty.text

        illegal = await c.post(
            "/ai/generate",
            json={"seed_question_ids": [str(uuid.uuid4())]},
            headers=h,
        )
        assert illegal.status_code == 400, illegal.text

        # --- no AI key -> 503 (never 500) ---
        def boom():
            raise AINotConfigured("text AI is not configured")

        ai_router.get_text_provider = boom
        down = await c.post(
            "/ai/generate",
            json={"seed_question_ids": [seed["id"]], "count": 2},
            headers=h,
        )
        assert down.status_code == 503, down.text

    print("verify_ai_generate: ALL PASS")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Run the script — expect FAIL**

Ensure Postgres is up and migrated first:

```bash
docker compose up -d postgres
cd apps/server && .venv/Scripts/python.exe -m alembic upgrade head
.venv/Scripts/python.exe scripts/verify_ai_generate.py
```

Expected: FAIL — `AssertionError` on `q0["knowledge_summary"]` / `q0["tags"]` (the endpoint does not yet return these fields, so they are absent/default), proving the test exercises the new behavior.

- [ ] **Step 3: Add the two fields to `GeneratedQuestion` (`schemas.py`)**

Replace the `GeneratedQuestion` class (currently ~lines 253-263):

```python
class GeneratedQuestion(BaseModel):
    """One model-produced draft. `valid` reflects the stage-2 QuestionIn
    cross-field rules; the stage-8 review flow surfaces a bad draft
    (filtered out client-side) rather than dropping it server-side.
    `tags` are existing owned tag NAMES the model picked (resolved to
    ids only at "Add to question bank" time); `knowledge_summary` is the
    per-question analysis."""

    stem: str
    type: str
    options: list[OptionOut]
    correct: list[str]
    valid: bool
    validation_error: str | None = None
    knowledge_summary: str = ""
    tags: list[str] = []
```

- [ ] **Step 4: Update the generate prompts (`prompts.py`)**

Replace `GENERATE_SYSTEM` and `generate_user` (currently ~lines 67-85):

```python
GENERATE_SYSTEM = (
    "You generate NEW multiple-choice questions modeled on the seed "
    "questions' topic and difficulty — do NOT copy or trivially reword "
    "them. Rules for each question: 'type' is one of single|multi|judge; "
    "'options' is a list of {'label','content'} with labels A,B,C,...; "
    "'correct' lists the correct label(s); single has exactly 1 correct, "
    "multi has >=1, judge has exactly options T/F with 1 correct. "
    "Also output 'knowledge_summary': a 1-2 sentence study note stating "
    "the key concept the question tests — do not restate the question or "
    "reveal the answer. Also output 'tags': pick up to 3 MOST relevant "
    "tag names FROM THE GIVEN EXISTING-TAG LIST ONLY; never invent a "
    "tag; if none fit or the list is empty, return []. "
    + LATEX_RULE
    + ' Reply with strict json: {"questions": [{"stem","type",'
    '"options","correct","knowledge_summary","tags"}, ...]}.'
)


def generate_user(seeds_json: str, n: int, tag_names: list[str]) -> str:
    return (
        f"Generate {n} new questions.\n\n"
        f"Existing tags (choose tags only from these): "
        f"{json.dumps(tag_names, ensure_ascii=False)}\n\n"
        f"Seed questions (JSON):\n{seeds_json}\n\n"
        "Return the json now."
    )
```

- [ ] **Step 5: Load owned tags + normalize in `generate` (`ai.py`)**

In `apps/server/app/routers/ai.py`, in the `generate` function, after the
`if not seeds:` block (which raises 400) and BEFORE `seeds_json = json.dumps(`,
insert:

```python
    tags = list(
        (
            await db.scalars(
                select(Tag)
                .where(Tag.user_id == user.id, Tag.deleted_at.is_(None))
                .order_by(Tag.path)
            )
        ).all()
    )
    # lower-name -> canonical name (first wins, mirrors suggest_tags)
    canon_by_lower: dict[str, str] = {}
    for t in tags:
        canon_by_lower.setdefault(t.name.strip().lower(), t.name)
```

Then change the prompt call from:

```python
    data = await _call_text(
        db,
        user,
        prompts.GENERATE_SYSTEM,
        prompts.generate_user(seeds_json, body.count),
        temperature=0.8,  # generation wants variety, not determinism
    )
```

to:

```python
    data = await _call_text(
        db,
        user,
        prompts.GENERATE_SYSTEM,
        prompts.generate_user(
            seeds_json, body.count, [t.name for t in tags]
        ),
        temperature=0.8,  # generation wants variety, not determinism
    )
```

Then, inside the `for q in raw_list:` loop, after the existing
`norm_correct = [str(c) for c in correct]` line and BEFORE
`valid, err = True, None`, insert:

```python
        ks = q.get("knowledge_summary", "")
        ks = ks.strip() if isinstance(ks, str) else ""
        raw_tags = q.get("tags", [])
        raw_tags = raw_tags if isinstance(raw_tags, list) else []
        norm_tags: list[str] = []
        seen_t: set[str] = set()
        for tg in raw_tags:
            if not isinstance(tg, str):
                continue
            key = tg.strip().lower()
            if key in canon_by_lower and key not in seen_t:
                seen_t.add(key)
                norm_tags.append(canon_by_lower[key])
            if len(norm_tags) == 3:
                break
```

Then change the draft append from:

```python
        drafts.append(
            GeneratedQuestion(
                stem=stem,
                type=qtype,
                options=norm_opts,  # type: ignore[arg-type]
                correct=norm_correct,
                valid=valid,
                validation_error=err,
            )
        )
```

to:

```python
        drafts.append(
            GeneratedQuestion(
                stem=stem,
                type=qtype,
                options=norm_opts,  # type: ignore[arg-type]
                correct=norm_correct,
                valid=valid,
                validation_error=err,
                knowledge_summary=ks,
                tags=norm_tags,
            )
        )
```

- [ ] **Step 6: Run the verification script — expect PASS**

```bash
cd apps/server && .venv/Scripts/python.exe scripts/verify_ai_generate.py
```

Expected: `verify_ai_generate: ALL PASS` (exit 0).

- [ ] **Step 7: Commit**

```bash
git add apps/server/app/schemas.py apps/server/app/llm/prompts.py apps/server/app/routers/ai.py apps/server/scripts/verify_ai_generate.py
git commit -m "feat(server): /ai/generate emits existing-only tags + knowledge_summary (phase 8)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Frontend — API client updates (`ai.ts`, `qbank.ts`)

**Files:**
- Modify: `apps/web/src/lib/ai.ts`
- Modify: `apps/web/src/lib/qbank.ts:54-64` (`QuestionPayload`)

Run web commands from `apps/web`.

- [ ] **Step 1: Add generate types + function to `ai.ts`**

In `apps/web/src/lib/ai.ts`, after the `ParseQuestionOut` interface
(ends ~line 29) and before `AiUsageOut`, add:

```typescript
export interface GeneratedQuestion {
  stem: string;
  type: QuestionType;
  options: Option[];
  correct: string[];
  valid: boolean;
  validation_error: string | null;
  knowledge_summary: string;
  tags: string[];
}

export interface GenerateOut {
  questions: GeneratedQuestion[];
}
```

Then, at the end of the "Text tasks (DeepSeek)" section (after
`getAiUsage`, ~line 63), add:

```typescript
/** Generate `count` new questions seeded by the picked question ids.
 *  Each draft carries its own existing-tag names + knowledge_summary. */
export function generate(
  seedQuestionIds: string[],
  count: number,
): Promise<GenerateOut> {
  return apiFetch<GenerateOut>("/ai/generate", {
    method: "POST",
    body: { seed_question_ids: seedQuestionIds, count },
  });
}
```

- [ ] **Step 2: Widen `QuestionPayload.source` in `qbank.ts`**

In `apps/web/src/lib/qbank.ts`, change (in the `QuestionPayload`
interface, ~lines 61-63):

```typescript
  // Defaults to "manual" server-side; the OCR confirm flow sends "ocr".
  // Ignored by the backend on PUT (edit), so it's create-only in effect.
  source?: "manual" | "ocr";
```

to:

```typescript
  // Defaults to "manual" server-side; OCR confirm sends "ocr"; the
  // phase-8 "Add to question bank" sends "ai". Ignored by the backend
  // on PUT (edit), so it's create-only in effect.
  source?: "manual" | "ocr" | "ai";
```

- [ ] **Step 3: Type-check**

```bash
cd apps/web && pnpm exec tsc -b
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/ai.ts apps/web/src/lib/qbank.ts
git commit -m "feat(web): ai.generate() client + widen QuestionPayload.source to 'ai' (phase 8)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Frontend — `aiDraft` pure module (TDD)

**Files:**
- Create: `apps/web/src/lib/review/aiDraft.test.ts`
- Create: `apps/web/src/lib/review/aiDraft.ts`

Pure, React-free, deterministic (id generator injected — mirrors the
injected `rng` convention in `lib/review/session.ts`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/review/aiDraft.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { Question, Tag } from "../qbank";
import type { GeneratedQuestion } from "../ai";
import { buildAiCards, isAiCard, tagsByLowerName } from "./aiDraft";

function tag(id: string, name: string): Tag {
  return {
    id,
    user_id: "u",
    name,
    parent_id: null,
    path: id,
    created_at: "",
    updated_at: "",
  };
}

function draft(p: Partial<GeneratedQuestion> = {}): GeneratedQuestion {
  return {
    stem: "s",
    type: "single",
    options: [
      { label: "A", content: "a" },
      { label: "B", content: "b" },
    ],
    correct: ["A"],
    valid: true,
    validation_error: null,
    knowledge_summary: "note",
    tags: [],
    ...p,
  };
}

// deterministic id generator for tests
function ids(): () => string {
  let n = 0;
  return () => `ai-${++n}`;
}

describe("tagsByLowerName", () => {
  it("keys by trimmed lowercased name, first wins", () => {
    const m = tagsByLowerName([
      tag("1", "Algebra"),
      tag("2", "algebra"),
      tag("3", "Geometry"),
    ]);
    expect(m.get("algebra")!.id).toBe("1");
    expect(m.get("geometry")!.id).toBe("3");
    expect(m.size).toBe(2);
  });
});

describe("buildAiCards", () => {
  const tags = tagsByLowerName([tag("t1", "Algebra")]);

  it("drops invalid drafts", () => {
    const out = buildAiCards(
      [draft({ valid: false }), draft()],
      tags,
      ids(),
    );
    expect(out).toHaveLength(1);
  });

  it("each card has unique synthetic id, source ai, __ai true", () => {
    const out = buildAiCards([draft(), draft()], tags, ids());
    expect(out.map((c) => c.id)).toEqual(["ai-1", "ai-2"]);
    expect(out.every((c) => c.source === "ai")).toBe(true);
    expect(out.every((c) => c.__ai === true)).toBe(true);
  });

  it("resolves tag names case-insensitively, drops misses, dedupes, caps 3", () => {
    const many = tagsByLowerName([
      tag("a", "Algebra"),
      tag("b", "Bravo"),
      tag("c", "Charlie"),
      tag("d", "Delta"),
    ]);
    const out = buildAiCards(
      [
        draft({
          tags: ["ALGEBRA", "algebra", "Nope", "Bravo", "Charlie", "Delta"],
        }),
      ],
      many,
      ids(),
    );
    expect(out[0].tags.map((t) => t.name)).toEqual([
      "Algebra",
      "Bravo",
      "Charlie",
    ]);
  });

  it("passes knowledge_summary through; empty -> null (hidden)", () => {
    const out = buildAiCards(
      [draft({ knowledge_summary: "k" }), draft({ knowledge_summary: "" })],
      tags,
      ids(),
    );
    expect(out[0].knowledge_summary).toBe("k");
    expect(out[1].knowledge_summary).toBeNull();
  });
});

describe("isAiCard", () => {
  it("true for AI cards, false for a plain question", () => {
    const [card] = buildAiCards([draft()], tagsByLowerName([]), ids());
    expect(isAiCard(card)).toBe(true);
    const plain: Question = {
      id: "q",
      user_id: "u",
      stem: "s",
      type: "single",
      options: [],
      correct: [],
      knowledge_summary: null,
      source: "manual",
      created_at: "",
      updated_at: "",
      tags: [],
    };
    expect(isAiCard(plain)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL**

```bash
cd apps/web && pnpm test -- aiDraft
```

Expected: FAIL — `Cannot find module './aiDraft'` (file does not exist yet).

- [ ] **Step 3: Implement `aiDraft.ts`**

Create `apps/web/src/lib/review/aiDraft.ts`:

```typescript
// Pure, React-free helpers turning AI-generation drafts into ephemeral
// flashcards. Synthetic ids let the existing buildDeck / session logic
// reuse them unchanged; the `__ai` marker tells the session to skip
// ReviewLog / wrong-set and show "Add to question bank". The id
// generator is injected (default crypto.randomUUID) so tests are
// deterministic — mirrors the injected rng in session.ts.

import type { GeneratedQuestion } from "../ai";
import type { Question, Tag } from "../qbank";

/** A Question-shaped ephemeral card with no DB id. */
export interface AiCard extends Question {
  __ai: true;
}

export type MakeId = () => string;

/** Build a lower(trim(name)) -> Tag map; first occurrence wins (mirrors
 *  the backend `setdefault` in suggest_tags / generate). */
export function tagsByLowerName(tags: Tag[]): Map<string, Tag> {
  const m = new Map<string, Tag>();
  for (const t of tags) {
    const key = t.name.trim().toLowerCase();
    if (!m.has(key)) m.set(key, t);
  }
  return m;
}

/** Narrowing guard — the single source of truth for "is this an AI
 *  card?" used by the session page. */
export function isAiCard(q: Question): q is AiCard {
  return (q as Partial<AiCard>).__ai === true;
}

/** Keep only valid drafts; wrap each as a Question-shaped AiCard with a
 *  synthetic id, source "ai", resolved existing tags (case-insensitive,
 *  deduped, <=3, misses dropped) and the knowledge summary (empty ->
 *  null so the session hides the note row). Never creates a tag. */
export function buildAiCards(
  drafts: GeneratedQuestion[],
  tagsByName: Map<string, Tag>,
  makeId: MakeId = () => crypto.randomUUID(),
): AiCard[] {
  const out: AiCard[] = [];
  for (const d of drafts) {
    if (!d.valid) continue;
    const resolved: Tag[] = [];
    const seen = new Set<string>();
    for (const name of d.tags) {
      const key = name.trim().toLowerCase();
      const hit = tagsByName.get(key);
      if (hit && !seen.has(hit.id)) {
        seen.add(hit.id);
        resolved.push(hit);
      }
      if (resolved.length === 3) break;
    }
    out.push({
      id: makeId(),
      user_id: "",
      stem: d.stem,
      type: d.type,
      options: d.options,
      correct: d.correct,
      knowledge_summary: d.knowledge_summary
        ? d.knowledge_summary
        : null,
      source: "ai",
      created_at: "",
      updated_at: "",
      tags: resolved,
      __ai: true,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run the test — expect PASS**

```bash
cd apps/web && pnpm test -- aiDraft
```

Expected: PASS (all `aiDraft` tests green).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/review/aiDraft.ts apps/web/src/lib/review/aiDraft.test.ts
git commit -m "feat(web): aiDraft pure module — build ephemeral AI cards (TDD, phase 8)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Frontend — Review entry page AI controls + submit branch

**Files:**
- Modify: `apps/web/src/pages/ReviewEntryPage.tsx`

- [ ] **Step 1: Add imports**

In `apps/web/src/pages/ReviewEntryPage.tsx`, add to the existing import
block (near the other `../lib/...` imports):

```typescript
import { generate } from "../lib/ai";
import { buildAiCards, tagsByLowerName } from "../lib/review/aiDraft";
```

`Question` is already imported from `../lib/qbank` in this file
(`listQuestions, listTags, type Question, type Tag`), so no qbank import
change is needed — `Question` is available for Step 3's typing.

- [ ] **Step 2: Add AI mode state**

After the existing `const [fastMode, setFastMode] = useState(false);`
line, add:

```typescript
  const [aiMode, setAiMode] = useState<"off" | "mixed" | "ai">("off");
  const [aiCount, setAiCount] = useState(5);
```

- [ ] **Step 3: Replace `onSubmit` with the AI-aware version**

Replace the entire existing `async function onSubmit() { ... }` with:

```typescript
  async function onSubmit() {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const ids = [...selected];

      // --- Off: existing bank-only path, unchanged ---
      if (aiMode === "off") {
        const deck = await getDeck(ids, randomPick ? count : undefined);
        if (deck.items.length === 0) {
          setError("None of the selected questions are available anymore.");
          return;
        }
        navigate("/review/session", {
          state: {
            reviewConfig: {
              questions: deck.items,
              requestedOrder: ids,
              randomOrder: randomPick,
              shuffleOptions,
              fastMode,
              isWrongSetSession: activeId === WRONG,
            },
          },
        });
        return;
      }

      // --- Mixed / AI only: selected ids are the generation seeds ---
      const gen = await generate(ids, aiCount);
      const aiCards = buildAiCards(
        gen.questions,
        tagsByLowerName(tags),
      );

      // AiCard extends Question, so AiCard[] is assignable to Question[].
      let questions: Question[] = aiCards;
      let requestedOrder = aiCards.map((c) => c.id);
      let notice: string | undefined;

      if (aiMode === "ai") {
        if (aiCards.length === 0) {
          setError(
            "AI returned no usable questions. Try different seeds or try again.",
          );
          return;
        }
      } else {
        // mixed: selected bank questions + the AI cards
        const bank = await getDeck(ids, randomPick ? count : undefined);
        if (bank.items.length === 0 && aiCards.length === 0) {
          setError("None of the selected questions are available anymore.");
          return;
        }
        questions = [...bank.items, ...aiCards];
        requestedOrder = [
          ...bank.items.map((q) => q.id),
          ...aiCards.map((c) => c.id),
        ];
        if (aiCards.length === 0) {
          notice =
            "AI generation produced no usable questions; continuing with your selected questions.";
        }
      }

      navigate("/review/session", {
        state: {
          reviewConfig: {
            questions,
            requestedOrder,
            randomOrder: randomPick,
            shuffleOptions,
            fastMode,
            isWrongSetSession: false,
            notice,
          },
        },
      });
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }
```

- [ ] **Step 4: Add the AI controls to the bottom bar**

In the bottom Submit bar `<div className="mt-4 flex flex-wrap items-center gap-4 border-t ...">`,
immediately AFTER the Fast mode `<label>...</label>` and BEFORE the
`<button ... onClick={onSubmit}>` Submit button, insert:

```tsx
        <div className="flex items-center gap-1">
          <span className="text-gray-600">AI:</span>
          <div className="flex overflow-hidden rounded-md border border-gray-300 text-xs">
            {(["off", "mixed", "ai"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setAiMode(m)}
                className={
                  "px-2 py-1 " +
                  (aiMode === m
                    ? "bg-slate-800 text-white"
                    : "text-gray-600 hover:bg-gray-50")
                }
              >
                {m === "off" ? "Off" : m === "mixed" ? "Mixed" : "AI only"}
              </button>
            ))}
          </div>
          <input
            type="number"
            min={1}
            max={10}
            value={aiCount}
            disabled={aiMode === "off"}
            onChange={(e) =>
              setAiCount(
                Math.min(10, Math.max(1, Number(e.target.value) || 1)),
              )
            }
            className="w-14 rounded-md border border-gray-300 px-2 py-1 disabled:bg-gray-50"
            aria-label="AI question count"
          />
        </div>
```

Then replace the helper paragraph at the bottom (`<p className="mt-2 text-xs text-gray-500">Fast mode: ...</p>`) with:

```tsx
      <p className="mt-2 text-xs text-gray-500">
        Fast mode: single/judge reveal the moment you pick (no Check
        button); multiple-choice still needs Submit. AI: seeds are the
        questions you ticked (≥1 needed); generated questions are{" "}
        <strong>not</strong> saved to your bank automatically — use "Add
        to question bank" during review. Your selection isn't saved
        between visits.
      </p>
```

- [ ] **Step 5: Type-check, lint, build**

```bash
cd apps/web && pnpm exec tsc -b && pnpm lint && pnpm build
```

Expected: no TS errors, no lint errors, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/ReviewEntryPage.tsx
git commit -m "feat(web): review entry AI mode (off/mixed/ai) + count + submit branch (phase 8)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Frontend — Session: skip log/wrong-set for AI cards + "Add to question bank"

**Files:**
- Modify: `apps/web/src/pages/ReviewSessionPage.tsx`

- [ ] **Step 1: Add imports**

In `apps/web/src/pages/ReviewSessionPage.tsx`, add:

```typescript
import { createQuestion } from "../lib/qbank";
import { isAiCard } from "../lib/review/aiDraft";
```

- [ ] **Step 2: Add `notice` to `ReviewConfig` and a dismissible banner**

In the `interface ReviewConfig { ... }`, add a final optional field:

```typescript
  notice?: string;
```

In `ReviewRunner`, after the existing `const [wrongNote, setWrongNote] = useState<string | null>(null);`
line, add:

```typescript
  const [notice, setNotice] = useState<string | null>(
    config.notice ?? null,
  );
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [addError, setAddError] = useState<string | null>(null);
```

In the main card JSX (the `return (` with the outer
`<div className="rounded-xl border ...">`), immediately AFTER that
opening div and BEFORE the `{logError && (` block, insert:

```tsx
      {notice && (
        <div className="mb-3 flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span>{notice}</span>
          <button
            onClick={() => setNotice(null)}
            className="rounded border border-amber-300 px-2 py-0.5 text-xs hover:bg-amber-100"
          >
            Dismiss
          </button>
        </div>
      )}
```

- [ ] **Step 3: Skip ReviewLog for AI cards in `doReveal`**

In `doReveal`, wrap the existing logging block. Replace:

```typescript
    if (!loggedRef.current.has(idx)) {
      loggedRef.current.add(idx);
      try {
        await postReviewLog(q.id, correct);
        setLogError(null);
      } catch {
        loggedRef.current.delete(idx);
        setLogError(
          "Couldn't save this result. Your progress continues.",
        );
      }
    }
```

with:

```typescript
    // AI cards are ephemeral (no DB id) — never log them, so a wrong
    // answer also never enters the wrong set (spec §2.5).
    if (!isAiCard(q) && !loggedRef.current.has(idx)) {
      loggedRef.current.add(idx);
      try {
        await postReviewLog(q.id, correct);
        setLogError(null);
      } catch {
        loggedRef.current.delete(idx);
        setLogError(
          "Couldn't save this result. Your progress continues.",
        );
      }
    }
```

- [ ] **Step 4: Add the `onAddToBank` handler**

After the existing `async function onMaster() { ... }` function, add:

```typescript
  async function onAddToBank() {
    if (added.has(q.id)) return;
    try {
      await createQuestion({
        stem: q.stem,
        type: q.type,
        options: q.options,
        correct: q.correct,
        knowledge_summary: q.knowledge_summary,
        tag_ids: q.tags.map((t) => t.id),
        source: "ai",
      });
      setAdded((s) => new Set(s).add(q.id));
      setAddError(null);
    } catch {
      setAddError("Couldn't add — click to retry.");
    }
  }
```

- [ ] **Step 5: Clear `addError` on advance**

In `next()`, after the existing `setMasterError(null);` line, add:

```typescript
    setAddError(null);
```

(`added` is intentionally NOT reset — it is keyed by card id and must
persist across the session.)

- [ ] **Step 6: Render the "Add to question bank" button**

In the action row `<div className="mt-5 flex items-center gap-2">`,
immediately BEFORE the existing Quit button
(`<button onClick={() => navigate("/review")} ...>Quit</button>`),
insert:

```tsx
        {isAiCard(q) && (
          <div className="flex items-center gap-2">
            <button
              disabled={added.has(q.id)}
              onClick={onAddToBank}
              className="rounded-md border border-emerald-500 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
            >
              {added.has(q.id) ? "Added ✓" : "Add to question bank"}
            </button>
            {addError && (
              <span className="text-xs text-red-700">{addError}</span>
            )}
          </div>
        )}
```

- [ ] **Step 7: Type-check, lint, build**

```bash
cd apps/web && pnpm exec tsc -b && pnpm lint && pnpm build
```

Expected: no TS errors, no lint errors, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/ReviewSessionPage.tsx
git commit -m "feat(web): session skips log/wrong-set for AI cards + Add-to-bank button (phase 8)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Full gate + roadmap docs + GUI acceptance

**Files:**
- Modify: `docs/Roadmap_CN.md` (phase 8 row + section)
- Modify: `docs/Roadmap_EN.md` (phase 8 row + section)

- [ ] **Step 1: Run the full web gate**

```bash
cd apps/web && pnpm exec tsc -b && pnpm lint && pnpm test && pnpm build
```

Expected: all green; the existing 34 vitest tests plus the new
`aiDraft` tests pass; no regressions.

- [ ] **Step 2: Re-run the backend verification script**

```bash
docker compose up -d postgres
cd apps/server && .venv/Scripts/python.exe -m alembic upgrade head
.venv/Scripts/python.exe scripts/verify_ai_generate.py
.venv/Scripts/python.exe scripts/verify_review.py
```

Expected: `verify_ai_generate: ALL PASS` and `verify_review: ALL PASS`
(phase-7 review path not regressed).

- [ ] **Step 3: GUI acceptance walkthrough (spec §9.4)**

Start the stack (`docker compose up -d postgres`, backend `uvicorn`,
`pnpm --dir apps/web dev`), log in, ensure ≥3 questions with tags exist,
then verify:
1. Review picker: tick 3 questions → set AI = **Mixed**, count 5 →
   Submit. Session shows the 3 bank questions + up to 5 AI questions;
   each AI card shows "Add to question bank" and (on reveal) its
   `knowledge_summary` note.
2. Answer an AI card **wrong** → return to `/review`; the
   `⚠ Wrong questions (N)` count is unchanged (AI wrong never enters
   the set). A bank card answered wrong DOES still enter it.
3. Tick the same 3 → AI = **AI only**, count 5 → Submit. The session
   contains only AI questions (no bank questions).
4. Click "Add to question bank" on 2 AI cards → button becomes
   "Added ✓". Open the Question Bank: the 2 appear with `source` ai,
   the AI-picked existing tags attached, and the knowledge summary;
   open one in the edit form and confirm it loads.
5. Set AI = Off → Submit behaves exactly as before (pure bank review).

Record the result. If any step fails, fix before Step 4.

- [ ] **Step 4: Mark phase 8 done in the roadmaps**

In `docs/Roadmap_CN.md`, change the overview table row from:

```
| 8 AI 出题 | ⬜ 待办 | 种子选择 → 预览页 → 入库 + 三种过题模式 |
```

to:

```
| 8 AI 出题 | ✅ 已完成 (2026-05-19) | 复习入口选种子 → 混合/仅AI过题 → 卡上"加入题库"（带tag+分析） |
```

And under `## 阶段 8 — AI 出题 + 三种过题模式`, add a status
blockquote immediately under the heading (mirror the phase-7 style):

```
> **状态：✅ 已完成 (2026-05-19)。** 走 brainstorming → spec → 计划 →
> 执行。复用复习入口选择集合作 AI 出题种子；扩展 `/ai/generate` 同时
> 产出"仅限现有标签"的 tag 与 knowledge_summary（分析）；AI 题为合成
> id 的临时卡，过题时不写 ReviewLog、不进错题集（答错也不入），卡上
> "Add to question bank" 复用 `POST /questions`（`source=ai`）。两个
> 子选项：混合 / 仅 AI。无新表/新端点/迁移。规格见
> `docs/superpowers/specs/2026-05-19-phase8-ai-generation-design.md`。
```

Apply the equivalent edits to `docs/Roadmap_EN.md` (the matching table
row and a parallel English status blockquote under the phase-8 heading).

- [ ] **Step 5: Commit**

```bash
git add docs/Roadmap_CN.md docs/Roadmap_EN.md
git commit -m "docs: mark phase 8 (AI generation in review) complete (CN/EN)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Finish the branch**

Invoke the `superpowers:finishing-a-development-branch` skill to decide
how to integrate `phase-8-ai-generation` (merge to `main` / open a PR /
keep). Do this only after Steps 1-5 are all green.

---

## Self-review

**Spec coverage:**
- §2.1 seed = picker selection → Task 4 (`onSubmit` uses `[...selected]` as `seed_question_ids`).
- §2.2 existing tags only, no creation → Task 1 (backend `canon_by_lower` filter), Task 3 (`buildAiCards` resolves to existing `Tag` only), Task 5 (`tag_ids` from resolved tags).
- §2.3 count 1–10 default 5 → Task 4 (`aiCount` state + clamped number input).
- §2.4 no inline editing → not built (Task 5 only adds an Add button); roadmap note Task 6.
- §2.5 ephemeral, never auto-banked, wrong never persists → Task 3 (synthetic id, no DB id), Task 5 (`isAiCard` skips `postReviewLog`).
- §2.6 three modes → Task 4 segmented control + branch.
- §5.1/§5.2/§5.3 flow → Tasks 4, 5, 3.
- §6 backend → Task 1.
- §7 frontend → Tasks 2-5.
- §8 error handling: 8.1 (catch → ApiError.message, Task 4), 8.2 (AI-only error vs mixed notice, Task 4 + notice banner Task 5), 8.3 (invalid dropped, Task 3), 8.4 (duplicate-add guard `added` set + inline retry, Task 5), 8.5 (refresh bounce — existing behavior, unchanged), 8.6/8.7 (reuse stage-6 limiter / `POST /questions` ownership — no new code).
- §9 testing → Task 3 (vitest), Task 1 (verify script), Task 6 (gate + GUI).
- §10 YAGNI → nothing built for out-of-scope items.

**Placeholder scan:** No TBD/TODO; every code step has complete code; the one awkward `let questions` type expression in Task 4 Step 3 is explicitly corrected to `let questions: Question[] = aiCards;` in the same step.

**Type consistency:** `GeneratedQuestion` fields identical across schemas.py (Task 1), ai.ts (Task 2), aiDraft.ts/test (Task 3). `AiCard extends Question` + `__ai: true`; `isAiCard` defined Task 3, used Task 5. `generate(seedQuestionIds, count)` defined Task 2, called Task 4. `tagsByLowerName`/`buildAiCards` signatures match between Task 3 implementation and Task 4 caller. `QuestionPayload.source` widened (Task 2) before `createQuestion({... source: "ai"})` (Task 5). `reviewConfig.notice` written (Task 4) and read (Task 5).
