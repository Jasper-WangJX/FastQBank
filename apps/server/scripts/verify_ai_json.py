"""Verification: AI JSON parsing tolerates LaTeX backslashes.

Root cause (phase-8 debugging): the LaTeX-strict prompts make the model
emit \\frac, \\sum, \\theta ... INSIDE JSON string values. A lone
backslash is invalid JSON, so json.loads raised and the API returned
502 "AI returned an unparseable response" for every LaTeX question.
Some commands (\\frac -> \\f = formfeed) parse but silently corrupt the
math. _parse_json_obj must heal model LaTeX-JSON before parsing.

No DB / no network — calls the pure parser directly. Run from
apps/server: .venv/Scripts/python.exe scripts/verify_ai_json.py
Exits 0 on success; raises AssertionError on the first failure.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import HTTPException  # noqa: E402

from app.routers.ai import _parse_json_obj  # noqa: E402


def main() -> None:
    # A — the real failure: model emitted single-backslash LaTeX. The
    # Python literal below IS the exact bytes the model returned:
    #   {"summary": "The series $\sum \frac{1}{n(n+1)}$ converges to $1$."}
    raw_a = (
        '{"summary": "The series $\\sum \\frac{1}{n(n+1)}$ '
        'converges to $1$."}'
    )
    out = _parse_json_obj(raw_a)
    assert out == {
        "summary": "The series $\\sum \\frac{1}{n(n+1)}$ converges to $1$."
    }, out

    # B — silent-corruption case: \frac starts with \f (valid JSON
    # formfeed) so the OLD code parsed it but mangled the LaTeX. The
    # backslash must survive intact (no formfeed).
    out = _parse_json_obj('{"stem": "$\\frac{a}{b}$"}')
    assert out == {"stem": "$\\frac{a}{b}$"}, out
    assert "\f" not in out["stem"], out  # no formfeed corruption

    # C — already-valid JSON (no backslashes) is untouched.
    out = _parse_json_obj('{"tags": ["Calculus", "Algebra"]}')
    assert out == {"tags": ["Calculus", "Algebra"]}, out

    # D — correctly double-escaped LaTeX (valid JSON) still decodes to a
    # single backslash, i.e. healing does not double it.
    out = _parse_json_obj('{"stem": "$\\\\sqrt{2}$"}')
    assert out == {"stem": "$\\sqrt{2}$"}, out

    # E — ```json fenced + single-backslash LaTeX (fence strip + heal).
    out = _parse_json_obj(
        '```json\n{"summary": "$\\alpha \\ge 0$"}\n```'
    )
    assert out == {"summary": "$\\alpha \\ge 0$"}, out

    # F — an escaped quote inside a LaTeX string is preserved.
    out = _parse_json_obj('{"summary": "use \\"$\\theta$\\" here"}')
    assert out == {"summary": 'use "$\\theta$" here'}, out

    # G — genuinely unparseable junk still raises 502 (not silently ok).
    try:
        _parse_json_obj("not json at all {{{")
        raise AssertionError("expected HTTPException for junk input")
    except HTTPException as e:
        assert e.status_code == 502, e.status_code

    print("verify_ai_json: ALL PASS")


if __name__ == "__main__":
    main()
