# 前端架构与规范

> v1.1 · 2026-10-24 · apps/web (Nuxt 3) + packages/shared + packages/ui(可选)
> 架构参照竞品已验证形态〔RM-证据：前端技术栈章节〕：SSG 落地页 + SPA 应用壳、vendor 分包、自建组件层
> v1.1 变更：ModelPicker 改目录驱动（mode_order/scene/枚举校验/批量报价），任务轮询补 reviewing 态（RE-03/RE-05）

## 1. 目录结构

```
apps/web/
  app.vue · error.vue          # app.vue 按路由切换布局（见 §2 布局表）
  layouts/
    default.vue                # 深色营销壳（落地页/登录/协议/分享），与竞品同底 #000
    app.vue                    # 浅色工作台壳（侧边栏 216px + 顶栏 56px + 内容区）
    tool.vue                   # 工具页双栏壳（参数面板 | 预览），无侧栏
  pages/            # 文件路由，与 PRD §4 能力项一一对应
    index.vue                  # 落地页（导航/Hero/双工作流/能力矩阵/流程/页脚）
    home.vue                   # 工作台首页（对齐竞品 App 首页：双入口卡+工具矩阵+案例墙）
    works.vue                  # 作品库（PRD F9）：四态聚合、示例模板、续做、归档
    projects/index.vue         # 全部项目（卡片网格 + 新建弹窗）
    projects/[id].vue          # 流水线工作台（步骤条 + 分集栏 + 舞台）
    create/[tool].vue          # 工具页统一骨架(参数面板|预览|历史 三栏)
    tools.vue · tasks.vue · assets.vue · credits.vue · pricing.vue · settings.vue
    login.vue · terms.vue · privacy.vue · report.vue
    share/[token].vue          # 公开分享页（只读 + 举报入口）
    admin.vue                  # 运营后台（独立鉴权）
  components/                  # 平铺，文件名即组件名（Nuxt 自动注册）
    Button · Modal · TextField · TextAreaField · SelectField · TabBar
    Card · Tag · Progress · EmptyState · Skeleton
    ToastHost · OnboardingBar
  composables/
    useAuth · useApi · useToast · useTaskPolling · useUpload · useTrack
  middleware/auth.global.ts    # 需登录页未登录 → 跳 /login?redirect=
  assets/css/tokens.css        # 设计令牌（三层：原始值 → 语义 → 组件用）
```

### 布局选择规则

| 路由 | 布局 | 说明 |
|---|---|---|
| `/` `/login` `/terms` `/privacy` `/report` `/share/*` | `default` | 深色营销壳 |
| `/home` `/works` `/projects` `/projects/*` `/tasks` `/assets` `/credits` `/settings` `/pricing` `/admin` | `app` | 浅色工作台壳 |
| `/create/*` | `tool` | 双栏工具壳 |

> **SSR 策略**：所有数据驱动的工作台页在 `nuxt.config.ts` 的 `routeRules` 中显式设 `ssr: false`。
> 原因：`definePageMeta({ ssr:false })` 对直接 URL 访问不足以保证首帧一致，会导致 hydration mismatch（已实测）。


## 2. 关键约定

| 项 | 约定 |
|---|---|
| 语言 | TS strict；API 类型一律 import 自 `packages/shared`，**禁止手抄接口类型** |
| 组件 | `<script setup lang="ts">`；props 用类型；事件 emit 声明 |
| 样式 | Tailwind 原子类为主；复杂组件允许 scoped CSS；设计令牌见 §4 |
| 请求 | 统一 `$api` 封装（信封解包、401 静默 refresh 单飞、错误码→文案映射表）；业务代码只见 data，不见信封 |
| 状态 | 服务端数据用 composables + pinia store；跨页共享仅 auth/credits/models/tasks |
| 路由守卫 | middleware/auth：需登录页未登录 → 弹登录并暂存目标（PRD F1 验收） |
| 乐观 UI | 余额/任务状态禁乐观更新（与计费强一致）；点赞/标签可乐观 |

## 3. 核心交互模块规格

### useTaskPolling（竞品同款模式〔RM-证据：useTaskPolling 反编译〕）

```
- 5s 间隔批量 GET /tasks?ids=<在途任务>（RE 同节奏）
- 状态机: pending→running→reviewing→done|failed|timeout(前端视角；reviewing=供应商审核中)
- 页面隐藏>30s 自动降频至 30s，visibilitychange 恢复
- 任务成功 → 刷新余额(竞品 refreshCreditsAfterTasksDone 同思路)+ SSE 不可用时的兜底
```

### useUpload（OSS 直传）

