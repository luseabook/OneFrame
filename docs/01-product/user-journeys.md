# 核心用户旅程

> v1.3 · 2026-10-24 · 对应 PRD v1.3（流水线旗舰）· 页面/API 全链路映射
> 变更：v1.3 按《逆向一致性审查》修订 J1（导入剧本拆集/资产定稿/批量报价/模型驱动时长/导出 manifest）与 J3a-1（逐镜 745703 部分成功）
> 变更：v1.2 按启动前审查报告修订：小说上限统一 5 万字；预算触顶(745703)与余额不足(745701)拆为两个分支；导出改异步任务口径；补 LLM 失败/审核未过分支；集剧本草稿默认折叠可跳过

## J1 旗舰：粘贴小说 → 一集成片（P1 阿凯 / P2 林姐）

```
工作台「新建项目」
 ├─ 表单：标题/类型(真人|动漫)/画幅(9:16)/来源：粘贴小说(≤5 万字) or 一句话想法 or 导入已有剧本
 │   POST /projects                                    ← 建项
 │   source_type=3 时 POST /projects/{id}/episodes/split ← 导入剧本拆集（不扣积分）
 ├─ 大纲页（P95≤20s 生成态，硬超时 30s）
 │   POST /projects/{id}/outline/generate              ← DeepSeek 分集大纲
 │   generate 即落草稿；编辑(增删集/改标题梗概)自动保存（刷新不丢稿）
 │   PUT /projects/{id}/outline                        ← 确认提交
 ├─ 角色页
 │   POST /projects/{id}/characters/generate           ← 自动抽角色卡(可编辑)
 │   逐角色「生成定妆图」POST …/characters/{cid}/portrait   ← 走任务系统(mode=studio_asset_image)
 │     轮询候选 1~4 张 → 选定并「定稿」→ project_assets.status=2
 │     （不满意→以候选改稿 image2image；未定稿角色不可被分镜引用）
 ├─ 分集页（选第 1 集）
 │   POST …/episodes/{eid}/script-draft/generate       ← 集剧本草稿(可编辑；默认折叠可跳过)
 │   POST …/episodes/{eid}/storyboards/generate {shot_count:10}
 │                                                     ← 分镜数默认 10（可调 4~30）
 │   分镜表行内编辑；每镜勾选入镜角色(→已定稿定妆图自动成为参考)
 │   时长/画幅/分辨率选项由所选模型 storyboard_reference_video 渲染（不写死档位）
 ├─ 批量投递
 │   POST /credits/quote/batch {items:[逐镜]}           ← 预算默认值=total_credits
 │   POST …/episodes/{eid}/storyboards/generate-videos
 │        {shot_ids:[全部], budget_credits_max:默认=批量报价总额, model, ratio?, resolution?}
 │   ← 200 {items:[{shot_id, task_id|null, submitted, code?}]}（部分成功）
 │   项目页出现分镜矩阵(镜×状态)；GET /tasks?ids=… + GET /projects/{id}/episodes/{eid}
 │   失败镜(红)→ 一键重试(幂等)；未定稿镜→400105 先定稿；预算触顶镜(灰, code 745703)→ 提高预算续投
 ├─ 异常分支（任一 LLM 步骤：大纲/角色/剧本/分镜）
 │   生成失败/超时(745901)/审核未过(745801/745802) → 明确报错 + 定位到环节
 │   → 用户改写/调整后重试（不重复扣费，无半写状态）
 └─ 导出（异步任务）
     POST …/episodes/{eid}/export              ← 提交导出任务（成功镜<80%→400106）
     → 完成通知(轮询/SSE) → {download_url}     ← zip=成功镜+manifest（失败/未投镜标注）
     (v1.1: 成片自动拼接)
```

**关键体验点**：LLM 步骤 ≤20s 带 skeleton；定妆图不满意可"改稿"而非重抽；断点续跑不重复扣费；成片带 AI 标识。

## J2 工具入口：单点文生视频（漏斗）

```
落地页「免费生成」→ 登录（手机验证码；Alpha 期需邀请码） → /create/text-to-video
 quote 实时 → POST /v1/generations → 历史卡片轮询 → 下载
→ 满意的片段引导「加入项目当分镜素材」(资产转存, F5)
```

## J3 额度与预算（两个独立分支）

**J3a-1 预算触顶（code=745703，余额充足）**——投递在预算上限处部分成功：

```
接口 200，items[].submitted=false + code=745703 → 弹「提高预算续投」：
输入新预算上限（预填：已消耗 + 剩余镜头报价，来自 /credits/quote/batch）
 → 确认新预算值后仅对未投镜续投（不做静默沿用旧预算）
```

**J3a-2 余额不足（745701，Alpha 期无支付）**：

```
745701 → 弹窗「免费额度已用完」：展示剩余等待人数 + 等待名单表单(留手机号)
 → 邀请码激活通道(运营发放)
```

**J3b Beta 后（支付回流）**

```
745701 → 弹「还差 N 积分」+ 智能档位推荐
 → /pricing → POST /billing/orders → 微信扫码 → 回调入账(<3s)
 → 回到项目页黄条「继续投递」：输入新预算上限（预填：已消耗 + 剩余镜头报价）→ 续投
745703（预算触顶，余额充足）→ 直接弹「提高预算续投」（同 J3a-1 交互）
```

## J4 v1.5 画布预览（承诺视图，首发不做）

```
打开项目 → 「画布视图」(Beta 后上线)
 同一项目数据渲染为节点图：大纲节点→角色节点(定妆图缩略)→分镜节点(视频缩略)
 右键任意节点「重新生成/改稿」；Agent 输入框：一句话新增情节分支
 协作：他人光标+节点锁(心跳)——数据层已按 canvas schema 预留(database §7)
```
