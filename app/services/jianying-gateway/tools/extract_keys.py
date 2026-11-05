"""Extract protocol constants from a JianYing (剪影) APK.

The app hides two constants as 7-char bit-packed literals:
  * RSA public key   (X.509 / SPKI, base64)  -> request body encryption
  * AES key          (16/24/32 chars)        -> X-Sign + response decryption

Usage:
    python tools/extract_keys.py path\\to\\jianying.apk
    python tools/extract_keys.py path\\to\\extracted\\classes3.dex

If the upstream rotates its keys in a future version, run this and paste the
output into app/jianying.py (_RSA_PUB_B64 / _AES_KEY).

Add --verify to test every AES candidate against the live upstream
(it decrypts a /app/ai/feature/portal response).
"""
from __future__ import annotations

import base64
import json
import re
import sys
import time
import zipfile
from pathlib import Path

BIT_ALPHABET = "XABYCDZ"  # position -> bit (7th char == 'Z' means 1)
LITERAL_RE = re.compile(rb"[XABYZCDL]{120,}")


def decode_literal(s: str, offset: int = 0) -> str:
    s = s[offset:]
    out = []
    for i in range(0, len(s) - len(s) % 7, 7):
        group = s[i : i + 7]
        bits = "".join("1" if group[j] == c else "0" for j, c in enumerate(BIT_ALPHABET))
        val = sum((1 if bits[6 - j] == "1" else 0) << j for j in range(7))
        if val:
            out.append(chr(val))
    return "".join(out)


def iter_blobs(path: Path):
    if path.suffix.lower() == ".apk" or zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            for name in z.namelist():
                if name.endswith(".dex"):
                    yield name, z.read(name)
    else:
        yield path.name, path.read_bytes()


def is_printable(s: str) -> bool:
    return all(32 <= ord(c) < 127 for c in s)


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    path = Path(sys.argv[1])
    if not path.is_file():
        print(f"not a file: {path}")
        return 1

    rsa_keys: set[str] = set()
    aes_keys: set[str] = set()

    for name, blob in iter_blobs(path):
        for m in LITERAL_RE.finditer(blob):
            lit = m.group(0).decode("ascii", "ignore")
            for offset in range(7):
                dec = decode_literal(lit, offset)
                if "MIGf" in dec or "MIIB" in dec:
                    i = max(dec.find("MIGf"), dec.find("MIIB"))
                    key = dec[i:]
                    if len(key) > 100 and is_printable(key):
                        rsa_keys.add(key)
                if len(dec) in (16, 24, 32) and is_printable(dec):
                    aes_keys.add(dec)

    print(f"[+] scanned: {path}")
    rsa = None
    if rsa_keys:
        for k in sorted(rsa_keys, key=len):
            print("\n[RSA public key] put into app/jianying.py -> _RSA_PUB_B64")
            print(k)
        rsa = sorted(rsa_keys, key=len)[0]
    else:
        print("\n[RSA public key] not found (packed/obfuscated or new encoding?)")
    if aes_keys:
        for k in sorted(aes_keys, key=len):
            print(f"\n[AES key candidate] {k!r}  (len={len(k)}) -> _AES_KEY")
    else:
        print("\n[AES key] not found")

    if "--verify" in sys.argv and rsa and aes_keys:
        good = verify_live(rsa, sorted(aes_keys, key=len))
        print("\n[verify] working AES key:", good if good else "none (upstream changed?)")
    return 0


def verify_live(rsa_b64: str, candidates: list[str]) -> str | None:
    """Ask the live upstream for one response and try to decrypt it."""
    try:
        import requests
        from Crypto.Cipher import AES, PKCS1_v1_5
        from Crypto.PublicKey import RSA
        from Crypto.Util.Padding import pad, unpad
    except ImportError:
        print("[verify] requires requests + pycryptodome")
        return None

    rsa_key = RSA.import_key(base64.b64decode(rsa_b64))
    payload = json.dumps(
        {"version": 1, "abcd": "vivo", "isVip": False, "openId": "", "userId": ""},
        separators=(",", ":"),
    ).encode()
    body = base64.b64encode(PKCS1_v1_5.new(rsa_key).encrypt(payload))
    ts = str(int(time.time()))

    for aes in candidates:
        key = (aes + "0" * 32)[:32].encode()
        sign = base64.b64encode(AES.new(key, AES.MODE_ECB).encrypt(pad(ts.encode(), 16))).decode()
        headers = {
            "deviceId": "a" + "0" * 15, "channel": "vivo", "en": "zh_CN", "type": "1",
            "X-Time": ts, "X-Sign": sign, "X-Device": "a" + "0" * 15, "X-OS": "android",
            "X-Version": "972", "X-AppId": "com.mediaeditor.video", "X-IMEI": "", "X-MAC": "",
            "X-DeviceVersion": "SM-G955N", "Content-Type": "application/json; charset=utf-8",
        }
        try:
            r = requests.post("http://newapi.jianyingeditor.cn/app/ai/feature/portal",
                              data=body, headers=headers, timeout=30)
            text = unpad(AES.new(key, AES.MODE_ECB).decrypt(base64.b64decode(r.content)), 16)
            if b"code" in text:
                return aes
        except Exception:
            continue
    return None


if __name__ == "__main__":
    raise SystemExit(main())
