"""Size / aspect-ratio mapping and local post-processing.

The upstream accepts only three canvases:
    1:1  1024x1024   ratioType=3
    4:3  1152x864    ratioType=2
    3:4  864x1152    ratioType=1
Anything else requested by an OpenAI client is generated on the nearest
canvas and then cover-cropped (fit=crop) or padded (fit=pad) locally.
"""
from __future__ import annotations

import io
import math
import re
from dataclasses import dataclass

from PIL import Image, ImageDraw, ImageFilter

from .config import settings

SUPPORTED = [
    # key, w, h, ratio_type
    ("1:1", 1024, 1024, "3"),
    ("4:3", 1152, 864, "2"),
    ("3:4", 864, 1152, "1"),
]

_SIZE_RE = re.compile(r"^\s*(\d{2,5})\s*[x×*]\s*(\d{2,5})\s*$", re.I)
_ASPECT_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)\s*$")

# common OpenAI size presets -> aspect ratio hint
PRESETS = {
    "256x256": "1:1", "512x512": "1:1", "1024x1024": "1:1", "2048x2048": "1:1",
    "1024x1792": "9:16", "1792x1024": "16:9",
    "1024x1536": "2:3", "1536x1024": "3:2",
    "1024x768": "4:3", "768x1024": "3:4",
    "1344x768": "7:4", "768x1344": "4:7",
    "1152x864": "4:3", "864x1152": "3:4",
}


@dataclass
class Target:
    width: int
    height: int
    ratio_type: str
    base: tuple[int, int]

    @property
    def ratio(self) -> float:
        return self.width / self.height


def parse_size(size: str | None) -> tuple[int, int] | None:
    if not size:
        return None
    m = _SIZE_RE.match(size)
    if not m:
        return None
    w, h = int(m.group(1)), int(m.group(2))
    return clamp_size(w, h)


def clamp_size(w: int, h: int) -> tuple[int, int]:
    w = max(64, min(w, settings.max_output_side))
    h = max(64, min(h, settings.max_output_side))
    return w, h


def _parse_aspect(aspect: str | None) -> float | None:
    if not aspect:
        return None
    m = _ASPECT_RE.match(aspect)
    if not m:
        return None
    a, b = float(m.group(1)), float(m.group(2))
    if a <= 0 or b <= 0:
        return None
    return a / b


def _nearest_supported(ratio: float) -> tuple[str, int, int, str]:
    best = min(SUPPORTED, key=lambda s: abs(math.log(ratio) - math.log(s[1] / s[2])))
    return best


def resolve_target(
    size: str | None = None,
    aspect_ratio: str | None = None,
    resolution: str | None = None,
    default: str = "1024x1024",
) -> Target:
    """Decide the upstream canvas and the final canvas.

    Order of precedence: size > aspect_ratio > resolution > default.
    """
    dims = parse_size(size)
    if dims is None and size and size in PRESETS:
        aspect_ratio = aspect_ratio or PRESETS[size]

    aspect = _parse_aspect(aspect_ratio)
    if dims is not None:
        target_ratio = dims[0] / dims[1]
    elif aspect:
        target_ratio = aspect
        dims = _dims_from_aspect(aspect, resolution)
    else:
        dims = parse_size(default) or (1024, 1024)
        target_ratio = dims[0] / dims[1]

    key, bw, bh, rt = _nearest_supported(target_ratio)
    dims = clamp_size(*dims)
    return Target(width=dims[0], height=dims[1], ratio_type=rt, base=(bw, bh))


def _dims_from_aspect(aspect: float, resolution: str | None) -> tuple[int, int]:
    long_edge = 1024
    if resolution:
        r = resolution.lower().strip()
        table = {"1k": 1024, "2k": 1536, "4k": 2048, "512": 512, "768": 768, "1024": 1024, "1536": 1536, "2048": 2048}
        if r in table:
            long_edge = table[r]
        else:
            digits = re.sub(r"[^0-9]", "", r)
            if digits:
                long_edge = max(256, min(int(digits), settings.max_output_side))
    if aspect >= 1:
        w = long_edge
        h = max(64, round(long_edge / aspect))
    else:
        h = long_edge
        w = max(64, round(long_edge * aspect))
    return w, h


