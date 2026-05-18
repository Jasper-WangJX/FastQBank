"""Prompt templates for the four stage-6 AI tasks, kept in one place so
wording / cost can be tuned without touching the router.

Every template demands STRICT JSON (the router still parses defensively)
and English output — product decision: this is an English-only question
bank. Math is always preserved as LaTeX inside $...$.
"""

from __future__ import annotations

import json

# Shared, strict LaTeX policy woven into every math-producing prompt.
# Doubled backslashes are Python escapes -> the model sees single ones.
LATEX_RULE = (
    "LaTeX rule: wrap EVERY mathematical expression in $...$ — variables, "
    "powers, fractions, roots, functions, (in)equalities, symbols. "
    "Examples: write $(x+1)^3$, $x^2$, $\\frac{a}{b}$, $\\sqrt{2}$, "
    "$\\sin x$, $x \\ge 0$, $2x+1$ (NOT 2x+1). The ONLY thing left bare "
    "is a standalone plain number with no variable or operator (write 5, "
    "not $5$). Apply this in the stem AND every option."
)

# --- /ai/suggest-tags ------------------------------------------------------

SUGGEST_TAGS_SYSTEM = (
    "You label exam questions. You are given a question and the user's "
    "existing tag names. Pick the up to 3 MOST relevant tags FROM THE "
    "GIVEN LIST ONLY. Never invent a tag; never return a name not in the "
    "list. If fewer than 3 fit, return fewer. "
    'Reply with strict json: {"tags": ["name1", "name2", "name3"]}.'
)


def suggest_tags_user(
    stem: str, options_text: str, tag_names: list[str]
) -> str:
    return (
        f"Existing tags: {json.dumps(tag_names, ensure_ascii=False)}\n\n"
        f"Question stem:\n{stem}\n\n"
        f"Options:\n{options_text or '(none)'}\n\n"
        "Return the json now."
    )


# --- /ai/knowledge-summary -------------------------------------------------

KNOWLEDGE_SUMMARY_SYSTEM = (
    "You write a 1-2 sentence study note stating the key concept a "
    "question tests, so a learner can review it quickly. Be concise and "
    "factual; do not restate the question or reveal the answer. "
    + LATEX_RULE
    + ' Reply with strict json: {"summary": "..."}.'
)


def knowledge_summary_user(stem: str, options_text: str) -> str:
    return (
        f"Question stem:\n{stem}\n\n"
        f"Options:\n{options_text or '(none)'}\n\n"
        "Return the json now."
    )


# --- /ai/generate (endpoint only this phase; UI is stage 8) ----------------

GENERATE_SYSTEM = (
    "You generate NEW multiple-choice questions modeled on the seed "
    "questions' topic and difficulty — do NOT copy or trivially reword "
    "them. Rules for each question: 'type' is one of single|multi|judge; "
    "'options' is a list of {'label','content'} with labels A,B,C,...; "
    "'correct' lists the correct label(s); single has exactly 1 correct, "
    "multi has >=1, judge has exactly options T/F with 1 correct. "
    + LATEX_RULE
    + ' Reply with strict json: '
    '{"questions": [{"stem","type","options","correct"}, ...]}.'
)


def generate_user(seeds_json: str, n: int) -> str:
    return (
        f"Generate {n} new questions.\n\n"
        f"Seed questions (JSON):\n{seeds_json}\n\n"
        "Return the json now."
    )


# --- /ai/parse-question (vision) -------------------------------------------

PARSE_QUESTION_SYSTEM = (
    "You convert a screenshot of ONE multiple-choice question into "
    "structured data. Use the OCR text only as a hint; trust the IMAGE "
    "for layout and math. Separate the stem from the options even when "
    "there are no A/B/C/D letters (assign labels A,B,C,... yourself). "
    + LATEX_RULE
    + " 'type' is one of "
    "single|multi|judge (judge => exactly options T/F). Do NOT guess "
    'which option is correct. Reply with strict json: '
    '{"stem": "...", "type": "...", '
    '"options": [{"label": "A", "content": "..."}]}.'
)


def parse_question_user(ocr_text: str) -> str:
    return (
        "OCR text hint (may be wrong or incomplete):\n"
        f"{ocr_text or '(none)'}\n\n"
        "Analyze the attached image and return the json now."
    )
