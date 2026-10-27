# ReelFlow 发布播放页（`/watch/[token]` + 公开读端点 + 三态）交付报告

> 负责人：teammate `film-api`｜日期：2026-10-27｜任务 `task-22`（模块 #20 92%→98%，权重 8）
> 契约/证据：`rea-reelmate/routes.txt:917`（`wf/publish`）、`:923`（`wf/video-slicing`）、
> `_acceptance/_gap/fullsite-route-inventory.md:81`（ReelFlow 差距=切片/发布/clip 资产绑定）；
> 上一轮已落 `timeline_publications` 状态机（1 排队 / 2 转码中 / 3 可播放 / 4 失败 / 5 已下架）+ `share_token`。

---

## 1. 交付

### 1.1 后端端点（2 个，均 `@Public`，只认 token）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/v1/watch/:token` | 公开播放信息。可播放 → `{title, episode_no, status, file_url(现签 1h), duration_ms, published_at, view_count}`；**不含** space_id/user_id/project_id/episode_id/publication_id/share_token/slice/error |
| POST | `/v1/watch/:token/view` | 播放计数 → `{ok, counted, view_count}`；同 token + 同 IP **5 分钟内只算一次**（Redis `SETNX` 原子占位） |

文件：
- 新增 `apps/api/src/modules/script/publish.controller.ts`（`PublishPublicController`，两个方法都 `@Public()`，
  与 `ScriptController` 分开写——避免后续重构把公开页顺手套上 `req.auth`）；
- 修改 `apps/api/src/modules/script/publish.service.ts`：**只追加** `publicWatch()` / `recordView()` 与
  两个内部工具（`viewCount`/`ipFingerprint`），**未改** publish/unpublish 状态机与既有方法；
  `PublishService` 构造函数新增 `RedisService` 注入（RedisModule 是 `@Global`，无需改模块 imports）。
- ⚠️ **一处跨出我文件清单的 2 行改动**：`apps/api/src/modules/script/script.module.ts`
  （`import { PublishPublicController }` + `controllers: [ScriptController, PublishPublicController]`）。
  原因：Nest 的 controller 必须在模块里注册，否则端点不生效；这是"新建 controller"的必要配套。
  已按"先读再改"落盘（未覆盖他人改动），如你要收回该文件的归属请直接改回来并告诉我。

### 1.2 四种非正常态（都有明确 reason，页面不白屏）

| 场景 | HTTP 信封 | reason（写在 msg 末尾） | 页面 |
|---|---|---|---|
| token 形状非法 / 不存在 | `400102` | `not_found` | 「链接无效或已失效」+ 回首页 |
| status=5 已下架 | `400102` | `off_shelf` | 「该视频已下架」+ 回首页 |
| status=1/2 排队/转码中 | `400105` | `transcoding` | 「视频正在转码」+ 重试 |
| status=4 转码失败 | `400105` | `transcode_failed` | 「视频暂不可播放」+ 重试 |
| 网络/未知错误 | — | — | 「加载失败」+ 重试 |

> `reason` 为什么在 msg 里：全局信封 `{code,msg,data}` 冻结、`AppError.details` 不出网
> （Lead 在 task-11 已确认该口径）。页面按固定格式 `（([a-z_]+)）$` 解析，**同时**用 code 兜底，
> 两者任一命中即进对应态（防御后端文案微调）。

### 1.3 前端页面 `apps/web/pages/watch/[token].vue`

- `definePageMeta({ ssr: false })`，**默认布局**（营销壳）：未登录可直接打开（截图里站头显示「登录/立即登录」）；
- 可播放态：`<video controls playsinline>` + 标题 + 第 N 集 + 时长（`0:03`）+ 发布时间 + 播放量 + 分享按钮（复制链接，失败退化为 `prompt`）+ 署名行；
- 转码中/已下架/不存在/转码失败/网络失败 五套面板（图标 + 标题 + 说明 + 重试/回首页），**无 404 白屏**；
- `?lang=` 走全局 i18n 插件（`plugins/i18n.ts` 已按 `?lang=` → cookie → 浏览器协商），
  本页文案用**页面内词典**（zh-CN/en，其余回落中文），未新造 i18n 结构；
  既有 key 复用 `common.loading`/`errors.load`；
