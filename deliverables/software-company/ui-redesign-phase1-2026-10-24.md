# UI 重构 · 第一阶段（设计系统 + 工作台壳 + 基础设施修复）

> 2026-10-24 · 依据竞品 **ReelMate（万兴剧厂）** 实测界面证据重构。
> 证据来源：`rea-reelmate/`（逆向素材包）+ 线上抓取 `https://www.reelmate.cn/` 的 CSS（2412 个 CSS 变量解析）。

## 一、竞品视觉基线（实测，非推测）

| 项 | 竞品实测值 | 本项目采用 |
|---|---|---|
| 品牌紫 | `--color-brand-solid-primary: #7e70ff` | `--brand-500: #7e70ff`（含 50–950 全梯度） |
| 强调紫 | pink-purple-60 `#af5fff` | `--accent-500` |
| 深色背景 | base `#000` / layout `#141414` / container `#1f1f1f` / elevated `#333` | `--dark-*` 全套 |
| 前景 | `#fff0` / `#ffffffb8` / `#ffffff8f` | `--text-inverse{,-2,-3}` |
| 圆角 | xs .125 → 3xl 1.5rem（7 级） | `--radius-xs → --radius-3xl` 同值 |
| 阴影 | sm/md/lg/xl 4 级黑 alpha 叠加 | `--shadow-sm → --shadow-xl` 同值 |
| 字号 | xs .75 → 5xl 3rem + 行高比 | `--text-xs → --text-5xl` 同值 |
| 字体 | HarmonyOS Sans + 等宽栈 | `--font-sans`（HarmonyOS Sans 优先） |
| 动效 | ease-in/out/in-out 三档 | `--ease-*` 同值 |
| 信息架构 | 短剧工作流 / 工具矩阵 / 资产 / 积分 + 侧栏 | 侧边栏 216px 分组导航（创作/资源/账户） |

## 二、本阶段交付

### 设计系统（`assets/css/tokens.css`，61 → 380 行）
- 品牌紫 10 阶 + 强调色 + 语义色（success/warning/danger/info）；
- 深色表面层（营销页）+ 浅色表面层（工作台）双主题；
- 文本 4 阶、边框 3 阶、圆角 7 阶、阴影 4 阶、字号 9 阶、间距 8 阶、动效 3 档、层级 5 档；
- 全局 focus-visible、scrollbar、selection 规范。

### 组件层
- 重写：`Button`（5 变体 × 3 尺寸 × loading/block）、`Modal`（Teleport + 动画 + footer 插槽）、`TextField`（label/hint/error/required）；
- 新增：`Card`（header/slot/actions）、`Tag`（6 tone × 2 尺寸）、`Progress`、`EmptyState`、`Skeleton`（shimmer）、`SelectField`、`TabBar`、`TextAreaField`（计数）。

### 布局系统
- `layouts/default.vue`：深色营销布局（竞品同款 `#000`）；
- `layouts/app.vue`：浅色工作台布局（侧边栏 216px + 顶栏 56px + 积分/昵称区），与竞品登录后 IA 对齐；
- `app.vue` 按路由自动切换布局；16 个页面完成令牌迁移（224 处旧变量）。

### 顺带修复的 3 个真实缺陷
1. **nginx upstream 缓存旧 IP**：容器重建后 IP 变化 → 全站 502。改为 `resolver 127.0.0.11` + 变量运行时重解析。
2. **Nuxt SSR 代理目标错误**：`NUXT_API_PROXY` 默认 `127.0.0.1:3000`（容器内指向自己）→ 502。改为构建期注入 `http://api:3000`（Dockerfile ARG + compose build args）。
3. **工作台页 hydration mismatch**：侧边栏登录态内容 SSR 空/客户端有值。改用 `ClientOnly` 包裹登录态区域。

## 三、验证

```
逐页检查（全新页面、独立 console 监听）：
  /  /login  /terms  /privacy  /report
  /projects  /tasks  /assets  /credits  /settings  /pricing
  /create/text-to-video  /create/image-to-video
  → 全部 clean（0 error / 0 warning）
工作台页：sidebar=true, width=216, bg=rgb(255,255,255), overflow=0
深色页：marketing bg=rgb(0,0,0), text=rgb(255,255,255)
```

## 四、下一步

1. 业务组件层：`TaskCard` / `ModelPicker` / `StoryboardTable` / `CreditsBadge` / `PipelineStepper`；
2. 流水线页 1:1 复刻竞品「向导 + 分镜工作台 + 批量面板」；
3. 任务/资产/积分页用新组件重做；
4. 落地页深色复刻（Hero / 能力矩阵 / 作品展示）；
5. 响应式与可访问性回归 + 截图验收。
