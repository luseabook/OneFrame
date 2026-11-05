"""OpenAI-compatible image generation gateway backed by the JianYing app API."""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import FastAPI, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

from . import storage
from .config import settings
from .imageops import (
    Target,
    image_size,
    openai_mask_to_upstream,
    postprocess,
    resolve_target,
)
from .jianying import (
    STYLE_BASE,
    STYLE_IDS,
    CircuitOpenError,
    UpstreamError,
    upstream,
)
from .schemas import (
    ChatCompletionRequest,
    ImageData,
    ImageGenerationRequest,
    ImageResponse,
)

log = logging.getLogger("gateway")
logging.basicConfig(
    level=getattr(logging, settings.log_level, logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s | %(message)s",
)

IMAGE_MODELS = {
    "jianying-draw", "jianying", "jianying-draw-3", "jimeng", "jimeng-3",
    "doubao-seedream", "seedream", settings.default_model,
}

EFFECTS_FALLBACK = [
    {"id": "aliyun_tongyi_1", "title": "3D Fairy Tale", "need_face": True},
    {"id": "aliyun_5", "title": "Painting", "need_face": True},
    {"id": "aliyun_0", "title": "Retro comics", "need_face": True},
    {"id": "aliyun_tongyi_36", "title": "2D Anime World", "need_face": True},
    {"id": "color_image", "title": "Colorizer", "need_face": False},
    {"id": "cartoon", "title": "Cartoon", "need_face": True},
    {"id": "pixarEffect", "title": "Disney", "need_face": True},
    {"id": "img2img_pretty_style_ink", "title": "Ink", "need_face": True},
    {"id": "img2img_style_light", "title": "Light", "need_face": True},
    {"id": "game_3d", "title": "3D Game", "need_face": True},
    {"id": "enhancer_image", "title": "Photo Enhancer", "need_face": False},
    {"id": "eraser", "title": "Eraser", "need_face": False},
    {"id": "134", "title": "Impasto hand painting", "need_face": False},
    {"id": "107", "title": "Cartoon illustration", "need_face": False},
    {"id": "121", "title": "Clay", "need_face": False},
    {"id": "age_image", "title": "Old Me", "need_face": True},
    {"id": "avatar", "title": "Avatar", "need_face": True},
    {"id": "angel_plus", "title": "Switch Angel", "need_face": True},
]

_effects_cache: dict[str, Any] = {"ts": 0.0, "items": []}

METRICS: dict[str, Any] = {"requests": 0, "errors": 0, "latency_ms_total": 0, "by_status": {}}


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("gateway %s starting, upstream=%s concurrency=%s",
             settings.version, settings.upstream_base, settings.max_concurrency)
    task = asyncio.create_task(storage.cleanup_loop())
    try:
        yield
    finally:
        task.cancel()
        await upstream.close()


app = FastAPI(title="JianYing Image Gateway", version=settings.version, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------ helpers
def error_json(status: int, message: str, etype: str = "upstream_error", code: Any = None, param: str | None = None):
    return JSONResponse(
        status_code=status,
        content={"error": {"message": message, "type": etype, "param": param, "code": code}},
    )


@app.middleware("http")
async def auth_and_trace(request: Request, call_next):
    rid = request.headers.get("X-Request-Id") or uuid.uuid4().hex[:16]
    request.state.rid = rid
    t0 = time.time()
    path = request.url.path
    if settings.api_keys and path.startswith("/v1"):
        auth = request.headers.get("Authorization", "")
        token = auth[7:].strip() if auth.lower().startswith("bearer ") else request.headers.get("x-api-key", "")
        if token not in settings.api_keys:
            return error_json(401, "invalid api key", "authentication_error")
    try:
        response = await call_next(request)
    except Exception as exc:  # pragma: no cover - safety net
        log.exception("[%s] unhandled: %s", rid, exc)
        return error_json(500, f"internal error: {exc}")
    elapsed_ms = (time.time() - t0) * 1000
    response.headers["X-Request-Id"] = rid
    METRICS["requests"] += 1
    METRICS["latency_ms_total"] += elapsed_ms
    key = str(response.status_code)
    METRICS["by_status"][key] = METRICS["by_status"].get(key, 0) + 1
    if response.status_code >= 400:
        METRICS["errors"] += 1
    log.info("[%s] %s %s -> %s %.0fms", rid, request.method, path, response.status_code, elapsed_ms)
    return response


def public_base(request: Request) -> str:
    if settings.public_base_url:
        return settings.public_base_url
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host", request.headers.get("host", ""))
    return f"{proto}://{host}".rstrip("/")


def _styles(value: str | list[str] | None) -> list[str]:
    if value is None:
        value = settings.default_style
    if isinstance(value, str):
        value = [v.strip() for v in value.split(",") if v.strip()]
    out: list[str] = []
    for v in value or []:
        if v.lower() in ("vivid", "natural", "hd", "standard"):
            continue  # OpenAI style vocabulary, not a jianying style id
        out.append(str(v))
    return out


def _finalize(raw: bytes, target: Target, fit: str, fmt: str, base: str, prompt: str,
              watermark_removed: bool = False) -> ImageData:
    try:
        data = postprocess(raw, target, fit=fit, quality=settings.jpeg_quality)
    except Exception as exc:
        raise UpstreamError(f"image postprocess failed: {exc}") from exc
    size = f"{target.width}x{target.height}"
    if fmt == "b64_json":
        return ImageData(b64_json=base64.b64encode(data).decode(), revised_prompt=prompt,
                         size=size, watermark_removed=watermark_removed or None)
    name = storage.save_image(data, prefix="gen")
    return ImageData(url=f"{base}/files/{name}", revised_prompt=prompt, size=size,
                     watermark_removed=watermark_removed or None)


async def _download(url: str) -> bytes:
    last: Exception | None = None
    for attempt in range(3):
        try:
            return await upstream.download(url)
        except (httpx.HTTPError, OSError) as exc:
            last = exc
            await asyncio.sleep(0.8 * (attempt + 1))
    raise UpstreamError(f"failed to download generated image: {last}", transient=True)


async def _generate_one(prompt: str, styles: list[str], target: Target,
                        fit: str, fmt: str, base: str, remove_wm: bool = False) -> ImageData:
    url = await upstream.text_to_image(prompt, styles=styles, ratio_type=target.ratio_type)
    raw = await _download(url)
    removed = False
    if remove_wm:
        try:
            wpx, hpx = image_size(raw)
            fixed = await upstream.remove_watermark(url, wpx, hpx, wide=False)
            raw = await _download(fixed)
            removed = True
        except Exception as exc:
            log.warning("watermark removal failed: %s", exc)
    return _finalize(raw, target, fit, fmt, base, prompt, watermark_removed=removed)


async def _edit_one(image_url: str, mask_b64: str | None, effect: str, prompt: str,
                    target: Target, fit: str, fmt: str, base: str,
                    remove_wm: bool = False) -> ImageData:
    if mask_b64:
        url = await upstream.inpaint(image_url, mask_b64)
    else:
        url = await upstream.style_transfer(image_url, effect)
    raw = await _download(url)
    removed = False
    if remove_wm and not mask_b64:
        try:
            wpx, hpx = image_size(raw)
            fixed = await upstream.remove_watermark(url, wpx, hpx, wide=True)
            raw = await _download(fixed)
            removed = True
        except Exception as exc:
            log.warning("watermark removal failed (edit): %s", exc)
    return _finalize(raw, target, fit, fmt, base, prompt, watermark_removed=removed)


# ---------------------------------------------------------------- endpoints
@app.get("/")
async def index():
    return {
        "name": "jianying-image-gateway",
        "version": settings.version,
        "openai_compatible": ["/v1/images/generations", "/v1/images/edits", "/v1/chat/completions"],
        "extras": ["/v1/styles", "/v1/effects", "/healthz"],
        "docs": "/docs",
    }


@app.get("/healthz")
async def healthz():
    return {
        "status": "ok",
        "version": settings.version,
        "upstream": settings.upstream_base,
        "max_concurrency": settings.max_concurrency,
    }


@app.get("/metrics")
async def metrics():
    req = max(1, METRICS["requests"])
    return {
        **METRICS,
        "avg_latency_ms": round(METRICS["latency_ms_total"] / req, 1),
        "max_concurrency": settings.max_concurrency,
        "upstream": settings.upstream_base,
    }


@app.get("/v1/models")
async def models():
    ids = sorted({m for m in IMAGE_MODELS if m})
    return {
        "object": "list",
        "data": [
            {"id": m, "object": "model", "created": 0, "owned_by": "jianying-gateway"}
            for m in ids
        ],
    }


@app.get("/v1/styles")
async def styles():
    return {
        "object": "list",
        "data": [
            {"id": s, "thumbnail": f"{STYLE_BASE}{s}.jpg"}
            for s in STYLE_IDS
        ],
    }


@app.get("/v1/effects")
async def effects():
    now = time.time()
    if _effects_cache["items"] and now - _effects_cache["ts"] < 3600:
        return {"object": "list", "data": _effects_cache["items"]}
    try:
        data = await upstream.portal()
        items = [
            {
                "id": it.get("id"),
                "title": it.get("engTitle") or it.get("title") or "",
                "need_face": bool(it.get("sourceNeedFace")),
            }
            for it in (data.get("data") or {}).get("items", [])
            if it.get("id") and it.get("requestSourceType") == "image"
        ]
        if items:
            _effects_cache.update(ts=now, items=items)
            return {"object": "list", "data": items}
    except Exception as exc:
        log.warning("portal fetch failed: %s", exc)
    return {"object": "list", "data": EFFECTS_FALLBACK}


@app.get("/files/{name}")
async def get_file(name: str):
    p = storage.file_path(name)
    if p is None:
        return error_json(404, "file not found", "invalid_request_error")
    return FileResponse(p, headers={"Cache-Control": "public, max-age=86400"})


@app.post("/v1/images/generations")
async def images_generations(body: ImageGenerationRequest, request: Request):
    prompt = (body.prompt or "").strip()
    if body.negative_prompt:
        prompt = f"{prompt}\n画面中不要出现：{body.negative_prompt}".strip()
    if not prompt and not body.reference_image:
        return error_json(400, "prompt is required", "invalid_request_error", param="prompt")
    if len(prompt) > 3000:
        return error_json(400, "prompt too long (max 3000 chars)", "invalid_request_error", param="prompt")

    target = resolve_target(body.size, body.aspect_ratio, body.resolution)
    base = public_base(request)
    styles = _styles(body.style)
    remove_wm = settings.remove_watermark if body.watermark is None else (body.watermark == "remove")

    try:
        if body.reference_image:
            image_url = body.reference_image.strip()
            if not image_url.startswith(("http://", "https://")):
                return error_json(
                    400,
                    "reference_image must be a public http(s) URL (upload it via /v1/images/edits "
                    "or host it yourself)",
                    "invalid_request_error",
                    param="reference_image",
                )
            mask_b64 = None
            if body.mask:
                mask_b64 = _decode_data_url(body.mask)
                if mask_b64 is None:
                    return error_json(400, "mask must be a data:image/...;base64 URL",
                                      "invalid_request_error", param="mask")
            effect = body.effect or settings.default_effect
            tasks = [
                _edit_one(image_url, mask_b64, effect, prompt, target, body.fit,
                          body.response_format, base, remove_wm)
                for _ in range(body.n)
            ]
        else:
            tasks = [
                _generate_one(prompt, styles, target, body.fit, body.response_format, base,
                              remove_wm)
                for _ in range(body.n)
            ]
        results = await asyncio.gather(*tasks)
    except CircuitOpenError as exc:
        return error_json(503, exc.message, "upstream_unavailable")
    except UpstreamError as exc:
        return error_json(502, exc.message, "upstream_error", code=exc.code)

    return ImageResponse(created=int(time.time()), data=results).model_dump(exclude_none=True)


@app.post("/v1/images/edits")
async def images_edits(request: Request):
    # all fields are parsed manually: `image` may be a file OR a URL string
    form = await request.form()

    def field(name: str, default: str = "") -> str:
        v = form.get(name)
        return v if isinstance(v, str) else default

    image = field("image")
    prompt = field("prompt")
    n = int(field("n", "1") or 1)
    size = field("size") or None
    aspect_ratio = field("aspect_ratio") or None
    resolution = field("resolution") or None
    effect = field("effect") or None
    response_format = field("response_format", "b64_json") or "b64_json"
    fit = field("fit", "crop") or "crop"
    watermark_field = field("watermark")
    remove_wm = settings.remove_watermark if not watermark_field else (watermark_field == "remove")

    image_url = None
    uploaded = form.get("image")
    if isinstance(uploaded, UploadFile):
        raw = await uploaded.read()
        if not raw:
            return error_json(400, "empty image upload", "invalid_request_error", param="image")
        if len(raw) > settings.max_upload_mb * 1024 * 1024:
            return error_json(400, f"image larger than {settings.max_upload_mb}MB",
                              "invalid_request_error", param="image")
        try:
            image_url = await _host_upload(raw)
        except UpstreamError as exc:
            return error_json(400, exc.message, "invalid_request_error", param="image")
    elif image and image.startswith(("http://", "https://")):
        image_url = image
    if not image_url:
        return error_json(
            400,
            "provide `image` as a public URL, or as a file upload with PUBLIC_BASE_URL configured",
            "invalid_request_error",
            param="image",
        )

    mask_b64 = None
    mask_field = form.get("mask")
    if isinstance(mask_field, UploadFile):
        mraw = await mask_field.read()
        if mraw:
            try:
                mask_b64 = openai_mask_to_upstream(mraw)
            except Exception as exc:
                return error_json(400, f"bad mask: {exc}", "invalid_request_error", param="mask")

    n = max(1, min(int(n or 1), 4))
    target = resolve_target(size, aspect_ratio, resolution)
    base = public_base(request)
    fmt = "b64_json" if response_format == "b64_json" else "url"
    eff = effect or settings.default_effect

    try:
        results = await asyncio.gather(*[
            _edit_one(image_url, mask_b64, eff, prompt, target, fit, fmt, base, remove_wm)
            for _ in range(n)
        ])
    except CircuitOpenError as exc:
        return error_json(503, exc.message, "upstream_unavailable")
    except UpstreamError as exc:
        return error_json(502, exc.message, "upstream_error", code=exc.code)

    return ImageResponse(created=int(time.time()), data=results).model_dump(exclude_none=True)


@app.post("/v1/chat/completions")
async def chat_completions(body: ChatCompletionRequest, request: Request):
    if body.model not in IMAGE_MODELS:
        return error_json(
            400,
            f"model `{body.model}` not served here; image models: {sorted(IMAGE_MODELS)}",
            "invalid_request_error",
            param="model",
        )
    prompt = _last_user_text(body.messages)
    if not prompt.strip():
        return error_json(400, "no text prompt found in messages", "invalid_request_error", param="messages")

    target = resolve_target(body.size, body.aspect_ratio, None)
    base = public_base(request)
    try:
        img = await _generate_one(prompt, _styles(body.style), target, "crop", "url", base)
    except CircuitOpenError as exc:
        return error_json(503, exc.message, "upstream_unavailable")
    except UpstreamError as exc:
        return error_json(502, exc.message, "upstream_error", code=exc.code)

    content = f"![generated]({img.url})\n\n{img.url}"
    cid = f"chatcmpl-{uuid.uuid4().hex[:24]}"
    created = int(time.time())
    if body.stream:
        async def sse():
            chunk = {
                "id": cid, "object": "chat.completion.chunk", "created": created,
                "model": body.model,
                "choices": [{"index": 0, "delta": {"role": "assistant", "content": content},
                             "finish_reason": None}],
            }
            yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
            done = {
                "id": cid, "object": "chat.completion.chunk", "created": created,
                "model": body.model,
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            }
            yield f"data: {json.dumps(done, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(sse(), media_type="text/event-stream")

    return {
        "id": cid,
        "object": "chat.completion",
        "created": created,
        "model": body.model,
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": content},
            "finish_reason": "stop",
        }],
        "usage": {"prompt_tokens": len(prompt), "completion_tokens": 0, "total_tokens": len(prompt)},
        "data": [img.model_dump(exclude_none=True)],
    }


