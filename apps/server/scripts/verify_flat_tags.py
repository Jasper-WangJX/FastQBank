"""Verification: flat tags + tag_id[]/tag_match filter against real dev DB.

Prereqs: `docker compose up -d postgres` and `alembic upgrade head`.
Run from apps/server:  .venv/Scripts/python.exe scripts/verify_flat_tags.py
Exits 0 on success; raises AssertionError (non-zero) on the first failure.
"""

import asyncio
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402
from httpx import ASGITransport  # noqa: E402

from main import app  # noqa: E402


async def main() -> None:
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as c:
        email = f"flat+{uuid.uuid4().hex[:8]}@example.com"
        r = await c.post(
            "/auth/register",
            json={"email": email, "password": "password123"},
        )
        assert r.status_code == 201, r.text
        token = r.json()["access_token"]
        h = {"Authorization": f"Bearer {token}"}

        # 1. Create three flat tags. No parent_id allowed (extra fields
        #    ignored by pydantic? — request only sends `name`).
        t_calc = (
            await c.post("/tags", json={"name": "calculus"}, headers=h)
        ).json()
        t_limit = (
            await c.post("/tags", json={"name": "limits"}, headers=h)
        ).json()
        t_prob = (
            await c.post("/tags", json={"name": "probability"}, headers=h)
        ).json()
        # Schema check — no parent_id / path leaked
        assert "parent_id" not in t_calc, t_calc
        assert "path" not in t_calc, t_calc

        # 2. Duplicate name -> 409
        dup = await c.post("/tags", json={"name": "calculus"}, headers=h)
        assert dup.status_code == 409, dup.text

        # 3. Rename collision -> 409
        bad = await c.patch(
            f"/tags/{t_limit['id']}",
            json={"name": "calculus"},
            headers=h,
        )
        assert bad.status_code == 409, bad.text

        # 4. Three questions with different tag combinations:
        #    q1: calculus + limits
        #    q2: calculus only
        #    q3: probability only
        def q_body(stem: str, tag_ids: list[str]) -> dict:
            return {
                "stem": stem,
                "type": "single",
                "options": [
                    {"label": "A", "content": "a"},
                    {"label": "B", "content": "b"},
                ],
                "correct": ["A"],
                "tag_ids": tag_ids,
            }

        q1 = (
            await c.post(
                "/questions",
                json=q_body("Q1", [t_calc["id"], t_limit["id"]]),
                headers=h,
            )
        ).json()
        q2 = (
            await c.post(
                "/questions",
                json=q_body("Q2", [t_calc["id"]]),
                headers=h,
            )
        ).json()
        q3 = (
            await c.post(
                "/questions",
                json=q_body("Q3", [t_prob["id"]]),
                headers=h,
            )
        ).json()

        # 5. tag_id=calculus, tag_id=limits, tag_match=all -> {Q1}
        r = await c.get(
            "/questions",
            params=[
                ("tag_id", t_calc["id"]),
                ("tag_id", t_limit["id"]),
                ("tag_match", "all"),
            ],
            headers=h,
        )
        ids = [it["id"] for it in r.json()["items"]]
        assert ids == [q1["id"]], r.text

        # 6. tag_match=any -> {Q1, Q2}
        r = await c.get(
            "/questions",
            params=[
                ("tag_id", t_calc["id"]),
                ("tag_id", t_limit["id"]),
                ("tag_match", "any"),
            ],
            headers=h,
        )
        ids = sorted(it["id"] for it in r.json()["items"])
        assert ids == sorted([q1["id"], q2["id"]]), r.text

        # 7. tag_match defaults to "all" when omitted
        r = await c.get(
            "/questions",
            params=[
                ("tag_id", t_calc["id"]),
                ("tag_id", t_limit["id"]),
            ],
            headers=h,
        )
        ids = [it["id"] for it in r.json()["items"]]
        assert ids == [q1["id"]], r.text

        # 8. No tag_id => no tag filter, returns all 3
        r = await c.get("/questions", headers=h)
        assert r.json()["total"] == 3, r.text

        # 9. Single tag id -> just that tag's questions (no subtree)
        r = await c.get(
            "/questions",
            params=[("tag_id", t_prob["id"])],
            headers=h,
        )
        ids = [it["id"] for it in r.json()["items"]]
        assert ids == [q3["id"]], r.text

        # 10. /review/tag-question-ids with two ids, AND
        r = await c.get(
            "/review/tag-question-ids",
            params=[
                ("tag_id", t_calc["id"]),
                ("tag_id", t_limit["id"]),
                ("tag_match", "all"),
            ],
            headers=h,
        )
        assert r.json()["question_ids"] == [q1["id"]], r.text

        # 11. Soft-delete a tag and reuse its name
        d = await c.delete(f"/tags/{t_limit['id']}", headers=h)
        assert d.status_code == 204, d.text
        t_limit2 = await c.post(
            "/tags", json={"name": "limits"}, headers=h
        )
        assert t_limit2.status_code == 201, t_limit2.text

        # 12. After delete, Q1 no longer appears under the (now stale)
        #     old t_limit id. With the new id and tag_match=all -> empty
        #     (Q1 still has the old link, which is hidden because the
        #     old tag is soft-deleted).
        r = await c.get(
            "/questions",
            params=[
                ("tag_id", t_calc["id"]),
                ("tag_id", t_limit2.json()["id"]),
                ("tag_match", "all"),
            ],
            headers=h,
        )
        assert r.json()["items"] == [], r.text

        print("OK — verify_flat_tags passed all 12 assertions.")


asyncio.run(main())
