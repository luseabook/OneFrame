# 第 4 批：创作 Agent 收口（task-6）交付报告

> 负责人：agent-impl · 完成时间：2026-10-27 08:30 (+08)
> 任务：`/agent` 页面 + Skill 卡市场 8 端点 + STT + 推荐卡（权重 10）
> 结论：**后端 12 端点落盘、页面可点（E2E 29/29）、spec 9 例全绿**；真实 ASR 供应商与竞品会话级分享未接（下方「未完成」逐条列明）。

---

## 交付

### 端点（本批新增 12 条，全部 `/v1` 前缀，响应裸 data 由信封包裹）

**Skill 卡市场 8 端点 + 1 别名**（`agent-skills.controller.ts`）

| # | 方法 路径 | 语义 |
|---|---|---|
| 1 | `GET /agent-skills` | 全集（广场 ∪ 本空间自建），支持 `category` / `q` / `page` / `page_size` |
| 2 | `GET /agent-skills/plaza` | 广场（`visibility=2`） |
| 3 | `GET /agent-skills/mine` | 本空间自建（`space_id = 当前空间`，含 `is_mine` 区分创建人） |
| 4 | `GET /agent-skills/favorites` | 我的收藏 |
| 5 | `POST /agent-skills/:id/favorite` | 收藏/取消，body `{favorite?: boolean}` 省略=取反；**幂等** |
| 6 | `GET /agent-skills/:id` | 卡片详情 |
| 7 | `POST /agent-skills` | 新建（`visibility` 1 私有 / 2 发布广场，默认 1） |
| 8 | `DELETE /agent-skills/:id` | 软删（仅创建人；平台卡 403、跨空间 404） |
| 9 | `GET /agent-skills/details?id=` | 竞品同名字面量别名（`rt:382`） |

**STT 2 条**（`agent-stt.controller.ts`）
- `GET /agent/stt-token`：能力位 + 120s 中继令牌；**无 Key → HTTP 200 + `{available:false, reason, fallback:"browser"}`**，绝不 500。
- `POST /agent/stt/transcribe`：服务端中转（`@Public` + 自验 `aud=agent-stt` 票），厂商 Key 不下发浏览器。

**推荐卡 1 条**（`agent-recommend.controller.ts`）
- `GET /agent-recommend-cards`：按空间最近 30 天项目/资产/会话选 3~6 张；空态给竞品 4 张兜底卡。返回 `{list, source:"signals"|"default", signals}`。

**独立创作会话 8 条**（`agent-conversations.controller.ts`，`/agent` 页必需，我方增补）
- `GET/POST /agent/sessions`、`PATCH/DELETE /agent/sessions/:id`、`GET/POST /agent/sessions/:id/messages`、`POST /agent/sessions/:id/read`、`GET /agent/sessions/:id/stream`(SSE)。
- 只放行 `scope=1`；拿画布会话 id 打这些端点一律 400102（越权面收口）。
- 底层完全复用既有 `agent_sessions / agent_messages / agent_events`，无第二套存储。

### 页面

| 路由 | 文件 | 内容 |
|---|---|---|
| `/agent` | `apps/web/pages/agent.vue` | 历史会话侧栏（新建/切换/删除/结束）+ 消息流（SSE 消费、seq 游标去重、断线重连、3s 降级轮询）+ 任务卡（生成中/完成/失败）+ 分享入口 + Skill 卡抽屉 + 推荐卡 + 语音入口 |

组件（`apps/web/components/agent/`）：

| 文件 | 职责 |
|---|---|
| `useAgentChat.ts` | 状态机：会话 CRUD、消息合并（按 `message_id` 去重）、SSE 手写解析（fetch + ReadableStream，不用 EventSource）、`min(1000·2^n, 30000)` 退避 5 次、降级 3s 轮询、`last_stream_id`/`after_event_id` 双游标 |
| `AgentMessageItem.vue` | 气泡 / 卡片节点 / 计划步骤 / HITL 问题 / 任务卡挂载 |
| `AgentTaskCard.vue` | 任务三态 + 进度条 + 结果预览（图/视频/文本）+ 分享（复用 `POST /tasks/:id/share`） |
| `AgentSkillDrawer.vue` | 广场/我的/收藏三 tab、分类、搜索（300ms 防抖）、收藏乐观翻转、使用、新建、删除 |
| `AgentRecommendCards.vue` | 推荐卡（tag 图标、signals 徽标、失败重试） |
| `AgentVoiceRecorder.vue` | MediaRecorder 按住说话 → base64 → 中继转写；不可用时降级到浏览器 `SpeechRecognition`；两者都不可用则禁用 + 可读原因（60s 上限） |