```
POST /files/upload-token → STS → 浏览器分片直传(进度条) → POST /files/complete
限制前端先校验(类型/大小)，服务端 complete 再嗅探兜底
```

### ModelPicker（数据驱动）

模型列表来自 `GET /models?mode=`，按 `mode_order[mode]` 升序（缺键排后）；表单控件由 `modes[mode]`（及流水线 `scene_modes[scene]`）元数据渲染（durations/ratios/resolution_options/counts/media_limits），**新模型上架零前端改动**（竞品目录驱动同思路〔RM-证据：_models.md〕）。禁止在前端写死时长/画幅/分辨率档位；提交值与展示 label 分离（`value` 提交、`label` 展示）；模型切换后清空下游选项并按新模型重列。批量投递前调 `/credits/quote/batch` 取预算默认值。

## 4. 设计令牌（三层体系，`assets/css/tokens.css`）

> 基线来源：竞品 ReelMate 线上 CSS 实测（2412 个 CSS 变量解析，2026-10-24）。品牌色与其保持一致。

### 4.1 层一：原始值

| 组 | 令牌 | 值 |
|---|---|---|
| 品牌紫 10 阶 | `--brand-50 … --brand-950` | `#f2f0ff → #1a1452`，主色 `--brand-500: #7e70ff`（竞品 `--color-brand-solid-primary`） |
| 强调紫 | `--accent-400/500/600` | `#cf9fff / #af5fff / #8c4ccc` |
| 语义色 | `--success/warning/danger/info` + `-bg` | 绿/黄/红/蓝成对 |
| 深色表面 | `--dark-base/layout/container/elevated/overlay/spotlight` | `#000 / #141414 / #1f1f1f / #333 / #292929 / #3d3d3d`（竞品同值） |

### 4.2 层二：语义

| 组 | 令牌 | 说明 |
|---|---|---|
| 浅色表面（工作台） | `--bg-app/surface/raised/sunken/hover/active` | `#f6f7f9 / #fff / …` |
| 文本 | `--text-1/2/3/4` + `--text-inverse[-2/-3]` | 深色文字 / 深底反白文字 |
| 边框 | `--border-1/2/3` + `--border-inverse[-strong]` | |
| 圆角 | `--radius-xs … --radius-3xl` + `--radius-full` | 7 级 + full，与竞品同值 |
| 阴影 | `--shadow-sm/md/lg/xl` + `--shadow-brand` | 4 级黑 alpha 叠加 |
| 字号 | `--text-xs … --text-5xl`（含 `-lh` 行高） | 9 级 |
| 间距 | `--space-1 … --space-20` | 4px 基准 |
| 动效 | `--ease-in/out/in-out` + `--duration-fast/base/slow` | 3 档缓动 + 3 档时长 |
| 层级 | `--z-header/dropdown/drawer/modal/toast` | 5 档 |
| 布局 | `--header-h: 56px` `--sidebar-w: 216px` `--content-max: 1440px` | |

### 4.3 层三：使用约定

- 组件与页面**只允许引用层二语义令牌**，不得直接写死色值（品牌定稿后仅改层一）；
- 深色营销页用 `--dark-*` + `--text-inverse-*`；浅色工作台用 `--bg-*` + `--text-1..4`；
- 字体：`--font-sans`（HarmonyOS Sans → PingFang SC → 微软雅黑），等宽用 `--font-mono`。

## 5. 性能预算（对照竞品现状设定）

| 指标 | 预算 | 手段 |
|---|---|---|
| 落地页 LCP | ≤2.0s | SSG + CDN；首图 preload |
| 应用壳首屏 JS | ≤300KB gz（竞品约 2.5MB，赢在这里） | 工具页路由级懒加载；vendor 手动分包(vue/pinia/i18n) |
| 生成页可交互 | ≤3s | 参数面板骨架屏 |
| 轮询开销 | 单活页 1 req/5s | useTaskPolling 批量化 |
| 视频/图片 | 全走 CDN 预签名 | 不进应用域 |

分包配置参照竞品 chunk 策略（vendor-vueuse/vendor-lodash 等独立 chunk〔RM-证据：bundle 分析〕），我们收敛为 3 个 vendor chunk 起步。

## 6. 可访问性与 SEO 基线

- 落地页 SSG + 完整 meta/OG；工具页 SPA(noindex)；
- 全部可交互元素可键盘触达；弹窗焦点圈定；
- 图片 alt 必填；色彩对比 ≥4.5:1。

## 7. i18n 预留

MVP 仅 zh-CN，但文案 **不得硬编码**：一律 `t('key')`；竞品 5 语言路由前缀方案（/en /ja…）作为 Ph3 出海时的实现参考〔RM-证据：路由表 i18n 前缀〕。
