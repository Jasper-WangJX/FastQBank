from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


class RegisterIn(BaseModel):
    """Request body for POST /auth/register."""

    email: EmailStr
    # 8..72: lower bound is a minimum strength; the 72 upper bound mirrors
    # bcrypt's byte limit so the user gets a clean 422 instead of silent
    # truncation. (security.py still byte-truncates as a safety net.)
    password: str = Field(min_length=8, max_length=72)


class LoginIn(BaseModel):
    """Request body for POST /auth/login. No length rules on purpose —
    validation here would just leak password policy to attackers."""

    email: EmailStr
    password: str


class TokenOut(BaseModel):
    """Response of register/login: the bearer access token."""

    access_token: str
    token_type: Literal["bearer"] = "bearer"


class UserOut(BaseModel):
    """Safe public view of a User. Whitelist of fields — password_hash is
    simply not declared here, so it can never be serialized to a client.
    from_attributes lets FastAPI build this straight from the ORM object."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    created_at: datetime


# ---------------------------------------------------------------------------
# Stage 2 — Tag / Question CRUD schemas
# ---------------------------------------------------------------------------

# --- Tags ---


class TagIn(BaseModel):
    """Request body for POST /tags. An omitted/null parent_id => root tag."""

    name: str = Field(min_length=1, max_length=100)
    parent_id: UUID | None = None


class TagRename(BaseModel):
    """Request body for PATCH /tags/{id}. Rename only — with id-based
    materialized paths the `path` never changes on a rename, so descendants
    are untouched."""

    name: str = Field(min_length=1, max_length=100)


class TagMove(BaseModel):
    """Request body for PUT /tags/{id}/move. An explicit null parent_id
    means "make this a root tag". A dedicated endpoint (instead of an
    optional field on a shared body) keeps null unambiguous."""

    parent_id: UUID | None


class TagOut(BaseModel):
    """Public view of a Tag. deleted_at is intentionally NOT declared so
    the soft-delete column can never be serialized to a client. The tree
    is returned as a flat list ordered by `path`; the client rebuilds the
    hierarchy."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    name: str
    parent_id: UUID | None
    path: str
    created_at: datetime
    updated_at: datetime


# --- Questions ---

QuestionType = Literal["single", "multi", "judge"]


class OptionIn(BaseModel):
    """One answer option in a request body."""

    label: str = Field(min_length=1, max_length=8)
    content: str = Field(min_length=1)


class OptionOut(BaseModel):
    """One answer option in a response. Mirrors the JSONB shape stored in
    Question.options: [{"label": "A", "content": "..."}, ...]."""

    model_config = ConfigDict(from_attributes=True)

    label: str
    content: str


class QuestionIn(BaseModel):
    """Request body for POST /questions. All cross-field rules live in one
    model_validator so the API answers with a single clear 422 instead of
    bouncing off the DB CHECK constraints."""

    stem: str = Field(min_length=1)
    type: QuestionType
    options: list[OptionIn]
    correct: list[str]
    knowledge_summary: str | None = None
    tag_ids: list[UUID] = []
    # Kept so OCR (stage 5) / AI (stage 8) can reuse this schema; stage 2
    # only ever sends "manual".
    source: Literal["manual"] = "manual"

    @model_validator(mode="after")
    def _check_consistency(self) -> "QuestionIn":
        labels = [o.label for o in self.options]
        if len(labels) != len(set(labels)):
            raise ValueError("option labels must be unique")
        if len(self.correct) != len(set(self.correct)):
            raise ValueError("correct must not contain duplicate labels")

        label_set = set(labels)
        for c in self.correct:
            if c not in label_set:
                raise ValueError(
                    f"correct label {c!r} is not one of the option labels"
                )

        if self.type == "judge":
            # Judge is a fixed true/false item — the UI locks options to
            # exactly T/F, so reject anything else server-side as well.
            if label_set != {"T", "F"}:
                raise ValueError(
                    "judge questions must have exactly options 'T' and 'F'"
                )
            if len(self.correct) != 1:
                raise ValueError(
                    "judge questions need exactly one correct option"
                )
        elif self.type == "single":
            if len(self.correct) != 1:
                raise ValueError(
                    "single-choice needs exactly one correct option"
                )
        else:  # multi
            if len(self.correct) < 1:
                raise ValueError(
                    "multiple-choice needs at least one correct option"
                )

        return self


class QuestionUpdate(QuestionIn):
    """Request body for PUT /questions/{id}. Same shape as QuestionIn and
    treated as a FULL replace (no partial merge of options/correct/tags).
    The router ignores `source` here so editing an OCR/AI question never
    silently rewrites its origin."""


class QuestionOut(BaseModel):
    """Public view of a Question. `tags` is populated explicitly by the
    router — models.py declares no ORM relationship on purpose, to avoid
    async lazy-load MissingGreenlet errors."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    stem: str
    type: QuestionType
    options: list[OptionOut]
    correct: list[str]
    knowledge_summary: str | None
    source: str
    created_at: datetime
    updated_at: datetime
    tags: list[TagOut] = []


class QuestionListOut(BaseModel):
    """Paginated response for GET /questions. `total` is the match count
    BEFORE limit/offset so the client can render pagination controls."""

    items: list[QuestionOut]
    total: int
    limit: int
    offset: int