类型追加：`apps/web/types/api.ts`（`AgentSkill` / `AgentSkillPage` / `AgentRecommendCard` / `AgentRecommendResult` / `AgentSttToken` / `AgentSttRelayResult` / `AgentTaskDetail` / `TaskShareLink`）。

### 测试：`apps/api/test/agent-skills.spec.ts` 9 例（含 22 断言组）

实测（`cd apps/api; npx vitest run test/agent-skills.spec.ts test/agent.spec.ts`）：

```
 ✓ test/agent-skills.spec.ts (9 tests) 709ms
 ✓ test/agent.spec.ts (13 tests) 1720ms
 Test Files  2 passed (2)
      Tests  22 passed (22)
```

覆盖：广场 33 张 + 分类/搜索/分页不重叠 / 收藏幂等（双击不涨计数、DB 行数=0）/ 自建卡 mine→detail→details 别名→跨空间 400102→软删后不可读 / 平台卡 403 + 发布卡全局可见但仅创建人可删 / 参数校验 4 条 / STT 能力位与令牌（含未接入 provider 明确 false）/ 推荐卡空态 4 张兜底 + 信号态含 `rec_novel_to_script` + `skills[].skill_id` 真实性 / 独立会话发消息→回复→已读→SSE 游标 746004→结束 400101 / scope 隔离（画布会话不可经 `/agent/sessions/*` 读写）。

### 其他门禁

```
pnpm --filter @app/api typecheck   → 0 error（tsc --noEmit 退出 0）
pnpm --filter @app/web typecheck   → 0 error（nuxt prepare + vue-tsc 退出 0）
npx eslint src/modules/agent       → 0 problem
npx eslint pages/agent.vue components/agent → 0 problem
pnpm --filter @app/api lint        → 仅剩 1 个他人文件错误（见下「需要 Lead 做」）
```

### 页面可点：`_acceptance/e2e-agent.cjs` 29/29

```
创作 Agent E2E：29/29 通过
```

覆盖：S1 骨架+空态+推荐卡(4) / S2 新建→发消息→user 气泡→assistant 气泡（SSE）→输入框清空 / S3 任务卡出现且状态在「排队中/生成中/已完成/失败」内 + 分享给出真实链接 `/share/<token>` / S4 抽屉 12 张卡 + 点「使用」填充 `/character-multiview-sheet` 预置 prompt + chip 显示 / S5 收藏点两次计数回到初值（幂等）/ S6 语音入口存在且不可用时有可读降级 / S7 API 交叉核对（广场 33、推荐卡 3 张 source=signals、STT available=false、会话落库）/ S8 控制台零未预期错误。

截图：`_acceptance/agent-e2e/01-agent-empty.png` … `05-agent-voice.png`（1440×900）。

> 验证用的私有栈：api `:3012` + web(nuxt dev) `:3013`，指向同一 PG 55432 / Redis 6380。**共享栈 3002/3003 跑的是旧 `dist`/`.output` 构建，不含本批路由**（见「需要 Lead 做」）。

---

## 证据

