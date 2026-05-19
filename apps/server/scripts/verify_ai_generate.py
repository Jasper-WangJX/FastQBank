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


# Duck-typed on purpose: the real provider (app.llm.LLMProvider) is a
# concrete class whose __init__ needs api_key/base_url/model, so we don't
# subclass it — we only implement the one method the router calls
# (complete_text), with a signature matching provider.py.
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
        _orig = ai_router.get_text_provider
        ai_router.get_text_provider = lambda: FakeProvider()
        try:
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
        finally:
            ai_router.get_text_provider = _orig

        # --- no AI key -> 503 (never 500) ---
        def boom():
            raise AINotConfigured("text AI is not configured")

        ai_router.get_text_provider = boom
        try:
            down = await c.post(
                "/ai/generate",
                json={"seed_question_ids": [seed["id"]], "count": 2},
                headers=h,
            )
            assert down.status_code == 503, down.text
        finally:
            ai_router.get_text_provider = _orig

    print("verify_ai_generate: ALL PASS")


if __name__ == "__main__":
    asyncio.run(main())
