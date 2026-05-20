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
    """Request body for POST /tags. Flat tags — no parent reference."""

    name: str = Field(min_length=1, max_length=100)


class TagRename(BaseModel):
    """Request body for PATCH /tags/{id}. Rename only."""

    name: str = Field(min_length=1, max_length=100)


class TagOut(BaseModel):
    """Public view of a Tag. `deleted_at` is intentionally NOT declared so
    the soft-delete column can never be serialized to a client. Tags are
    flat; clients render the list in name order."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    name: str
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
    # Stage 2 only ever sends "manual"; stage 5 sends "ocr" for
    # screenshot-captured questions and stage 8 will send "ai". The DB
    # CHECK constraint already allows all three.
    source: Literal["manual", "ocr", "ai"] = "manual"

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


# ---------------------------------------------------------------------------
# Stage 6 — AI endpoint schemas
# ---------------------------------------------------------------------------


class SuggestTagsIn(BaseModel):
    """Body for POST /ai/suggest-tags. The server reads the user's own
    tag list itself (it has db + user), so the client only sends the
    question text; options are optional context."""

    stem: str = Field(min_length=1)
    options: list[OptionIn] = []


class SuggestedTag(BaseModel):
    """A suggestion resolved back to a real owned tag so the form can
    pre-select it by id (the model only ever returns existing names)."""

    id: UUID
    name: str


class SuggestTagsOut(BaseModel):
    tags: list[SuggestedTag]


class KnowledgeSummaryIn(BaseModel):
    """Body for POST /ai/knowledge-summary."""

    stem: str = Field(min_length=1)
    options: list[OptionIn] = []


class KnowledgeSummaryOut(BaseModel):
    summary: str


class GenerateIn(BaseModel):
    """Body for POST /ai/generate. Endpoint only this phase — the seed
    picker / preview UI lands in stage 8."""

    seed_question_ids: list[UUID] = Field(min_length=1)
    count: int = Field(default=5, ge=1, le=10)


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


class GenerateOut(BaseModel):
    questions: list[GeneratedQuestion]


class ParseQuestionOut(BaseModel):
    """Response of POST /ai/parse-question (vision, stage 6 step 5).
    Mirrors the OCR splitter's SplitResult so the confirm form fills the
    same way. `matched` is always true here (the AI did structure it)."""

    stem: str
    type: QuestionType
    options: list[OptionOut]
    matched: bool = True


class AiUsageOut(BaseModel):
    """Today's per-user AI spend — backs the stage-6 exit criterion
    'token counter visible in the backend' and the remaining-quota hint
    in the form."""

    total_tokens: int
    request_count: int
    limit: int


# ---------------------------------------------------------------------------
# Stage 7 — Flashcards review + wrong-question set schemas
# ---------------------------------------------------------------------------


class DeckIn(BaseModel):
    """Body for POST /review/deck. The client sends the explicit set of
    selected question ids it built in the picker. `limit` (the optional
    "random pick" cap) draws a random sample of that many; omitted/None
    means all selected (server caps at 1000 as a sanity bound)."""

    question_ids: list[UUID] = Field(min_length=1)
    limit: int | None = Field(default=None, ge=1, le=1000)


class DeckOut(BaseModel):
    """The questions to run, as full QuestionOut (the client needs
    `correct` to score locally — these are the user's own questions, and
    GET /questions already exposes `correct`)."""

    items: list[QuestionOut]


class ReviewLogIn(BaseModel):
    """Body for POST /review/logs — one per answered card."""

    question_id: UUID
    correct: bool


class WrongListOut(BaseModel):
    """Active wrong questions + the count for the picker's tag-column
    "⚠ Wrong questions (N)" entry."""

    items: list[QuestionOut]
    total: int


class TagQuestionIdsOut(BaseModel):
    """Every live question id matching the supplied tag filter — backs
    the picker's per-source "Select all" without paging."""

    question_ids: list[UUID]


# ---------------------------------------------------------------------------
# Stage 9 — Share-link cross-account transfer + bulk operations
# ---------------------------------------------------------------------------


class ShareCreateIn(BaseModel):
    """Body for POST /shares. 1..99 owned question ids. The server
    snapshots the questions at creation time; the resulting share is
    immutable (no edit endpoint)."""

    question_ids: list[UUID] = Field(min_length=1, max_length=99)


class ShareCreateOut(BaseModel):
    """Response of POST /shares. The full URL is built server-side from
    the frontend base + the new token, so the client just copies it."""

    token: str
    share_url: str


class SharedQuestion(BaseModel):
    """One question inside a share payload. `source_id` is the creator's
    `question.id`; the importer's row gets a fresh `id` and stores this
    value in `imported_from_id` for UUID-based dedup."""

    source_id: UUID
    stem: str
    type: QuestionType
    options: list[OptionOut]
    correct: list[str]
    knowledge_summary: str | None = None
    source: Literal["manual", "ocr", "ai"]
    tag_names: list[str] = []


class SharePayload(BaseModel):
    """Top-level shape of the JSONB payload column. `version` is here so
    a future shape change can be detected without a column rename."""

    version: Literal[1] = 1
    questions: list[SharedQuestion]


class SharePreviewOut(BaseModel):
    """Response of GET /shares/{token}. Creator identity is NOT exposed
    — by design (spec §2.2 'no access logging / anonymous-ish')."""

    payload: SharePayload
    created_at: datetime


class ShareImportOut(BaseModel):
    """Response of POST /shares/{token}/import. Counters drive the
    success toast."""

    imported: int
    skipped: int
    tags_created: int
    tags_reused: int


class MyShareRow(BaseModel):
    """One entry in the GET /shares/me list. `question_count` is
    derived from `len(payload.questions)` server-side — the modal shows
    it so the user can identify which share is which."""

    id: UUID
    token: str
    question_count: int
    created_at: datetime


class MyShareListOut(BaseModel):
    items: list[MyShareRow]


class BulkAddTagsIn(BaseModel):
    """Body for POST /questions/bulk-tags. Adds the given tag ids to
    every listed question, idempotently. Existing other tags on each
    question are untouched. Foreign / unknown / soft-deleted ids are
    silently skipped (matches the rest of the codebase's tolerance for
    stale client state)."""

    question_ids: list[UUID] = Field(min_length=1)
    tag_ids: list[UUID] = Field(min_length=1)


class BulkAddTagsOut(BaseModel):
    """Response counters drive the success toast."""

    questions_updated: int
    links_added: int