| 我方实现 | 竞品证据 |
|---|---|
| `/agent` 页面（对话式创作页） | `rea-reelmate/routes.txt:14`（`/agent`）、`:15-16`（bigscreen/editor 同族）、`:42`（`/creation-agent`）；`docs/07-plan/completion-plan-to-100.md:177`（任务 4.1） |
| Skill 卡市场 8 端点 | `routes.txt:378-385`（recommend-cards + agent-skills 7 条，共 8 路由）；`docs/01-product/_parts/d-canvas-agent.md:347`（`agent-skills/plaza`、`/favorites`、`/mine`、`/details`、`/:id/favorite`、`PUT/POST/DELETE` 9 条）；`completion-plan-to-100.md:178`（含「竞品实测 33 张」） |
| 卡片字段 / 分类枚举 / tag 1..5 | `d-canvas-agent.md:343-344`（`tag ∈ 1批量生图/2视频制作/3剧本创作/4skill/5自定义`）、`:345`（图标映射） |
| 斜杠指令 DSL（`/character-multiview-sheet` 等） | `d-canvas-agent.md:349`（`CpJ9@HXe`、正则 `^\/([A-Za-z0-9_-]+)`） |
| 推荐卡字段 `{recommend_id,title,description,preset_prompt,tag,tag_label,skills[],cover_file_id}` | `d-canvas-agent.md:342-343`（`core-lib@982025`、`CpJ9@zXe()`，字段逐个对齐） |
| 兜底 4 张（一键成片/人物多视角/第一人称短片/武侠短片） | `d-canvas-agent.md:346`（`CpJ9@HXe`）；样例 `docs/01-product/reelmate-feature-map.md:303`（`skill_name_en:"wuxia-one-line-film-director"`, `tag_label:"一键成片"`） |
| STT token 端点 | `routes.txt:126`（`/web/v1/agent/stt-token`）；`completion-plan-to-100.md:179`（任务 4.3） |
| SSE 协议 / 帧格式 / 降级 3s 轮询 / 退避 `min(1000·2^n,30000)` / 不用 EventSource | `_acceptance/_gap/agent-chat-frontend-contract.md:104-134`（§1.4，尤其 `:129` 降级硬要求、`:132` 手写 fetch 解析） |
| 会话/消息形状（`session_id/title/status/scope/last_active_at/message_count/last_message_preview`、`message_id/role/content_type/seq/reaction`） | `agent-chat-frontend-contract.md:42-52`、`:66-89` |
| 会话串行 + seq 单调（复用既有无改动） | `contract-draft-canvas-agent.md` §2.3.0 合表决策；实现见 `agent-events.service.ts:32-43` |

---

## 已知偏离 / 待取证

1. **33 张卡逐卡文案未取证**：证据基座只有 3 个斜杠指令名与 5 个分类枚举（`d-canvas-agent.md:344-349`），其余 30 张的标题/摘要/prompt 为**我方自拟**（可运营改），斜杠命名风格照竞品 kebab-case。登记待取证：竞品广场 33 张的真实标题与分类分布。
2. **推荐卡选卡规则为我方推断**：竞品接口无参数（`d-canvas-agent.md:342`），"服务端按空间状态选卡"是合理外推；具体排序/信号未取证。我方规则写死在 `agent-recommend.service.ts` 注释里（项目→剧本/分镜；视频资产>图像→成片/第一人称；图像→人物多视角；会话史→一键成片）。
3. **`cover_file_id` 恒为 null**：竞品有封面文件位，我方暂无"卡片封面资产"来源，返回 null 而不是编 id（前端用 tag 图标兜底，`:345` 映射）。
4. **`mine` 语义取「本空间自建」而非「我创建的」**：团队空间下成员共享卡池更符合收益（同 space 成员可复用），`is_mine` / `owner_user_id` 仍能区分创建人。竞品 `mine` 的精确口径未取证。
5. **STT 令牌不是厂商凭据**：竞品把短期票发给浏览器直连 ASR（推断），我方改发**自有中继票**并中转音频——故意偏离，理由是不会把厂商 Key 交给浏览器。因此 `POST /agent/stt/transcribe` 是**我方新增路由**（竞品无）。
6. **`/agent/sessions/*` 8 条为我方增补**：竞品 `/agent` 只列了 `home/resource/*`、`task/*`、`stt-token`（`rt:123-134`），没有会话 CRUD 路由；但页面必须有历史会话/切换/续传，故在既有三表上加 scope=1 入口。已登记为"必要增补"，不是照抄。
7. **错误信封不下发 `details`**：`AllExceptionsFilter` → `fail(code,msg)` 只有 `{code,msg,data:null}`（`common/http/exception.filter.ts:22`），所以 STT 不可用原因写进 `msg`（"语音转写未配置（已回退文字输入）"），前端按 `code===400100` 降级。未新增错误码（听 Lead 指示）。
8. **E2E 过滤 `/_nuxt/builds/meta/dev.json` 404**：仅 `nuxt dev` 首次请求 HMR 清单的噪声，生产 `.output` 不请求；已写明在脚本注释里。

---

## 需要 Lead 做

