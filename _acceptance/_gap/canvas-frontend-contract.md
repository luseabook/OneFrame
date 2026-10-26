# 画布编辑器组件契约（并行开发唯一接口）

> 本文件是 canvas 前端并行开发的**接口冻结文档**。
> 任何组件改动 prop/emit 名字都必须先改这里，否则并行开发必然撞车。

## 0. 已存在的地基（不要重写，直接用）

| 文件 | 提供 |
|---|---|
| `app/apps/web/types/canvas.ts` | `CanvasNodeDto` / `CanvasEdgeDto` / `CanvasGroupDto` / `CanvasDetail` / `CANVAS_NODE_TYPES` / `NODE_TYPE_META` / `TOOLBAR_NODE_TYPES` / `NODE_STATUS` / `CANVAS_ERR` |
| `app/apps/web/composables/useCanvasApi.ts` | `useCanvasApi()` → list/create/detail/rename/remove/commit/snapshots/snapshot/lock/unlock/renew/heartbeat/createGroup/deleteGroup/pinNode |
| `app/apps/web/composables/useCanvasEditor.ts` | `useCanvasEditor(canvasId: Ref<string>)` → 见下 |
| `app/apps/web/assets/css/canvas.css` | `.canvas-view` / `.cv-glass-btn` / `.cv-chrome` / `.cv-tip` / `.cv-tag` / `.cv-field` / `.cv-input` / `.cv-select` / `.cv-textarea` / `.cv-hint` / `.cv-seg` / `.cv-section` |
| `app/apps/web/components/canvas/CanvasIcon.vue` | `<CanvasIcon name="..." :size="18" />`，可用名见该文件 |

### `useCanvasEditor` 返回签名（只读用，组件不要改它）

```ts
{
  // 数据
  title: Ref<string>; version: Ref<number>;
  nodes: Ref<CanvasNodeDto[]>; edges: Ref<CanvasEdgeDto[]>; groups: Ref<CanvasGroupDto[]>;
  pinnedNodeId: Ref<string | null>;
  // 状态
  loading: Ref<boolean>; saving: Ref<boolean>; dirty: Ref<boolean>; loadError: Ref<string>;
  mode: Ref<"select" | "connect" | "pan">;
  connectFrom: Ref<string | null>;
  connectCursor: Ref<{ x: number; y: number } | null>;
  viewport: Ref<{ x: number; y: number; zoom: number }>;
  lockedNodes: Ref<Array<{ node_id: string; user_id: string }>>;
  myUserId: Ref<string>;
  // 选择
  selectedIds: Ref<string[]>; selectedId: ComputedRef<string | null>;
  selectedNodes: ComputedRef<CanvasNodeDto[]>; selectedNode: ComputedRef<CanvasNodeDto | null>;
  select(id: string | null, additive?: boolean): void;
  selectInRect(rect: { x: number; y: number; w: number; h: number }, additive?: boolean): void;
  selectAll(): void;
  // 历史
  canUndo: ComputedRef<boolean>; canRedo: ComputedRef<boolean>;
  undo(): void; redo(): void; pushHistory(): void;
  // 载入/保存
  load(): Promise<void>; loadMe(): Promise<void>; save(): Promise<boolean>;
  // 节点
  addNode(type: CanvasNodeType, at?: { x: number; y: number }): CanvasNodeDto;
  deleteNodes(ids: string[]): void;
  duplicateNodes(ids: string[]): void;
  moveNodes(ids: string[], dx: number, dy: number): void;
  setNodeParam(nodeId: string, key: string, value: unknown): void;
  setNodeParamPath(nodeId: string, path: string[], value: unknown): void;
  setNodeField(nodeId: string, field: "name"|"width"|"height"|"z_index"|"status"|"group_ids", value): void;
  setNodesField(ids: string[], field, value): void;
  alignNodes(ids: string[], align: "left"|"hcenter"|"right"|"top"|"vcenter"|"bottom"): void;
  // 连线
  addEdge(srcId: string, dstId: string, semantic?: string): boolean;
  deleteEdge(edgeId: string): void;
  edgesOf(nodeId: string): CanvasEdgeDto[];
  // 视口
  zoomAt(factor: number, screenX: number, screenY: number): void;
  setZoom(next: number, screenX: number, screenY: number): void;
  panBy(dx: number, dy: number): void;
  fitView(size?: { w: number; h: number }): void;
  focusNode(nodeId: string, size?: { w: number; h: number }): void;
  // 锁 / 钉住
  tryLock(nodeId: string): Promise<void>; releaseLock(nodeId: string): Promise<void>;
  lockHolder(nodeId: string): string | null; heartbeat(): Promise<void>;
  setPinned(nodeId: string | null): Promise<void>;
  // 生命周期
  startTimers(): void; stopTimers(): void; dispose(): Promise<void>;
}
```

