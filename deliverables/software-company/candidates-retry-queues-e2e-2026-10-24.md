# 候选定妆图 + 导出重试 + 队列指标验证记录（2026-10-24）

> 目标：补齐 P1' 最后两个交互缺口，并让运营后台能看到队列健康度。

## 1. 候选定妆图

- 定妆图生成支持 `count=1..4`；MockAdapter 按 `options.count` 返回多结果；
- `GET /projects/:id/characters/:cid/portrait/candidates` → 预签名候选 URL 列表；
- `POST .../portrait/select {task_id,index}` → 从任务结果选定一张，创建 asset 并置角色定稿；
- Web：角色页可选生成数量；已定稿角色显示「候选图」，弹窗点选即切换。

实测：

```
portrait count=2 → task SUCCEEDED → candidates=2
select index=1 → project_asset.portrait_asset_id=107361797364465664
portrait_url=/files/local?...（可访问）
```

## 2. 导出失败重试

- `POST /projects/:id/episodes/:eid/exports/:xid/retry`（仅 status=4）；
- 修复：导出的 BullMQ `jobId` 带时间戳，避免重试被已完成同名 job 去重。

实测：

```
批量前创建导出 → status=4（400106 no video results）
批量 4 镜成功 → retry → status=3，download_url 可下载
```

## 3. 管理端队列指标

- `GET /ops/admin/queues` 与 dashboard 内嵌 `queues`：gen.submit / export.zip 的 wait/active/failed/completed/delayed；
- 实测（本轮）：

```
gen.submit: wait0 active0 failed0 completed5 delayed0
export.zip: wait0 active0 failed0 completed1 delayed0
```

Web `/admin` 概览下方展示队列卡片。

## 测试

- API 28 项通过（新增导出重试 1 项、admin queues 1 项；pipeline 10 项）；
- 全仓 lint/typecheck/test/build 绿；CI 需通过（migrate 0003 → seed → test）。
