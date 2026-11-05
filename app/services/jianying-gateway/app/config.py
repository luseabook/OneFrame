"""Runtime configuration loaded from environment / .env."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _str(name: str, default: str) -> str:
    v = os.getenv(name)
    return v.strip() if v is not None and v.strip() != "" else default


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "").strip())
    except (TypeError, ValueError):
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "").strip())
    except (TypeError, ValueError):
        return default


def _bool(name: str, default: bool) -> bool:
    v = os.getenv(name)
    if v is None or v.strip() == "":
        return default
    return v.strip().lower() in ("1", "true", "yes", "on", "y")


def _list(name: str, default: str = "") -> list[str]:
    raw = os.getenv(name, default)
    return [x.strip() for x in raw.split(",") if x.strip()]


class Settings:
    # --- server -----------------------------------------------------------
    host: str = _str("HOST", "0.0.0.0")
    port: int = _int("PORT", 8788)
    log_level: str = _str("LOG_LEVEL", "info").upper()
    request_timeout: int = _int("REQUEST_TIMEOUT", 300)  # whole-request budget (s)

    # --- auth -------------------------------------------------------------
    # empty list = open gateway
    api_keys: list[str] = _list("API_KEYS", "")

    # --- upstream -----------------------------------------------------------
    upstream_base: str = _str("UPSTREAM_BASE", "http://newapi.jianyingeditor.cn")
    connect_timeout: float = _float("CONNECT_TIMEOUT", 10.0)
    read_timeout: float = _float("READ_TIMEOUT", 180.0)
    max_concurrency: int = _int("MAX_CONCURRENCY", 8)
    upstream_retries: int = _int("UPSTREAM_RETRIES", 3)
    retry_backoff: float = _float("RETRY_BACKOFF", 1.2)
    trust_env: bool = _bool("TRUST_ENV", True)

    # --- circuit breaker ----------------------------------------------------
    cb_fail_threshold: int = _int("CB_FAIL_THRESHOLD", 8)
    cb_open_seconds: int = _int("CB_OPEN_SECONDS", 30)

    # --- images -------------------------------------------------------------
    data_dir: Path = Path(_str("DATA_DIR", str(BASE_DIR / "data")))
    file_ttl_hours: float = _float("FILE_TTL_HOURS", 72.0)
    public_base_url: str = _str("PUBLIC_BASE_URL", "").rstrip("/")
    # optional third-party uploader for /v1/images/edits when PUBLIC_BASE_URL
    # is not reachable: none | catbox
    upload_fallback: str = _str("UPLOAD_FALLBACK", "none").lower()
    upload_fallback_ttl: str = _str("UPLOAD_FALLBACK_TTL", "1h")
    max_upload_mb: int = _int("MAX_UPLOAD_MB", 20)

    default_model: str = _str("DEFAULT_MODEL", "jianying-draw")
    default_style: str = _str("DEFAULT_STYLE", "")
    # erase the upstream "AI生成" watermark by masking it and calling the
    # app's inpainting endpoint (adds ~4-8s per image)
    remove_watermark: bool = _bool("REMOVE_WATERMARK", True)
    default_effect: str = _str("DEFAULT_EFFECT", "aliyun_tongyi_1")
    # upscale limit when the caller asks for something larger than upstream
    max_output_side: int = _int("MAX_OUTPUT_SIDE", 2048)
    jpeg_quality: int = _int("JPEG_QUALITY", 92)

    version = "1.0.0"


settings = Settings()
settings.data_dir.mkdir(parents=True, exist_ok=True)
(settings.data_dir / "files").mkdir(parents=True, exist_ok=True)
(settings.data_dir / "uploads").mkdir(parents=True, exist_ok=True)
