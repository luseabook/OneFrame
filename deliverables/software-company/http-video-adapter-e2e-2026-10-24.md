# 通用 HTTP 视频供应商适配器验证记录（2026-10-24）

> 目标：把 worker 从 mock 切到真实 HTTP 供应商调用，在无供应商 Key 的情况下用本地假供应商验证全链路。

## 实现

- `packages/model-adapters/src/http-video.ts`：
  - `POST {base}{submitPath}`（默认 `/v1/video/tasks`）提交 `{model,prompt,image,reference_images,duration,ratio,resolution,count,client_task_id}`；
  - `GET {base}{pollPath}`（默认 `/v1/video/tasks/{id}`）轮询，状态归一化（pending/running/succeeded/failed/review_rejected）；
  - 结果兼容 `results/videos/outputs` 的字符串或 `{url|uri|video_url}` 对象；
  - `HTTP_VIDEO_MODEL_MAP` 支持我方模型名→供应商模型名；
  - 404/5xx/超时显式报错，走任务失败/退款路径。
- 启用：`ADAPTER_MODE=real` + `HTTP_VIDEO_BASE_URL`（其余视频/图像 adapter_code 均路由到此网关；DeepSeek 文本仍走 DeepSeek）。

## 实测（本地假供应商 + 真实 mp4）

假供应商收到：

```
submit {"model":"sky-media-2.0","prompt":"真实供应商 HTTP 链路验证","auth":"Bearer test-key"}
```

worker（ADAPTER_MODE=real）：

```
任务 2(RUNNING) → 3(SUCCEEDED)
results[0].uri = u/<space>/tasks/<id>/r0.mp4
ai_label = {explicit:true, implicit:true, generator:"OneFrame AI", sidecar_uri:...}
下载结果 2775B；ffprobe:
  artist  = OneFrame AI
  comment = AI-generated content (OneFrame AI)
余额 80-8=72，冻结 0
```

## 测试

- `http-video.spec.ts` 2 项：提交/鉴权/模型映射 + 轮询到结果；失败映射；
- 适配器包共 6 项测试通过；API 28 项、全仓 lint/typecheck/test/build 绿。

## 下一步（Key 到位后）

- 按火山/百炼/可灵实际协议调整 `submitPath/pollPath` 与字段映射（或加轻量 vendor 适配层）；
- 增加供应商任务取消、回调（webhook）、限流与重试；
- 真实结果抽验水印持久性与审核状态映射。
