# 第 3 轮批次报告（Lead 复核记录）

> 背景：第 3 轮的 6 个 teammate turn 在会话中断中被切断（模型/宿主切换），代码已大量落盘但**报告缺失**。
> 本文件由 Lead 按"当前工作树 + 实跑证据"逐项复核，**只记录能复核的事实**：
> 端点/页面/用例数字来自 `pwsh _acceptance/verify-round.ps1 -ScaleOnly` 与实跑，
> 行为来自 `_acceptance/smoke-round3.ps1` 的真实 HTTP 链路输出。
> 诚实边界：teammate 自述的"未做项"若无法核实，一律标「未取证」。

## 0. 本轮规模变化

| 指标 | v2.1（第 2 轮） | v2.2（本轮） | 变化 |
|---|---:|---:|---|
| API 端点 | 648 | **683** | +35（ad-drama 12 / video-redraw 9 / watch 2 / novel 7 / 其他 5） |
| Web 页面 | 55 | **60** | +5（`/ad-drama/create`、`/ad-drama/workspace`、`/video-redraw/workspace`、`/watch/[token]`、+1） |
| 数据表 | 110 | **111** | +1（`episode_resources`）＋ 6 列（`project_mode`/`mode_meta`/`prompt_status`/`view_count`/`is_starred`/`template_key`） |
| 迁移 | 31 | **33** | 0031（本轮 schema）、0032（`timeline_publications.view_count`） |
| 测试 | 1,044 | **1,100** | +56（ad-drama 13 / video-redraw 14 / reelflow-publish +5 / 其它 24） |

## 1. 模块 #13 广告剧（`modules/ad/`，12 端点 + 2 页面）

**竞品证据**：`rea-reelmate/routes.txt:680-691`（12 端点）、`:11-12`（页面）、`docs/01-product/reelmate-feature-map.md:267`（五段语义）、
`_acceptance/_gap/cli-skill/reelmate-cli-skill/commands/ad.md:57-67,85,117,133,149`（参数名逐个对齐）。

**映射**（`ad-drama.controller.ts` 顶部表格逐条可核）：`asset/extract`→`POST /ad-drama/projects/:id/asset/extract`、`asset/image-tips`、
`brief/generate|select`、`project/info|point|save`、`script/edit|generate|reset`、`selling-point/generate`、`storyboard/generate`。

**设计取舍（写进代码注释）**：
- 广告剧复用 `script_projects` 骨架（`project_mode=2`）+ `mode_meta` jsonb（服务端不解析语义、只限大小），**不新建表**——
  竞品把 `drama_ad` 挂在 `df/script_project/*` 下，本身就是"一个项目 + 一段专属流程"。
- `STAGE`/`STATUS` 值域竞品**未取证**（CLI 只打印列），我方 1..5 / 1 进行中 2 完成，并在 `ad.constants.ts` 注释标注。

**实跑证据**（`_acceptance/smoke-round3.ps1`，真实 API `:3002`）：
```
create: id=108496860256092160 created=True
selling_points=5 charge=2        ← 发分走 tasks/账本，响应带本次消耗
briefs=3 → selected=True
script_len=483 → edited=496      ← 人工编辑生效
storyboard/generate → 1 shot
asset/extract → 1 asset（prop：Portable Juicer）
image-tips=6
info: stage=5 current=5 stages_done=5/5
```
**测试**：`test/ad-drama.spec.ts` **13 例**（含 403/参数/幂等/跨 space）。

**未做/待取证**：竞品 `brief` 候选数量与文案模板未取证（我方 3 条）；`sp_type` 只留痕不参与逻辑；页面无浏览器截图（HTTP 200 + 接口链路已验）。

## 2. 模块 #14 视频转绘（`modules/redraw/`，9 端点 + 2 页面）

**竞品证据**：`routes.txt:703-710`（8 端点）、`:121-122`（页面）、`feature-map.md:268`、`commands/redraw.md`。

