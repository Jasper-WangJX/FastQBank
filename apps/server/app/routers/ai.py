"""AI endpoints (Roadmap stage 6).

Conventions mirror questions.py: explicit paths, `user: CurrentUser`,
`db: AsyncSession = Depends(get_db)`, every query scoped to the user AND
`deleted_at IS NULL`.

Cost discipline (the whole point of stage 6):
- API keys NEVER leave the server; the client only ever sees results.
- Per-minute request cap via slowapi (`@limiter.limit`, per-user key).
- Per-user daily token cap checked BEFORE the call
  (`assert_under_daily_cap`); real spend recorded AFTER
  (`record_usage`) from the provider's own `usage.total_tokens`.
- Missing key => 503 (AINotConfigured), so the app runs without AI.

Text tasks use DeepSeek (step 4); the vision /ai/parse-question
(step 5) uses Gemini and is the ONLY on-demand-cost path: the desktop
calls it just when the regex split failed / a formula is suspected /
the user clicks "Improve with AI".
"""

from __future__ import annotations

import json

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from openai import OpenAIError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import ValidationError

from app.db import get_db
from app.deps import CurrentUser
from app.llm import (
    AINotConfigured,
    get_text_provider,
    get_vision_provider,
    preprocess_for_vision,
)
from app.llm import prompts
from app.llm.usage import (
    assert_under_daily_cap,
    get_today_usage,
    record_usage,
)
from app.models import GenSession, Question, Tag
from app.ratelimit import limiter
from app.schemas import (
    AiUsageOut,
    GenerateIn,
    GeneratedQuestion,
    GenerateOut,
    KnowledgeSummaryIn,
    KnowledgeSummaryOut,
    ParseQuestionOut,
    QuestionIn,
    SuggestedTag,
    SuggestTagsIn,
    SuggestTagsOut,
)
from app.settings import get_settings

router = APIRouter(tags=["ai"])


# slowapi accepts a callable returning the limit string, so the per-min
# cap stays config-driven (settings, not a frozen literal at import).
def _rate() -> str:
    return f"{get_settings().ai_rate_limit_per_min}/minute"


def _options_text(options: list) -> str:
    """Render options as 'A. content' lines for the prompt (cheap tokens,
    clearer than raw JSON for the text models)."""
    return "\n".join(f"{o.label}. {o.content}" for o in options)


def _strip_json_fence(s: str) -> str:
    """Models sometimes wrap JSON in ```json fences despite json_mode —
    tolerate it instead of failing the request."""
    s = s.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else s
        if s.endswith("```"):
            s = s[: s.rfind("```")]
    return s.strip()


def _heal_latex_json(s: str) -> str:
    """Make model-emitted LaTeX-in-JSON parseable.

    The LaTeX-strict prompts make the model put commands like \\frac,
    \\sum, \\theta INSIDE JSON string values. A lone backslash is
    invalid JSON (only \\" \\\\ \\/ \\b \\f \\n \\r \\t \\uXXXX are
    legal), so json.loads either raises ("unparseable") or — worse —
    silently corrupts the math when the command happens to start a
    valid escape (\\frac -> \\f = formfeed).

    Domain assumption: in these endpoints a backslash is ALWAYS a LaTeX
    literal, except `\\\\` (an already-escaped pair) and `\\"` (an
    escaped quote the model uses to embed a quote in a string). Every
    other lone backslash is doubled so it survives json.loads as a
    literal backslash. JSON has no backslashes outside string literals,
    so scanning the whole text and only rewriting backslash runs is
    structurally safe.
    """
    out: list[str] = []
    i, n = 0, len(s)
    while i < n:
        c = s[i]
        if c == "\\" and i + 1 < n:
            nxt = s[i + 1]
            if nxt == "\\":  # keep an already-escaped pair as-is
                out.append("\\\\")
                i += 2
                continue
            if nxt == '"':  # keep an escaped quote
                out.append('\\"')
                i += 2
                continue
            out.append("\\\\")  # lone backslash -> LaTeX literal
            i += 1
            continue
        out.append(c)
        i += 1
    return "".join(out)


def _parse_json_obj(raw: str) -> dict:
    try:
        data = json.loads(_heal_latex_json(_strip_json_fence(raw)))
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI returned an unparseable response",
        ) from None
    if not isinstance(data, dict):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI returned an unexpected response shape",
        )
    return data


def _text_provider():
    """Resolve the DeepSeek provider or 503 (never 500) when unconfigured."""
    try:
        return get_text_provider()
    except AINotConfigured as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e)
        ) from None


def _vision_provider():
    """Resolve the Gemini provider or 503 (never 500) when unconfigured."""
    try:
        return get_vision_provider()
    except AINotConfigured as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e)
        ) from None


