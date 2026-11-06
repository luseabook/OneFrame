# 剪影 5.2.2 生图链路逆向报告

> 目标：`剪影_5.2.2.apk`（`com.mediaeditor.video`，versionName 5.2.2，versionCode 972，minSdk 24 / targetSdk 36）
> 工具：jadx 1.5.0（JDK 17）、Python 3.12、pycryptodome、Pillow
> 产物：`app/jianying.py`（协议实现）、`tools/extract_keys.py`（密钥提取）

## 1. 入口与调用链

```
AIDrawActivity（AI绘画页）
└── MaterialDrawFragment.x0()            入口按钮：校验提示词 / 参考风格 / 比例
    └── a7.m.B0(text, ratioIndex, styleUrl)
        └── JFTBaseActivity.h(1, url, params, Bean.class, callback)   ← 统一请求入口
            └── BaseAbstractActivity.U() → k1.l.j(...)
                └── k1.l.g()  组装 OkHttp：j1.c 签名拦截器 / j1.b DNS 兜底 / j1.a 错误重试
```

关键类：

| 类 | 作用 |
|---|---|
| `a7.m` | 全部业务 API 定义（`/app/ai/text/to/image`、`/app/ai/image/fix`、`/app/ai/face/edit/attr` …） |
| `a7.n` | base URL + 参数包装（`data` 字段 + abcd/isVip/openId/userId） |
| `k1.l` | OkHttp 封装：POST body = `base64(RSA(json))`，响应 AES 解密 |
| `j1.c` | 请求头注入：token / deviceId / X-Time / X-Sign / X-UserId … |
| `g1.d` | RSA/ECB/PKCS1Padding 分段加密（117 字节/段，1024-bit key） |
| `g1.c` | AES/ECB/PKCS7：响应解密 + X-Sign 生成 |
| `g1.e` | 7 字符位打包字面量的解码器（藏 RSA/AES 密钥） |
| `k1.e` | 设备常量（deviceId / 渠道 / 版本号） |
| `og.f` | 风格缩略图 URL → 风格 id（去目录去扩展名，如 `401.jpg` → `401`） |

## 2. 传输层

### 2.1 基础地址

```
http://newapi.jianyingeditor.cn          # a7.n.f250a，明文 HTTP
```

### 2.2 请求头（j1.c）

```
token           登录 token（匿名可为空）
pushId          推送 id（可空）
deviceId        android_id / imei / uuid（任意稳定串即可）
channel         UMENG_CHANNEL（vivo）
en              语言（zh_CN）
type            1
X-UserId        用户 id（匿名可空）
X-Time          Unix 秒
X-Sign          base64(AES-ECB-PKCS7(X-Time))
X-Device        同 deviceId
X-OS            android
X-Version       versionCode（972）
X-AppId         com.mediaeditor.video
X-IMEI / X-MAC  空串
X-DeviceVersion Build.MODEL
Content-Type    application/json; charset=utf-8
```

### 2.3 请求体

```java
// k1.l.i()
RequestBody.create(
    Base64(RSA_Encrypt(JSON.toJSONString(params))),
    MediaType.parse("application/json; charset=utf-8")
)
```

- JSON 先由 `a7.n.b()` 包一层：`{"data":"<业务参数JSON>", ...}` —— 外层 map 会被 `a7.n.a()` 序列化成
  内层 `data` 字符串，再整体 RSA。
- RSA：`RSA/ECB/PKCS1Padding`，X.509 SPKI 公钥，1024-bit，按 117 字节分段后拼接。
- Base64：`android.util.Base64` 默认 NO_WRAP（标准字母表、无换行）。

### 2.4 响应体

```java
// k1.l 成功回调
new JSONObject(g1.c.a(responseBody))     // g1.c.a = AES_Decrypt(Base64_Decode(body))
```

失败状态码 406 时优先读 `desc` 字段做提示。

### 2.5 密钥的隐藏方式

`g1.e.c(str)` 把字符串按 **7 个字符一组** 转成 bit 串，位序与字符映射：

| 位 | 字符 |
|---|---|
| 0 | `X` |
| 1 | `A` |
| 2 | `B` |
| 3 | `Y` |
| 4 | `C` |
| 5 | `D` |
| 6 | `Z`（非 Z 即 0） |

