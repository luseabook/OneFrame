"""Upstream client for the JianYing (剪影) AI drawing API.

Protocol (reverse engineered from com.mediaeditor.video 5.2.2):

  POST {UPSTREAM_BASE}{path}
  headers:
    token, pushId, deviceId, channel, en, type,
    X-UserId, X-Time, X-Sign, X-Device, X-OS, X-Version, X-AppId,
    X-IMEI, X-MAC, X-DeviceVersion
  body: base64( RSA_PKCS1_v1_5( JSON ) )  with Content-Type: application/json
  response: base64( AES-128-ECB/PKCS7( JSON ) )

  X-Sign = base64( AES-128-ECB/PKCS7( unix_seconds ) )
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import random
import string
import time
from typing import Any
from urllib.parse import urlparse

import httpx
from Crypto.Cipher import AES, PKCS1_v1_5
from Crypto.PublicKey import RSA
from Crypto.Util.Padding import pad, unpad

from .config import settings

log = logging.getLogger("jianying")

# --- embedded protocol constants (from APK g1.e / g1.c / k1.l / j1.c) ------
_RSA_PUB_B64 = (
    "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCb/IxioWuunK3ZcyYX/YzupNZrwjGB"
    "UbV9wjB5vghSp7joutnJ6115v5xIBH/qXh1uWfvjFOFdIFBiC+JP3+tRLNYHg/juU+z"
    "2SYYN73CSpKVlwgAPA9vUecSASWo2gX0Y2AFeZnuYJxUXNU5+qXhrumv2LFnZ/4SLa6"
    "dJmMz8sQIDAQAB"
)
_AES_KEY = b"8x/A?D(G+KbPeShVmYq3s6v9y$B&E)H@"
_APP_ID = "com.mediaeditor.video"
_APP_VERSION = "972"

_RSA_KEY = RSA.import_key(base64.b64decode(_RSA_PUB_B64))

# error fragments that indicate a transient failure worth retrying
_TRANSIENT_MARKERS = (
    "请稍后", "稍后再试", "转码失败", "系统繁忙", "超时", "timeout", "busy", "again",
)


def _b64e(data: bytes) -> str:
    return base64.b64encode(data).decode()


def _b64d(data: str) -> bytes:
    return base64.b64decode(data)


def rsa_encrypt(data: bytes) -> bytes:
    cipher = PKCS1_v1_5.new(_RSA_KEY)
    out = bytearray()
    for i in range(0, len(data), 117):
        out += cipher.encrypt(data[i : i + 117])
    return bytes(out)


def aes_encrypt(data: bytes) -> bytes:
    return AES.new(_AES_KEY, AES.MODE_ECB).encrypt(pad(data, 16))


def aes_decrypt(data: bytes) -> bytes:
    return unpad(AES.new(_AES_KEY, AES.MODE_ECB).decrypt(data), 16)


def random_device_id() -> str:
    return "".join(random.choices(string.hexdigits.lower(), k=16))


def _no_proxy_match(host: str) -> bool:
    if not host:
        return False
    raw = os.getenv("NO_PROXY") or os.getenv("no_proxy") or ""
    entries = [e.strip().lstrip("[").rstrip("]").split(":")[0].lower() for e in raw.split(",") if e.strip()]
    host = host.lower()
    for e in entries:
        if e == "*":
            return True
        if host == e or host.endswith("." + e):
            return True
    return False


def resolve_proxy(url: str) -> str | None:
    """Resolve an HTTP(S) proxy without letting httpx parse a malformed
    NO_PROXY (bracketed IPv6 entries crash httpx>=0.28)."""
    if not settings.trust_env:
        return None
    try:
        host = urlparse(url).hostname or ""
    except Exception:
        host = ""
    if _no_proxy_match(host):
        return None
    scheme = urlparse(url).scheme
    names = ("HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy") if scheme == "https" else (
        "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy")
    for n in names:
        v = os.getenv(n)
        if v and v.strip():
            v = v.strip()
            try:
                p = urlparse(v)
                if p.scheme in ("http", "https", "socks5", "socks5h") and p.hostname and p.port:
                    return v
            except Exception:
                continue
    return None


class UpstreamError(Exception):
    def __init__(self, message: str, code: Any = None, transient: bool = False):
        super().__init__(message)
        self.message = message
        self.code = code
        self.transient = transient


class CircuitOpenError(UpstreamError):
    pass


class JianyingUpstream:
    """Async upstream client with signing, retries, concurrency cap and a
    simple consecutive-failure circuit breaker."""

    def __init__(self) -> None:
        self._sem = asyncio.Semaphore(max(1, settings.max_concurrency))
        self._fail_count = 0
        self._open_until = 0.0
        self._clients: dict[str | None, httpx.AsyncClient] = {}
        self.device_id = random_device_id()

    # ------------------------------------------------------------------ http
    def _client_for(self, url: str) -> httpx.AsyncClient:
        proxy = resolve_proxy(url)
        client = self._clients.get(proxy)
        if client is not None and not client.is_closed:
            return client
        limits = httpx.Limits(
            max_connections=max(4, settings.max_concurrency * 2),
            max_keepalive_connections=max(4, settings.max_concurrency),
        )
        timeout = httpx.Timeout(
            settings.read_timeout,
            connect=settings.connect_timeout,
            write=settings.connect_timeout,
            pool=settings.connect_timeout,
        )
        client = httpx.AsyncClient(
            timeout=timeout,
            limits=limits,
            trust_env=False,
            proxy=proxy,
            follow_redirects=True,
            headers={"User-Agent": "okhttp/3.12.0"},
        )
        self._clients[proxy] = client
        return client

    async def close(self) -> None:
        for client in list(self._clients.values()):
            if not client.is_closed:
                await client.aclose()
        self._clients.clear()

    def _headers(self, ts: str, token: str = "", user_id: str = "") -> dict[str, str]:
        sign = _b64e(aes_encrypt(ts.encode()))
        return {
            "token": token,
            "pushId": "",
            "deviceId": self.device_id,
            "channel": "vivo",
            "en": "zh_CN",
            "type": "1",
            "X-UserId": user_id,
            "X-Time": ts,
            "X-Sign": sign,
            "X-Device": self.device_id,
            "X-OS": "android",
            "X-Version": _APP_VERSION,
            "X-AppId": _APP_ID,
            "X-IMEI": "",
            "X-MAC": "",
            "X-DeviceVersion": "SM-G955N",
            "Content-Type": "application/json; charset=utf-8",
            "Accept": "application/json",
        }

    async def _post_once(self, path: str, params: dict[str, Any], timeout: float | None) -> dict:
        inner = dict(params)
        inner.update({"abcd": "vivo", "isVip": False, "openId": "", "userId": ""})
        payload = json.dumps(inner, ensure_ascii=False, separators=(",", ":")).encode()
        body = _b64e(rsa_encrypt(payload))
        ts = str(int(time.time()))
        client = self._client_for(settings.upstream_base)
        resp = await client.post(
            settings.upstream_base + path,
            content=body.encode(),
            headers=self._headers(ts),
            timeout=timeout or settings.read_timeout,
        )
        if resp.status_code != 200:
            detail = ""
            try:
                body = resp.content.strip()
                if body.startswith(b"{"):
                    detail = str(json.loads(body.decode()).get("desc") or "")
                elif body:
                    detail = aes_decrypt(_b64d(body.decode())).decode("utf-8", "ignore")
            except Exception:
                pass
            msg = f"upstream http {resp.status_code}" + (f": {detail[:200]}" if detail else "")
            raise UpstreamError(msg, code=resp.status_code, transient=resp.status_code >= 500)
        raw = resp.content.strip()
        if not raw:
            raise UpstreamError("empty upstream response", transient=True)
        try:
            text = aes_decrypt(_b64d(raw.decode())).decode("utf-8")
        except Exception:
            # plaintext fallback (some deployments)
            try:
                text = raw.decode("utf-8")
            except Exception as exc:  # pragma: no cover
                raise UpstreamError(f"cannot decrypt response: {exc}", transient=True) from exc
        try:
            data = json.loads(text)
        except Exception as exc:
            raise UpstreamError(f"bad upstream json: {text[:120]}", transient=True) from exc
        code = data.get("code")
        if code not in (0, "0", None):
            msg = str(data.get("desc") or data.get("msg") or "upstream error")
            transient = any(m in msg for m in _TRANSIENT_MARKERS)
            raise UpstreamError(msg, code=code, transient=transient)
        return data

    def _check_breaker(self) -> None:
        if self._open_until > time.monotonic():
            remain = int(self._open_until - time.monotonic())
            raise CircuitOpenError(f"upstream circuit open, retry in {remain}s")

    def _record(self, ok: bool) -> None:
        if ok:
            self._fail_count = 0
            return
        self._fail_count += 1
        if self._fail_count >= settings.cb_fail_threshold:
            self._open_until = time.monotonic() + settings.cb_open_seconds
            self._fail_count = 0
            log.warning("circuit opened for %ss", settings.cb_open_seconds)

    async def post(self, path: str, params: dict[str, Any], timeout: float | None = None) -> dict:
        self._check_breaker()
        last_exc: Exception | None = None
        for attempt in range(settings.upstream_retries + 1):
            try:
                async with self._sem:
                    data = await self._post_once(path, params, timeout)
                self._record(True)
                return data
            except CircuitOpenError:
                raise
            except UpstreamError as exc:
                last_exc = exc
                ok_retry = exc.transient and attempt < settings.upstream_retries
                self._record(False) if not exc.transient else None
                if not ok_retry:
                    raise
            except (httpx.HTTPError, OSError) as exc:
                last_exc = exc
                self._record(False)
                if attempt >= settings.upstream_retries:
                    raise UpstreamError(f"network error: {exc}", transient=True) from exc
            delay = settings.retry_backoff * (2**attempt) + random.uniform(0, 0.4)
            log.info("retry %s/%s for %s in %.1fs (%s)", attempt + 1,
                     settings.upstream_retries, path, delay, last_exc)
            await asyncio.sleep(delay)
        raise UpstreamError(str(last_exc or "upstream failed"))

    # ------------------------------------------------------------- endpoints
    async def text_to_image(
        self, prompt: str, styles: list[str] | None = None, ratio_type: str = "3",
        timeout: float | None = None,
    ) -> str:
        params = {
            "text": prompt,
            "styles": styles or [],
            "proportion": 1,
            "ratioType": str(ratio_type),
        }
        data = await self.post("/app/ai/text/to/image", params, timeout=timeout)
        url = (data.get("data") or {}).get("url")
        if not url:
            raise UpstreamError("upstream returned no image url", transient=True)
        return url

    async def inpaint(self, image_url: str, mask_b64: str, timeout: float | None = None) -> str:
        data = await self.post(
            "/app/ai/image/fix", {"url": image_url, "maskBase64": mask_b64}, timeout=timeout
        )
        url = (data.get("data") or {}).get("url")
        if not url:
            raise UpstreamError("upstream returned no image url", transient=True)
        return url

    async def style_transfer(self, image_url: str, effect: str, timeout: float | None = None) -> str:
        data = await self.post(
            "/app/ai/face/edit/attr", {"type": effect, "url": image_url}, timeout=timeout
        )
        url = (data.get("data") or {}).get("url")
        if not url:
            raise UpstreamError("upstream returned no image url", transient=True)
        return url

    async def remove_watermark(
        self, image_url: str, width: int, height: int, wide: bool = False,
        timeout: float | None = None,
    ) -> str:
        """Erase the baked-in watermark with the app's own inpainting endpoint.

        The inpaint model leaves every pixel outside the mask untouched
        (measured mean abs diff < 1/255), so the rest of the image survives.
        """
        from .imageops import watermark_mask_b64

        mask = watermark_mask_b64(width, height, wide=wide)
        return await self.inpaint(image_url, mask, timeout=timeout)

    async def portal(self) -> dict:
        return await self.post("/app/ai/feature/portal", {"version": 1}, timeout=20)

    async def download(self, url: str) -> bytes:
        client = self._client_for(url)
        resp = await client.get(url, timeout=settings.read_timeout)
        resp.raise_for_status()
        return resp.content


upstream = JianyingUpstream()

# preset reference-style ids shipped with the app (thumbnails live under
# http://file.jianyingeditor.cn/normal/aiimage/<id>.jpg)
STYLE_IDS = [
    "401", "101", "102", "103", "104", "106", "107", "108", "109", "111", "112",
    "113", "114", "115", "116", "117", "118", "119", "201", "202", "204", "301",
]
STYLE_BASE = "http://file.jianyingeditor.cn/normal/aiimage/"
