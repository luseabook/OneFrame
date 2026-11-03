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
  composables/               # 现状：useAuth · useApi · useToast · useI18n · useActiveSpace
                             #      useAdminApi · useAdminMenu · useEnsureTeamSpace
                             #      useCanvasApi · useCanvasEditor · useCanvasAgent
                             # 规划中（尚未落地）：useTaskPolling · useUpload · useTrack
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
| 语言 | TS strict；API 类型一律 import 自 `packages/shared`，**禁止手抄接口类型**。现状例外：`apps/web/types/api.ts`（约 2100 行、197 个导出类型）仍是手写契约，属待收敛债务，不是规范许可 |
| 组件 | `<script setup lang="ts">`；props 用类型；事件 emit 声明 |
| 样式 | Tailwind 原子类为主；复杂组件允许 scoped CSS；设计令牌见 §4 |
| 请求 | 统一 `$api` 封装（信封解包、401 静默 refresh 单飞、错误码→文案映射表）；业务代码只见 data，不见信封 |
| 状态 | 服务端数据用 composables + pinia store；跨页共享仅 auth/credits/models/tasks |
| 路由守卫 | middleware/auth：需登录页未登录 → 弹登录并暂存目标（PRD F1 验收） |
| 乐观 UI | 余额/任务状态禁乐观更新（与计费强一致）；点赞/标签可乐观 |

## 3. 核心交互模块规格

### useTaskPolling（规划中；当前轮询逻辑仍内联在页面/`useCanvasAgent`）

```
- 5s 间隔批量 GET /tasks?ids=<在途任务>（RE 同节奏）
- 状态机: pending→running→reviewing→done|failed|timeout(前端视角；reviewing=供应商审核中)
- 页面隐藏>30s 自动降频至 30s，visibilitychange 恢复
- 任务成功 → 刷新余额(竞品 refreshCreditsAfterTasksDone 同思路)+ SSE 不可用时的兜底
```

### useUpload（规划中；当前上传走 `/assets/upload` base64 接口，尚无 OSS 直传）

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

## 8. SSR 口径（2026-11-03 裁定，替代「所有顶层路由一律 ssr:false」）

**背景**：旧守卫 `apps/api/test/web-route-rules.spec.ts:57` 要求 `pages/` 下**每个**顶层路由都必须
`routeRules: { ssr: false }`。这条规则是为修 `/team`、`/share` 的「首帧与客户端不一致 → 整页空白」而设，
但把 `/terms`、`/privacy`、`/report` 一并关掉后，**合规页对爬虫与监管抓取只剩一个 SPA 骨架**，
而 sitemap 又列了它们 —— 内容与声明不一致。

**裁定：分两类显式清单，未分类即红。**

| 类别 | 路由 | 理由 |
|---|---|---|
| **必须服务端渲染（ssr 不为 false）** | `/`（SEO 入口）、`/terms`、`/privacy`、`/report` | 内容不依赖登录态与异步数据，SSR 是纯收益；且属「法律义务展示」，需可抓取、可审计、可公证 |
| **必须 `ssr: false`** | 其余全部顶层路由（含 `/share`、`/canvas`、`/create`、`/team`、`/works`…） | 鉴权靠内存 token + refresh Cookie，服务端无会话 → 服务端渲染必然首帧空白；`/share` 内容依赖异步接口，首帧一致优先于抓取 |

**守卫要求（Backend 改 spec，与 Frontend 改配置同一 PR 落地）**

1. 两份清单必须**恰好覆盖** `pages/` 的顶层路由全集：多一个（新增未分类）少一个（清单过期）都判红；
2. 清单 1 的路由：`routeRules` 中不得有 `ssr: false`，且页面 `definePageMeta` 不得含 `ssr: false`；
3. 清单 2 的路由：必须存在 `"/x"` 或 `"/x/**"` 的 `{ ssr: false }`（允许两形态任一）；
4. 根路由 `""` 保持非 `ssr:false`（旧守卫已有此断言，保留）。

**已知取舍（本轮不改，登记在案）**：`/pricing` 现为 `definePageMeta({ ssr: false, requiresAuth: true })`。
定价页是营销入口、本应可抓取，但它被要求登录后可见 —— 属产品口径问题，非工程缺陷；
若改为公开可抓取，同 PR 需把它移入清单 1 并去掉 `requiresAuth`。

