"""Server-side image prep for the vision call (Roadmap stage 6 cost
control): downsample + grayscale + recompress BEFORE any token is spent.

Done here, not in the Electron main process, so it is unit-testable and
so any future web capture path benefits identically — the desktop only
has to hand over the raw cropped PNG.
"""

from __future__ import annotations

import base64
import io

from PIL import Image

# Long-edge cap: vision cost scales with the pixels the model ingests;
# exam screenshots stay perfectly readable well under this.
MAX_LONG_EDGE = 1024
JPEG_QUALITY = 80


def preprocess_for_vision(image_bytes: bytes) -> str:
    """Any image bytes -> grayscale, long edge <= MAX_LONG_EDGE, JPEG,
    base64 (no `data:` prefix — the provider adds it)."""
    with Image.open(io.BytesIO(image_bytes)) as im:
        im = im.convert("L")  # grayscale
        w, h = im.size
        longest = max(w, h)
        if longest > MAX_LONG_EDGE:
            scale = MAX_LONG_EDGE / longest
            im = im.resize(
                (max(1, round(w * scale)), max(1, round(h * scale))),
                Image.LANCZOS,
            )
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=JPEG_QUALITY)
    return base64.b64encode(buf.getvalue()).decode("ascii")