**我方 9 条** = 竞品 8 条 + **1 条补充**（`GET /video-redraw/projects` 列表：竞品 8 端点里没有列表，但工作台必须有入口；
已在 controller 注释标注为"我方补充"）。

**设计取舍**：`mode_meta` 存 `{source_uri, source_kind, style, redraw_strength, source_duration_s, episode_ranges, shot_duration_s}`；
`episode_ranges` 让"分镜计划"能按切集区间默认取值（否则切完集还要再问一次时间轴）；分镜/资产/绑定全部复用既有表与快照语义。

**实跑证据**：
```
create: id=108496861011066880
episodes/batch(count=3) → 3 集
storyboard/plan(ep1) → 20 镜
resources/generate(ep1) → 20 个任务（走报价 + 记账）
asset/bind(ep1) → bound=20
info: stage=done episodes=3 storyboards=20 assets=20 bound=20
```
**测试**：`test/video-redraw.spec.ts` **14 例**。

**未做/待取证**：真实供应商重绘能力（无 Key，mock 可跑且确定性）；`redraw_strength` 对产出无可见影响（mock 下不体现）。

## 3. 模块 #20 ReelFlow 发布播放页（`/watch/[token]`，2 端点 + 1 页）

**竞品证据**：`routes.txt:917,923,906,911`（发布/切片/片段资产/下架）；`_acceptance/_gap/fullsite-route-inventory.md:81`（我方差距原文"缺切片/发布/clip 资产绑定"）。

**交付**：`GET /v1/watch/:token`（`@Public`，键集合严格收紧，spec 用"全等"断言，不含 space/user/project/episode/publication/token/slice）、
`POST /v1/watch/:token/view`（同 token+IP 5 分钟去重）、`/watch/[token]` 页（五态：可播放/转码中/转码失败/已下架/不存在，均不白屏）。

**Lead 补的持久化**：本轮新增 `timeline_publications.view_count`（迁移 0032）——原实现只落 Redis，重启即丢；
现改为"Redis 只做 5 分钟去重 + 列原子自增"，`GET` 读列（`publish.service.ts` 注释说明为何不能只靠 Redis）。
**测试**：`reelflow-publish.spec.ts` 8 → **13 例**。

## 4. 模块 #17 资产/主体补完（消除上一轮 5 条偏离）

| 上轮偏离 | 本轮状态 | 证据 |
|---|---|---|
| 集级资源清单用"投影"（绑定∪提及）代替快照 | **已消除** | 新表 `episode_resources`（迁移 0031，唯一键 `(episode_id,kind,name)`）；`modules/script` 内 16 处引用，`save-resource-matches` 按类清空重写 |
| `prompt_blocked`/`prompt_generating` 无列可依 | **已消除** | `project_assets.prompt_status`（0/1/2/3），11 处引用；被拦截资产不参与智能补充 |
| 主体无星标/IP 模板 | **已实现** | `subjects.is_starred` + `subjects.template_key`（列 + 索引），`GET /subjects` 支持筛选 |
| `images[]` 可能直接替换 prompt 未定义 | **已定口径** | `prompt_inject_mode=append|replace`，默认 `append`（保持既有行为），`replace` 需产品确认 |
| extraction 端点偏少 | **已补** | `GET /extraction/tasks`、`POST /extraction/tasks/:id/cancel`、`GET /extraction/stats` |

**测试**：`subject` / `extraction` / `asset-match` / `project-assets` 全绿（本轮实跑 8 个相关 spec 共 **104 例**）。

## 5. 模块 #16 多语言补完（路径前缀 + hreflang/sitemap + 4 页）

