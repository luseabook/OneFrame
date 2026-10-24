# 前端架构与规范

> v1.1 · 2026-10-24 · apps/web (Nuxt 3) + packages/shared + packages/ui(可选)
> 架构参照竞品已验证形态〔RM-证据：前端技术栈章节〕：SSG 落地页 + SPA 应用壳、vendor 分包、自建组件层
> v1.1 变更：ModelPicker 改目录驱动（mode_order/scene/枚举校验/批量报价），任务轮询补 reviewing 态（RE-03/RE-05）

## 1. 目录结构

```
apps/web/
  app.vue · error.vue
  pages/            # 文件路由，与 PRD §5 页面清单一一对应
    index.vue                  # 落地页(SSG, ISR 1h)
    create/[tool].vue          # 工具页统一骨架(参数面板|预览|历史 三栏)
    tasks/ · assets/ · pricing/ · settings/
  components/
    ui/              # 基础组件(Button/Modal/Select…，Tailwind 实现)
    biz/             # 业务组件(PromptEditor/ModelPicker/TaskCard/CreditsBadge…)
  composables/
    useAuth · useCredits · useTaskPolling · useUpload · useTrack · useCaptcha
  stores/            # Pinia: auth · credits · models · tasks · assets
  locales/zh-CN.json # i18n 预留(vue-i18n, MVP 只 zh-CN)
  plugins/ · middleware/
```

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

## 4. 设计令牌（最小集）

```css
--color-primary: #6C5CE7;      /* 品牌主色(暂定, 品牌定稿后更新) */
--color-bg / --color-surface / --color-border
--text-1/2/3                    /* 主/次/弱 */
--radius-s 6px / --radius-m 10px / --radius-l 16px
间距 4 的倍数；字号 12/13/14/16/18/22/28
暗色模式：MVP 不做，令牌先行(用 CSS vars 包一层)
```

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
