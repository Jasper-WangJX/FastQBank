"""LLM access layer (Roadmap stage 6) — see provider.py for the design.

Re-exports the symbols the /ai router needs. `prompts` and `usage`
(added in step 3) are imported as submodules:
    from app.llm import get_text_provider, AINotConfigured
    from app.llm import prompts
"""

from app.llm.images import preprocess_for_vision
from app.llm.provider import (
    AINotConfigured,
    LLMProvider,
    get_text_provider,
    get_vision_provider,
)

__all__ = [
    "AINotConfigured",
    "LLMProvider",
    "get_text_provider",
    "get_vision_provider",
    "preprocess_for_vision",
]
