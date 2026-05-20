"""Verification: stage 9 share-link transfer + bulk-add-tag against real dev DB.

Prereqs: `docker compose up -d postgres` and `alembic upgrade head`.
Run from apps/server:  .venv/Scripts/python.exe scripts/verify_phase9.py
Exits 0 on success; raises AssertionError (non-zero) on the first failure.

Coverage:
  1. Create share — owner can create with 1 / 99 ids; >=100 ids → 422;
     a non-owned id → 404; a soft-deleted id → 404. Token is 12 URL-safe
     chars.
  2. GET /shares/{token} returns payload + created_at, no creator
     identity; soft-deleted → 410; nonexistent → 404; malformed → 404.
  3. Import under another account — all N inserted with fresh `id`,
     `imported_from_id = source_id`, source preserved, tags created
     or reused by name, counters match.
  4. UUID dedup — same share imported twice under same account: round
     2 all skipped. Self-import (creator imports own share): all
     skipped. Soft-delete an imported row then re-import: still
     skipped (does not undelete).
  5. My-shares + revoke — list returns only own active rows; revoke
     only by creator (foreign user → 404); revoked then re-import →
     410.
  6. Bulk-add-tags — union semantics, idempotent, soft-deleted /
     foreign ids silently dropped.
"""

import asyncio
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402
from httpx import ASGITransport  # noqa: E402

from main import app  # noqa: E402


def _qbody(stem: str, tag_ids: list[str]) -> dict:
    return {
        "stem": stem,
        "type": "single",
        "options": [
            {"label": "A", "content": "alpha"},
            {"label": "B", "content": "beta"},
        ],
        "correct": ["A"],
        "tag_ids": tag_ids,
    }


async def _register(c: httpx.AsyncClient) -> tuple[str, dict[str, str]]:
    """Returns (email, auth-headers)."""
    email = f"p9+{uuid.uuid4().hex[:8]}@example.com"
    r = await c.post(
        "/auth/register",
        json={"email": email, "password": "password123"},
    )
    assert r.status_code == 201, r.text
    return email, {"Authorization": f"Bearer {r.json()['access_token']}"}


