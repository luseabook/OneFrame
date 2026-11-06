import base64, json, os, time, random, string, sys
import requests
from Crypto.PublicKey import RSA
from Crypto.Cipher import PKCS1_v1_5, AES
from Crypto.Util.Padding import pad, unpad

BASE = os.getenv("UPSTREAM_BASE", "http://newapi.jianyingeditor.cn")
# 协议常量（APK 内嵌）；与 app/jianying.py 的默认值一致，可用环境变量覆盖。
RSA_PUB_B64 = os.getenv("JY_RSA_PUB_B64", "") or "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCb/IxioWuunK3ZcyYX/YzupNZrwjGBUbV9wjB5vghSp7joutnJ6115v5xIBH/qXh1uWfvjFOFdIFBiC+JP3+tRLNYHg/juU+z2SYYN73CSpKVlwgAPA9vUecSASWo2gX0Y2AFeZnuYJxUXNU5+qXhrumv2LFnZ/4SLa6dJmMz8sQIDAQAB"
AES_KEY = (os.getenv("JY_AES_KEY", "") or "8x/A?D(G+KbPeShVmYq3s6v9y$B&E)H@").encode("utf-8")
APP_ID = "com.mediaeditor.video"
VERSION = "972"

def rsa_encrypt(data: bytes) -> bytes:
    key = RSA.import_key(base64.b64decode(RSA_PUB_B64))
    cipher = PKCS1_v1_5.new(key)
    out = b""
    for i in range(0, len(data), 117):
        chunk = data[i:i+117]
        out += cipher.encrypt(chunk)
    return out

def aes_encrypt(data: bytes) -> bytes:
    c = AES.new(AES_KEY, AES.MODE_ECB)
    return c.encrypt(pad(data, 16))

def aes_decrypt(data: bytes) -> bytes:
    c = AES.new(AES_KEY, AES.MODE_ECB)
    return unpad(c.decrypt(data), 16)

def new_device_id():
    return "".join(random.choices(string.hexdigits.lower(), k=16))

class JianyingClient:
    def __init__(self, token="", user_id="", device_id=None, open_id="", is_vip=False, channel="vivo"):
        self.token = token
        self.user_id = user_id
        self.open_id = open_id
        self.is_vip = is_vip
        self.device_id = device_id or new_device_id()
        self.channel = channel
        self.s = requests.Session()

    def _headers(self, ts):
        sign = base64.b64encode(aes_encrypt(ts.encode())).decode()
        return {
            "token": self.token, "pushId": "", "deviceId": self.device_id,
            "channel": self.channel, "en": "zh_CN", "type": "1",
            "X-UserId": self.user_id, "X-Time": ts, "X-Sign": sign,
            "X-Device": self.device_id, "X-OS": "android",
            "X-Version": VERSION, "X-AppId": APP_ID,
            "X-IMEI": "", "X-MAC": "", "X-DeviceVersion": "SM-G955N",
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "okhttp/3.12.0",
        }

    def post(self, path, params: dict, timeout=60):
        inner = dict(params)
        inner.update({"abcd": self.channel, "isVip": self.is_vip, "openId": self.open_id, "userId": self.user_id})
        payload = json.dumps(inner, ensure_ascii=False, separators=(",", ":")).encode()
        body = base64.b64encode(rsa_encrypt(payload))
        ts = str(int(time.time()))
        r = self.s.post(BASE + path, data=body, headers=self._headers(ts), timeout=timeout)
        return r

    @staticmethod
    def parse(resp):
        raw = resp.content
        try:
            dec = aes_decrypt(raw).decode("utf-8")
            return json.loads(dec)
        except Exception:
            try:
                return json.loads(raw.decode("utf-8"))
            except Exception:
                return {"_raw": raw[:500].decode("utf-8", "replace")}

if __name__ == "__main__":
    c = JianyingClient()
    r = c.post("/app/ai/text/to/image", {"text": "a cat astronaut, cinematic", "styles": ["401"], "proportion": 1, "ratioType": "0"})
    print("HTTP", r.status_code)
    print(json.dumps(c.parse(r), ensure_ascii=False, indent=2)[:1500])
