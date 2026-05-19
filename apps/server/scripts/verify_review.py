"""Stage-7 verification: /review behaviours against the real dev DB.

Prereqs: `docker compose up -d postgres` and `alembic upgrade head`.
Run from apps/server:  .venv/Scripts/python.exe scripts/verify_review.py
Exits 0 on success; raises AssertionError (non-zero) on the first failure.
"""

import asyncio
import uuid

import httpx
from httpx import ASGITransport

from main import app


async def main() -> None:
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as c:
        email = f"phase7+{uuid.uuid4().hex[:8]}@example.com"
        r = await c.post(
            "/auth/register",
            json={"email": email, "password": "password123"},
        )
        assert r.status_code == 201, r.text
        token = r.json()["access_token"]
        h = {"Authorization": f"Bearer {token}"}

        def q_body(stem: str) -> dict:
            return {
                "stem": stem,
                "type": "single",
                "options": [
                    {"label": "A", "content": "right"},
                    {"label": "B", "content": "wrong"},
                ],
                "correct": ["A"],
                "tag_ids": [],
            }

        q1 = (
            await c.post("/questions", json=q_body("Q1"), headers=h)
        ).json()
        q2 = (
            await c.post("/questions", json=q_body("Q2"), headers=h)
        ).json()

        d = await c.post(
            "/review/deck",
            json={"question_ids": [q1["id"], q2["id"]]},
            headers=h,
        )
        assert d.status_code == 200, d.text
        items = d.json()["items"]
        assert len(items) == 2, items
        assert items[0]["correct"] == ["A"], items[0]

        d1 = await c.post(
            "/review/deck",
            json={"question_ids": [q1["id"], q2["id"]], "limit": 1},
            headers=h,
        )
        assert len(d1.json()["items"]) == 1, d1.text

        w = await c.get("/review/wrong", headers=h)
        assert w.json()["total"] == 0, w.text

        r = await c.post(
            "/review/logs",
            json={"question_id": q1["id"], "correct": False},
            headers=h,
        )
        assert r.status_code == 204, r.text
        w = await c.get("/review/wrong", headers=h)
        assert w.json()["total"] == 1, w.text
        assert w.json()["items"][0]["id"] == q1["id"]

        await c.post(
            "/review/logs",
            json={"question_id": q1["id"], "correct": True},
            headers=h,
        )
        assert (await c.get("/review/wrong", headers=h)).json()[
            "total"
        ] == 1

        m = await c.post(
            f"/review/wrong/{q1['id']}/master", headers=h
        )
        assert m.status_code == 204, m.text
        assert (await c.get("/review/wrong", headers=h)).json()[
            "total"
        ] == 0

        m2 = await c.post(
            f"/review/wrong/{q1['id']}/master", headers=h
        )
        assert m2.status_code == 404, m2.text

        await c.post(
            "/review/logs",
            json={"question_id": q1["id"], "correct": False},
            headers=h,
        )
        assert (await c.get("/review/wrong", headers=h)).json()[
            "total"
        ] == 1

        bad = await c.post(
            "/review/logs",
            json={"question_id": str(uuid.uuid4()), "correct": False},
            headers=h,
        )
        assert bad.status_code == 404, bad.text

        await c.post(
            "/review/logs",
            json={"question_id": q2["id"], "correct": False},
            headers=h,
        )
        assert (await c.get("/review/wrong", headers=h)).json()[
            "total"
        ] == 2
        await c.delete(f"/questions/{q2['id']}", headers=h)
        assert (await c.get("/review/wrong", headers=h)).json()[
            "total"
        ] == 1

    print("verify_review: ALL PASS")


if __name__ == "__main__":
    asyncio.run(main())