1. **重建共享 web**（api 已就绪）：我刚探测共享栈——`GET :3002/v1/agent-recommend-cards` 返回 `401101`（= 路由已存在，只是未带 Bearer），说明 **api 侧的 `dist` 已经重建并包含本批 12 条路由**；但 `GET :3003/agent` 仍 **404**，说明 web 的 `.output` 还是旧构建。需要 `pnpm --filter @app/web build`（或 `pwsh _acceptance/start-wanxing-stack.ps1` 里的 web 段）后 `/agent` 才对共享栈可用。我用私有 3012/3013 做过完整 29/29 验证，验证后已停掉，不与共享栈抢端口。
2. **`layouts/app.vue` 侧栏**：`{ key:"agent", to:"", disabled:true }` → `{ key:"agent", to:"/agent" }`（你之前说等我页面落盘后接线；**页面已落盘**）。
3. **`nuxt.config.ts` routeRules** `/agent` 已由你加好，无需再动（web typecheck 已过）。
4. **`apps/api/src/config/env.ts`** 的 4 个 `AGENT_STT_*` 已由你加好，我已改为读 `env.*`（不再 `process.env`）。
5. **`pnpm --filter @app/api lint` 剩余 1 错属他人文件**：`apps/api/src/modules/script/asset-match.service.ts:373` `'kind' is assigned a value but never used`（script 域在途）。`api typecheck` 现在已是 0 错（film/script 那两处已被各自 owner 修掉）。我未改他人文件。
6. 可选：`packages/shared/src/errors.ts` 若后续想给"STT 不可用 / 转写失败"独立码再加；本轮按你的指示没加。

---

## 未完成（诚实列出）

| # | 项 | 状态 | 原因 / 下一步 |
|---|---|---|---|
| 1 | `volc` / `minimax` 真实 ASR 接入 | **未做** | 两家需要各自的签名/token 交换与音频编码要求，无凭据无文档不可臆造（ADR-013）。当前 `resolveSttCapability` 对二者返回 `available:false + reason:stt_provider_unsupported:*`，**不假装可用**。已接入的只有 `custom`（OpenAI 兼容 `/audio/transcriptions`，可指向自建网关）。 |
| 2 | 中继转写的真实端到端验证 | **未验证** | 本地无 `AGENT_STT_API_KEY`，只能验票据闸门（伪票 401）与"不可用→400100"路径；真实转写需在配 Key 的环境点一次（`SP 待取证：厂商响应格式差异`）。 |
| 3 | 竞品 `agent/task/share/{share_id}/sse`（分享页 SSE） | **未做** | `routes.txt:132`。我方分享走既有任务分享 `POST /tasks/:id/share` + `/share/:token` 只读页（任务卡上已可点、E2E 已验证链接生成），但没有"分享页实时进度流"。 |
| 4 | 竞品 `/agent/home/resource/info`、`/recommend`、`/sse`（`rt:123-125`） | **未做** | 属 `/agent` 首页资源位（推荐素材/资源卡），本轮 4.1~4.3 范围外；推荐位用 `agent-recommend-cards` 覆盖了主入口。 |
| 5 | `/agent` 页的 HITL 决策卡（approve/reject） | **部分** | 页面只展示"需要你确认 + 问题"，不提交决策。决策通道已在后端（`chat.send` 的 `decision` 分支 + 画布内面板完整实现），`/agent` 页未接（当前 mock 的独立创作回复不产生 HITL 中断，接了也无从验证）。 |
| 6 | 消息赞/踩（reaction）在 `/agent` 页 | **未做** | 端点存在但挂在 `/canvas/chat/sessions/*` 前缀上（会话级、作用域通用）；本轮没把它接进 `/agent` 页，避免跨域前缀调用。要么后续加 `/agent/sessions/:id/messages/:mid/reaction` 别名，要么页面直连画布前缀。 |
| 7 | 语音的浏览器内置识别 | **仅实现未 E2E 覆盖** | headless Chromium 无麦克风，无法自动化验证 `SpeechRecognition` 路径；逻辑按"不可用即提示"处理，真实设备需人工点一次。 |
| 8 | 33 张卡的运营位配置（排序/下架/封面） | **未做** | 排序用 `use_count desc`，下架靠 `status`，封面字段留空；运营后台（admin）未接卡片管理。 |