async def _call_text(
    db: AsyncSession,
    user: CurrentUser,
    system: str,
    user_msg: str,
    *,
    temperature: float = 0.3,
) -> dict:
    """Shared flow: cap-check -> provider call -> record spend -> JSON.
    Any provider/network failure becomes a clean 502."""
    settings = get_settings()
    provider = _text_provider()
    await assert_under_daily_cap(db, user.id, settings.ai_daily_token_limit)
    try:
        content, tokens = await provider.complete_text(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": user_msg},
            ],
            max_tokens=settings.ai_max_tokens,
            temperature=temperature,
            json_mode=True,
        )
    except OpenAIError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI provider error: {e}",
        ) from None
    await record_usage(db, user.id, tokens)
    return _parse_json_obj(content)


@router.post("/ai/suggest-tags", response_model=SuggestTagsOut)
@limiter.limit(_rate)
async def suggest_tags(
    request: Request,
    body: SuggestTagsIn,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> SuggestTagsOut:
    """Top-3 tags chosen by the model FROM the user's existing tags only.
    Returned names are intersected with live owned tags and resolved back
    to ids so the form can pre-select them."""
    tags = list(
        (
            await db.scalars(
                select(Tag)
                .where(Tag.user_id == user.id, Tag.deleted_at.is_(None))
                .order_by(Tag.name)
            )
        ).all()
    )
    if not tags:
        return SuggestTagsOut(tags=[])

    by_name: dict[str, Tag] = {}
    for t in tags:
        by_name.setdefault(t.name.strip().lower(), t)

    data = await _call_text(
        db,
        user,
        prompts.SUGGEST_TAGS_SYSTEM,
        prompts.suggest_tags_user(
            body.stem, _options_text(body.options), [t.name for t in tags]
        ),
    )
    names = data.get("tags", [])
    if not isinstance(names, list):
        names = []

    out: list[SuggestedTag] = []
    seen: set = set()
    for n in names:
        if not isinstance(n, str):
            continue
        t = by_name.get(n.strip().lower())
        if t and t.id not in seen:
            seen.add(t.id)
            out.append(SuggestedTag(id=t.id, name=t.name))
        if len(out) == 3:
            break
    return SuggestTagsOut(tags=out)


@router.post("/ai/knowledge-summary", response_model=KnowledgeSummaryOut)
@limiter.limit(_rate)
async def knowledge_summary(
    request: Request,
    body: KnowledgeSummaryIn,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> KnowledgeSummaryOut:
    """A 1-2 sentence study note for the question (user can edit it)."""
    data = await _call_text(
        db,
        user,
        prompts.KNOWLEDGE_SUMMARY_SYSTEM,
        prompts.knowledge_summary_user(
            body.stem, _options_text(body.options)
        ),
    )
    summary = data.get("summary", "")
    return KnowledgeSummaryOut(
        summary=summary.strip() if isinstance(summary, str) else ""
    )


@router.post("/ai/generate", response_model=GenerateOut)
@limiter.limit(_rate)
async def generate(
    request: Request,
    body: GenerateIn,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> GenerateOut:
    """Generate N new questions from owned seed questions. Endpoint only
    this phase — the seed-picker / preview UI is stage 8. Each draft is
    validated against the stage-2 QuestionIn rules and surfaced (not
    dropped) so the future UI can let the user fix it."""
    seeds = list(
        (
            await db.scalars(
                select(Question).where(
                    Question.id.in_(body.seed_question_ids),
                    Question.user_id == user.id,
                    Question.deleted_at.is_(None),
                )
            )
        ).all()
    )
    if not seeds:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="no valid seed questions found",
        )

    tags = list(
        (
            await db.scalars(
                select(Tag)
                .where(Tag.user_id == user.id, Tag.deleted_at.is_(None))
                .order_by(Tag.name)
            )
        ).all()
    )
    # lower-name -> canonical name (first wins, mirrors suggest_tags)
    canon_by_lower: dict[str, str] = {}
    for t in tags:
        canon_by_lower.setdefault(t.name.strip().lower(), t.name)

    seeds_json = json.dumps(
        [
            {
                "stem": s.stem,
                "type": s.type,
                "options": s.options,
                "correct": s.correct,
            }
            for s in seeds
        ],
        ensure_ascii=False,
    )
    data = await _call_text(
        db,
        user,
        prompts.GENERATE_SYSTEM,
        prompts.generate_user(
            seeds_json, body.count, [t.name for t in tags]
        ),
        temperature=0.8,  # generation wants variety, not determinism
    )

    raw_list = data.get("questions", [])
    if not isinstance(raw_list, list):
        raw_list = []

    drafts: list[GeneratedQuestion] = []
    for q in raw_list:
        if not isinstance(q, dict):
            continue
        stem = str(q.get("stem", "")).strip()
        qtype = str(q.get("type", "")).strip()
        opts = q.get("options", [])
        correct = q.get("correct", [])
        opts = opts if isinstance(opts, list) else []
        correct = correct if isinstance(correct, list) else []
        norm_opts = [
            {
                "label": str(o.get("label", "")),
                "content": str(o.get("content", "")),
            }
            for o in opts
            if isinstance(o, dict)
        ]
        norm_correct = [str(c) for c in correct]
        ks = q.get("knowledge_summary", "")
        ks = ks.strip() if isinstance(ks, str) else ""
        raw_tags = q.get("tags", [])
        raw_tags = raw_tags if isinstance(raw_tags, list) else []
        norm_tags: list[str] = []
        seen_t: set[str] = set()
        for tg in raw_tags:
            if not isinstance(tg, str):
                continue
            key = tg.strip().lower()
            if key in canon_by_lower and key not in seen_t:
                seen_t.add(key)
                norm_tags.append(canon_by_lower[key])
            if len(norm_tags) == 3:
                break
        valid, err = True, None
        try:
            QuestionIn(
                stem=stem,
                type=qtype,  # type: ignore[arg-type]
                options=norm_opts,  # type: ignore[arg-type]
                correct=norm_correct,
            )
        except ValidationError as ve:
            valid = False
            err = "; ".join(e["msg"] for e in ve.errors())
        drafts.append(
            GeneratedQuestion(
                stem=stem,
                type=qtype,
                options=norm_opts,  # type: ignore[arg-type]
                correct=norm_correct,
                valid=valid,
                validation_error=err,
                knowledge_summary=ks,
                tags=norm_tags,
            )
        )

    # Record the generation session (model already existed, unused until
    # now) for stage-8 traceability.
    db.add(
        GenSession(user_id=user.id, seed_question_ids=[s.id for s in seeds])
    )
    await db.commit()

    return GenerateOut(questions=drafts)


@router.get("/ai/usage", response_model=AiUsageOut)
async def ai_usage(
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> AiUsageOut:
    """Today's token spend for this user. No rate limit / no model call —
    it's the cheap read that proves the counter accumulates and feeds the
    remaining-quota hint in the form."""
    total, count = await get_today_usage(db, user.id)
    return AiUsageOut(
        total_tokens=total,
        request_count=count,
        limit=get_settings().ai_daily_token_limit,
    )


def _normalize_parsed(data: dict) -> ParseQuestionOut:
    """Coerce the model's JSON into ParseQuestionOut. The model assigns
    its own A,B,C labels (it must split unlabeled options); we relabel
    sequentially anyway so the form always gets clean A.. labels, and
    fall back to T/F for a judge with no options."""
    stem = str(data.get("stem", "")).strip()
    qtype = str(data.get("type", "single")).strip().lower()
    if qtype not in ("single", "multi", "judge"):
        qtype = "single"

    raw_opts = data.get("options", [])
    raw_opts = raw_opts if isinstance(raw_opts, list) else []
    options: list[dict] = []
    for i, o in enumerate(raw_opts):
        if not isinstance(o, dict):
            continue
        content = str(o.get("content", "")).strip()
        if not content:
            continue
        options.append(
            {"label": chr(ord("A") + len(options)), "content": content}
        )

    if qtype == "judge":
        options = [
            {"label": "T", "content": "True"},
            {"label": "F", "content": "False"},
        ]

    return ParseQuestionOut(
        stem=stem,
        type=qtype,  # type: ignore[arg-type]
        options=options,  # type: ignore[arg-type]
        matched=True,
    )


@router.post("/ai/parse-question", response_model=ParseQuestionOut)
@limiter.limit(_rate)
async def parse_question(
    request: Request,
    user: CurrentUser,
    image: UploadFile = File(...),
    ocr_text: str = Form(""),
    db: AsyncSession = Depends(get_db),
) -> ParseQuestionOut:
    """Vision fallback: a cropped screenshot + the PaddleOCR text hint ->
    structured {stem, type, options[]} with LaTeX recovered. One call
    solves both deferred OCR problems (no A/B/C/D markers; lost
    formulas). On-demand only — the client calls this just when the
    local regex split failed or the user asked for it."""
    settings = get_settings()
    provider = _vision_provider()  # 503 if no vision key

    raw = await image.read()
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="empty image upload",
        )
    try:
        # Downsample + grayscale BEFORE the call — the stage-6 cost lever.
        image_b64 = preprocess_for_vision(raw)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="could not decode the uploaded image",
        ) from None

    await assert_under_daily_cap(db, user.id, settings.ai_daily_token_limit)
    try:
        content, tokens = await provider.complete_vision(
            image_b64,
            prompts.parse_question_user(ocr_text),
            max_tokens=settings.ai_max_tokens,
            system=prompts.PARSE_QUESTION_SYSTEM,
            json_mode=True,
        )
    except OpenAIError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI provider error: {e}",
        ) from None
    await record_usage(db, user.id, tokens)
    return _normalize_parsed(_parse_json_obj(content))
