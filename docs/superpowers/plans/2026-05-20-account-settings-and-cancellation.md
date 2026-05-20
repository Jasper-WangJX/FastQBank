# Phase 11.1 — Account Independence, Settings Modal, Cancellation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reverse Phase 11's email-based auto-merge between Google sign-in and password accounts (each becomes an independent `users` row), add a Settings (gear) modal with reset-password (password accounts only) and delete-account flows, and enforce a 24-hour password re-registration cooldown after deletion.

**Architecture:**
- Backend: migration 0007 swaps the global `UNIQUE(email)` for two partial unique indexes (one for password rows, one for Google rows), and adds a `deleted_users` cooldown table. Auth router gets three new authed endpoints (`/auth/request-password-reset-code`, `/auth/reset-password`, `/auth/delete-account`) and `/auth/google/callback` is rewritten to look up by `google_id` (Google `sub` claim) instead of email. `/me` exposes a new `has_password` field.
- Frontend: `AuthContext` caches the `/me` response as `currentUser`; `AppLayout`'s placeholder `HelpCircle` button is replaced with a gear icon that opens a `SettingsModal` (visual style copied from `ImportModal` / `MySharesModal`).

**Tech Stack:** FastAPI · SQLAlchemy 2 async · Alembic · Postgres partial unique indexes · bcrypt · React 19 + Vite · existing modal pattern.

**Spec:** [docs/superpowers/specs/2026-05-20-account-settings-and-cancellation-design.md](../specs/2026-05-20-account-settings-and-cancellation-design.md)

---

## Conventions

- Branch: continuation of `phase-11-account-security` (already cut from `main`).
- Backend test convention: stand-alone `<module>_test.py` smoke scripts run via `.venv/Scripts/python.exe -m app.<module>_test`. No pytest. Behavioural coverage of new endpoints lives in the manual checklist (Task 14), mirroring Phase 11.
- After Task 1 lands, you should run `.venv/Scripts/python.exe -m alembic upgrade head` once before testing manually — Phase 11.1's data model changes are in 0007.
- Commit messages follow `feat: … / fix: … / docs: …` Conventional-Commit style used in the repo.

---

## File map

### Backend — creates
- `apps/server/alembic/versions/0007_account_independence_and_cancellation.py`

### Backend — modifies
- `apps/server/app/models.py`              (User unique-rules via partial indexes; new `DeletedUser`)
- `apps/server/app/schemas.py`             (UserOut.has_password, ResetPasswordIn, DeleteAccountIn)
- `apps/server/app/routers/auth.py`        (six endpoint additions/changes)
- `apps/server/app/auth_routes_test.py`    (assert new routes are mounted)

### Frontend — creates
- `apps/web/src/lib/account.ts`
- `apps/web/src/components/settings/SettingsModal.tsx`

### Frontend — modifies
- `apps/web/src/auth/AuthContext.tsx`      (cache `/me` as currentUser)
- `apps/web/src/components/AppLayout.tsx`  (Help icon → Settings gear + modal mount)

---

## Task 1: Alembic migration 0007 — partial unique indexes + deleted_users

**Files:**
- Create: `apps/server/alembic/versions/0007_account_independence_and_cancellation.py`

- [ ] **Step 1: Write the migration**

Create `apps/server/alembic/versions/0007_account_independence_and_cancellation.py`:

```python
"""Phase 11.1: account independence + cancellation

Replace the global UNIQUE(email) on users with two partial unique
indexes so a password account and a Google account that happen to
share an email can coexist as independent rows. Also swap 0006's
`uq_users_google_id` for a partial unique index so the naming is
consistent ("only unique where the column has a value").

Add `deleted_users (email, deleted_at)` to enforce a 24-hour
password-re-registration cooldown after `/auth/delete-account`.

Revision ID: 0007_account_independence_and_cancellation
Revises: 0006_phase11_account_security
Create Date: 2026-05-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0007_account_independence_and_cancellation"
down_revision: str | None = "0006_phase11_account_security"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # (a) Drop the global UNIQUE on users.email (named in 0001) and
    # 0006's UNIQUE on users.google_id. Replace both with partial
    # unique indexes that only enforce uniqueness for the relevant
    # subset of rows.
    op.drop_constraint("uq_users_email", "users", type_="unique")
    op.drop_constraint("uq_users_google_id", "users", type_="unique")

    op.create_index(
        "uq_users_email_password",
        "users",
        ["email"],
        unique=True,
        postgresql_where=sa.text("google_id IS NULL"),
    )
    op.create_index(
        "uq_users_email_google",
        "users",
        ["email"],
        unique=True,
        postgresql_where=sa.text("google_id IS NOT NULL"),
    )
    op.create_index(
        "uq_users_google_id_notnull",
        "users",
        ["google_id"],
        unique=True,
        postgresql_where=sa.text("google_id IS NOT NULL"),
    )

    # (b) deleted_users cooldown table.
    op.create_table(
        "deleted_users",
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column(
            "deleted_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("email", "deleted_at"),
    )


def downgrade() -> None:
    op.drop_table("deleted_users")
    op.drop_index("uq_users_google_id_notnull", table_name="users")
    op.drop_index("uq_users_email_google", table_name="users")
    op.drop_index("uq_users_email_password", table_name="users")
    # Best-effort: will fail if two rows share an email/google_id.
    op.create_unique_constraint(
        "uq_users_google_id", "users", ["google_id"]
    )
    op.create_unique_constraint("uq_users_email", "users", ["email"])
```

- [ ] **Step 2: Confirm the head**

From `apps/server`:

```bash
.venv/Scripts/python.exe -m alembic heads
```

Expected: `0007_account_independence_and_cancellation (head)`.

- [ ] **Step 3: (If DB available) apply**

```bash
.venv/Scripts/python.exe -m alembic upgrade head
```

Expected: `Running upgrade 0006_phase11_account_security -> 0007_account_independence_and_cancellation`.

If no DB is running locally, skip — Task 14 instructs the user to run this themselves.

- [ ] **Step 4: Commit**

```bash
git add apps/server/alembic/versions/0007_account_independence_and_cancellation.py
git commit -m "feat(db): phase 11.1 migration — partial unique indexes + deleted_users"
```

---

