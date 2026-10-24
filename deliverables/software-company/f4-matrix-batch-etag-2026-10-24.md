# F4 矩阵 + 批量下载 + ETag 验证记录（2026-10-24）

## 项目分镜矩阵

- `GET /projects/:id/matrix`：返回每集镜头 `status` 与任务 `task_status`；
- Web 批量投递页上方矩阵：绿=成功、黄=在途/已投递、红=失败、灰=未投递；点击镜格跳到该集分镜；
- API 测试：3 集、第 1 集 10 镜、含 `task_status` 字段。

## 批量下载 zip（≤50）

- `POST /tasks/batch-download {task_ids}`：仅打包 SUCCEEDED 任务结果 + `manifest.json`；单个失败结果跳过；空结果 400102。
- 实测（2 个 mock 任务）：

```
batch-download → url /v1/files/local?key=u/<space>/downloads/<id>.zip
zip entries: task-...-1.mp4 (43B) ×2 + manifest.json (299B)
```

## ETag/304

- `GET /tasks?ids=` 返回 `ETag`（响应数据 sha1）；
- 带 `If-None-Match` 再次请求返回 **304**（flow 测试覆盖）。

## 验收更新

- F4 批量下载 ✅、矩阵 ✅、ETag ✅（P95 未压测）；
- F2 导出 80% 阈值已实现，<80% 场景待自动化测试。