> **更新（2026-10-26，并行开发中补齐）**：`setNodeField` / `setNodesField` / `alignNodes` /
> `setPinned` / `canvasId` 是后补的。原契约只有 params 写入通道，检查器的"公共区"
> （名称/宽度/Z序/状态/分组）与"钉住"无处落地——直接改 node 字段会漏脏标记，
> 静默丢改动。补齐后**统一走方法，不要手改 node 字段**。

### 关键：`canvas.css` 必须在 `nuxt.config.ts` 里挂载

```ts
css: ["~/assets/css/tokens.css", "~/assets/css/canvas.css"],
```

顺序不能反（canvas.css 用 var() 引 tokens 的层二令牌）。
**漏了这行，typecheck/lint 全绿但运行时所有 `cv-*` 类与 `--cv-*` 变量都不存在**——
这是本次并行开发中两个 teammate 独立踩到的同一个坑（2026-10-26）。

---

## 1. `CanvasNode.vue`（Lead 负责）

节点卡片。**纯展示 + 冒泡事件**，不做拖拽（拖拽在编辑器画布层做，因为要处理多选/吸附）。

```ts
props: {
  node: CanvasNodeDto;
  selected: boolean;
  connecting: boolean;      // 处于连线模式
  connectSource: boolean;   // 本节点是连线起点
  lockHolder: string | null; // 他人持锁者 userId
}
emits: {
  pointerdown: (ev: PointerEvent) => void;   // 编辑器接管拖拽
  select: () => void;
}
```

渲染要求：
- 宽度用 `node.width ?? NODE_TYPE_META[type].width`
- 头部：类型图标 + 类型名 + 锁标记；右侧显示 `status` 徽标（生成中/完成）
- 主体：按类型渲染**摘要**（文本节点显示 prompt 前 3 行；image/video 显示 prompt + mode/settings 摘要；audio 显示 audioKind；table 显示 sheet 数；clip 显示镜头数；script 显示 runPhase + shotCount；asset 显示 activeTab；director/3D/group 显示对应字段）
- 选中态：品牌色描边 + 外发光
- 他人持锁：半透明 + 锁图标

---

## 2. `CanvasInspector.vue`（Teammate: inspector）

右侧检查器面板。**唯一负责参数编辑**的组件。

```ts
props: {
  editor: CanvasEditor;   // 直接传 composable 返回值（画布编辑器只有一个实例，无需再拆 props）
  width: number;          // 面板宽度，由父级控制（可拖拽调宽）
}
emits: {
  close: () => void;
}
```

必须覆盖的能力：
1. 未选中时：显示画布概览（节点数/连线数/分组数 + 操作提示）
2. 单选时：节点属性表单，**按 `node.node_type` 渲染不同面板**（11 种全覆盖，字段见 §5）
3. 多选时：批量操作（批量改 status、批量删除、批量对齐 x/y）
4. 公共区（所有类型都有）：名称、X、Y、宽度、Z 序、状态、分组归属
5. 连线区：列出该节点的进出连线，可删除
6. 底部操作：连线模式切换、复制节点、删除节点、钉住节点

**参数写入必须走 `editor.setNodeParam` / `editor.setNodeParamPath`**，不要直接改 `node.params`（否则脏标记不生效）。

---

## 3. Chrome 组件（Teammate: chrome）

### 3.1 `CanvasTopBar.vue`

```ts
props: {
  title: string;
  version: number;
  dirty: boolean;
  saving: boolean;
  canUndo: boolean;
  canRedo: boolean;
}
emits: {
  back: () => void;
  rename: (title: string) => void;   // 失焦/回车提交
  save: () => void;
  reload: () => void;
  undo: () => void;
  redo: () => void;
  history: () => void;               // 打开历史版本
}
```

### 3.2 `CanvasToolbar.vue`（左侧竖排）

```ts
props: { mode: "select" | "connect" | "pan"; activeCount: number }
emits: {
  "update:mode": (m: "select" | "connect" | "pan") => void;
  add: (type: CanvasNodeType) => void;   // 点「+」后从弹出面板选类型
  layers: () => void;                    // 图层（占位，弹 toast 说明未实现）
}
```

### 3.3 `CanvasDock.vue`（底部悬浮条：缩放 + 视图 + 小地图开关）

```ts
props: { zoom: number; minimapOpen: boolean }
emits: {
  zoomIn: () => void;
  zoomOut: () => void;
  setZoom: (z: number) => void;
  fitView: () => void;
  organize: () => void;
  "toggle:minimap": () => void;
}
```

### 3.4 `CanvasEmptyGuide.vue`（空画布引导）

```ts
props: { tutorialOpen: boolean }
emits: {
  select: (type: CanvasNodeType) => void;   // 点 chip 建节点
  "toggle-tutorial": () => void;
  "select-tutorial": (key: string) => void;
}
```

