# 画布内 Agent 对话面板 —— 前端实现契约（2026-10-26）

> 目的：把「后端尚未落地」时的前端并行开发**钉死在接口形状上**。
> 上游依据：`contract-draft-canvas-agent.md` §3.3（C7 端点表）、§4.4（SSE 协议）、`canvas-frontend-baseline.md:134,172`（参照站右侧整套 Agent 面板）。
> 本文只写**前端要遵守的形状与行为**；后端实现细节见我侧代码。

---

## 0. 前端文件边界（严格）

| 文件 | 归属 | 说明 |
|---|---|---|
| `apps/web/composables/useCanvasAgent.ts` | **你（新增）** | 状态机 + API 调用 + SSE 连接 + 类型定义（类型放本文件，别动 `types/canvas.ts`） |
| `apps/web/components/canvas/CanvasAgentPanel.vue` | **你（新增）** | 面板 UI |
| `apps/web/assets/css/canvas-agent.css` | **你（新增）** | 面板样式（单独文件，别改 `canvas.css`） |
| `apps/web/pages/canvas/[id].vue` | **我** | 我只做「挂载 + 右侧 dock 页签」 |
| `apps/web/nuxt.config.ts` | **我** | 我只做 css 注册 |
| `apps/web/composables/useCanvasEditor.ts` | **我** | 不改 |

**禁止**：新增 npm 依赖；改任何既有文件；用假数据/占位文案冒充功能。

---

## 1. 后端 REST 形状（已冻结）

全部走 `useApi()`（`~/composables/useApi`），路径**不含** `/v1` 前缀（与 `useCanvasApi.ts` 一致）。
信封由 `useApi` 解包，直接拿 `data`。

### 1.1 会话（scope=2 画布内对话）
```
GET    /canvas/canvases/:canvas_id/chat/sessions?page=1&page_size=20
       → { list: AgentSession[], total: number, page: number, page_size: number }
POST   /canvas/canvases/:canvas_id/chat/sessions       body { title?: string }
       → { session: AgentSession }
PATCH  /canvas/canvases/:canvas_id/chat/sessions/:session_id   body { title?: string, status?: 1|2 }
       → { session: AgentSession }
DELETE /canvas/canvases/:canvas_id/chat/sessions/:session_id
       → { ok: true }
```

```ts
interface AgentSession {
  session_id: string;      // 字符串化雪花 id
  title: string;           // 空串 = 未命名（前端显示"新会话"）
  status: 1 | 2 | 3;       // 1 活跃 2 已结束 3 已归档
  scope: 1 | 2;            // 2 = 画布内
  last_active_at: string | null;   // ISO
  created_at: string;
  message_count: number;
  last_message_preview: string;    // 空串表示无消息
}
```

### 1.2 消息
```
GET  /canvas/canvases/:canvas_id/chat/sessions/:session_id/messages?after_event_id=<id>&page_size=50
     → { list: AgentMessage[], next_event_id: string | null, has_more: boolean }
POST /canvas/canvases/:canvas_id/chat/sessions/:session_id/messages
     body { content: string, content_type?: 1|2|3|4,
            reference_node_ids?: string[],
            decision?: { interrupt_id: string, decision: "approve" | "reject", edits?: unknown },
            wait?: boolean }
     → { message_id: string, stream_id: string }
```
```ts
interface AgentMessage {
  message_id: string;
  role: 1 | 2 | 3;              // 1user 2assistant 3system
  content: string;
  content_type: 1 | 2 | 3 | 4;  // 1text 2card 3plan 4hitl
  payload: {
    // content_type=2 卡片：可直接落到画布上的节点描述
    nodes?: Array<{ node_type: string; name: string; params?: Record<string, unknown> }>;
    // content_type=3 计划
    steps?: string[];
    // content_type=4 HITL
    interrupt_id?: string;
    question?: string;
    allowed_decisions?: Array<"approve" | "reject">;
    // 消息触发的真实任务（可能为 null）
    task_id?: string | null;
    [k: string]: unknown;
  };
  task_id: string | null;
  seq: number;
  created_at: string;
  reaction: 0 | 1 | 2 | 3;      // 0 无 1 赞 2 踩 3 已取消
}
```

### 1.3 增补
```
POST /canvas/chat/sessions/:session_id/read              body { last_read_seq: number }
     → { unread_count: number }
POST /canvas/chat/sessions/:session_id/messages/:message_id/reaction   body { reaction: "like"|"dislike"|"none" }
     → { ok: true }
POST /canvas/chat/sessions/:session_id/messages/:message_id/node-binding body { node_ids: string[], binding_kind?: 1|2|3 }
     → { bound: number }
GET  /canvas/canvases/:canvas_id/chat/writing-outputs?page=1&page_size=20
     → { list: AgentMessage[], total: number, page: number, page_size: number }   // 只有 assistant 且有节点的消息
```
> `node-binding` 在「消息里的节点已被我创建到画布」后调用，把 `message → node` 的产出来源记下来（可反查"这个节点是谁给我做的"）。绑定失败不该阻塞 UI：吞掉错误、只记 console。