def postprocess(raw: bytes, target: Target, fit: str = "crop", quality: int | None = None) -> bytes:
    """Resize/crop/pad the upstream image onto the requested canvas."""
    img = Image.open(io.BytesIO(raw))
    img.load()
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")

    if (img.width, img.height) == (target.width, target.height):
        return _encode(img, quality)

    if fit not in ("crop", "pad", "stretch"):
        fit = "crop"

    if fit == "stretch":
        out = img.resize((target.width, target.height), Image.LANCZOS)
        return _encode(out, quality)

    if fit == "crop":
        scale = max(target.width / img.width, target.height / img.height)
        nw, nh = max(target.width, round(img.width * scale)), max(target.height, round(img.height * scale))
        resized = img.resize((nw, nh), Image.LANCZOS)
        left = (nw - target.width) // 2
        top = (nh - target.height) // 2
        out = resized.crop((left, top, left + target.width, top + target.height))
        return _encode(out, quality)

    # pad: blurred cover background + contain foreground
    scale_bg = max(target.width / img.width, target.height / img.height)
    bw, bh = max(target.width, round(img.width * scale_bg)), max(target.height, round(img.height * scale_bg))
    bg = img.convert("RGB").resize((bw, bh), Image.LANCZOS)
    left = (bw - target.width) // 2
    top = (bh - target.height) // 2
    bg = bg.crop((left, top, left + target.width, top + target.height)).filter(
        ImageFilter.GaussianBlur(radius=max(8, target.width // 60))
    )

    scale_fg = min(target.width / img.width, target.height / img.height)
    fw, fh = max(1, round(img.width * scale_fg)), max(1, round(img.height * scale_fg))
    fg = img.resize((fw, fh), Image.LANCZOS)
    canvas = bg
    if fg.mode == "RGBA":
        canvas.paste(fg, ((target.width - fw) // 2, (target.height - fh) // 2), fg)
    else:
        canvas.paste(fg, ((target.width - fw) // 2, (target.height - fh) // 2))
    return _encode(canvas, quality)


def _encode(img: Image.Image, quality: int | None) -> bytes:
    buf = io.BytesIO()
    if img.mode == "RGBA":
        img.save(buf, format="PNG", optimize=True)
    else:
        img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def openai_mask_to_upstream(mask_bytes: bytes) -> str:
    """OpenAI edit masks: transparent pixels mark the area to edit.

    Upstream expects a base64 PNG where white marks the repaired area.
    """
    import base64

    img = Image.open(io.BytesIO(mask_bytes))
    img.load()
    if img.mode == "RGBA":
        alpha = img.getchannel("A")
        gray = alpha.point(lambda a: 255 if a < 128 else 0, mode="L")
    else:
        gray = img.convert("L")
        gray = gray.point(lambda v: 255 if v < 128 else 0, mode="L")
    buf = io.BytesIO()
    gray.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def image_size(raw: bytes) -> tuple[int, int]:
    img = Image.open(io.BytesIO(raw))
    return img.size


def watermark_mask_b64(width: int, height: int, wide: bool = False) -> str:
    """Binary mask covering the upstream watermark in the bottom-right corner.

    Measured on 剪影 5.2.2 output:
      * badge "AI生成": width ~0.10*w, height ~0.043*w, 11 px margins
      * style-transfer also draws "图片由AI生成" text (~0.28*w wide) left of it
    A small padding is added on every side except the image edges.
    """
    import base64

    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    if wide:
        x0 = width - max(160, int(width * 0.30))
        y0 = height - max(80, int(height * 0.065))
    else:
        x0 = width - max(120, int(width * 0.14))
        y0 = height - max(72, int(height * 0.060))
    draw.rectangle([x0, y0, width - 2, height - 2], fill=255)
    buf = io.BytesIO()
    mask.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()
