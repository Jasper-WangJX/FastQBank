"""Smoke-test the share token generator without pulling in pytest.

Run: `.venv/Scripts/python.exe -m app.share_token_test`
Exits 0 on success; raises AssertionError on the first failure.
"""

from app.share_token import (
    SHARE_TOKEN_CHARSET,
    SHARE_TOKEN_LENGTH,
    generate_share_token,
    is_valid_share_token,
)


def main() -> None:
    seen: set[str] = set()
    for _ in range(2000):
        t = generate_share_token()
        assert len(t) == SHARE_TOKEN_LENGTH, t
        assert all(c in SHARE_TOKEN_CHARSET for c in t), t
        assert is_valid_share_token(t), t
        seen.add(t)
    # 2000 generations should produce 2000 unique tokens (~72-bit
    # entropy makes collisions astronomically unlikely).
    assert len(seen) == 2000, len(seen)

    # Negative cases for is_valid_share_token
    assert not is_valid_share_token("")
    assert not is_valid_share_token("short")
    assert not is_valid_share_token("a" * 13)
    assert not is_valid_share_token("invalid@char_")  # @ not in charset
    assert not is_valid_share_token("with spaceXX")
    print("OK — share_token smoke test")


if __name__ == "__main__":
    main()
