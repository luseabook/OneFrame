# Worker 适配器 + 结果转存/下载 验证记录（2026-10-24）

> 目标：验证 worker 通过统一适配器执行任务、把结果转存自有存储、并通过预签名 URL 下载。
> 环境：PostgreSQL 18(55432) + Redis 8(6380) + api(3000) + worker(`ADAPTER_MODE=mock`)；本地存储 `app/data/storage`。

## 结果

| 步骤 | 观测 |
|---|---|
| 提交 text2video（天幕2.0，8 积分） | `POST /generations` → task_id；余额 80→72、冻结 8 |
| worker 执行 | `resolveAdapter("tomoviee:video", {mode:"mock"})` → MockAdapter 提交/轮询 → SUCCEEDED |
| 结果转存 | `mock://results/<task>.mp4` → `u/<space>/tasks/<task>/r0.mp4`（43 bytes 占位），`meta.storage=local`、`original_uri` 保留 |
| 下载 | `GET /tasks/{id}/results/1/download-url` → `http://127.0.0.1:3000/v1/files/local?key=…&expires=…&sig=…`；HTTP 200，签名校验通过 |
| 结算 | `credits_frozen=8`、`credits_settled=8`；`/me` 余额 72、冻结 0 |

DB 核对：

```
task.status=3, results[0].uri=u/<space>/tasks/<task>/r0.mp4
flows: gift +80 | freeze -8/+8 | settle 0/-8
```

## 说明与后续

- `MockAdapter` 不访问网络，CI/本地默认（`ADAPTER_MODE=mock`）；真实视频供应商适配器接入后仅替换 adapter_code 解析，任务/结算/转存链路不变。
- `DeepSeekChatAdapter` 已按 OpenAI 兼容 `/chat/completions` 实现，并有本地 HTTP fixture 测试（请求头/体、同步文本、错误）。
- 存储层当前只有 `local` driver；`STORAGE_DRIVER=s3` 会显式报错而非静默降级。上线前接 OSS/S3 driver + CDN。
- 转存失败按 ADR-005 降级：保留供应商 URL 并标记 `meta.transfer_failed`，等待人工补转/告警。
