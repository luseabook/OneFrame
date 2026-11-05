# 剪影 AI 生图 · OpenAI 兼容网关

把 **剪影（com.mediaeditor.video 5.2.2）** App 内置的 AI 生图能力封装成标准 OpenAI
Images API。逆向细节见 [docs/protocol.md](docs/protocol.md)。

```
OpenAI SDK / 任意客户端  ──►  本网关 :8788  ──►  newapi.jianyingeditor.cn（豆包 Seedream）
        (OpenAI 格式)            (签名/加密/重试/并发/落地)          (RSA+AES 私有协议)
```

## 能力

| 能力 | 说明 |
|---|---|
| 文生图 | `POST /v1/images/generations`，提示词 + 预设风格 + 任意画幅 |
| 局部重绘 | `POST /v1/images/edits`（带 mask），上游蒙版修复接口 |
| 风格迁移 | `POST /v1/images/edits`（不带 mask），25 种效果（3D童话/动漫/黏土/迪士尼…） |
| 画幅/分辨率 | `size` / `aspect_ratio` / `resolution` 三套参数，上游三种画布 + 本地裁切/补边/缩放 |
| 多张 | `n=1..4`，并行生成 |
| 返回格式 | `url`（本地稳定链接，不依赖上游临时 OSS 地址）/ `b64_json` |
| 聊天壳 | `POST /v1/chat/completions`，聊天客户端里直接出图（支持 `stream`） |
| 鉴权 | 可选 `API_KEYS`，Bearer / `x-api-key` |
| 稳定性 | 并发信号量、指数退避重试、熔断器、连接池复用、请求 ID、`/metrics` |
| 部署 | Windows 一键 `start.bat`、`docker compose up -d`、Linux `start.sh` |

## 快速开始

### Windows 一键

```bat
start.bat
```

首次运行会创建 `.venv`、安装依赖、从 `.env.example` 生成 `.env` 并启动。

### Docker

```bash
cp .env.example .env
docker compose up -d --build
```

### 手动

```bash
python -m pip install -r requirements.txt
cp .env.example .env
python run.py
```

启动后：

- API 根地址 `http://127.0.0.1:8788/v1`
- Swagger 文档 `http://127.0.0.1:8788/docs`
- 健康检查 `http://127.0.0.1:8788/healthz`
- 指标 `http://127.0.0.1:8788/metrics`

> 上游是 **匿名可用** 的公开接口，无需账号即可出图；`API_KEYS` 只是网关自身的访问控制。

## API

### 1. 文生图 `POST /v1/images/generations`

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `prompt` | string | — | 提示词（≤3000 字符） |
| `n` | int | 1 | 生成数量 1–4，并行 |
| `size` | string | `1024x1024` | `宽x高`，如 `1792x1024`，上限 `MAX_OUTPUT_SIDE` |
| `aspect_ratio` | string | — | `1:1` `3:4` `4:3` `16:9` `9:16` …（与 size 二选一） |
| `resolution` | string | — | 配合 aspect_ratio：`1k` `2k` 或长边像素值 |
| `fit` | string | `crop` | 上游画布到目标尺寸的适配：`crop`（居中裁切）/ `pad`（模糊补边）/ `stretch` |
| `style` | string \| string[] | — | 预设风格 id（`GET /v1/styles`，如 `101` `401` `301`），可多个 |
| `negative_prompt` | string | — | 负向描述，会拼进提示词 |
| `response_format` | string | `url` | `url` 或 `b64_json` |
| `watermark` | string | `remove` | `remove` 自动擦除右下角「AI生成」水印；`keep` 保留（全局默认 `REMOVE_WATERMARK`） |
| `reference_image` | string | — | 参考图公网 URL；有值时走「风格迁移 / 局部重绘」 |
| `mask` | string | — | 与 reference_image 搭配，data URL 蒙版（透明=要修改的区域） |
| `effect` | string | `aliyun_tongyi_1` | 风格迁移效果 id（`GET /v1/effects`） |
| `model` | string | `jianying-draw` | 别名：`jimeng` `seedream` `doubao-seedream` … |

```bash
curl -s http://127.0.0.1:8788/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{"prompt":"赛博朋克城市夜景，霓虹雨夜，电影感","size":"1792x1024"}'
```

```json
{
  "created": 1793304664,
  "data": [{
    "url": "http://127.0.0.1:8788/files/gen_0f0981d1c3d0457585782c8c.png",
    "revised_prompt": "赛博朋克城市夜景，霓虹雨夜，电影感",
    "size": "1792x1024"
  }]
}
```

### 2. 图片编辑 `POST /v1/images/edits`（multipart/form-data）