### 8.1 法律页的多语言口径（2026-11-03 裁定：只标中文）

开 SSR 后暴露的问题：`curl -H "Accept-Language: en-US" /terms` 返回 `<html lang="en">` + 英文 `<title>`，
**正文仍是中文**。而 `i18n/index.ts` 的 `PUBLIC_PATHS` 把 `/terms` `/privacy` `/report` 一并列进
5 语言 sitemap + hreflang —— 等于对外声明有 5 个语言版本，实际只有一个。

**裁定：只有 `/terms` `/privacy` 两页声明 `zh-CN`**（法律文本现实中只有中文版具效力，翻译版还要重新法务，本轮不做）。

**`/report` 不在其列（2026-11-03 修正）**：它是投诉**表单**而不是法律文本，且已完全 i18n 化
（20 处 `t()`、模板零硬编码中文）。强加 `lang=zh-CN` 会把一个本来正确的多语页面改成错的。
→ 收窄为两页；`/report` 与 `/` `/pricing` `/login` 一样保留 5 语 hreflang。

1. `page lang` 固定 `zh-CN`：内容语言即声明语言，不随 `Accept-Language` 漂；
2. sitemap / hreflang 只列 `zh-CN` 一条（其余 4 语不再列这两页，避免虚假声明）；
3. 非中文界面进入这两页时，页首用当前 UI 语言显示一行「本页法律文本以中文版为准」（5 语各一条）；
4. `/` `/pricing` `/login` `/report` 保留 5 语 hreflang。

**验证**：`curl -H "Accept-Language: en-US" /terms` 的 `<html lang>` 必须是 `zh-CN`；
`/sitemap.xml` 里 `/terms` `/privacy` 各只出现 1 次且 alternate 只有 `zh-CN`，
而 `/report` 仍出现 5 次（5 语）。

**静态化（`nuxt generate`）的定位**：2026-11-03 实测可行（15 条 prerender、`.output/public` 4.1M），
但会丢掉 `server/routes/robots.txt` 与 `sitemap.xml`、把 sitemap origin 固化成构建机地址、深链要靠
`try_files … /200.html`。结论：**验收环境走 node server；静态化只作为内存撑不住时的降级预案**，
启用前必须先补 `nitro.prerender.routes` 与 `NUXT_PUBLIC_SITE_URL` 兜底。

## 9. 信封与鉴权判决的唯一入口（2026-11-03）

**背景**：本仓 API 的信封是 **HTTP 200 + `code` 业务码**（未登录返回 `code:401101`，不是裸 401）。
因此“未登录/失败”只能从 `code !== 0` 判出来，**`catch` 只能抓到抛错**。
任何一处只看 HTTP 状态码、或只看 `access_token` 是否存在就放过的代码，都会把 401101 当成功——
这类缺陷的表现是“静默”（横幅不显示、登录态错乱），而不是报错。

**判决入口共三处（按客户端类型分，不是“到处各判一次”）**

| 包装 | 位置 | 适用 |
|---|---|---|
| 用户态 `call()` | `composables/useAuth.ts:43` | 登录用户的 `/v1/**`；`code !== 0` 即抛错，`doRefresh()` 的 `catch { return false }` 接的就是它 |
| 通用 `useApi` | `composables/useApi.ts:52` | 业务数据请求 |
| 管理端 `useAdminApi` | `composables/useAdminApi.ts:83` | `/v1/ops/**`（独立 `admin_token`，不走用户 Cookie） |

**已登记的两处页面级例外（不得再新增，除非在此登记）**

| 位置 | 为什么例外 |
|---|---|
| `pages/login.vue:84`（发码） | 登录前无用户态、且要读 `data.debug_code` 做开发态提示，并区分“发码失败”文案 |
| `pages/admin/login.vue:37`（管理员登录） | 管理端独立口令与 token 存储（`localStorage.admin_token`），不属用户态包装范围 |

**规则**：新增代码**不得**在页面/组件里直接用 `$fetch` 判 `code`；需要例外时在本节登记「文件:行 + 理由」，
并说明为什么不能用现有三个包装。**判定入口必须可枚举**——这是“未登录不算失败”这类静默缺陷的唯一防线。