# ------------------------------------------------------------------ utils
def _decode_data_url(value: str) -> str | None:
    value = value.strip()
    if not value.startswith("data:image/"):
        return None
    try:
        return value.split(",", 1)[1]
    except IndexError:
        return None


def _last_user_text(messages) -> str:
    for msg in reversed(messages):
        if msg.role != "user":
            continue
        content = msg.content
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = []
            for c in content:
                if isinstance(c, dict) and c.get("type") == "text":
                    parts.append(c.get("text", ""))
            return "\n".join(parts)
    return ""


async def _host_upload(raw: bytes) -> str:
    """Make uploaded bytes reachable by the upstream service."""
    try:
        w, h = image_size(raw)
    except Exception as exc:
        raise UpstreamError(f"not a valid image: {exc}") from exc
    if max(w, h) < 32:
        raise UpstreamError("image is too small (min side 32px)")
    name = storage.save_upload(raw, ext="png")
    if settings.public_base_url:
        return f"{settings.public_base_url}/files/{name}"
    if settings.upload_fallback == "catbox":
        url = await _catbox_upload(raw)
        if url:
            return url
        raise UpstreamError("temporary upload failed; set PUBLIC_BASE_URL or retry")
    raise UpstreamError(
        "PUBLIC_BASE_URL is not configured: the upstream service must be able to fetch the "
        "image over the internet. Set PUBLIC_BASE_URL (e.g. https://your-host) or "
        "UPLOAD_FALLBACK=catbox in .env"
    )


async def _catbox_upload(raw: bytes) -> str | None:
    try:
        async with httpx.AsyncClient(timeout=60, trust_env=settings.trust_env) as client:
            resp = await client.post(
                "https://litterbox.catbox.moe/resources/internals/api.php",
                data={"reqtype": "fileupload", "time": settings.upload_fallback_ttl},
                files={"fileToUpload": ("image.png", raw, "image/png")},
            )
            text = resp.text.strip()
            if resp.status_code == 200 and text.startswith("http"):
                return text
            log.warning("catbox upload failed: %s %s", resp.status_code, text[:120])
    except Exception as exc:
        log.warning("catbox upload error: %s", exc)
    return None