## Task 2: ORM models — partial-index `__table_args__` + DeletedUser

**Files:**
- Modify: `apps/server/app/models.py`

- [ ] **Step 1: Update `User.__table_args__` and add `DeletedUser`**

In `apps/server/app/models.py`:

1. Replace the existing `User` class (the one with `ck_users_auth_method` from Phase 11) with:

```python
class User(Base):
    __tablename__ = "users"

    id: Mapped[PyUUID] = _uuid_pk()
    # NOT unique at the column level — uniqueness is enforced by the
    # two partial indexes below, so a password account and a Google
    # account that share an email can coexist as independent rows.
    email: Mapped[str] = mapped_column(Text, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    # google_id uniqueness is enforced via a partial index (only
    # non-null rows must be unique); same pattern as email.
    google_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = _now_column()

    __table_args__ = (
        CheckConstraint(
            "password_hash IS NOT NULL OR google_id IS NOT NULL",
            name="ck_users_auth_method",
        ),
        Index(
            "uq_users_email_password",
            "email",
            unique=True,
            postgresql_where=text("google_id IS NULL"),
        ),
        Index(
            "uq_users_email_google",
            "email",
            unique=True,
            postgresql_where=text("google_id IS NOT NULL"),
        ),
        Index(
            "uq_users_google_id_notnull",
            "google_id",
            unique=True,
            postgresql_where=text("google_id IS NOT NULL"),
        ),
    )
```

The key differences from Phase 11's `User`: `email` no longer has
`unique=True` on the column; `google_id` no longer has `unique=True`;
three new `Index(...)` entries with `postgresql_where=` enforce
unique-where-applicable. The `ck_users_auth_method` CHECK is preserved.

2. At the end of `apps/server/app/models.py`, append:

```python
class DeletedUser(Base):
    """Cooldown record for password-account cancellation.

    /auth/request-code queries this table to block password
    re-registration of an email for 24 hours after the previous
    password account at that email was deleted. Google sign-in is
    unaffected; this table is not consulted for the Google flow.
    Composite PK so the same email can appear multiple times over
    the project lifetime.
    """

    __tablename__ = "deleted_users"

    email: Mapped[str] = mapped_column(Text, primary_key=True)
    deleted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        primary_key=True,
        server_default=text("now()"),
    )
```

- [ ] **Step 2: Verify imports resolve**

From `apps/server`:

```bash
.venv/Scripts/python.exe -c "from app.models import User, DeletedUser; print('ok')"
```

Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add apps/server/app/models.py
git commit -m "feat(models): partial unique indexes on users + DeletedUser"
```

---

## Task 3: Schemas — UserOut.has_password + reset/delete bodies

**Files:**
- Modify: `apps/server/app/schemas.py`

- [ ] **Step 1: Update `UserOut`**

In `apps/server/app/schemas.py`, find the existing `UserOut` class and replace it with:

```python
class UserOut(BaseModel):
    """Safe public view of a User. Whitelist of fields — password_hash
    is simply not declared here, so it can never be serialized to a
    client. `has_password` is derived in the /me handler so the
    frontend can show / hide password-only features (e.g. the reset
    password section in Settings)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    created_at: datetime
    has_password: bool
```

- [ ] **Step 2: Append the two new request schemas**

At the end of `apps/server/app/schemas.py`, append:

```python
# ---------------------------------------------------------------------------
# Phase 11.1 — Reset password + delete account
# ---------------------------------------------------------------------------


class ResetPasswordIn(BaseModel):
    """Body for POST /auth/reset-password (authenticated)."""

    code: str = Field(pattern=r"^\d{6}$")
    new_password: str = Field(min_length=8, max_length=72)
    confirm_password: str = Field(min_length=8, max_length=72)


class DeleteAccountIn(BaseModel):
    """Body for POST /auth/delete-account (authenticated). The user
    must re-type their own email to avoid one-click deletion of the
    wrong account in a stale tab."""

    confirm_email: EmailStr
```

- [ ] **Step 3: Verify imports**

```bash
.venv/Scripts/python.exe -c "from app.schemas import UserOut, ResetPasswordIn, DeleteAccountIn; print('ok')"
```

Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add apps/server/app/schemas.py
git commit -m "feat(server): UserOut.has_password + reset/delete schemas"
```

---

## Task 4: Rewrite `/auth/google/callback` to use sub-keyed lookup

**Files:**
- Modify: `apps/server/app/routers/auth.py`

- [ ] **Step 1: Replace the callback body**

In `apps/server/app/routers/auth.py`, find the `async def google_callback(...)` function and replace its entire body (everything inside the function) with:

```python
async def google_callback(
    body: GoogleCallbackIn, db: AsyncSession = Depends(get_db)
) -> TokenOut:
    settings = get_settings()
    if not settings.google_client_id or not settings.google_client_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="google sign-in not configured",
        )

    row = await db.scalar(
        select(OAuthState).where(OAuthState.state == body.state)
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid state",
        )
    now = datetime.now(tz=timezone.utc)
    expires_at = row.expires_at
    redirect_uri = row.redirect_uri
    code_verifier = row.code_verifier
    await db.delete(row)
    await db.commit()
    if expires_at < now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid state",
        )

    try:
        token = await exchange_code_for_id_token(
            code=body.code,
            code_verifier=code_verifier,
            redirect_uri=redirect_uri,
            client_id=settings.google_client_id,
            client_secret=settings.google_client_secret,
        )
        identity = verify_id_token(
            token, audience=settings.google_client_id
        )
    except (RuntimeError, ValueError) as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"token exchange failed: {e}",
        ) from e
    if not identity.email_verified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="google email not verified",
        )

    # Phase 11.1: identify users by Google sub, NOT by email. A
    # password account that happens to share this email is left
    # strictly alone.
    user = await db.scalar(
        select(User).where(User.google_id == identity.sub)
    )
    if user is None:
        user = User(
            email=identity.email,
            password_hash=None,
            google_id=identity.sub,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    return TokenOut(access_token=create_access_token(str(user.id)))
```

The previous body's auto-merge branch (`user.google_id is None →
write google_id`) and the `409 account conflict` branch are gone.

- [ ] **Step 2: Quick boot check**

```bash
.venv/Scripts/python.exe -m app.auth_routes_test
```

Expected: `OK — auth routes smoke test`. The structural test still passes because the route set is unchanged.

- [ ] **Step 3: Commit**

```bash
git add apps/server/app/routers/auth.py
git commit -m "feat(auth): google/callback identifies users by sub, not email"
```

---

## Task 5: Narrow request-code/register checks + cooldown lookup

**Files:**
- Modify: `apps/server/app/routers/auth.py`

- [ ] **Step 1: Import `DeletedUser`**

In `apps/server/app/routers/auth.py`, find the import line:

```python
from app.models import EmailVerification, OAuthState, User
```

Replace with:

```python
from app.models import DeletedUser, EmailVerification, OAuthState, User
```

- [ ] **Step 2: Narrow the request-code "already registered" check and add cooldown lookup**

Find the `async def request_code(...)` function. Replace the section from `# Already-registered check` down through (but not including) `# Per-(email, purpose) 60-second cooldown.` with:

```python
    # Already-registered check: only blocks if a PASSWORD account
    # exists for this email. A Google account with the same email
    # does not block password registration (Phase 11.1 made the two
    # rows independent).
    existing_pw = await db.scalar(
        select(User).where(
            User.email == body.email,
            User.password_hash.is_not(None),
        )
    )
    if existing_pw is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="email already registered",
        )

    # Cooldown check: a password account at this email was recently
    # deleted; block re-registration for 24h. Google sign-in is not
    # affected — it doesn't write to deleted_users.
    cutoff = now - timedelta(hours=24)
    recent_delete = await db.scalar(
        select(DeletedUser)
        .where(
            DeletedUser.email == body.email,
            DeletedUser.deleted_at > cutoff,
        )
        .order_by(DeletedUser.deleted_at.desc())
        .limit(1)
    )
    if recent_delete is not None:
        unlock_at = recent_delete.deleted_at + timedelta(hours=24)
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail=f"email cooling down, try again after {unlock_at.isoformat()}",
        )
```

- [ ] **Step 3: Narrow the register concurrent-uniqueness re-check**

Inside the same file, find the `async def register(...)` function. Locate the line:

```python
    existing = await db.scalar(select(User).where(User.email == body.email))
```

Replace with:

```python
    # Concurrent-register guard: only collides with another password
    # account; Google rows with the same email are independent.
    existing = await db.scalar(
        select(User).where(
            User.email == body.email,
            User.password_hash.is_not(None),
        )
    )
```

- [ ] **Step 4: Smoke check**

```bash
.venv/Scripts/python.exe -m app.auth_routes_test
```

Expected: `OK — auth routes smoke test`.

- [ ] **Step 5: Commit**

```bash
git add apps/server/app/routers/auth.py
git commit -m "feat(auth): narrow email checks to password rows + 24h cooldown"
```

---

## Task 6: `/me` returns `has_password`

**Files:**
- Modify: `apps/server/app/routers/auth.py`

- [ ] **Step 1: Replace the `/me` handler**

In `apps/server/app/routers/auth.py`, find:

```python
@router.get("/me", response_model=UserOut)
async def me(current_user: CurrentUser) -> User:
    return current_user
```

Replace with:

```python
@router.get("/me", response_model=UserOut)
async def me(current_user: CurrentUser) -> UserOut:
    """`has_password` lets the frontend gate the reset-password UI
    (Settings modal). We compute it here because it's not an actual
    ORM attribute — UserOut otherwise builds straight from the User
    via `from_attributes=True`."""
    return UserOut(
        id=current_user.id,
        email=current_user.email,
        created_at=current_user.created_at,
        has_password=current_user.password_hash is not None,
    )
```

- [ ] **Step 2: Smoke check**

```bash
.venv/Scripts/python.exe -m app.auth_routes_test
```

Expected: `OK — auth routes smoke test`.

- [ ] **Step 3: Commit**

```bash
git add apps/server/app/routers/auth.py
git commit -m "feat(auth): /me returns has_password for the Settings UI"
```

---

## Task 7: Reset-password endpoints

**Files:**
- Modify: `apps/server/app/routers/auth.py`

- [ ] **Step 1: Import the new schemas**

In `apps/server/app/routers/auth.py`, find the existing schema import block (`from app.schemas import ...`) and ADD `ResetPasswordIn`, `DeleteAccountIn` to it (alphabetical order). After this task the block should include all of:

```python
from app.schemas import (
    DeleteAccountIn,
    GoogleCallbackIn,
    GoogleStartOut,
    LoginIn,
    ProvidersOut,
    RegisterIn,
    RequestCodeIn,
    ResetPasswordIn,
    TokenOut,
    UserOut,
)
```

- [ ] **Step 2: Append two new endpoints**

At the END of `apps/server/app/routers/auth.py` (after `google_callback`), append:

```python
# --- Reset password (authenticated; password accounts only) ---------------


@router.post(
    "/auth/request-password-reset-code",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def request_password_reset_code(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Mail a 6-digit reset code to the logged-in user's email.

    Google-only accounts (password_hash IS NULL) cannot reset — they
    have no password to reset. Reuses EmailVerification with
    purpose='reset' so the per-email 60-second cooldown and DELETE-
    then-INSERT pattern from /auth/request-code apply unchanged.
    """
    if current_user.password_hash is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="password reset not available for this account",
        )

    now = datetime.now(tz=timezone.utc)

    prior = await db.scalar(
        select(EmailVerification).where(
            EmailVerification.email == current_user.email,
            EmailVerification.purpose == "reset",
        )
    )
    if prior is not None:
        elapsed = (now - prior.sent_at).total_seconds()
        if elapsed < CODE_RESEND_SECONDS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="please wait before requesting another code",
            )
        await db.execute(
            delete(EmailVerification).where(
                EmailVerification.email == current_user.email,
                EmailVerification.purpose == "reset",
            )
        )

    code = _new_code()
    row = EmailVerification(
        email=current_user.email,
        code_hash=hash_password(code),
        expires_at=now + timedelta(minutes=CODE_TTL_MINUTES),
        attempts=0,
        sent_at=now,
        purpose="reset",
    )
    db.add(row)
    await db.flush()

    try:
        await send_verification(current_user.email, code)
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="mail delivery failed",
        ) from e

    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/auth/reset-password",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def reset_password(
    body: ResetPasswordIn,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Verify the reset code, then replace password_hash with the
    new value. Code lifecycle mirrors /auth/register exactly."""
    if current_user.password_hash is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="password reset not available for this account",
        )
    if body.new_password != body.confirm_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="passwords do not match",
        )

    now = datetime.now(tz=timezone.utc)
    row = await db.scalar(
        select(EmailVerification).where(
            EmailVerification.email == current_user.email,
            EmailVerification.purpose == "reset",
        )
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="verification required",
        )
    if row.expires_at < now:
        await db.delete(row)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="code expired",
        )
    if row.attempts >= CODE_MAX_ATTEMPTS:
        await db.delete(row)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="too many attempts",
        )
    if not verify_password(body.code, row.code_hash):
        row.attempts += 1
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid code",
        )

    # Code is good — consume it and update the password. We keep the
    # existing JWT valid: its `sub` (user id) is unchanged, and
    # rotating tokens here would log the user out of their current
    # tab without buying real security.
    await db.delete(row)
    current_user.password_hash = hash_password(body.new_password)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
```

- [ ] **Step 3: Confirm both routes mount**

```bash
.venv/Scripts/python.exe -c "from main import app; paths = sorted({r.path for r in app.routes if hasattr(r, 'path')}); print('\n'.join(p for p in paths if 'reset' in p))"
```

Expected output includes:

```
/auth/request-password-reset-code
/auth/reset-password
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/app/routers/auth.py
git commit -m "feat(auth): authed /auth/request-password-reset-code + /auth/reset-password"
```

---

## Task 8: Delete-account endpoint

**Files:**
- Modify: `apps/server/app/routers/auth.py`

- [ ] **Step 1: Import the question/tag/etc. models so explicit deletes are tidy**

In `apps/server/app/routers/auth.py`, replace the existing models import (added in Task 5) with the full list this endpoint needs:

```python
from app.models import (
    AiUsage,
    DeletedUser,
    EmailVerification,
    GenSession,
    OAuthState,
    Question,
    ReviewLog,
    Tag,
    User,
    WrongQuestion,
)
```

(`QuestionTag` is intentionally omitted from the imports — deleting
a question cascades to its join rows via the FK from migration
0001, so we don't need to delete from `question_tags` explicitly.)

- [ ] **Step 2: Append the endpoint**

At the END of `apps/server/app/routers/auth.py`, append:

```python
# --- Delete account (authenticated) ---------------------------------------


@router.post(
    "/auth/delete-account",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_account(
    body: DeleteAccountIn,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Hard-delete the caller and everything they own. For password
    accounts, also record (email, deleted_at) in deleted_users so
    /auth/request-code blocks re-registration for 24 hours. Google
    accounts skip the cooldown — the user can re-sign-in immediately.

    Done explicitly (not via FK CASCADE) because most user_id FKs
    in the original schema don't carry ON DELETE CASCADE. Order
    matters: child tables before users.
    """
    if body.confirm_email != current_user.email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="email mismatch",
        )

    uid = current_user.id

    # Clean up child rows first.
    await db.execute(
        delete(ReviewLog).where(ReviewLog.user_id == uid)
    )
    await db.execute(
        delete(WrongQuestion).where(WrongQuestion.user_id == uid)
    )
    await db.execute(
        delete(AiUsage).where(AiUsage.user_id == uid)
    )
    await db.execute(
        delete(GenSession).where(GenSession.user_id == uid)
    )
    # Question deletion cascades to question_tags (FK has CASCADE
    # from migration 0001).
    await db.execute(
        delete(Question).where(Question.user_id == uid)
    )
    await db.execute(
        delete(Tag).where(Tag.user_id == uid)
    )
    # Any pending verification rows for this email; cheap to clear.
    await db.execute(
        delete(EmailVerification).where(
            EmailVerification.email == current_user.email
        )
    )

    is_password_account = current_user.password_hash is not None

    # shares.creator_id has ON DELETE CASCADE (migration 0005), so
    # deleting the user row cascades to their shares.
    await db.delete(current_user)

    if is_password_account:
        db.add(
            DeletedUser(
                email=current_user.email,
                deleted_at=datetime.now(tz=timezone.utc),
            )
        )

    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
