"""Request models. OpenAI images API compatible, plus documented extensions."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ImageGenerationRequest(BaseModel):
    model: str = "jianying-draw"
    prompt: str = Field(default="", description="Text prompt")
    n: int = Field(default=1, ge=1, le=4)
    size: str | None = Field(default=None, description="WxH, e.g. 1024x1024 / 1792x1024")
    aspect_ratio: str | None = Field(default=None, description="e.g. 1:1, 3:4, 4:3, 16:9, 9:16")
    resolution: str | None = Field(default=None, description="1k / 2k / long-edge pixels")
    quality: str | None = None
    style: str | list[str] | None = Field(
        default=None, description="Preset style id(s), e.g. 101/401/301 (see GET /v1/styles)"
    )
    response_format: Literal["url", "b64_json"] = "url"
    fit: Literal["crop", "pad", "stretch"] = Field(
        default="crop", description="How to fit the upstream canvas to the requested size"
    )
    reference_image: str | None = Field(
        default=None,
        description="Public http(s) URL of a reference image; switches to style transfer / inpaint",
    )
    effect: str | None = Field(
        default=None, description="Effect id for style transfer (see GET /v1/effects)"
    )
    mask: str | None = Field(
        default=None,
        description="data URL mask for inpainting (white/transparent = edit region)",
    )
    negative_prompt: str | None = None
    seed: int | None = None
    user: str | None = None
    watermark: Literal["remove", "keep"] | None = Field(
        default=None,
        description="remove = erase the baked-in AI watermark (default from REMOVE_WATERMARK)",
    )

    # tolerate non-standard fields sent by OpenAI SDK clients
    model_config = {"extra": "allow"}


class ImageData(BaseModel):
    url: str | None = None
    b64_json: str | None = None
    revised_prompt: str | None = None
    size: str | None = None
    watermark_removed: bool | None = None


class ImageResponse(BaseModel):
    created: int
    data: list[ImageData]


class ChatMessage(BaseModel):
    role: str
    content: Any = None


class ChatCompletionRequest(BaseModel):
    model: str = "jianying-draw"
    messages: list[ChatMessage]
    n: int = 1
    stream: bool = False
    size: str | None = None
    aspect_ratio: str | None = None
    style: str | list[str] | None = None
    response_format: dict | None = None
    user: str | None = None

    model_config = {"extra": "allow"}
