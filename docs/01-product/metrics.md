# 指标体系与埋点方案

> v1.3 · 2026-10-24 · 对应 PRD v1.3
> 变更：v1.3 漏斗补 assets_finalized（RE 资产硬门）、事件补 asset_extract/finalize、credits_hint 增 reason
> 变更：v1.2 按启动前审查报告修订（P0-06、P1-18、P2-16 等）：北极星/episode_completed 定义改为工程口径；事件表补 export_submit/export_ready/shot_download/asset_promote；护栏"首集耗时"改 30min 人工操作口径；增长板补"工具→建项转化率"观察指标

## 1. 北极星与护栏

| 类型 | 指标 | 定义 | 目标(Beta) |
|---|---|---|---|
| 北极星 | **WCE 周完集数** | 周内 episode_completed 事件数（用户×集去重）；**episode_completed 判定（工程口径）**：一集 ≥80% 镜头 SUCCEEDED 且触发过全集导出 | 环比 +20%/月 |
| 护栏 | 激活率 | 注册 48h 内首次 episode_completed / 注册（按工程口径统计） | ≥35% |
| 护栏 | 首集耗时 | 建项→首次 episode_completed 的**人工操作时长**中位数（与 PRD 愿景 30min 同口径；端到端含排队 ≤2h 另作验收观测，不计入本护栏） | ≤30min 人工操作时长 |
| 护栏 | 任务成功率 | SUCCEEDED/(S+FAILED)（媒体任务，排除取消） | ≥92% |
| 护栏 | 角色一致性投诉率 | 客诉"人物不像"相关/完集数 | ≤5% |
| 商业 | 首单转化 / 积分毛利率 | 注册 7 日首笔 / (售价-成本)/售价 | ≥8% / ≥30% |

## 2. 流水线漏斗（Alpha 核心观测，定位卡点）

```
project_created
 → outline_generated → outline_confirmed(有编辑动作或点确认)
 → characters_generated → portrait_ready(≥1 角色绑定定妆图)
 → assets_finalized(本集引用角色/场景全部定稿；RE 的资产硬门)
 → storyboards_generated → batch_submitted(首次投递)
 → episode_completed(北极星事件)
```

每环看：转化率、中位耗时、退出率。Alpha 结束输出卡点报告指导 v1.1。**Alpha 期本漏斗为观察项（20~50 人样本不设通过线），以卡点报告为主要产出**（对应 PRD §7 Alpha 观察口径）。

## 3. 事件表（前端 track(event, props)）

| 事件 | 关键属性 | 触点 |
|---|---|---|
| page_view | path, ref | 全站 |
| signup | source, invited(bool) | 登录成功(新) |
| project_create | source_type, novel_chars_bucket, drama_type | 建项 |
| outline_generate / outline_edit / outline_confirm | ep_count | 大纲页 |
| character_edit | — | 角色页 |
| portrait_generate / portrait_regen(改稿) / portrait_bind | candidate_count | 定妆图 |
| asset_extract / asset_finalize | kind(character/scene/prop), count | 资产抽取/定稿（RE 硬门） |
| script_draft_skip | — | 集剧本(跳过率；默认折叠) |
| storyboard_edit | shot_count | 分镜表 |
| batch_submit | shot_count, budget_mode(auto/manual) | 批量投递 |
| batch_resume / shot_retry | fail_count | 断点续跑 |
| episode_completed | ttfr_ms(建项→完集), shots_ok_ratio | 北极星 |
| export_submit / export_ready | ep_id, shot_count | 全集导出（异步任务提交/完成） |
| shot_download | task_id, shot_no | 逐镜下载 |
| tool_visit / generation_submit / task_status_change | tool_visit{tool}, generation_submit{mode,model}, task_status_change{from,to} | 工具&任务 |
| asset_save / asset_download / asset_promote | asset_save{asset_kind}, asset_promote{character_id, tag} | 资产（asset_promote=定妆图转存通用资产） |
| credits_hint / waitlist_submit | balance, code(745701 余额不足 / 745703 预算触顶), reason(budget_exceeded) | J3a |
| order_create / order_paid | sku, cents | Beta |

服务端补充（task_events/credit_flows 聚合）：任务生命周期、各 adapter 延迟与成本、审核拦截率、LLM 步骤成功率与耗时。

## 4. 看板

1. **增长板**：WCE + 流水线漏斗 + AARRR + **工具→建项转化率**（观察指标：tool_visit → generation_submit → project_create 的 F3 漏斗，衡量工具入口向旗舰流水线的导流效率）；
2. **供给板**：adapter 成功率/延迟/单均成本——周度定价复核输入；
3. **稳定性板**：RED 指标/队列深度/轮询命中率。

## 5. 实现约定

批量上报端点、snake_case、新事件先登记；隐私最小化——**不上传提示词/小说内容**（仅长度分桶与哈希），PIPL 对齐（compliance D 组）。