```

- [ ] **Step 3: Confirm the route mounted**

```bash
.venv/Scripts/python.exe -c "from main import app; print('/auth/delete-account' in {r.path for r in app.routes if hasattr(r, 'path')})"
```

Expected: `True`.

- [ ] **Step 4: Commit**

```bash
git add apps/server/app/routers/auth.py
git commit -m "feat(auth): /auth/delete-account with cooldown for password rows"
```

---

## Task 9: Extend auth_routes_test.py with the three new endpoints

**Files:**
- Modify: `apps/server/app/auth_routes_test.py`

- [ ] **Step 1: Add the three routes to `EXPECTED_ROUTES`**

In `apps/server/app/auth_routes_test.py`, find the `EXPECTED_ROUTES` dict and replace it with:

```python
EXPECTED_ROUTES: dict[str, set[str]] = {
    "/auth/register": {"POST"},
    "/auth/login": {"POST"},
    "/auth/request-code": {"POST"},
    "/auth/providers": {"GET"},
    "/auth/google/start": {"GET"},
    "/auth/google/callback": {"POST"},
    "/auth/request-password-reset-code": {"POST"},
    "/auth/reset-password": {"POST"},
    "/auth/delete-account": {"POST"},
    "/me": {"GET"},
}
```

- [ ] **Step 2: Run the test**

```bash
.venv/Scripts/python.exe -m app.auth_routes_test
```

Expected: `OK — auth routes smoke test`.

- [ ] **Step 3: Run the other smoke tests to confirm no regression**

```bash
.venv/Scripts/python.exe -m app.share_token_test
.venv/Scripts/python.exe -m app.mail_test
.venv/Scripts/python.exe -m app.oauth_google_test
```

Each must print its `OK — …` line and exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/server/app/auth_routes_test.py
git commit -m "test(server): assert phase 11.1 routes are mounted"
```

---

## Task 10: AuthContext caches `/me` as `currentUser`

**Files:**
- Modify: `apps/web/src/auth/AuthContext.tsx`

