"""Smoke-test that Phase 11 added the expected auth routes to the app.

Run: `.venv/Scripts/python.exe -m app.auth_routes_test`
Exits 0 on success.

This is a structural test only — it confirms the FastAPI app boots
and the new routes are mounted at the right paths. Behavioural
testing of these endpoints lives in the Phase 11 plan's Task 24
manual checklist (the spec calls for manual end-to-end coverage of
the Google flow anyway, and the verification flow is verified the
same way for consistency).
"""

from __future__ import annotations

from starlette.routing import Route

from main import app


EXPECTED_ROUTES: dict[str, set[str]] = {
    "/auth/register": {"POST"},
    "/auth/login": {"POST"},
    "/auth/request-code": {"POST"},
    "/auth/providers": {"GET"},
    "/auth/google/start": {"GET"},
    "/auth/google/callback": {"POST"},
    "/me": {"GET"},
}


def main() -> None:
    actual: dict[str, set[str]] = {}
    for r in app.routes:
        if isinstance(r, Route):
            actual.setdefault(r.path, set()).update(r.methods or set())

    for path, methods in EXPECTED_ROUTES.items():
        got = actual.get(path)
        assert got is not None, f"missing route: {path}"
        missing = methods - got
        assert not missing, f"route {path}: missing methods {missing}, got {got}"

    print("OK — auth routes smoke test")


if __name__ == "__main__":
    main()
