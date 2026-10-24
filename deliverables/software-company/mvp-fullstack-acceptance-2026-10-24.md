# MVP 全栈验收记录（2026-10-24）

> 目的：在 **Docker Compose 生产栈**（PG/Redis/MinIO/nginx/api/worker/web）上，用真实 HTTP 链路验证代码侧 MVP 验收点。

## 环境

```
docker compose -f docker-compose.prod.yml up -d --build
services: postgres / redis / minio / minio-init / migrate / api / worker / web / nginx 全部 running
```

## 冒烟结果（同一账号、同一空间）

| 验收点 | 请求 | 结果 |
|---|---|---|
| 健康检查 | `GET /v1/healthz` | `{"status":"ok","checks":{"db":"up","redis":"up"}}` |
| Web 首页 | `GET /` | 200 |
| 注册登录 | `POST /v1/auth/login`（含 age_confirmed） | space_id 下发 |
| 积分流水 | `GET /v1/credits/flows` | `gift/80` 首条 |
| 文生视频 | `POST /v1/generations` → 轮询 | status=3，uri `u/<space>/tasks/<id>/r0.mp4` |
| 结果下载 | `GET /v1/tasks/<id>/results/1/download-url` | S3 预签名（host=localhost），下载 43B |
| 输入审核 | prompt 含敏感词 | **745801**「内容包含敏感词，请修改后重试」 |
| 任务结果转存资产 | `POST /v1/assets/from-task` | code=0，tags=`from-task` |
| 加入项目分镜素材 | `POST /v1/projects/<id>/shot-materials` | code=0，kind=`shot_material`，列表 1 条 |
| 资产目录 | `POST /v1/asset-folders` | code=0，name=「角色参考」 |
| 资产打标签 | `PATCH /v1/assets/<id>` | tags=`#角色A` |
| 标签检索 | `GET /v1/assets?tag=%23角色A` | total=1 |
| 流水线漏斗 | `GET /v1/ops/admin/funnel` | 6 段（建项→…→镜头成功） |
| 任务指标 | `GET /v1/ops/admin/task-metrics` | failure_rate=0，adapter 延迟行 1 |
| 失败清单导出 | `GET /v1/ops/admin/failed-tasks.csv` | 200，头 `task_id,space_id,model,mode,status,…` |

> 注：跨账号访问他人任务/资产返回 400102（空间隔离生效），已确认属预期行为。

## 自动化测试规模

| 套件 | 数量 |
|---|---|
| API（flow/pipeline/assets/admin/files） | **45** |
| adapters（mock/deepseek/http-video/ark） | **9** |
| db schema 契约 | 26 表断言 |
| storage（含 MinIO 集成，本地） | 6+1 |

CI（GitHub Actions）在本轮全部提交上为绿：install → shared/db build → migrate → seed → lint → typecheck → test → build。

## 结论

代码侧 MVP（F1–F8 验收点）已全部落地并有自动化测试与全栈冒烟证据。
剩余事项均为外部依赖：真实供应商 Key 与企业认证、ICP/AI/算法备案、支付 Beta、
生产域名与 TLS、镜像瘦身与监控告警、敏感词库运营与人工复审队列。