- [ ] **Step 1: Update the file**

Replace the entire contents of `apps/web/src/auth/AuthContext.tsx` with:

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  UNAUTHORIZED_EVENT,
  apiFetch,
  clearToken,
  getToken,
  setToken as persistToken,
} from "../lib/api";

interface Providers {
  google: boolean;
}

interface CurrentUser {
  id: string;
  email: string;
  has_password: boolean;
}

interface AuthContextValue {
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string) => void;
  logout: () => void;
  /** Server-side feature flags. Null until the first /auth/providers
   *  fetch resolves; consumers should treat null as "still loading,
   *  hide the optional button for now". */
  providers: Providers | null;
  /** Cached /me. Null while fetching or logged out. Refresh() forces
   *  a re-fetch (e.g. after Settings actions that change has_password
   *  — currently the password reset keeps has_password true, so this
   *  isn't strictly needed today, but provided for hygiene). */
  currentUser: CurrentUser | null;
  refreshCurrentUser: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [providers, setProviders] = useState<Providers | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const login = useCallback((newToken: string) => {
    persistToken(newToken);
    setTokenState(newToken);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setTokenState(null);
    setCurrentUser(null);
  }, []);

  const refreshCurrentUser = useCallback(() => {
    setRefreshTick((n) => n + 1);
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      setTokenState(null);
      setCurrentUser(null);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () =>
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiFetch<Providers>("/auth/providers")
      .then((p) => {
        if (!cancelled) setProviders(p);
      })
      .catch(() => {
        if (!cancelled) setProviders({ google: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (token === null) {
      setCurrentUser(null);
      return;
    }
    let cancelled = false;
    apiFetch<CurrentUser>("/me")
      .then((u) => {
        if (!cancelled) setCurrentUser(u);
      })
      .catch(() => {
        // 401 is already handled by the UNAUTHORIZED_EVENT path;
        // for anything else, leave currentUser null and let the UI
        // hide gated features.
        if (!cancelled) setCurrentUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token, refreshTick]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      isAuthenticated: token !== null,
      login,
      logout,
      providers,
      currentUser,
      refreshCurrentUser,
    }),
    [token, login, logout, providers, currentUser, refreshCurrentUser],
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm -C apps/web tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/auth/AuthContext.tsx
git commit -m "feat(web): AuthContext caches /me as currentUser"
```

---

## Task 11: `lib/account.ts` — API helpers

**Files:**
- Create: `apps/web/src/lib/account.ts`

- [ ] **Step 1: Write the helpers**

Create `apps/web/src/lib/account.ts`:

```ts
// Phase 11.1 — thin wrappers for the three Settings-modal endpoints
// (request reset code, reset password, delete account). Keeps the
// modal JSX free of fetch plumbing.

import { apiFetch } from "./api";

export async function requestPasswordResetCode(): Promise<void> {
  await apiFetch<void>("/auth/request-password-reset-code", {
    method: "POST",
  });
}

export interface ResetPasswordBody {
  code: string;
  new_password: string;
  confirm_password: string;
}

export async function resetPassword(body: ResetPasswordBody): Promise<void> {
  await apiFetch<void>("/auth/reset-password", {
    method: "POST",
    body,
  });
}

export async function deleteAccount(confirm_email: string): Promise<void> {
  await apiFetch<void>("/auth/delete-account", {
    method: "POST",
    body: { confirm_email },
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm -C apps/web tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/account.ts
git commit -m "feat(web): account.ts API helpers (reset + delete)"
```

---

## Task 12: SettingsModal component

**Files:**
- Create: `apps/web/src/components/settings/SettingsModal.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/settings/SettingsModal.tsx`:

```tsx
// Phase 11.1 — Settings modal opened from the gear button in
// AppLayout. Contains two sections:
//   - Reset password   (only rendered when currentUser.has_password)
//   - Delete account   (always rendered)
//
// Visual style follows the existing ImportModal / MySharesModal:
// backdrop + centered white card + slate borders + font-mono labels.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, Lock, ShieldAlert, X } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { ApiError } from "../../lib/api";
import {
  deleteAccount,
  requestPasswordResetCode,
  resetPassword,
} from "../../lib/account";

interface Props {
  open: boolean;
  onClose: () => void;
}

const RESEND_COOLDOWN = 60;

function friendlyError(detail: string | undefined): string {
  if (!detail) return "Network error";
  if (detail === "password reset not available for this account")
    return "Password reset is not available for Google accounts.";
  if (detail === "email mismatch")
    return "Email confirmation does not match.";
  if (detail.startsWith("email cooling down, try again after ")) {
    const iso = detail.slice("email cooling down, try again after ".length);
    const when = new Date(iso);
    if (!Number.isNaN(when.valueOf()))
      return `Email was recently cancelled. Try again after ${when.toLocaleString()}.`;
    return detail;
  }
  if (detail === "passwords do not match") return "Passwords do not match.";
  if (detail === "please wait before requesting another code")
    return "Please wait a moment before requesting another code.";
  if (detail === "invalid code") return "Invalid code — try again.";
  if (detail === "code expired")
    return "Code expired. Please request a new one.";
  if (detail === "too many attempts")
    return "Too many attempts. Please request a new code.";
  if (detail === "verification required")
    return "Please verify your email first.";
  if (detail === "mail delivery failed")
    return "Could not send the email. Try again in a moment.";
  return detail;
}

export default function SettingsModal({ open, onClose }: Props) {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();

  // ----- reset-password state machine ----------------------------------
  type ResetStep = "idle" | "verify";
  const [resetStep, setResetStep] = useState<ResetStep>("idle");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetCooldown, setResetCooldown] = useState(0);
  const [resetSuccess, setResetSuccess] = useState(false);
  const successTimer = useRef<number | null>(null);

  // ----- delete-account state ------------------------------------------
  const [confirmEmail, setConfirmEmail] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Reset transient state every time the modal opens.
  useEffect(() => {
    if (!open) return;
    setResetStep("idle");
    setResetCode("");
    setNewPassword("");
    setConfirmPassword("");
    setConfirmTouched(false);
    setResetError(null);
    setResetBusy(false);
    setResetSuccess(false);
    setConfirmEmail("");
    setDeleteError(null);
    setDeleteBusy(false);
  }, [open]);

  // 60s "resend" cooldown timer.
  useEffect(() => {
    if (resetCooldown <= 0) return;
    const id = window.setInterval(() => {
      setResetCooldown((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [resetCooldown]);

  // Auto-fold the "Password updated." line after 3 seconds.
  useEffect(() => {
    if (!resetSuccess) return;
    successTimer.current = window.setTimeout(() => {
      setResetSuccess(false);
    }, 3000);
    return () => {
      if (successTimer.current !== null)
        window.clearTimeout(successTimer.current);
    };
  }, [resetSuccess]);

  if (!open) return null;
  if (!currentUser) return null; // /me hasn't resolved yet

  const passwordsMatch =
    !confirmTouched || newPassword === confirmPassword || confirmPassword === "";

  async function sendResetCode() {
    setResetError(null);
    setResetBusy(true);
    try {
      await requestPasswordResetCode();
      setResetStep("verify");
      setResetCooldown(RESEND_COOLDOWN);
    } catch (e) {
      setResetError(
        friendlyError(e instanceof ApiError ? e.message : undefined),
      );
    } finally {
      setResetBusy(false);
    }
  }

  async function submitReset(e: FormEvent) {
    e.preventDefault();
    setResetError(null);
    if (newPassword !== confirmPassword) {
      setResetError("Passwords do not match.");
      return;
    }
    if (!/^\d{6}$/.test(resetCode)) {
      setResetError("Verification code must be 6 digits.");
      return;
    }
    setResetBusy(true);
    try {
      await resetPassword({
        code: resetCode,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      // Reset UI back to idle + show inline confirmation.
      setResetStep("idle");
      setResetCode("");
      setNewPassword("");
      setConfirmPassword("");
      setConfirmTouched(false);
      setResetCooldown(0);
      setResetSuccess(true);
    } catch (e) {
      const detail = e instanceof ApiError ? e.message : undefined;
      setResetError(friendlyError(detail));
      if (
        detail === "code expired" ||
        detail === "too many attempts" ||
        detail === "verification required"
      ) {
        setResetStep("idle");
        setResetCode("");
        setResetCooldown(0);
      }
    } finally {
      setResetBusy(false);
    }
  }

  async function submitDelete() {
    if (confirmEmail !== currentUser.email) return;
    if (
      !window.confirm("Are you absolutely sure? This cannot be undone.")
    )
      return;
    setDeleteError(null);
    setDeleteBusy(true);
    try {
      await deleteAccount(currentUser.email);
      logout();
      navigate("/login", { replace: true });
    } catch (e) {
      setDeleteError(
        friendlyError(e instanceof ApiError ? e.message : undefined),
      );
      setDeleteBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-4 py-8"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-[480px] max-w-full rounded-sm border border-slate-200 bg-white"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
            MODULE / SETTINGS
          </span>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-slate-500 hover:text-slate-900"
            aria-label="Close"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4">
          {/* Account summary */}
          <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-slate-500">
            Account
          </div>
          <div className="mt-1 font-mono text-[12px] text-slate-800">
            {currentUser.email}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-slate-500">
            sign-in: {currentUser.has_password ? "Password" : "Google"}
          </div>

          {/* Reset password section (password accounts only) */}
          {currentUser.has_password && (
            <section className="mt-5 border-t border-slate-200 pt-4">
              <div className="flex items-center justify-between">
                <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-slate-500">
                  Reset password
                </div>
                {resetSuccess && (
                  <span className="font-mono text-[11px] text-emerald-700">
                    Password updated.
                  </span>
                )}
              </div>

              {resetError && (
                <div className="mt-2 rounded-sm border border-red-300 bg-red-50 px-3 py-2 font-mono text-[12px] text-red-700">
                  [ AUTH ] · {resetError}
                </div>
              )}

              {resetStep === "idle" && (
                <div className="mt-3">
                  <p className="font-mono text-[12px] text-slate-600">
                    &gt;_ a 6-digit code will be sent to <span className="text-slate-900">{currentUser.email}</span>
                  </p>
                  <button
                    type="button"
                    onClick={sendResetCode}
                    disabled={resetBusy || resetCooldown > 0}
                    className="mt-3 inline-flex items-center justify-center gap-2 rounded-sm border border-[#1E3A8A] bg-[#1E3A8A] px-3 py-2 font-mono text-[12.5px] uppercase tracking-[0.08em] text-white transition-colors duration-150 hover:bg-[#0B3B8C] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {resetCooldown > 0
                      ? `RESEND IN ${resetCooldown}S`
                      : resetBusy
                      ? "SENDING…"
                      : "SEND CODE"}
                  </button>
                </div>
              )}

              {resetStep === "verify" && (
                <form onSubmit={submitReset} className="mt-3" noValidate>
                  <label
                    htmlFor="set-code"
                    className="block font-mono text-[11px] uppercase tracking-[0.1em] text-slate-500"
                  >
                    Verification code
                  </label>
                  <div className="relative mt-1">
                    <KeyRound
                      size={14}
                      strokeWidth={1.5}
                      aria-hidden
                      className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400"
                    />
                    <input
                      id="set-code"
                      type="text"
                      inputMode="numeric"
                      pattern="\d{6}"
                      autoComplete="one-time-code"
                      required
                      maxLength={6}
                      value={resetCode}
                      onChange={(e) =>
                        setResetCode(
                          e.target.value.replace(/\D/g, "").slice(0, 6),
                        )
                      }
                      className="w-full rounded-sm border border-slate-200 bg-white py-2 pl-8 pr-3 font-mono text-sm tracking-[0.18em] text-slate-900 outline-none transition-colors duration-150 focus:border-[#1E3A8A]"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={resetCooldown > 0 || resetBusy}
                    onClick={sendResetCode}
                    className="mt-1 font-mono text-[11px] text-slate-500 underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 hover:text-[#1E3A8A]"
                  >
                    {resetCooldown > 0
                      ? `Resend in ${resetCooldown}s`
                      : "Resend code"}
                  </button>

                  <label
                    htmlFor="set-new-pw"
                    className="mt-3 block font-mono text-[11px] uppercase tracking-[0.1em] text-slate-500"
                  >
                    New password
                  </label>
                  <div className="relative mt-1">
                    <Lock
                      size={14}
                      strokeWidth={1.5}
                      aria-hidden
                      className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400"
                    />
                    <input
                      id="set-new-pw"
                      type="password"
                      required
                      minLength={8}
                      maxLength={72}
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full rounded-sm border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm text-slate-900 outline-none transition-colors duration-150 focus:border-[#1E3A8A]"
                    />
                  </div>

                  <label
                    htmlFor="set-confirm-pw"
                    className="mt-3 block font-mono text-[11px] uppercase tracking-[0.1em] text-slate-500"
                  >
                    Confirm new password
                  </label>
                  <div className="relative mt-1">
                    <Lock
                      size={14}
                      strokeWidth={1.5}
                      aria-hidden
                      className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400"
                    />
                    <input
                      id="set-confirm-pw"
                      type="password"
                      required
                      minLength={8}
                      maxLength={72}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      onBlur={() => setConfirmTouched(true)}
                      className={`w-full rounded-sm border ${passwordsMatch ? "border-slate-200" : "border-red-300"} bg-white py-2 pl-8 pr-3 text-sm text-slate-900 outline-none transition-colors duration-150 focus:border-[#1E3A8A]`}
                    />
                  </div>
                  {!passwordsMatch && (
                    <span className="mt-1 block font-mono text-[11px] text-red-600">
                      passwords do not match
                    </span>
                  )}

                  <button
                    type="submit"
                    disabled={
                      resetBusy ||
                      !passwordsMatch ||
                      resetCode.length !== 6 ||
                      newPassword.length < 8
                    }
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-sm border border-[#1E3A8A] bg-[#1E3A8A] px-3 py-2 font-mono text-[12.5px] uppercase tracking-[0.08em] text-white transition-colors duration-150 hover:bg-[#0B3B8C] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {resetBusy ? "UPDATING…" : "UPDATE PASSWORD"}
                  </button>
                </form>
              )}
            </section>
          )}

          {/* Delete account section */}
          <section className="mt-5 rounded-sm border border-red-300 bg-red-50 p-3">
            <div className="flex items-center gap-2">
              <ShieldAlert size={14} strokeWidth={1.5} className="text-red-700" />
              <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-red-700">
                Danger zone — delete account
              </span>
            </div>
            <p className="mt-2 font-mono text-[12px] text-slate-700">
              {currentUser.has_password
                ? "This will permanently delete your account, all your questions, tags, and review history. "
                : "This will permanently delete your account, all your questions, tags, and review history."}
              {currentUser.has_password && (
                <>
                  The email <span className="text-slate-900">{currentUser.email}</span> will be blocked from password registration for 24 hours.
                </>
              )}
            </p>

            {deleteError && (
              <div className="mt-2 rounded-sm border border-red-300 bg-white px-3 py-2 font-mono text-[12px] text-red-700">
                [ AUTH ] · {deleteError}
              </div>
            )}

            <label
              htmlFor="set-confirm-email"
              className="mt-3 block font-mono text-[11px] uppercase tracking-[0.1em] text-red-700"
            >
              Type your email to confirm
            </label>
            <input
              id="set-confirm-email"
              type="email"
              autoComplete="off"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              className="mt-1 w-full rounded-sm border border-red-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors duration-150 focus:border-red-500"
            />

            <button
              type="button"
              onClick={submitDelete}
              disabled={confirmEmail !== currentUser.email || deleteBusy}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-sm border border-red-600 bg-red-600 px-3 py-2 font-mono text-[12.5px] uppercase tracking-[0.08em] text-white transition-colors duration-150 hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deleteBusy ? "DELETING…" : "DELETE ACCOUNT"}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm -C apps/web tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/settings/SettingsModal.tsx
git commit -m "feat(web): SettingsModal — reset password + delete account"
```

---

## Task 13: AppLayout — swap Help icon for Settings gear and mount the modal

**Files:**
- Modify: `apps/web/src/components/AppLayout.tsx`

- [ ] **Step 1: Patch the imports**

In `apps/web/src/components/AppLayout.tsx`, find the line:

```ts
  HelpCircle,
```

(inside the `lucide-react` import block) and replace `HelpCircle` with `Settings`. The block now reads (in the original alphabetical order — adjust as needed):

```ts
import {
  // ...other icons unchanged...
  Settings,
  // ...
} from "lucide-react";
```

Also add at the top:

```ts
import { useState } from "react";
import SettingsModal from "./settings/SettingsModal";
```

(If `useState` is already imported, just add `SettingsModal`.)

- [ ] **Step 2: Add modal state + render**

Inside the `AppLayout` function body, near the other hooks, add:

```ts
  const [settingsOpen, setSettingsOpen] = useState(false);
```

Find the button block at lines 218–225 (the existing Help button):

```tsx
            <button
              type="button"
              title="Help"
              aria-label="Help"
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-slate-200 text-slate-500 transition-colors duration-150 hover:border-[#1E3A8A] hover:text-[#1E3A8A]"
            >
              <HelpCircle size={14} strokeWidth={1.5} />
            </button>
```

Replace with:

```tsx
            <button
              type="button"
              title="Settings"
              aria-label="Settings"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-slate-200 text-slate-500 transition-colors duration-150 hover:border-[#1E3A8A] hover:text-[#1E3A8A]"
            >
              <Settings size={14} strokeWidth={1.5} />
            </button>
```

Then near the bottom of the component (just before the closing `</div>` of the AppLayout root), add the modal mount:

```tsx
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
```

The exact location is just before the final closing `</div>` of the outermost wrapper — wherever the existing modals (if any) are mounted, you can sit next to them. AppLayout returns a single top-level wrapper, so the modal sits as the last child inside it.

- [ ] **Step 3: Typecheck**

```bash
pnpm -C apps/web tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/AppLayout.tsx
git commit -m "feat(web): replace Help icon with Settings gear + mount SettingsModal"
```

---

## Task 14: Manual end-to-end verification + Roadmap note

**Files:**
- Modify: `docs/Roadmap_CN.md`
- Modify: `docs/Roadmap_EN.md`

This is the closing task: run through the spec's manual checklist (§7.2) and append a short Phase-11.1 note to the Roadmaps.

- [ ] **Step 1: Apply migration locally**

```bash
cd apps/server
.venv/Scripts/python.exe -m alembic upgrade head
```

Expected: `Running upgrade 0006_phase11_account_security -> 0007_account_independence_and_cancellation`.

If your DB has rows in `users` where the same `email` appears more than once with the same `google_id IS NULL` shape (shouldn't be possible — the old constraint enforced it), the partial-index creation will fail. The migration is otherwise non-destructive.

- [ ] **Step 2: Run server smoke tests**

From `apps/server`:

```bash
.venv/Scripts/python.exe -m app.share_token_test
.venv/Scripts/python.exe -m app.mail_test
.venv/Scripts/python.exe -m app.oauth_google_test
.venv/Scripts/python.exe -m app.auth_routes_test
```

Each must print its `OK — …` line and exit 0.

- [ ] **Step 3: Frontend typecheck**

```bash
pnpm -C apps/web tsc -b --noEmit
pnpm -C apps/desktop tsc --noEmit
```

Both must be clean.

- [ ] **Step 4: Manual checklist (spec §7.2)**

Walk through items 1–10 of the spec's §7.2 in a running browser + uvicorn. Tick each as it passes:

1. **Independence — Google after password.** Password-register email X. Log out. Google sign-in with the same email. Two independent rows exist; password login still works.
2. **Independence — password after Google.** Google sign-in first. Log out. Password-register the same email succeeds with a fresh code.
3. **Settings button visible.** Top-right shows the gear icon (not the `?`).
4. **Reset password (password account).** Settings → SEND CODE → log shows the code → enter code + new password + confirm → success → log out → log back in with new password.
5. **Reset section absent (Google account).** Google sign-in → Settings → only DANGER ZONE section is rendered.
6. **Delete account (Google).** Google sign-in → DANGER ZONE → type email → DELETE → confirm prompt → /login → Google sign-in same email creates a fresh account, no historical data.
7. **Delete account (password) + cooldown.** Password-register a fresh email, add a question, delete → /login. Password-register the same email immediately → cooldown error with unlock time. Google sign-in with the same email → succeeds.
8. **Email mismatch.** Type a wrong email — DELETE button stays disabled.
9. **Password mismatch on reset.** Confirm field differs → red border + "passwords do not match" + button disabled.
10. **`/me has_password`.** Devtools network inspection: `has_password` is `true` for password sign-in and `false` for Google sign-in.

- [ ] **Step 5: Append a Phase 11.1 note to the Roadmaps**

Append to `docs/Roadmap_CN.md` (find the "阶段总览" table that has rows for Phase 11; add Phase 11.1 right after it). One row:

```
| 11.1 帐号独立 + 设置面板 + 注销 | ✅ 已完成 (2026-05-20) | 同邮箱 Google + 密码账号成为两行独立账户；齿轮按钮替换帮助按钮，打开设置面板可重设密码（仅密码账号）或注销账号；密码账号注销后该邮箱 24h 内禁止密码重新注册 |
```

Then, before the "## 风险点与早期验证建议" heading, add a short section:

```markdown
## 阶段 11.1 — 帐号独立 + 设置面板 + 注销

> **状态：✅ 已完成 (2026-05-20)。** 设计：`docs/superpowers/specs/2026-05-20-account-settings-and-cancellation-design.md`。计划：`docs/superpowers/plans/2026-05-20-account-settings-and-cancellation.md`。

### 主要改动
- DB 迁移 0007：用 `(email) WHERE google_id IS NULL` 与 `(email) WHERE google_id IS NOT NULL` 两个 partial unique index 替换 `users.email` 的全局唯一约束；新增 `deleted_users (email, deleted_at)` 表。
- 后端：`/auth/google/callback` 改为按 Google `sub` 查询用户（不再按邮箱合并）；`/auth/request-code` 与 `/auth/register` 的"已注册"检查窄化为 `password_hash IS NOT NULL`；新增 `/auth/request-password-reset-code`、`/auth/reset-password`、`/auth/delete-account` 三个认证接口；`/me` 增加 `has_password` 字段。
- 前端：`AuthContext` 缓存 `/me` 为 `currentUser`；`AppLayout` 顶部的占位 Help 按钮换成 Settings（齿轮）按钮，打开 `SettingsModal` —— 包含 Reset password（仅密码账号显示）与 Delete account 两部分。
```

Do the same in English in `docs/Roadmap_EN.md`:

```
| 11.1 Account independence + Settings modal + Cancellation | ✅ Done (2026-05-20) | Same-email Google + password accounts become two independent rows; gear icon replaces Help and opens a Settings modal with reset password (password accounts only) and delete account; deleting a password account blocks re-registration of the same email for 24 hours |
```

```markdown
## Phase 11.1 — Account independence + Settings modal + Cancellation

> **Status: ✅ Done (2026-05-20).** Design: `docs/superpowers/specs/2026-05-20-account-settings-and-cancellation-design.md`. Plan: `docs/superpowers/plans/2026-05-20-account-settings-and-cancellation.md`.

### Key changes
- DB migration 0007 replaces the global `UNIQUE(email)` with two partial unique indexes (one for password rows, one for Google rows) and adds a `deleted_users (email, deleted_at)` table.
- Backend: `/auth/google/callback` looks up users by Google `sub` (no email-merge); `/auth/request-code` and `/auth/register` narrow their "already registered" check to `password_hash IS NOT NULL`; three new authed endpoints added (`/auth/request-password-reset-code`, `/auth/reset-password`, `/auth/delete-account`); `/me` exposes `has_password`.
- Frontend: `AuthContext` caches `/me` as `currentUser`; `AppLayout` swaps the placeholder Help icon for a Settings gear that opens a `SettingsModal` with Reset password (password accounts only) and Delete account sections.
```

- [ ] **Step 6: Commit**

```bash
git add docs/Roadmap_CN.md docs/Roadmap_EN.md
git commit -m "docs: mark Phase 11.1 done — account independence + settings + cancellation"
```

---

## Done

Final state: same-email Google and password accounts are independent rows; the Settings gear opens a modal that lets password users reset their password and any user delete their account; deletion of a password account locks the same email from password re-registration for 24 hours.