`g1.e.d(bitstr)` 再把每 7 个 bit 按逆序拼回 char code。等价 Python：

```python
def decode(s):
    out = []
    for i in range(0, len(s) - len(s) % 7, 7):
        g = s[i:i+7]
        bits = ''.join('1' if g[j] == c else '0' for j, c in enumerate('XABYCDZ'))
        out.append(chr(sum((1 if bits[6-j] == '1' else 0) << j for j in range(7))))
    return ''.join(out)
```

- `k1.l` 里 2030 字符的字面量解码后：前 64 字符是干扰串，**第 74 个字符开始是 RSA 公钥**
  （`substring(MediaPlayer.MEDIA_PLAYER_OPTION_TCP_FAST_OPEN_SUCCESS)`，常量值 518 = 74×7）。
- `g1.c` 里 224 字符的字面量解码得到 **32 字节 AES key**：`8x/A?D(G+KbPeShVmYq3s6v9y$B&E)H@`。

## 3. 生图接口

### 3.1 文生图 — 主链路

```
POST /app/ai/text/to/image
{
  "text":        "提示词",
  "styles":      ["101"],     // 预设风格 id 数组，可空
  "proportion":  1,
  "ratioType":   "3",         // 画幅
  "abcd":        "vivo",
  "isVip":       false,
  "openId":      "",
  "userId":      ""
}
→ {"code":0,"data":{"data":"","url":"https://me-pm.oss-cn-hangzhou.aliyuncs.com/tmp/doubao_generated_image_*.png","type":"image","ratio":1},"timestamp":...}
```

**实测画幅映射**（同提示词逐一下载比对像素）：

| ratioType | 实际输出 |
|---|---|
| 0 | 864×1152（3:4） |
| 1 | 864×1152（3:4） |
| 2 | 1152×864（4:3） |
| 3 | **1024×1024（1:1）** |
| 4–15 及其它 | 864×1152（默认 3:4） |

风格 id 来自 `MaterialDrawFragment.w0()` 的 22 张参考图：
`401 101 102 103 104 106 107 108 109 111 112 113 114 115 116 117 118 119 201 202 204 301`，
缩略图在 `http://file.jianyingeditor.cn/normal/aiimage/<id>.jpg`。
上游模型是 **豆包 Seedream**（返回 URL 前缀 `doubao_generated_image_`）。

### 3.2 局部重绘

```
POST /app/ai/image/fix
{"url": "公网图片URL", "maskBase64": "<PNG base64>"}
→ {"code":0,"data":{"url":"http://file.jianyingeditor.cn/tmp/ai/<uuid>.jpg"}}
```

- 蒙版：白色 = 待修复/重绘区域（OpenAI 的透明蒙版需转换，网关里 `imageops.openai_mask_to_upstream` 已做）。
- 上游按 URL 拉图，**不收提示词**；`data:` URL 会报「图片无效转码失败」。

### 3.3 风格迁移

```
POST /app/ai/face/edit/attr
{"type": "aliyun_tongyi_1", "url": "公网图片URL"}
→ {"code":0,"data":{"url":"http://file.jianyingeditor.cn/tmp/<uuid>.jpg"}}
```

效果 id 来自 `POST /app/ai/feature/portal`，实测 25 个：`aliyun_tongyi_1`（3D童话）、
`aliyun_5`（油画）、`aliyun_0`（复古漫画）、`aliyun_tongyi_36`（二次元）、`color_image`（上色）、
`cartoon`、`pixarEffect`（迪士尼）、`img2img_pretty_style_ink`（水墨）、`game_3d`、`enhancer_image`、
`eraser`、`134`（厚涂）、`107`（卡通插画）、`121`（黏土）、`age_image`（老去）、`avatar`、`angel_plus` 等。
部分效果要求图里有人脸（`sourceNeedFace=true`）。

### 3.4 其它相关端点（未接入网关）

| 端点 | 说明 |
|---|---|
| `/app/magic/image/do` + `/app/magic/result` | 模板类玩法（id + avatarUrl，jobId 轮询） |
| `/app/ai/feature/portal` | AI 功能清单 |
| `/app/user/upload/info` | OSS STS 上传凭证（需登录，匿名返回空） |
| `/app/ai/redbook` / `/app/ai/video/script` / `/app/ai/tts/*` | 其它 AI 能力 |

