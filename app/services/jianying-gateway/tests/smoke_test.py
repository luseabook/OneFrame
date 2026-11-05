"""Smoke test against a running gateway.

    python tests/smoke_test.py                 # offline checks only
    python tests/smoke_test.py --live          # + real generation calls
    python tests/smoke_test.py --base http://1.2.3.4:8788 --live
"""
from __future__ import annotations

import argparse
import base64
import io
import sys
import time

import httpx
from PIL import Image


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8788")
    ap.add_argument("--live", action="store_true", help="perform real generations")
    args = ap.parse_args()
    base = args.base.rstrip("/")
    client = httpx.Client(trust_env=False, timeout=300)
    failures = 0

    def check(name: str, cond: bool, detail: str = "") -> None:
        nonlocal failures
        print(("PASS " if cond else "FAIL ") + name + (f" | {detail}" if detail else ""))
        if not cond:
            failures += 1

    r = client.get(f"{base}/healthz")
    check("healthz", r.status_code == 200 and r.json().get("status") == "ok")

    r = client.get(f"{base}/v1/models")
    ids = [m["id"] for m in r.json().get("data", [])]
    check("models", "jianying-draw" in ids, ",".join(ids))

    r = client.get(f"{base}/v1/styles")
    check("styles", len(r.json().get("data", [])) >= 20)

    if not args.live:
        print(f"\n{failures} failure(s) (offline mode)")
        return 1 if failures else 0

    t0 = time.time()
    r = client.post(f"{base}/v1/images/generations", json={
        "prompt": "a single red apple on a wooden table, studio light",
        "size": "1024x1024",
    })
    ok = r.status_code == 200
    data = (r.json().get("data") or [{}])[0] if ok else {}
    check("generations(url)", ok and bool(data.get("url")), f"{time.time()-t0:.1f}s {data.get('size')}")
    if data.get("url"):
        img = client.get(data["url"]).content
        im = Image.open(io.BytesIO(img))
        check("image size", im.size == (1024, 1024), str(im.size))

    r = client.post(f"{base}/v1/images/generations", json={
        "prompt": "retro film photo of a bicycle", "size": "512x512", "response_format": "b64_json",
    })
    ok = r.status_code == 200
    item = (r.json().get("data") or [{}])[0] if ok else {}
    if item.get("b64_json"):
        im = Image.open(io.BytesIO(base64.b64decode(item["b64_json"])))
        check("generations(b64)", im.size == (512, 512), str(im.size))
    else:
        check("generations(b64)", False, str(r.text)[:120])

    r = client.post(f"{base}/v1/chat/completions", json={
        "model": "jianying-draw",
        "messages": [{"role": "user", "content": "a paper boat on a puddle"}],
    })
    check("chat.completions", r.status_code == 200 and "/files/" in r.json()["choices"][0]["message"]["content"])

    print(f"\n{failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