- `types/api.ts` **只追加** `WatchPublicationDto` / `WatchViewResultDto`。

### 1.4 需要 Lead 加的一行 routeRules

```ts
// nuxt.config.ts → routeRules（与 /film、/team 同批）
"/watch/**": { ssr: false },
```
（页面已声明 `definePageMeta({ ssr:false })`，但本仓库约定「登录后可用的页 + 公开落地页」都要在 routeRules 补一行，
避免直接访问时的 hydration 抖动。`/watch` 本身无独立页面，只需 `/**`。）

---

## 2. 播放量：双写（Redis 去重闸 + `view_count` 列权威计数）

`timeline_publications.view_count integer not null default 0` 已由 Lead 在**迁移 0032** 加上并 migrate，
本轮把计数改为**双写**（原实现是 Redis-only，已在 §4 D2 记为"已解决"）：

| 环节 | 实现 | 说明 |
|---|---|---|
| 去重闸 | `SETNX watch:view:<pubId>:<sha256(ip)[:24]>`，TTL 300s | 同 token + 同 IP **5 分钟内只算一次**；不落明文 IP。**保留在 Redis**（防刷），不承担计数职责 |
| 计数落库 | `UPDATE timeline_publications SET view_count = view_count + 1 RETURNING view_count` | **列内原子自增**（不是"先读再写"，并发下后者丢数）；直接拿自增后的值省一次读 |
| 出参 `GET /watch/:token` | 读 `row.view_count` | **列是唯一数据源**；Redis 不参与出参 |
| 出参 `POST /watch/:token/view` | 自增后的列值；去重命中时**重读**列值 | 去重命中路径重读一次，避免"同一页两个标签页同时打开"时报旧值 |
| `updated_at` | **不动** | 播放不是内容变更，改了会让"最后编辑时间"失真 |

**为什么不只用 Redis**（Lead 的列注释原话）：Redis 重启/淘汰会把"这部片子被看了多少次"清零，
而这是创作者与运营要看的历史指标，必须持久。

**验证**：新增第 14 例「view 计数持久化」断言链——新行 `view_count=0` → 首次 `counted=true` 且**列=1**
→ 同 IP 第二次 `counted=false` 且**列仍=1** → **清空 Redis 去重键（模拟重启）后 GET 仍读到 1**
→ 去重闸放行后 `counted=true` 且**列=2**（从持久值继续，不是从 0 重来）。

> 兼容说明：旧实现的旁路键 `watch:views:<pubId>`（Redis 侧累计）已随本轮双写**移除**，
> 不再被任何代码读写；测试里仍顺手 `DEL` 一次，保证从旧版本升级的环境不留脏键。


---

## 3. 验收实测（原文输出）

### 3.1 spec（既有 8 例 + 新增 6 例 = 14 例全绿）
```
cd app/apps/api; npx vitest run test/reelflow-publish.spec.ts
 ✓ test/reelflow-publish.spec.ts (14 tests) 1395ms
 Test Files  1 passed (1)
      Tests  14 passed (14)
```
新增 6 例覆盖：
1. **可播放**：不带任何 Authorization 也能读；`file_url` 含 `files/local`、`duration_ms=4000`、`episode_no≥1`；
   **键集合严格等于** `[duration_ms, episode_no, file_url, published_at, status, title, view_count]`
   （多一个字段都可能泄露内部信息，所以是"全等"断言而非 contains）；
2. **转码中/失败**：直接落 status=1/2/4 三条记录 → `400105` + `transcoding` / `transcode_failed`，`data=null`；
3. **已下架 + 不存在**：真发布 → 真下架（走 `DELETE .../publications/:id` 状态机）→ `400102 off_shelf`；
   随机 32-hex → `400102 not_found`；畸形 token → `400102 not_found`；下架后计数端点也是 `off_shelf`；
4. **计数（去重语义）**：首次 `counted=true`，同 IP 立刻再点 `counted=false` 且 `view_count` 不变；GET 里能读到同一数值；
5. **计数持久化（双写）**：`view_count` 真的写进列；**清空 Redis 后 GET 仍是持久值**；去重闸重置后再点从持久值继续 +1；
6. **能力式授权边界**：另一 space 的账号拿同一链接能看（链接即凭据）且响应仍无内部字段；
   但**内部发布端点**对该账号仍 `400102`（越权不泄露存在性，既有回归也仍然绿）。

