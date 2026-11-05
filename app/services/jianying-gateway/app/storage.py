"""Local file cache for generated / uploaded images."""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from pathlib import Path

from .config import settings

log = logging.getLogger("storage")

FILES = settings.data_dir / "files"
UPLOADS = settings.data_dir / "uploads"


def save_image(data: bytes, prefix: str = "img", ext: str = "png") -> str:
    name = f"{prefix}_{uuid.uuid4().hex[:24]}.{ext}"
    path = FILES / name
    path.write_bytes(data)
    return name


def save_upload(data: bytes, ext: str = "png") -> str:
    name = f"up_{uuid.uuid4().hex[:24]}.{ext}"
    (UPLOADS / name).write_bytes(data)
    return name


def file_path(name: str) -> Path | None:
    safe = Path(name).name
    for base in (FILES, UPLOADS):
        p = base / safe
        if p.is_file():
            return p
    return None


def cleanup_once(ttl_hours: float | None = None) -> int:
    ttl = (ttl_hours if ttl_hours is not None else settings.file_ttl_hours) * 3600
    if ttl <= 0:
        return 0
    cutoff = time.time() - ttl
    removed = 0
    for base in (FILES, UPLOADS):
        for p in base.glob("*"):
            try:
                if p.is_file() and p.stat().st_mtime < cutoff:
                    p.unlink()
                    removed += 1
            except OSError:
                pass
    return removed


async def cleanup_loop(interval: int = 1800) -> None:
    while True:
        try:
            n = cleanup_once()
            if n:
                log.info("cleaned %s expired files", n)
        except Exception as exc:  # pragma: no cover
            log.warning("cleanup failed: %s", exc)
        await asyncio.sleep(interval)