必须复刻参照站结构（`_acceptance/ref-authed/canvas.html`）：
- 主文案：`双击画布 / 单击 Tab` 白字 700 + `自由生成节点，一步步将创意变成现实` 灰字
- 两行 chip：`文本 表格 图像 视频 音频 视频合成` / `剧本拆资产 剧本拆分镜 新手引导⌄`
- chip 高 36、圆角 8、底 `#191A21`、1px 边框、间距 8

### 3.5 `CanvasMinimap.vue`

```ts
props: {
  nodes: CanvasNodeDto[];
  viewport: { x: number; y: number; zoom: number };
  stage: { w: number; h: number };
}
emits: { jump: (worldX: number, worldY: number) => void }
```

---

## 4. 页面（Teammate: shell / Lead）

### 4.1 `pages/canvas/index.vue`（Teammate: shell）

画布列表。独立布局 `blank`（无侧栏）。要求：
- 卡片网格 + 缩略图（用节点数/连线数画一个极简缩略示意，不要假图）
- 新建 / 打开 / 重命名（inline 编辑）/ 删除（二次确认）
- 空态：`EmptyState` + 「新建画布」
- 分页

### 4.2 `pages/canvas/[id].vue`（Lead）

编辑器主壳：全屏 + 视口变换 + 拖拽 + 框选 + 连线 + 快捷键 + 集成上面所有组件。

### 4.3 `layouts/blank.vue`（Teammate: shell）

无侧栏无顶栏的裸壳，只包 `<slot />`。`app.vue` 里把 `/canvas` 归到 `blank`，`nuxt.config.ts` 里给 `/canvas` 与 `/canvas/**` 加 `ssr: false`。

---

## 5. 各节点类型的参数字段（严格按 `rea-reelmate/cli-skill/.../node.md`）

| type | 字段 |
|---|---|
| `text` | `prompt`(str) `model`(str) `count`(int) `richText`(JSON: `{format:"plain"\|"markdown",...}`) |
| `image` | `mode` 枚举 `text2image\|image2image\|multi_reference\|upscale\|crop\|outpaint\|inpaint\|erase\|panorama\|multi_angle_360\|panorama_360\|lighting\|multi_camera_grid_9\|story_grid_4\|story_grid_9\|story_grid_25`；`prompt` `model` `count` `settings`(JSON: `ratio`/`quality`/`imageQuality`/`width`/`height`) |
| `video` | `mode` 枚举 `text2video\|image2video\|first_frame\|first_last_frame\|video_reference\|universal_reference\|video_extend\|video_clip\|video_upscale\|de_subtitle_auto\|de_subtitle_region\|frame_capture\|video_edit`；`prompt` `model` `count` `settings`(JSON: `ratio` 16:9/9:16/1:1/4:3/3:4；`resolution` 480p/720p/1080p/2K/4K；`duration` `enableSound` `mouthDrive` `shotType` `offPeak` `fps`) |
| `audio` | `audioKind` `voiceover\|music\|sfx\|ambient`；`prompt` `model` `duration`(num) `count`(int) `voice`(JSON: `voiceId`/`voiceName`/`tone`/`speed`/`pitch`/`volume`/`loop`...) `previewPlaybackRate` |
| `table` | `table`(JSON: `active_sheet_id` `sheet_selection_required` `source.type` `manual\|excel_import\|project_episode_import` `sheets`) |
| `script` | `runPhase` `storyboard\|asset_match`；`prompt` `sourceText` `model` `shotCount`(int) `columns`/`spawnConfig`/`upstreamRefs`(JSON) |
| `asset` | `sourceText` `model` `extractCredits`(num) `activeTab` `character\|scene\|prop`；`spawnConfig`/`upstreamRefs`(JSON) |
| `clip` | `shotOrder`(节点 ID 数组) `exportSettings`(JSON: `exportTarget` `canvas\|local`；`resolution` 480p/720p/1080p；`format` mp4/webm) `timeline`(JSON) `previewPlaybackRate` |
| `director` | 无专属参数（只有通用 `isReference`/`referenceRole`/`referenceLabel`） |
| `threeDWorld` | 复用 image 结构 + `worldInputIsPano`(bool) |
| `group` | `title` `color` `childNodeIds` `width` `height` `collapsed` `locked` `serverGroupId` |

---

## 6. 硬性约束（违反会返工）

1. **不新增 npm 依赖**（不引 X6/vue-flow/dagre/图标库）；现有 `vue`/`nuxt`/`three`/`qrcode` 之外一律自己写。
2. **不写死色值**：用 `assets/css/canvas.css` 的 `cv-*` 与 `tokens.css` 的层二语义令牌。唯一例外是 `canvas.css` 里已定义的常量。
3. **不碰别人的文件**（见任务 write_scopes）。需要改公共文件先找 Lead。
4. **中文注释**，且注释解释"为什么这么做"，不复述代码。
5. `<script setup lang="ts">`，TS strict，props 用类型声明，emits 用类型声明。
6. **空态/加载态/错误态**三态必须齐全，不能只有 happy path。
7. 组件根元素带语义 class（如 `.canvas-inspector`），便于 E2E 选择器稳定。
