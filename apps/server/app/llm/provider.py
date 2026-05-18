"""LLM access layer (Roadmap stage 6).

ONE provider class drives both back-ends: DeepSeek (text) and Gemini
(vision) each expose an OpenAI-compatible Chat Completions API, so an
AsyncOpenAI client differing only by base_url / api_key / model covers
both. Keeping the abstraction this thin means a future swap (OpenRouter,
Qwen, GPT-4o-mini) is a settings change, not a code change.

Design notes:
- Lives under app/ (not the literal `packages/llm_provider.py` the
  roadmap names) because the AI proxy is purely server-side and is
  imported as `from app.llm import ...`, exactly like app/security.py /
  app/deps.py. There is no Python monorepo workspace tooling here.
- Keys are optional. get_text_provider / get_vision_provider raise
  AINotConfigured when their key is missing; the /ai router turns that
  into a clean 503 instead of a 500 — the app must run without AI.
- Every call returns (text, total_tokens). total_tokens comes straight
  from the OpenAI-compatible `usage` block and feeds the per-user daily
  cap + the /ai/usage counter (stage-6 exit criterion).
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from openai import AsyncOpenAI

from app.settings import Settings, get_settings


class AINotConfigured(RuntimeError):
    """Raised when an AI call is attempted but its API key is unset. The
    /ai router maps this to HTTP 503 so the app still boots and every
    non-AI feature keeps working without any credentials."""


class LLMProvider:
    """Minimal text + vision interface over an OpenAI-compatible endpoint.

    `json_mode` asks the model for a strict JSON object. Both DeepSeek
    and Gemini honor `response_format`; the router still parses
    defensively (a model can always misbehave)."""

    def __init__(self, *, api_key: str, base_url: str, model: str) -> None:
        # The AsyncOpenAI client lazily builds its httpx.AsyncClient on
        # first use, inside uvicorn's running loop — so caching the
        # provider (lru_cache below) is safe and avoids per-request setup.
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url)
        self._model = model

    async def complete_text(
        self,
        messages: list[dict[str, Any]],
        max_tokens: int,
        *,
        temperature: float = 0.3,
        json_mode: bool = False,
    ) -> tuple[str, int]:
        """Plain chat completion. `messages` is the OpenAI chat array.
        Returns (content, total_tokens)."""
        kwargs: dict[str, Any] = {
            "model": self._model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        resp = await self._client.chat.completions.create(**kwargs)
        return self._unpack(resp)

    async def complete_vision(
        self,
        image_b64: str,
        prompt: str,
        max_tokens: int,
        *,
        system: str | None = None,
        json_mode: bool = True,
    ) -> tuple[str, int]:
        """One user turn = the prompt + a base64 JPEG (already
        downsampled + grayscaled by app.llm.images). Returns
        (content, total_tokens)."""
        messages: list[dict[str, Any]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append(
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{image_b64}"
                        },
                    },
                ],
            }
        )
        kwargs: dict[str, Any] = {
            "model": self._model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": 0.0,
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        resp = await self._client.chat.completions.create(**kwargs)
        return self._unpack(resp)

    @staticmethod
    def _unpack(resp: Any) -> tuple[str, int]:
        content = (resp.choices[0].message.content or "").strip()
        usage = getattr(resp, "usage", None)
        total = getattr(usage, "total_tokens", 0) or 0
        return content, int(total)


@lru_cache
def get_text_provider() -> LLMProvider:
    """DeepSeek-V3 client (cached). Raises AINotConfigured if no key."""
    s: Settings = get_settings()
    if not s.deepseek_api_key:
        raise AINotConfigured(
            "text AI is not configured (set DEEPSEEK_API_KEY)"
        )
    return LLMProvider(
        api_key=s.deepseek_api_key,
        base_url=s.deepseek_base_url,
        model=s.deepseek_model,
    )


@lru_cache
def get_vision_provider() -> LLMProvider:
    """Gemini 2.0 Flash client (cached). Raises AINotConfigured if no key."""
    s: Settings = get_settings()
    if not s.vision_api_key:
        raise AINotConfigured(
            "vision AI is not configured (set VISION_API_KEY)"
        )
    return LLMProvider(
        api_key=s.vision_api_key,
        base_url=s.vision_base_url,
        model=s.vision_model,
    )