| 字段 | 说明 |
|---|---|
| `image` | 图片文件，**或** 公网可访问的 http(s) URL 字符串 |
| `mask` | 可选。PNG 蒙版，透明区域 = 要修改的区域（自动转成上游蒙版格式） |
| `prompt` | 可选，仅回填 `revised_prompt`（上游修复接口本身不收提示词） |
| `effect` | 不带 mask 时使用，风格迁移效果 id |
| `size` / `aspect_ratio` / `resolution` / `fit` / `n` / `response_format` / `watermark` | 同上 |

> 上游按 URL 拉取图片，所以 **文件上传需要 `PUBLIC_BASE_URL` 指向本网关的公网地址**。
> 没有公网地址时可设置 `UPLOAD_FALLBACK=catbox`（上传到匿名临时图床，1h 有效，注意隐私）。

```bash
# 风格迁移（不带 mask）
curl -s http://127.0.0.1:8788/v1/images/edits \
  -F "image=https://your-host/photo.jpg" \
  -F "effect=aliyun_tongyi_1" \
  -F "size=864x1152"

# 局部重绘（带 mask，透明=重绘区）
curl -s http://127.0.0.1:8788/v1/images/edits \
  -F "image=@photo.png" -F "mask=@mask.png" -F "response_format=b64_json"
```

### 3. 聊天壳 `POST /v1/chat/completions`

把最后一条 user 文本当作提示词生图，返回 Markdown 图片链接（支持 `stream: true`）：

```bash
curl -s http://127.0.0.1:8788/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"jianying-draw","messages":[{"role":"user","content":"一只在向日葵田里的金毛幼犬"}]}'
```

### 4. 辅助端点

| 端点 | 说明 |
|---|---|
| `GET /v1/models` | 模型别名列表 |
| `GET /v1/styles` | 22 个预设风格 id + 缩略图 |
| `GET /v1/effects` | 上游效果列表（3D童话/动漫/黏土/迪士尼/上色/老照片…） |
| `GET /files/{name}` | 生成/上传图片（本地缓存，TTL 见 `FILE_TTL_HOURS`） |
| `GET /healthz` / `GET /metrics` | 健康检查 / 运行指标 |

### OpenAI SDK

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:8788/v1", api_key="not-needed")

r = client.images.generate(
    model="jianying-draw",
    prompt="a cozy cabin in snowy woods at night, warm windows",
    size="1024x1536",
)
print(r.data[0].url)
```

> 若你的机器 `NO_PROXY` 里带 `[::1]` 这类方括号 IPv6，httpx 0.28+ 会直接崩
> （`Invalid port: ':1]'`）。给 SDK 传 `http_client=httpx.Client(trust_env=False)`
> 即可；本网关已经内部绕开了这个 bug。

## 画幅与分辨率

上游只支持三种画布：

| 上游画布 | ratioType | 对应比例 |
|---|---|---|
| 1024×1024 | `3` | 1:1 |
| 1152×864 | `2` | 4:3 |
| 864×1152 | `1` | 3:4 |

其它比例（16:9 / 9:16 / 21:9 …）网关会自动选最接近的画布，再按 `fit` 处理：

- `crop`（默认）：等比放大后居中裁切，无黑边。
- `pad`：主体完整，四周用模糊背景补边。
- `stretch`：直接拉伸（会变形，不推荐）。

分辨率同理：超出上游原生尺寸时本地 Lanczos 缩放，`MAX_OUTPUT_SIDE` 限制上限。

## 并发与稳定性

| 机制 | 默认 | 说明 |
|---|---|---|
| 并发信号量 | `MAX_CONCURRENCY=8` | 上游单张 10–25s；8 路并发实测稳定 |
| 连接池 | 2×并发 | keep-alive 复用，避免握手开销 |
| 重试 | `UPSTREAM_RETRIES=3` | 仅对网络错误 / 5xx / 上游「稍后再试」类错误退避重试 |
| 熔断 | 8 次连续失败 → 停 30s | 上游整体异常时快速失败，返回 503 |
| 超时 | 连接 10s / 读 180s | 可按需调大 |
| 本地落地 | `FILE_TTL_HOURS=72` | 上游 OSS 临时链接约 1 小时失效，网关生成后立即下载到本地 |
| 指标 | `/metrics` | 请求数、错误数、各状态码、平均延迟 |

压测参考（本机实测）：6 路并发 6/6 成功，墙钟 ~25s；单张平均 15–20s。

## QQ 机器人（qqbot/）

官方 QQ 开放平台机器人桥接：WebSocket 接入 → 调本网关生图 → 上传富媒体 → 回图。

```bash
# 依赖
pip install -r qqbot/requirements.txt
# 配置
cp qqbot/qqbot.env.example qqbot/qqbot.env   # 填 APPID / SECRET / GATEWAY_API_KEY
# 启动
python qqbot/bot.py
```

指令（群聊需 @机器人）：

| 指令 | 说明 |
|---|---|
| 直接发文字 | 按文字生图 |
| `/画 <提示词>` | 同上，显式指令 |
| `--size 1024x1024` `--ratio 16:9` `--style 101` `--n 1` `--keep` | 附加参数，可跟在提示词后 |
| `/状态` | 网关健康检查 |
| `/帮助` | 使用说明 |

- 每人 20 秒冷却（`QQ_RATE_LIMIT_SECONDS`），并发生成上限 `QQ_CONCURRENCY`
- 回复 1：文字「生成中」；回复 2：`msg_type=7` 富媒体图片
- 图片以公网 URL 交给 QQ 拉取，因此 **网关必须公网可达**（`PUBLIC_BASE_URL`）
- 可用 `QQ_ALLOWED_GROUPS` / `QQ_ALLOWED_USERS` 白名单收紧

systemd 示例：

```ini
[Unit]
Description=QQ Bot bridge (JianYing image gateway)
After=network-online.target jianying-gateway.service

