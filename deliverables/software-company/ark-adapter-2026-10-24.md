# 火山方舟（Ark）视频适配器实现记录（2026-10-24）

> 依据官方文档：https://docs.volcengine.com/docs/ark/create-video-generation-task-api
> 说明：当前无供应商 Key，未做真实调用；协议映射用本地 fixture 测试验证。

## 协议映射

| 步骤 | 实现 |
|---|---|
| 提交 | `POST {ARK_BASE_URL}/api/v3/contents/generations/tasks`，Bearer `ARK_API_KEY` |
| 请求体 | `{ model: <endpoint/model id>, content: [{type:"text", text:"prompt --resolution 720p --ratio 9:16 --duration 5"}, {type:"image_url", image_url:{url}}...] }` |
| 提交响应 | `{id:"cgt-..."}` → `vendor_task_id` |
| 查询 | `GET /api/v3/contents/generations/tasks/{id}` |
| 状态 | `queued/pending → pending`；`running/processing → running`；`succeeded/success → succeeded`；`failed/error → failed` |
| 结果 | `content.video_url`（兼容数组首项）、`cover_url`、`duration` |
| 取消 | `POST .../{id}/cancel`（尽力而为） |

## 配置（worker）

```
ADAPTER_MODE=real
ARK_API_KEY=...
ARK_BASE_URL=https://ark.cn-beijing.volces.com
ARK_MODEL_MAP={"seedance-2.5":"ep-xxxxxxxx"}
```

`resolveAdapter("volcengine:video", {mode:"real", ark})` 会优先选择 `ArkVideoAdapter`；未配置 Key 时回退到通用 HTTP 网关/显式报错，不静默 mock。

## 测试

- `ark-video.spec.ts`：
  - 提交 content 结构（text 参数、image_url）、Bearer 鉴权、model map；
  - 轮询 queued→running→succeeded 与 `video_url` 归一化；
  - `resolveAdapter` 在 real+Ark 配置下选中 Ark，mock 模式下不选中。
- 适配器包 8 项测试通过。

## 联调待办（Key 到位后）

1. 确认真实模型/接入点 ID 与 `ARK_MODEL_MAP`；
2. 核对 text 参数前缀（`--resolution/--ratio/--duration`）与官方当前版本；
3. 真实任务取消/审核失败映射；
4. 结果 URL 下载→S3 转存→AI 水印→结算的真实链路（worker 已具备）。
