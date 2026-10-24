# 资产库 + 图生视频验证记录（2026-10-24）

> 目标：补齐 F3 的「资产 → 图生视频」路径。

## 实测（手机号 13200132000）

| 步骤 | 结果 |
|---|---|
| `POST /assets/upload`（1×1 PNG base64） | 返回 asset id 与 1h 预签名 URL |
| `GET /assets` | 列表包含该图，签名 URL 可访问 |
| `POST /credits/quote`（image2video，seedance-2.0-vip，first_frame_uri=asset.url，9:16/720p/5s） | 8 积分，余额充足 |
| `POST /generations`（同一 quote_id） | 任务创建，冻结 8 |
| worker（mock） | RUNNING → SUCCEEDED，转存 `u/<space>/tasks/<id>/r0.mp4` |
| 账户 | 80 − 8 = 72，冻结 0 |

API 测试 `assets.spec.ts` 3 项：
- 上传返回签名 URL；
- 列表包含资产，且用资产 URL 报价 image2video 成功；
- 软删后列表不再返回。

## 实现

- 上传：MVP 使用 base64（前端 canvas 压到 ≤1600px/JPEG 0.85），8MB 上限；写 storage 后落 `assets`（kind=image, uri=key, meta）；
- 列表/删除：按 space 隔离，软删 `deleted_at`；缩略图 1h 预签名；
- 图生视频：模型目录筛选 `modes.image2video`，参考图取资产 URL，按 schema 填 `first_frame_uri`（image2video 必填）；
- 结果复用任务中心/下载/分享。

## 后续

- 资产分页/搜索/文件夹、候选定妆图选择；
- 生产换 multipart 直传 OSS（避免 base64 开销）；
- 真实视频适配器需把 first_frame_uri 预签名 URL 传给供应商，并处理过期。