### 1.4 SSE
```
GET /canvas/chat/sessions/:session_id/stream?last_stream_id=<上次的帧 id>
    Content-Type: text/event-stream
```
帧格式（**照这个解**，event 名可选）：
```
id: <stream_id>
event: <type>
data: {"id":"<stream_id>","type":"<type>","seq":<n>,"payload":{...}}

```
心跳帧：`event: ping` / `data: {"ts":<ms>}`，**必须忽略**。

支持的 `type`（其余一律忽略，不要抛错——后端将来加类型不能打断前端）：

| type | payload | 前端行为 |
|---|---|---|
| `session_opened` | `{session_id}` | 可忽略 |
| `user_message` | `{message_id, content}` | 乐观消息替换为服务端消息（去重靠 message_id） |
| `model_step` | `{step:"thinking"\|"writing", label?}` | 显示"正在思考/正在写" |
| `agent_message` | `{message_id, content, content_type, payload}` | 追加助手消息 |
| `task_progress` | `{task_id, status, progress}` | 在该消息上显示进度条 |
| `error` | `{code, message}` | 消息条内红色提示，**不弹全局错误** |

**降级（硬要求，ADR-012）**：SSE 连不上/被网关吃掉/`maxAttempts` 用尽 → 自动切 **3s 轮询** `GET …/messages?after_event_id=` 补齐，行为等价。必须实现，不能只在文档里写。

- 重连退避：`min(1000 * 2^n, 30000)`，`maxAttempts=5`，`onopen` 重置。
- 用 `fetch` + `ReadableStream` 手写解析（**不要用原生 `EventSource`**：它不能带 `Authorization` 头）。
- `AbortController` 在组件卸载/切会话时 abort。

---

## 2. UI 规格

### 2.1 位置与容器
右侧 dock 的第二个页签（第一个是既有「属性」检查器），宽度与检查器一致（`--cv-inspector-w`），**不要自己改宽度**。
组件只负责 dock **内部**内容，`position/z-index` 由页面给；根元素 `class="cv-agent"`，高度 100%。

结构（从上到下）：
1. **头部**：`Agent` 标题 + 会话下拉（列出会话，含「＋ 新会话」）+ 关闭按钮（`emit("close")`）
2. **消息区**（`flex:1; overflow-y:auto`）：气泡、卡片、HITL
3. **输入区**：textarea（`Enter` 发送 / `Shift+Enter` 换行）+ 发送按钮 + 状态提示

### 2.2 必须实现的交互（E2E 会逐项验）
| # | 行为 | 断言锚点（class 或属性） |
|---|---|---|
| 1 | 首次挂载自动取会话列表；无会话时展示「新会话」按钮 | `.cv-agent`, `.cv-agent__new` |
| 2 | 新建会话后进入该会话，消息区显示空态引导 | `.cv-agent__empty` |
| 3 | 发送消息 → 输入框清空 → 消息区出现 user 气泡 | `.cv-agent__msg--user` |
| 4 | 助手回复到达（SSE 或轮询）→ 出现 assistant 气泡 | `.cv-agent__msg--assistant` |
| 5 | 助手卡片含节点时出现「在画布中创建 N 个节点」按钮 | `.cv-agent__apply` |
| 6 | 点该按钮 → `emit("create-nodes", nodes)`；父组件负责真正建节点 | 同上 |
| 7 | SSE 失败时出现降级提示条 | `.cv-agent__degraded` |
| 8 | 结束会话（status→2）后输入框禁用并提示 | `.cv-agent__ended` |
| 9 | 赞/踩按钮 | `.cv-agent__react` |
| 10 | 「历史产出」按钮列出可复用的历史消息 | `.cv-agent__outputs` |

### 2.3 组件对外 API（我来对接，必须严格一致）
```ts
defineProps<{
  canvasId: string;
  selectionIds?: string[];     // 当前选中节点，发消息时作为 reference_node_ids
  models?: Array<{ model_id: string; name: string; capability: string; modes: string[] }>; // 可选：模型切换器
}>()
defineEmits<{
  (e: "close"): void;
  (e: "create-nodes", nodes: Array<{ node_type: string; name: string; params?: Record<string, unknown> }>): void;
}>()
```

### 2.4 视觉
- 只用既有 `--cv-*` 变量与 `tokens.css` 变量；**不要新增十六进制颜色**（除非该 token 不存在，此时在 `canvas-agent.css` 顶部注释说明缺口）。
- 与检查器同款圆角/边框/字号；深色不是本期范围（跟随既有 token）。
- 中文注释解释**为什么**（例如"为什么手写 SSE 解析而不用 EventSource"），不要复述代码。

---

## 3. 自检清单（提交前）
1. `pnpm --filter @app/web typecheck` 通过（`vue-tsc` 或 nuxt typecheck）；
2. 组件内所有 DOM 断言锚点按 §2.2 落地；
3. 无新增 npm 依赖；
4. 无假数据：后端未返回就显示空态，不出现写死示例消息；
5. `git status` 只出现你负责的 3 个新文件。