### 3.2 静态门禁
```
pnpm --filter @app/api typecheck  → 我的文件 0 error；全包现有 4 个 error 都在他人 in-flight 的 modules/ad/ad-drama.service.ts（已告知 Lead）
pnpm --filter @app/web typecheck  → nuxt prepare + vue-tsc 通过（0 error）
npx eslint src/modules/script/{publish.service.ts,publish.controller.ts,script.module.ts} → 0 problem
npx eslint apps/web/pages/watch apps/web/types/api.ts → 0 problem
```

### 3.3 浏览器实测（真实 API + nuxt dev + 真实 3 秒 mp4，9/9 通过）

夹具：`ffmpeg testsrc` 生成 3 秒 640×360 mp4（22KB）→ `POST /assets/upload` → 落 publication（ready，真文件）
+ status=2（转码中）+ status=5（已下架）+ 随机 token（不存在）。

```
PASS 可播放态：渲染 <video> 且 src 是现签地址 :: http://127.0.0.1:3010/v1/files/local?key=u%2F1084...
PASS 可播放态：标题/集号/时长/播放量都在 :: 播放页验收 · 可播放切片 | 第 1 集·0:03·发布于 2026/10/27 11:34:47·1 次播放
PASS 可播放态：有分享按钮 :: 复制分享链接
PASS 可播放态：video 元数据已加载（readyState≥1） :: true
PASS 转码中态：文案 + 重试按钮，不白屏 :: 视频正在转码
PASS 不存在态：明确「链接无效或已失效」，不是 404 白屏 :: 链接无效或已失效
PASS 已下架态：文案与「不存在」区分开 :: 该视频已下架
PASS ?lang=en 生效（英文文案） :: Invalid or expired link
PASS 控制台/页面零错误
RESULT: 9/9 passed → E:\wanxing\_acceptance\watch-e2e
```
截图（4 张）：
- `_acceptance/watch-e2e/01-playable.png`（真视频播放中 + 标题/集号/时长/播放量/分享按钮）
- `_acceptance/watch-e2e/02-transcoding.png`
- `_acceptance/watch-e2e/03-not-found.png`
- `_acceptance/watch-e2e/04-off-shelf.png`

---

## 4. 已知偏离 / 待取证

| # | 项 | 说明 |
|---|---|---|
| D1 | `script.module.ts` 2 行注册 | 见 §1.1；controller 不注册就不生效，属"新建 controller"的必要配套（其他文件未动）。 |
| D2 | 播放量只落 Redis | 见 §2；无 `view_count` 列（按指示不加），Redis 重启丢计数。 |
| D3 | 计数按 IP（非用户） | 公开页多数访客未登录，按用户等于计不上；同 NAT 只算一次，`counted` 字段已诚实表达。 |
| D4 | reason 在 msg 而非 `details.reason` | 全局信封不下发 details（task-11 已定口径），页面按固定格式解析 + code 兜底。 |
| D5 | `transcode_failed` 是第四个态 | 任务列了三个 reason；status=4（转码失败）与"转码中"用户动作不同（等 vs 找发布者），故单列，页面文案不同。 |
| D6 | 公开端点不返回发布者/空间信息 | 有意为之：能力式授权只给"看作品"所需字段；要展示作者名需产品定（会泄露账号昵称）。 |
| D7 | 发布侧转码仍是 API 内同构实现 | 上一轮既有偏差（worker 无 publication handler，复制成片产物=转码占位）；本批未动，播放页只依赖 status=3。 |
| D8 | 分享按钮只做复制链接 | 竞品有微信/海报分享；本批按"复用 `/share/[token]` 的分享交互样式"最小实现（复制 + 退化 prompt），未做海报生成。 |

---

## 5. 未完成（诚实清单）

- 播放量持久化（需 `view_count` 列 + 迁移，归 Lead/schema 批次）。
- 真实切片转码（worker 侧 ffmpeg 按 slice 区间裁剪）；本页只消费 status=3 的产物。
- 分享海报/微信分享（仅复制链接）。
- `/watch/**` 的 routeRules 需 Lead 加（§1.4）。
- 未做 `git commit`（按约定）。