[Service]
WorkingDirectory=/opt/jianying-gateway/qqbot
EnvironmentFile=/opt/jianying-gateway/qqbot/qqbot.env
ExecStart=/opt/jianying-gateway/.venv/bin/python bot.py
Restart=always

[Install]
WantedBy=multi-user.target
```

## 目录结构

```
quark-image-gateway/
├── app/
│   ├── main.py        # FastAPI：路由、鉴权、指标、尺寸适配
│   ├── jianying.py    # 上游协议：RSA body + AES 响应 + X-Sign + 重试/熔断
│   ├── imageops.py    # 画幅映射、裁切/补边/缩放、蒙版转换
│   ├── storage.py     # 图片缓存与 TTL 清理
│   ├── schemas.py     # OpenAI 兼容请求模型
│   └── config.py      # 环境变量配置
├── tests/smoke_test.py
├── tools/
│   ├── extract_keys.py  # 新版本 APK 密钥重新提取
│   └── jy_client.py     # 协议最小复现（逆向时的验证脚本）
├── docs/protocol.md   # 逆向报告
├── Dockerfile / docker-compose.yml
├── start.bat / start.sh
└── .env.example
```

## 水印处理

上游文生图会烧录右下角「AI生成」角标（风格迁移还多一行「图片由AI生成」大字），
5.2.2 版服务端没有水印开关（实测 27 个候选参数：`watermark` / `add_log` / `logo` /
`isVip` / `hd` 等全部无效）。网关默认用 App 自带的**蒙版修复**接口把水印区域擦掉：

- 蒙版外的像素**完全不动**（实测平均差异 0.55/255，仅 JPEG 重编码噪声）
- 角标区由模型补全，1024 图肉眼基本看不出；代价是每张多一次上游调用（+4–8s）
- `"watermark": "keep"` 或 `REMOVE_WATERMARK=false` 可关闭
- 返回体 `data[].watermark_removed` 标识是否擦除成功

## 已知限制

1. 水印擦除是「蒙版修复」近似：角标区域会被 AI 补全，极近距离看有轻微涂抹感。
2. 提示词由上游模型处理，`seed`、`quality` 等 OpenAI 参数不生效（会忽略）。
3. 上游匿名调用无硬性配额，但请不要高频轰炸；生产建议加 `API_KEYS` + 前置限流。
4. 上游密钥/域名随 App 版本可能轮换。APK 更新后运行
   `python tools/extract_keys.py 新版.apk --verify`（会在线验证哪个 AES 候选可用），
   把输出的 RSA/AES 密钥贴回 `app/jianying.py` 即可，其它不用动。

## 故障排查

| 现象 | 处理 |
|---|---|
| `Invalid port: ':1]'` | 你的 `NO_PROXY` 里有 `[::1]`，删掉该条目，或给客户端传 `trust_env=False` |
| `upstream http 406` | 上游拉不到源图（URL 失效/非公开/防盗链），换公网可直链的图片 |
| `upstream http 5xx / 稍后再试` | 网关已自动重试 3 次；仍失败多半是上游波动，稍后再试 |
| `PUBLIC_BASE_URL is not configured` | 用文件上传做编辑时必须配置公网地址，或设 `UPLOAD_FALLBACK=catbox` |
| 返回图片是旧图/404 | 上游临时链接已过期；本网关已本地落地，检查 `data/files` 与 TTL |

## 逆向来源

- APK：`剪影_5.2.2.apk`（`com.mediaeditor.video` 5.2.2 / versionCode 972）
- 入口：`com.mediaeditor.video.ui.fragments.AI.AIDrawActivity`、`ui.picselect.fragment.MaterialDrawFragment`
- 网络层：`k1.l`（OkHttp 拦截器链）、`j1.c`（签名头）、`g1.d`（RSA）、`g1.c`（AES）
- 详见 [docs/protocol.md](docs/protocol.md)