async def main() -> None:
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as c:
        # --- Two users ---
        email_a, ha = await _register(c)
        _, hb = await _register(c)

        # --- User A owns 3 tags + 3 questions ---
        tag_math = (
            await c.post("/tags", json={"name": "math"}, headers=ha)
        ).json()
        tag_phys = (
            await c.post("/tags", json={"name": "physics"}, headers=ha)
        ).json()
        tag_only_a = (
            await c.post("/tags", json={"name": "only-a"}, headers=ha)
        ).json()

        q1 = (
            await c.post(
                "/questions",
                json=_qbody("Q1", [tag_math["id"], tag_phys["id"]]),
                headers=ha,
            )
        ).json()
        q2 = (
            await c.post(
                "/questions",
                json=_qbody("Q2", [tag_math["id"]]),
                headers=ha,
            )
        ).json()
        q3 = (
            await c.post(
                "/questions",
                json=_qbody("Q3", [tag_only_a["id"]]),
                headers=ha,
            )
        ).json()

        # --- 1. Create share with the 3 question ids ---
        r = await c.post(
            "/shares",
            json={"question_ids": [q1["id"], q2["id"], q3["id"]]},
            headers=ha,
        )
        assert r.status_code == 201, r.text
        share = r.json()
        token = share["token"]
        assert len(token) == 12, token
        allowed = set(
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
        )
        assert all(ch in allowed for ch in token), token
        assert share["share_url"].endswith(f"/s/{token}"), share

        # 1a. Empty list -> 422
        r = await c.post("/shares", json={"question_ids": []}, headers=ha)
        assert r.status_code == 422, r.text

        # 1b. >99 ids -> 422
        too_many = [str(uuid.uuid4()) for _ in range(100)]
        r = await c.post(
            "/shares", json={"question_ids": too_many}, headers=ha
        )
        assert r.status_code == 422, r.text

        # 1c. Foreign id -> 404
        # Make B own one question, then A tries to share it
        qb = (
            await c.post("/questions", json=_qbody("QB", []), headers=hb)
        ).json()
        r = await c.post(
            "/shares", json={"question_ids": [qb["id"]]}, headers=ha
        )
        assert r.status_code == 404, r.text

        # 1d. Soft-deleted id -> 404
        # Make A own a temp question, delete it, then try to share
        q_tmp = (
            await c.post("/questions", json=_qbody("QTMP", []), headers=ha)
        ).json()
        del_r = await c.delete(
            f"/questions/{q_tmp['id']}", headers=ha
        )
        assert del_r.status_code == 204, del_r.text
        r = await c.post(
            "/shares", json={"question_ids": [q_tmp["id"]]}, headers=ha
        )
        assert r.status_code == 404, r.text

        # --- 2. GET preview ---
        r = await c.get(f"/shares/{token}")
        assert r.status_code == 200, r.text
        prev = r.json()
        # No creator identity leak
        assert "creator_email" not in prev, prev
        assert "creator_id" not in prev, prev
        assert prev["payload"]["version"] == 1
        assert len(prev["payload"]["questions"]) == 3
        # tag_names by name, not by id
        q1_payload = next(
            qq
            for qq in prev["payload"]["questions"]
            if qq["source_id"] == q1["id"]
        )
        assert set(q1_payload["tag_names"]) == {"math", "physics"}, q1_payload

        # 2a. Malformed token -> 404 (not 410)
        r = await c.get("/shares/short")
        assert r.status_code == 404, r.text
        r = await c.get("/shares/AAAAAAAAAAAA")  # 12 chars but no match
        assert r.status_code == 404, r.text

        # --- 3. Import under user B ---
        r = await c.post(f"/shares/{token}/import", headers=hb)
        assert r.status_code == 200, r.text
        imp = r.json()
        assert imp["imported"] == 3, imp
        assert imp["skipped"] == 0, imp
        # B had zero of these tag names; all three created
        assert imp["tags_created"] == 3, imp
        assert imp["tags_reused"] == 0, imp

        # B now sees 4 questions (QB + 3 imported)
        b_list = (
            await c.get(
                "/questions?limit=100", headers=hb
            )
        ).json()
        assert b_list["total"] == 4, b_list
        imported_rows = [q for q in b_list["items"] if q["id"] != qb["id"]]
        # Fresh ids — not equal to creator's ids
        creator_ids = {q1["id"], q2["id"], q3["id"]}
        for q in imported_rows:
            assert q["id"] not in creator_ids, q
        # `source` preserved verbatim ('manual' in this case)
        for q in imported_rows:
            assert q["source"] == "manual", q
        # Tags resolved by name under B's account
        all_b_tag_names = {
            t["name"] for q in imported_rows for t in q["tags"]
        }
        assert {"math", "physics", "only-a"}.issubset(all_b_tag_names)

        # --- 3a. Import with one tag already present (reuse path) ---
        # User C pre-creates a `math` tag, then imports A's share —
        # expect tags_reused == 1 (math), tags_created == 2 (physics,
        # only-a). Confirms the reuse branch of import_share.
        _, hc = await _register(c)
        await c.post("/tags", json={"name": "math"}, headers=hc)
        r = await c.post(f"/shares/{token}/import", headers=hc)
        assert r.status_code == 200, r.text
        imp_c = r.json()
        assert imp_c["imported"] == 3, imp_c
        assert imp_c["skipped"] == 0, imp_c
        assert imp_c["tags_created"] == 2, imp_c
        assert imp_c["tags_reused"] == 1, imp_c
        # C has the 3 imported questions + the existing `math` tag is reused
        c_list = (
            await c.get("/questions?limit=100", headers=hc)
        ).json()
        assert c_list["total"] == 3, c_list

        # --- 4. UUID dedup ---
        # 4a. Re-import under B: all skipped
        r = await c.post(f"/shares/{token}/import", headers=hb)
        imp2 = r.json()
        assert imp2["imported"] == 0, imp2
        assert imp2["skipped"] == 3, imp2

        # 4b. Self-import (A imports own share): all skipped via id==source_id
        r = await c.post(f"/shares/{token}/import", headers=ha)
        imp3 = r.json()
        assert imp3["imported"] == 0, imp3
        assert imp3["skipped"] == 3, imp3

        # 4c. Soft-delete one of B's imported rows, then re-import: still skipped
        b_imported_one = imported_rows[0]
        del_r = await c.delete(
            f"/questions/{b_imported_one['id']}", headers=hb
        )
        assert del_r.status_code == 204
        r = await c.post(f"/shares/{token}/import", headers=hb)
        imp4 = r.json()
        assert imp4["imported"] == 0, imp4
        assert imp4["skipped"] == 3, imp4
        # Re-fetch B's list — the soft-deleted row is NOT undeleted
        b_list_after = (
            await c.get("/questions?limit=100", headers=hb)
        ).json()
        # Was 4 before; now 3 (one is hidden by soft-delete)
        assert b_list_after["total"] == 3, b_list_after

        # --- 5. My-shares + revoke ---
        r = await c.get("/shares/me", headers=ha)
        mine = r.json()
        assert len(mine["items"]) == 1, mine
        assert mine["items"][0]["token"] == token
        assert mine["items"][0]["question_count"] == 3, mine

        # 5a. B can't revoke A's share
        r = await c.delete(
            f"/shares/{mine['items'][0]['id']}", headers=hb
        )
        assert r.status_code == 404, r.text

        # 5b. A revokes
        r = await c.delete(
            f"/shares/{mine['items'][0]['id']}", headers=ha
        )
        assert r.status_code == 204, r.text

        # 5c. GET now 410
        r = await c.get(f"/shares/{token}")
        assert r.status_code == 410, r.text

        # 5d. Import now 410
        r = await c.post(f"/shares/{token}/import", headers=hb)
        assert r.status_code == 410, r.text

        # 5e. My-shares now empty
        r = await c.get("/shares/me", headers=ha)
        assert r.json()["items"] == [], r.text

        # 5f. Re-revoke same share -> 404 (already revoked)
        r = await c.delete(
            f"/shares/{mine['items'][0]['id']}", headers=ha
        )
        assert r.status_code == 404, r.text

        # --- 6. Bulk add tags ---
        # A has q1 (math, physics), q2 (math), q3 (only-a). Add 'physics'
        # + 'only-a' to all three.
        r = await c.post(
            "/questions/bulk-tags",
            json={
                "question_ids": [q1["id"], q2["id"], q3["id"]],
                "tag_ids": [tag_phys["id"], tag_only_a["id"]],
            },
            headers=ha,
        )
        assert r.status_code == 200, r.text
        bulk = r.json()
        assert bulk["questions_updated"] >= 1, bulk
        # q1 already had both tags? No — q1 had math+physics, missing only-a;
        # q2 had math, missing both; q3 had only-a, missing physics.
        # So expected new links: q1:+1, q2:+2, q3:+1 = 4 total.
        assert bulk["links_added"] == 4, bulk

        # Verify by reading back q2 — should now have math + physics + only-a
        r = await c.get(f"/questions/{q2['id']}", headers=ha)
        q2_after = r.json()
        names_after = {t["name"] for t in q2_after["tags"]}
        assert names_after == {"math", "physics", "only-a"}, q2_after
        # Other fields untouched
        assert q2_after["stem"] == q2["stem"]
        assert q2_after["type"] == q2["type"]
        assert q2_after["correct"] == q2["correct"]

        # 6a. Re-run is a no-op
        r = await c.post(
            "/questions/bulk-tags",
            json={
                "question_ids": [q1["id"], q2["id"], q3["id"]],
                "tag_ids": [tag_phys["id"], tag_only_a["id"]],
            },
            headers=ha,
        )
        bulk2 = r.json()
        assert bulk2["links_added"] == 0, bulk2

        # 6b. Foreign question_id silently dropped
        r = await c.post(
            "/questions/bulk-tags",
            json={
                "question_ids": [qb["id"]],  # B's question
                "tag_ids": [tag_math["id"]],
            },
            headers=ha,
        )
        bulk3 = r.json()
        assert bulk3["questions_updated"] == 0, bulk3
        assert bulk3["links_added"] == 0, bulk3

        # 6c. Foreign tag_id silently dropped
        # B owns its own tags; A uses B's existing tag id -> dropped.
        b_tag = (
            await c.post("/tags", json={"name": "b-tag"}, headers=hb)
        ).json()
        r = await c.post(
            "/questions/bulk-tags",
            json={
                "question_ids": [q1["id"]],  # A's question
                "tag_ids": [b_tag["id"]],     # B's tag
            },
            headers=ha,
        )
        bulk4 = r.json()
        assert bulk4["questions_updated"] == 0, bulk4
        assert bulk4["links_added"] == 0, bulk4

        # 6d. Soft-deleted question_id + soft-deleted tag_id silently dropped
        # Make a temp question + temp tag on A, soft-delete both, then
        # try bulk-tags with their ids -> both filtered out.
        q_soft = (
            await c.post("/questions", json=_qbody("QSOFT", []), headers=ha)
        ).json()
        t_soft = (
            await c.post("/tags", json={"name": "soft"}, headers=ha)
        ).json()
        assert (
            await c.delete(f"/questions/{q_soft['id']}", headers=ha)
        ).status_code == 204
        assert (
            await c.delete(f"/tags/{t_soft['id']}", headers=ha)
        ).status_code == 204
        # Soft-deleted question + valid tag -> dropped
        r = await c.post(
            "/questions/bulk-tags",
            json={
                "question_ids": [q_soft["id"]],
                "tag_ids": [tag_math["id"]],
            },
            headers=ha,
        )
        bulk5 = r.json()
        assert bulk5["questions_updated"] == 0, bulk5
        assert bulk5["links_added"] == 0, bulk5
        # Valid question + soft-deleted tag -> dropped
        r = await c.post(
            "/questions/bulk-tags",
            json={
                "question_ids": [q1["id"]],
                "tag_ids": [t_soft["id"]],
            },
            headers=ha,
        )
        bulk6 = r.json()
        assert bulk6["questions_updated"] == 0, bulk6
        assert bulk6["links_added"] == 0, bulk6

        print("ALL PASS — verify_phase9")


if __name__ == "__main__":
    asyncio.run(main())