## 4. 水印专项结论

- 文生图输出右下角烧录「AI生成」角标；风格迁移额外叠加「图片由AI生成」文字水印。
- **服务端没有水印开关**。穷举测试 27 个候选参数全部无效：
  `watermark`(=false/0/"false")、`watermarkEnable`、`isWatermark`、`noWatermark`、`removeWatermark`、
  `logo`、`wm`、`hd`、`vip`、`isVip=true`、`watermarkType`、`add_log`、`addLog`、`add_logo`、
  `addLogo`、`needWatermark`、`isAddWatermark`、`showWatermark`、`watermarkLogo`、`watermark_logo`、
  `logoHidden`、`nologo`、`no_logo`、`no_water`。全部照常出水印。
- APK 里的「去水印」是视频编辑器 VIP 功能（`FUNC_REMOVE_WATERMARK`），与 AI 生图无关。
- 可行的工程方案：`/app/ai/image/fix` 的蒙版修复**只改动蒙版内像素**
  （实测蒙版外平均差异 0.55/255），用它把角标区域擦掉。
  几何（以图宽 w 计）：角标宽 ≈ 0.10·w，高 ≈ 0.043·w，右下边距固定 11px；
  风格迁移的文字水印宽 ≈ 0.28·w。网关 `app/imageops.py: watermark_mask_b64` 已内置。
- 上游临时图可直接喂给 `image/fix`（公网 OSS 地址），无需重新上传。

## 5. 实测结论

1. **匿名可用**：token / userId 全空也能稳定出图，无登录校验。
2. **无硬限流**：6 路并发 6/6 成功，单张 10–25s；空提示词返回 `code:-1 无效转码失败`。
3. **提示词上限宽松**：600 字符正常；网关侧限制 3000。
4. **上游临时链接会过期**：`me-pm.oss-cn-hangzhou.aliyuncs.com/tmp/...` 约 1 小时后 403/406，
   网关生成后立即下载落地。
5. **图片带「AI生成」水印**，属上游输出的一部分，不可通过参数关闭。
6. HTTP（非 TLS）+ 明文 JSON 结构，仅靠 RSA/AES 做混淆，无请求签名防重放（`X-Sign` 只是时间戳密文）。

## 4.4 密码学说明（安全边界，务必知晓）

- **AES-128-ECB 是上游协议规定的**，不是本网关的选择：请求签名串 X-Sign 与响应体
  都按 ECB/PKCS7 处理，改成 CBC/GCM 即无法与剪影服务端互通。ECB 的弱点（相同明文块
  → 相同密文块、可做块重排/模式分析）在本链路上**接受**，因为：
  1. 密钥是 APK 内嵌的公开常量，保密性从来不是它的属性；
  2. 传输层还有 HTTPS（部署时 UPSTREAM_BASE 应走 https）；
  3. 解密内容只用于渲染结果，不作为信任边界。
- **不要在本网关内部复用这些原语**（例如给自家 token 签名）——那会把 ECB 的弱点
  带进我们自己的信任边界。网关只做协议适配。
- 密钥/公钥是**协议常量**，可由 `JY_AES_KEY` / `JY_RSA_PUB_B64` 覆盖（见 `.env.example`），
  便于上游换版时不动代码。

## 5. 升级与密钥轮换

上游换版本后，若网关开始报解密失败或 4xx：

```bash
python tools/extract_keys.py 新版剪影.apk --verify
```

工具会扫描所有 `classes*.dex` 中的 `[XABYZCDL]` 长字面量，按 7 位解码，输出：
- `[RSA public key]` → 覆盖 `app/jianying.py` 的 `_RSA_PUB_B64`
- `[AES key candidate]` → 覆盖 `_AES_KEY`；可能有多个诱饵候选，
  加 `--verify` 会实际请求一次 `/app/ai/feature/portal`，输出能成功解密的那一个

如果接口路径或参数变了，用 jadx 重新看 `a7.m`（API 定义）和 `a7.n`（base URL / data 包装）。

## 6. 复现命令（附录）

```bash
# 反编译
jadx --no-res --threads-count 12 -d jadx_out 剪影_5.2.2.apk

# 找生图入口
grep -rn "text/to/image" jadx_out/sources

# 协议最小验证（无网关）
python tools/jy_client.py
```