- `middleware/i18n-prefix.global.ts`：`/en|/ja|/br|/es` 前缀 → 等价无前缀路由 + 设语言；切换**替换**前缀（`localizedPath` 里 `stripLocalePrefix` 先剥后加）。
- `i18n/index.ts::buildAlternates`：5 条 `hreflang` + `x-default`（指向中文无前缀）。
- `server/routes/sitemap.xml.ts` + `robots.txt.ts`：只列公开页（不含 `/admin`、`/canvas` 等登录页），5 语言各一条。
- 4 页迁移：`works.vue`、`projects/index.vue`、`login.vue`、`share/[token].vue`（`useI18n` 已接入，见 grep）。
- **Lead 修的 2 个类型错**：`x-default` 需 `Array<{hreflang:string}>`（Locale 联合不含它）；`types/api.ts` 里 `AssetDto` 被重复声明（删重复块）。
- **未取证/未做**：`--prefix` 模式是否已并入 `i18n-check.cjs` 需下轮复核；剩余页面（novel/film/agent/create/集市/创作者/知识库/admin）未迁。

## 6. 模块 #9 CLI 收尾 + #7 团队权限拦截

- CLI：`apps/cli` 6 文件改动（README/args/builtins/registry/resolve/runtime），**83 例全绿**。
- **Lead 修的红**：`help.spec.ts` 断言骨架命令帮助含 "novel 批次"（文案已改写）→ 改为断言**竞品证据行** `commands/novel.md:59`（比批次标签更有意义：证据行号是"为什么这条命令存在/为什么还没实现"的唯一依据）。
- 团队权限：`TeamService.requirePermission` 已落（7 处引用），`GET /cam/permissions` 暴露 `enforced`；策略是**默认放行**（无显式 `power_list` 视为全权），避免打断存量 13 个 e2e。
- **未做**：3 个示范端点之外的入口拦截；真实越权回归用例（现为 spec 内 6 例）。

## 7. 模块 #1/#3/#15/#19/#26 收尾零头

| 项 | 状态 | 证据 |
|---|---|---|
| 首页运营位曝光/点击打点 | **已实现** | `modules/home` 内 view/click/view_count 13 处引用；Redis 去重 + 原子自增 |
| quality-check 口径版本 | **已实现** | `QUALITY_RUBRIC_VERSION` 常量随响应返回（便于换口径后对比历史分数） |
| 分享批量下载上限 | **已实现** | `MAX_SHARE_PACK_FILES`：>100 文件 → `400101 too many files` + spec 断言 |
| 3D 场景删除 UI | **Lead 补齐** | `useDirectorPersistence.removeScene()` + `Director3D.vue` 「删除场景」按钮（`window.confirm` + 清本地存档） |
| 后处理多框 + 撤销 | **Lead 补齐** | `video-upscale.vue` 改 `regions[]` 列表：多框渲染/点选/撤销上一个/删除选中；提交只下发选中框并在 UI 标注「仅选中框生效」（后端仍单组 `region_*`，不假装多框已生效） |

## 8. 模块 #2 小说链补完（novel-api 交付）

7 条新路由：`original_script/characters` 5 条**全部是路径别名**（别名到 `NovelService.listCharacters/generateCharacters/createCharacter/patchCharacter/confirmCharacter`，零复制逻辑）
+ `idea/:ni_id` GET/PATCH。**跨路径一致性断言**：写薄路径后 `core_character/list` 读到同一条（证明是别名不是副本）。
`novel.spec` 25 + `novel-original.spec` 17 = **42 例**，连跑 3 次稳定。

## 9. 本轮仍缺（诚实清单，进 §5 缺口表）

1. #6 工具箱：真实供应商 Key（全 mock）、图片类工具未做真实投递 —— 2.0 权重。
2. #10 创作者：`/creator-center/preview/:id`、`/earnings`、`effect` 维度（表无列）—— 2.4 权重。
3. #8 影视版：xlsx 导出（现 CSV/ZIP）、离线通知只到广播面、WS 真传输 —— 1.0。
4. #17 资产：集级快照已落表，但"IP 模板渲染语义"未取证 —— 0.6。
5. #16 多语言：剩余页面 + `i18n-check --prefix` 复核 —— 0.6。
6. #9 CLI：MCP server 0 行（竞品无证据）—— 0.8。
7. #13/#14：ad/redraw 的页面浏览器点击 E2E（本轮只验 HTTP 200 + 接口链路）—— 各 0.3。
