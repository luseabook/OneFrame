# OneFrame（一帧 / 万星）· 竞品视觉基线 v2

> 用途：为代码层 UI 对齐提供**可直接落地的视觉事实与偏差清单**。
> 范围：只做视觉/设计系统层（token、组件视觉、动效），不做页面结构复刻（那是 02 文档）。
> 取证时间：本次会话；竞品 = ReelMate（万星剧厂 www.reelmate.cn）登录态。
> 我方代码基线：`E:/wanxing/app/apps/web`（Nuxt 3 + 手写 CSS，无 Tailwind）。

---

## 0. 证据路径（已与主理人核对一致）

一手 CSS 变量与样式表在 **`_acceptance/reelmate/`**（不在 `rea-reelmate/reelmate/`，该路径为空）：

```
E:/wanxing/_acceptance/reelmate/vars.json        (150 KB，2412 个 CSS 变量 × 观测值数组)
E:/wanxing/_acceptance/reelmate/style-0.css      (302 KB，含全部 @theme / :root 定义)
E:/wanxing/_acceptance/reelmate/style-1..8.css   (8 个附加样式表)
E:/wanxing/_acceptance/reelmate/inline-*.css     (21 个内联样式表)
E:/wanxing/_acceptance/reelmate/index.html       (414 KB，已渲染 DOM 快照)
```

本文全部数值均按此路径取证。

三套令牌体系并存（同页共存，落地只取一套映射）：
`--background-*`（应用自有，决定壳层）/ `--mi-*`+`--fill-*`+`--text-*`（Mimosa 组件库，决定文本与填充）/ `--color-*`+`--palette-*`（250 个语义色，用于弹层与工作流节点）。

截图证据：
- 竞品 `_acceptance/ref-authed/`（1600×1000）、`_acceptance/ref2/`（1440×900）、`rea-reelmate/*.png`
- 我方 `_acceptance/ui-align/current/`（1600×1000，已登录）、`_acceptance/align-*.png`（1440×900 旧档）

> 注：任务书原述我方截图为 1084×625，实测新旧两档分别是 1440×900 与 1600×1000，本文按真实尺寸比对。

---

## 1. 证据清单与可信度分级

| 级别 | 含义 | 本次使用的证据 |
|---|---|---|
| ✅ | 一手实测：CSS 变量定义 / 像素量测（附坐标） | `vars.json`、`style-0.css`、PIL 逐像素扫描 |
| 🟡 | 从截图推断（几何可量、语义靠猜） | 由色块/文字包围盒反推字号、动画时长 |
| ❌ | 无证据（本文明确标注，不填猜测值） | 抽屉、Toast、分镜卡、悬停动效曲线 |

### 1.1 关键结论的证据锚点

| 结论 | 证据 | 级别 |
|---|---|---|
| 页面 chrome 底 = `#0B0B10` | `style-0.css` `body{background-color:#0b0b10}`；`--background-base:#0b0b10`；像素 `task.png(1590,300)`=`#0b0b10` | ✅ |
| 240px 侧栏底 = `#101015` | 像素 `task.png(100,300)`=`#101015`，侧栏横向 x0–x239 | ✅ |
| 侧栏右分隔 1px = `#25262F` | 像素 `task.png(239,300)`=`#25262f` | ✅ |
| 内容容器面板 = `#191A22`，圆角 12px | 像素 `task.png` x240–1589 / y64–977；左上角曲线 y64 左缘 x=251 → y75 x=240 | ✅ |
| 内容面板内缩：右 10px、下 22px | 像素 x1589→1590 变色；y977→978 变色 | ✅ |
| 顶栏 64px，且本身无独立底色 | 像素 `task.png(800,y0–63)` 全为 `#0b0b10` | ✅ |
| 顶栏胶囊高 40px、圆角全圆（r=20） | 像素 `task.png`：创作手册胶囊 y11–52、x918–1025；左缘 y11 x=935 → y28 x=918 | ✅ |
| 顶栏控件间距 7–8px | 像素 x 段：918–1025 / 1032–1139 / 1146–1187 / 1194–1235 / 1242–1461 / 1468–1528 / 1540–1571 | ✅ |
| 头像 32×32 圆形 | 像素 `task.png` x1540–1571 / y16–47 | ✅ |
| 控件圆角 = 10px（按钮 & 输入框一致） | 白按钮 `settings.png` y514 左缘 x383 → y523 x374（横跨 9–10px）；搜索框 y153 x1385 → y163 x1375 | ✅ |
| 白按钮高 40px | 像素 `settings.png` y514–553 | ✅ |
| 搜索输入框高 32px、底 `#121216`、描边 `#2E303A` | 像素 `settings.png` y153–184、x1375– | ✅ |
| Tab 选中 = 白字 + 白 2px 下划线（无左右内缩） | 像素 `settings.png`：选中"场景"文字峰值 `#ffffff`，未选"道具"`#9d9d9f`；`pricing-full.png` 下划线 y90–91、x239–303、`#ffffff` | ✅ |
| 主 CTA = `#9B46FF` 实色 | `--brand-01normal:#9b46ff`；像素 `pricing-full.png` 登录胶囊 64.4% 面积为 `#9b46ff` | ✅ |
| 分段控件选中底 = `#232328` | `--background-11bgsolid:#232328`；像素 `pricing-full.png(760,130)`=`#232328` | ✅ |
| 内层侧栏选中项底 = `#2E303B` | 像素 `novel-market.png` 区域 (30,205)-(215,235) 83.2% 为该色 | ✅ |
| 悬停/按下叠加 = 白 6% / 10% | `--background-02bg:#ffffff0f`、`--background-03bg:#ffffff1a` | ✅ |
| 竞品侧栏**没有**选中底色块 | `task.png` 侧栏区域 (0,40)-(240,110) 96.9% 为 `#101015`；各项文字峰值色同为 `#cfcfd0` | ✅ |
| 页面标题 ≈26px | 像素 `assets.png`："资""产"各 26px 宽、27px 高（x122–147 / x150–175，y96–122） | 🟡 由字宽反推 |
| 导航/Tab 字号 14px | 像素 `assets.png` "角色" 墨迹高 13px；`task.png` "首页" 墨迹高 13px | 🟡 |
| 登录弹窗为**纯白** 400×626 | 像素 `rea-reelmate/login-modal.png`(1280×720)：白色包围盒 x512–911 / y90–715 | ✅ |
| 渐变买断 CTA 48px 高 | 像素 `novel-market.png` y936–983；横向取色 `#DFD0FF`→`#B5B0FF`→`#DCD0FF` | ✅ |

### 1.2 未取证（禁止编造，实现时按我方既有惯例）

| 项 | 状态 |
|---|---|
| 抽屉 / Toast / Tooltip 的实测几何与配色 | ❌（只有 `--fill-toast-*`、`--bg-tooltip-*` 色值，无尺寸） |
| 分镜卡（storyboard card）实测规格 | ❌（`film-creation.png` 内有，但被内容图占满，量不出净样式） |
| 悬停/弹窗过渡的实际时长与曲线 | 🟡 只能取 `--default-transition-duration:.15s` 与 `cubic-bezier(.4,0,.2,1)` 作全局默认 |
| 表格行高、斑马纹 | ❌ |
| 深色/浅色双皮肤 | ❌ 竞品界面 100% 深色，只有登录弹窗是浅色 |

---

## 2. Token 基线表

### 2.1 表面 / 背景

竞品有**三套并存**的令牌体系，同页共存，取值不同源，落地时必须只用一套映射：

- `--background-*`（应用自有，20 个）→ **决定壳层**
- `--mi-*` / `--fill-*` / `--text-*`（Mimosa 组件库）→ **决定文本与组件填充**
- `--color-*` / `--palette-*`（另一套语义色，250 个）→ 主要用于弹层/工作流节点

| 用途 | 竞品值 | 证据 | 级别 |
|---|---|---|---|
| 页面 chrome（顶栏底、侧栏外底色） | `#0B0B10` | `--background-base` / `--background-01bg`；`body{background-color:#0b0b10}` | ✅ |
| 240px 侧栏 | `#101015` | 像素 `task.png(100,300)` | ✅ |
| 62px 图标栏（studio 壳） | `#131318` | 像素 `assets.png` x9–70 | ✅ |
| 内容区（无容器页） | `#0B0B10` | 像素 `pricing.png(700,600)` | ✅ |
| 内容容器面板 | `#191A22` | 像素 `task.png` x240–1589/y64–977；最接近令牌 `--background-10bgsolid #1a1a1e`（ΔB=4） | ✅ |
| 内层面板 / 内层侧栏 | `#191A22` | 像素 `novel-market.png` | ✅ |
| 内层侧栏**选中项** | `#2E303B` | 像素 `novel-market.png` (30,205)–(215,235) | ✅ |
| 实心层级 1 | `#1A1A1E` | `--background-10bgsolid` | ✅ |
| 实心层级 2（分段控件选中） | `#232328` | `--background-11bgsolid` | ✅ |
| 实心层级 3 | `#333336` | `--background-12bgsolid` | ✅ |
| 实心层级 4 | `#1E1E25` | `--background-13bgsolid` | ✅ |
| Sheet / 弹窗面板 | `#1C1D23` | `--background-sheet` | ✅ |
| 浮层（模型选择器） | `#272931` | `--background-model` | ✅ |
| 输入框底 | `#121216` | 像素 `settings.png` 搜索框 54.2% | ✅ |
| 顶栏胶囊底 | `#0A0A0E` | 像素 `task.png` 胶囊内部 29.6% | ✅ |
| 画布 / 编辑器底 | `#060608` | 像素 `workflow-canvas.png` 全屏 | ✅ |
| 悬停叠加 | 白 **6%** `#FFFFFF0F` | `--background-02bg` | ✅ |
| 按下叠加 | 白 **10%** `#FFFFFF1A` | `--background-03bg` | ✅ |
| 强叠加 1 | 白 **16%** `#FFFFFF29` | `--background-04bg` | ✅ |
| 强叠加 2 | 白 **24%** `#FFFFFF3D` | `--background-05bg` | ✅ |
| 遮罩 | 黑 70% `#000000B2`；浮层遮罩 80% `#000C` | `--background-13bg07`；`--mi-component-mask-primary` | ✅ |
| Mi 语义底（备用） | `#0A0A0E` / `#1D1D25` / `#282834` / `#333342` | `--bg-base-01/02`、`--bg-popup-01/02/03` | ✅ |
| 实心黑（浅色弹窗用） | `#0A0A0C` | `--text-black-primary` | ✅ |

### 2.2 文本五阶

竞品**两套五阶**，取值有差；我方已完整采用 Mimosa 那套（现值全对，不需要改）。

| 档位 | Mimosa（我方已用） | 应用自有 | 实测落点 | 级别 |
|---|---|---|---|---|
| 标题 / 主文本 | `#F5F8FF` `--mi-text-primary` | `#FFFFFF` `--text-white-primary` | 页面标题峰值 `#FFFFFF`；Tab 选中 `#FFFFFF` | ✅ |
| 正文 / 默认 | `#F5F8FF CC`（80%）`--mi-text-secondary` | `#F6F8FF CC` | 侧栏项文字峰值 `#CFCFD0`（= CC over #101015） | ✅ |
| 次要 / 说明 | `#F5F8FF 8F`（56%）`--mi-text-tertiary` | `#F6F8FF 99`（60%） | Tab 未选峰值 `#9D9D9F` | ✅ |
| 占位 / 弱说明 | `#F5F8FF 66`（40%）`--mi-text-quaternary` | `#F6F8FF 66` | — | ✅ |
| 禁用 | `#F5F8FF 3D`（24%）`--mi-text-disabled` | `#F6F8FF 33`（20%） | — | ✅ |
| 图标四态 | `#FFF9` / `#FFFC` / `#FFF` / `#FFF3`，辅助 `#FFF6` | — | `--texticon-01normal…05assistant` | ✅ |
| 语义文本色 | 错误 `#F83F3F`；信息 `#2EAAFF`；成功 `#1ED266`；警告 `#FF9933` | — | `--text-alert-*` | ✅ |
| 金色（会员/积分） | `#E1CEA6`（正文）`#DCC7A1`（弱） | — | 像素 `task.png` 顶栏金色胶囊 | ✅ |

### 2.3 边框与分隔

| 用途 | 竞品值 | 证据 | 级别 |
|---|---|---|---|
| 侧栏右分隔 | `#25262F`，1px | 像素 `task.png(239,300)` | ✅ |
| 输入框描边 | `#2E303A`，1px | 像素 `settings.png` 搜索框上下缘 | ✅ |
| 顶栏胶囊描边 | ≈ `#2C2C30`–`#303034`（白 14–16%） | 像素 `task.png` 胶囊 1px 边 | ✅ |
| 冷调透明描边阶梯（推荐主用） | `#C2CCF1` @ 4/8/12/16/20/24/28/32% = `#c2ccf10a/14/1f/29/33/3d/47/52` | `--border-trans-01…08` | ✅ |
| 实心描边阶梯 | `#1D1D25` / `#282834` / `#333342` | `--border-solid-01/02/03` | ✅ |
| Mi 组件描边 | `#DBE7FF` @ 16/24/32/40/48/56% | `--mi-component-stroke1…6` | ✅ |
| Mi 分割线 | `#DBE7FF1F` | `--mi-component-divider-basic` | ✅ |
| Mi 填充阶梯 | `#DBE7FF` @ 8/12/16/20/24/32% | `--mi-component-fill1…6` | ✅ |

> **要点**：竞品的"白 alpha 描边"其实**不是纯白**，是冷调 `#C2CCF1`（蓝白）。这是竞品深色界面"偏冷、有金属感"的关键，也解释了 `--panel-tint: rgba(194,204,241,.08)` 的由来。我方 `--border-1/2/3` 用纯白 → 偏中性、偏脏。

### 2.4 品牌色与状态色

| 用途 | 竞品值 | 证据 | 级别 |
|---|---|---|---|
| 品牌主色（实心 CTA） | `#9B46FF` | `--brand-01normal`；`--base-hue-iris-50`；像素 64.4% | ✅ |
| 主色 hover | `#A05AFF` | `--brand-02hover` = `--base-hue-iris-40` | ✅ |
| 主色 pressed | `#A564FF` | `--brand-03pressed` | ✅ |
| 主色 disabled | `#9B46FF 40%` | `--brand-04disabled` | ✅ |
| 次品牌紫（实心） | `#723FFF` | `--brand-normal` | ✅ |
| 次品牌 hover/active | `#9070FF` | `--brand-active` | ✅ |
| 次品牌 disabled | `#723FFF 30%` | `--brand-disabled` | ✅ |
| 第三紫（仅用于 alpha 填充/文字） | `#6B5CFF` @ 4→100% | `--palette-alpha-tech-purple-10…110` | ✅ |
| 紫红强调 | `#AF5FFF` / `#CF9FFF` | `--palette-function-dark-pink-purple-60/90` | ✅ |
| 品牌渐变（买断/会员 CTA） | 白 → 浅紫 → 白，量测 `#DFD0FF` / `#B5B0FF` / `#DCD0FF`，高 48px，全圆 | 像素 `novel-market.png` y936–983 | ✅ |
| Mi 购买渐变（备用） | `linear-gradient(105.22deg,#EA96FF 19.12%,#B2A7FF 80.32%)` | `--mi-gradient-buy-normal` | ✅ |
| 成功 | 文本 `#1ED266`／填充 `#0FBC5F`／hover `#0F954D`／pressed `#0D773E` | `--text-alert-success`、`base-hue-green-50/60/70` | ✅ |
| 警告 | 文本 `#FF9933`／填充 `#FF9316`／深 `#BF6803` | `--text-alert-warning`、`base-hue-orange-50/70` | ✅ |
| 危险 | 文本 `#F83F3F`／填充 `#F83F3F`／pressed `#D70909` | `--text-alert-error`、`base-hue-red-50/60/70` | ✅ |
| 信息 | `#2EAAFF`（UI token）／`#069AFF`（色板 sky-50） | `--text-alert-info`、`base-hue-sky-50` | ✅ |
| 金色（金币/会员） | `#FFD700` 纯金 / `#E1CEA6` 文字香槟金 | `base-hue-gold-50`；像素顶栏 | ✅ |
| 另一套实心品牌（Tailwind 侧） | `#6366F1`，hover `#5558E3` | `--brand-solid-normal/-hover` | ✅ |

> **要点**：竞品**同时有三支紫**（`#9B46FF` 实心主色 / `#723FFF` 次级 / `#6B5CFF` alpha 填充）。使用时严格分工：实心按钮 `#9B46FF`，软底/描边 `#6B5CFF` 或 `#9B46FF` 的 alpha，**禁止拿 alpha 紫去当实心**。

### 2.5 字体族与字号阶梯

| 项 | 竞品值 | 证据 | 级别 |
|---|---|---|---|
| font-family | `"HarmonyOS Sans", ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", …` | `--font-sans` | ✅ |
| mono | `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, …` | `--font-mono` | ✅ |
| body 基准 | `14px` / `line-height 1.5` | Tailwind 默认 + 实测导航 13px 墨迹高 | 🟡 |
| 字重档 | 300 / 400 / 500 / 600 / 700 / 900 | `--font-weight-*` | ✅ |
| letter-spacing | normal `0em`，wider `.05em` | `--tracking-normal/-wider` | ✅ |

字号阶梯（全部为 CSS 变量一手值，`rem` 按 16px 换算）：

| Token | font-size | line-height（比值 → px） | 证据 | 级别 |
|---|---|---|---|---|
| `--text-xs` | `.75rem` = 12px | `1/0.75` = 1.3333 → 16px | CSS 变量 | ✅ |
| `--text-sm` | `.875rem` = 14px | `1.25/0.875` = 1.4286 → 20px | CSS 变量 | ✅ |
| `--text-base` | `1rem` = 16px | `1.5` → 24px | CSS 变量 | ✅ |
| `--text-lg` | `1.125rem` = 18px | `1.75/1.125` = 1.5556 → 28px | CSS 变量 | ✅ |
| `--text-xl` | `1.25rem` = 20px | `1.4` → 28px | CSS 变量 | ✅ |
| `--text-2xl` | `1.5rem` = 24px | `2/1.5` = 1.3333 → 32px | CSS 变量 | ✅ |
| `--text-3xl` | `1.875rem` = 30px | `1.2` → 36px | CSS 变量 | ✅ |
| `--text-5xl` | `3rem` = 48px | `1` → 48px | CSS 变量 | ✅ |

实测落点（截图量测）：

| 元素 | 量测 | 推断 font-size | 级别 |
|---|---|---|---|
| 页面标题（资产） | 单字宽 26px、墨迹高 27px | **26px / 700** | 🟡 |
| 侧栏导航项 | 墨迹高 13px | **14px / 400–500** | 🟡 |
| Tab 标签 | 墨迹高 13px | **14px / 500** | 🟡 |
| 卡片正文说明 | 墨迹高 15px（含中英混排下行） | **13–14px / 400** | 🟡 |
| 顶栏胶囊文字 | 胶囊高 40px，文字占比 ≈ 1/3 | **13px / 500** | 🟡 |
| 分组标题（团队） | 明显小于导航项 | **12px / 400–500** | 🟡 |

### 2.6 间距 / 圆角 / 阴影 / 控件高度

| 项 | 竞品值 | 证据 | 级别 |
|---|---|---|---|
| 间距基准 | `4px`（`--spacing: .25rem`） | CSS 变量 | ✅ |
| 圆角阶梯 | 2 / 4 / 6 / 8 / 12 / 16 / 24 / 9999 | `--radius-xs/sm/md/lg/xl/2xl/3xl` | ✅ |
| **实测控件圆角（按钮、输入框）** | **10px** | 白按钮 y514→y523 左缘 x383→374；搜索框 y153→y163 x1385→1375 | ✅ |
| 实测容器面板圆角 | **12px** | `task.png` 面板左上角 | ✅ |
| 实测顶栏胶囊圆角 | **9999（全圆，r=20）** | 胶囊左缘曲线跨度 17–20px | ✅ |
| 阴影 | `shadow-sm/md/lg/xl`（Tailwind 默认 4 级，均为黑 `#0000001a`） | `--shadow-*` | ✅ |
| 顶栏高度 | **64px** | 像素 `task.png` y0–63 | ✅ |
| 侧栏宽度 | **240px** | 像素 x0–239 | ✅ |
| 图标栏宽度（studio 壳） | **62px** | 像素 `assets.png` x9–70 | ✅ |
| 壳层外边距 | 图标栏左 8px；内容面板右 10px、下 22px | 像素 x8/x1590/y978 | ✅ |
| 顶栏胶囊高度 | **40px** | 像素 y11–52 | ✅ |
| 顶栏图标按钮 | **42×40** | 像素 x1146–1187 | ✅ |
| 头像 | **32×32** 圆形 | 像素 x1540–1571 / y16–47 | ✅ |
| 顶栏控件间距 | **7–8px** | 像素段间距 | ✅ |
| 主按钮 / 白按钮高度 | **40px** | 像素 `settings.png` y514–553 | ✅ |
| 大号渐变 CTA 高度 | **48px** | 像素 `novel-market.png` y936–983 | ✅ |
| 输入框 / 搜索框高度 | **32px** | 像素 `settings.png` y153–184 | ✅ |
| 分段控件高度 | **44px**（容器含 1px 边） | 像素 `pricing-full.png` y112–155 | ✅ |
| 侧栏项节距 | **46px** | 像素 `task.png` 各项文字中心 y97.5 / 143.5 / 190 / 236 / 282 | ✅ |
| 底部工具区项节距 | **40px** | 同上 y427 / 467 / 507 / 547 | ✅ |
| 卡片内距 | **24px** | 🟡 `assets.png` 卡片标题左边距 ≈ 内容面板左 + 24 | 🟡 |

### 2.7 动效

| 项 | 竞品值 | 证据 | 级别 |
|---|---|---|---|
| 默认过渡时长 | `.15s` | `--default-transition-duration` | ✅ |
| 默认曲线 | `cubic-bezier(.4, 0, .2, 1)` | `--default-transition-timing-function` | ✅ |
| ease-out | `cubic-bezier(0, 0, .2, 1)` | `--ease-out` | ✅ |
| ease-in | `cubic-bezier(.4, 0, 1, 1)` | `--ease-in` | ✅ |
| 常用时长集合 | `.1s / .15s / .2s / .3s / .4s / .5s / .6s / .7s` | `--tw-duration` 观测值 | ✅ |
| 内置动画 | `spin`、`pulse` | `--animate-spin/-pulse` | ✅ |
| 悬停/弹窗具体过渡 | — | 截图无法量测 | ❌ |

---

## 3. 组件 anatomy 规格

> 每条格式：**结构 → 尺寸 → 颜色 → 状态 → 间距**。数值均标证据级别。

### 3.1 侧栏（240px · workbench 壳）

| 项 | 规格 | 级别 |
|---|---|---|
| 容器 | 宽 240px，高 100vh，底 `#101015`，右侧 1px `#25262F` | ✅ |
| 品牌行 | 高 64px；logo 32–34px 圆角方块 + 品牌名 17px/700 + 折叠按钮 28×28（右对齐） | 🟡（`task.png` 顶部 y8–30） |
| 导航项 | 高 ≈44px、节距 46px、左右内距 16px、图标 20px、图标↔文字 10–12px | 🟡 |
| 导航项文字 | 14px/400，色 `#F5F8FF CC`（实测峰值 `#CFCFD0`） | ✅ |
| 导航项默认底 | **透明** | ✅ |
| 导航项悬停 | `#FFFFFF0F`（6%） | 🟡（按 `--background-02bg` 推定；截图未捕获悬停） |
| 导航项**选中** | **无底色块、无渐变、无左描边**；与未选中项文字峰值色一致 | ✅ |
| 分组标题（团队） | 12px/500，色 `#F5F8FF 66`，距上一组 24px | 🟡 |
| 分组分隔线 | 1px `#DBE7FF1F`，左右内缩 16px | 🟡（`--mi-component-divider-basic`） |
| 底部工具区 | 节距 40px；"影视版"带右侧徽标"申请内测"（11px，`#F5F8FF99`，无底色） | ✅（`task.png` y820–860） |

> **关键**：竞品侧栏选中态**极其克制**。我方用"白色渐变胶囊 + 600 字重"是明显的风格越位。

### 3.2 顶栏（64px）

| 项 | 规格 | 级别 |
|---|---|---|
| 容器 | 高 64px，底 = 页面 chrome `#0B0B10`（**不加半透明、不加 blur**） | ✅ |
| 布局 | 右对齐控件簇，控件间 `gap: 7–8px`，右内距 24px | ✅ |
| 胶囊按钮（创作手册/商务合作） | 40px 高，`--background-*` 底 `#0A0A0E`，1px 描边 `#2C2C30`，圆角 9999，内距 0/14，13px/500，图标 16px | ✅ |
| 图标按钮（铃铛/帮助） | 42×40，圆角 9999，底 `#0A0A0E`，描边同上 | ✅ |
| 会员胶囊（金色） | 40px 高，圆角 9999，深底 + 1px 金描边，文字 `#E1CEA6` 13px；内嵌"100BP低至0.2元/秒"小徽标（约 20px 高，金底深字） | ✅ |
| 积分胶囊 | 40px 高，61px 宽，圆角 9999，底 `#0A0A0E`，星形图标 `#9B46FF`，数字 14px/600 `#FFFFFF` | ✅ |
| 头像 | 32×32 圆形，渐变紫底 `#9B46FF→#AF5FFF`，白字 13px/600 | ✅ |
| 登录按钮（未登录） | 40px 高，圆角 9999，实色 `#9B46FF`，白字 14px/600 | ✅ |

### 3.3 按钮

| 变体 | 规格 | 级别 |
|---|---|---|
| **Primary（实心）** | 高 40px，圆角 **10px**，底 `#9B46FF`，白字 14px/500–600，左右内距 16–20px；hover `#A05AFF`（变亮）；pressed `#A564FF`；disabled `#9B46FF 40%` | ✅ |
| **Primary（胶囊，顶栏/登录用）** | 高 40px，圆角 9999，其余同上 | ✅ |
| **Secondary（软底）** | 透明底 + 品牌 alpha 底（`#9B46FF1F` 级）+ 1px 品牌 alpha 描边，文字 `#CF9FFF` | 🟡（`assets.png` 深色小按钮） |
| **Ghost（描边）** | 透明底 + 1px `#2C2C30` 描边，`#F5F8FFCC` 文字；hover 底 `#FFFFFF0F` | ✅（`settings.png`"导入场景"） |
| **White（高强调）** | 高 40px，圆角 10px，纯白底 `#FFFFFF`，文字 `#0A0A0C` 14px/600，图标同色 | ✅ |
| **Gradient（买断/会员）** | 高 48px，圆角 9999，白→浅紫→白渐变，文字深色 | ✅ |
| **危险** | 底 `#F83F3F`，hover `#F71D1D`，pressed `#D70909` | ✅（色值来源 `base-hue-red-*`） |
| 聚焦环 | 无外发光证据；推定 1px 品牌描边 | ❌ |

### 3.4 卡片

| 项 | 规格 | 级别 |
|---|---|---|
| 底 | `#191A22`（容器）/ `#1A1A1E`（容器内卡片，`--background-10bgsolid`） | ✅/🟡 |
| 圆角 | 12px（容器级）/ 16px（大内容卡，`--radius-2xl`） | ✅/🟡 |
| 描边 | 1px 冷调白 6–16%（`--border-trans-02` ≈ `#C2CCF114`） | 🟡 |
| 内距 | 24px | 🟡 |
| 阴影 | 深色下**不用**投影，靠底色差分层 | 🟡 |
| 大卡片两列布局 | 两卡等高、间距 16px、左侧图文/右侧图，图片区右对齐出血，圆角跟随卡片 16px | 🟡（`assets.png` y430–560） |

### 3.5 输入框 / 文本域

| 项 | 规格 | 级别 |
|---|---|---|
| 高 | **32px** | ✅ |
| 圆角 | **10px** | ✅ |
| 底 | `#121216` | ✅ |
| 描边 | 1px `#2E303A` | ✅ |
| 内距 | 0 12px | 🟡 |
| 文字 | 14px `#F5F8FF`；占位 `#F5F8FF66` | ✅/🟡 |
| hover | 描边 → 白 24%（`--background-05bg` 同强度） | 🟡 |
| focus | 描边 → `#9B46FF` 1px（无外发光证据） | 🟡 |
| disabled | 底 `#0A0C0FA6`（`--mi-component-color-disabled`），文字 `#F5F8FF3D` | ✅ |
| 文本域 | 未取证 | ❌ |

### 3.6 下拉 / 选择器

未单独抓到竞品选择器的展开态（`❌`）。收起态沿用输入框规格（32px / 10px / `#121216` / `#2E303A`），右侧 chevron 14px `#F5F8FF8F`。展开面板用 `--background-sheet #1C1D23` 或 `--background-model #272931`，圆角 12px，阴影 `shadow-lg`。**级别 🟡**

### 3.7 Tab 与分段控件

| 项 | 规格 | 级别 |
|---|---|---|
| **Tab（下划线式）** | 文字 14px/500；**选中 = `#FFFFFF`**，未选 = `#9D9D9F`；下划线 **2px `#FFFFFF`**，宽度 = 文字宽度，**左右无内缩**，与文字基线间距 4px；Tab 高度 ≈40px | ✅ |
| Tab 容器 | 无背景；底部无全宽分隔线（只有选中项下方有 2px 白线） | ✅ |
| **分段控件（Segmented）** | 容器高 **44px**，圆角 9999，1px 描边 `#232328`，透明底；选中项底 **`#232328`**、圆角 9999、白字 13px/500；未选项文字 `#9D9D9F` | ✅ |
| 分段控件内距 | 约 4px | 🟡 |

### 3.8 标签 / 徽标

| 变体 | 规格 | 级别 |
|---|---|---|
| 圆点标签（首次体验） | 高 20px，圆角 9999，文字 11px/500；品牌 alpha 底 + 品牌 alpha 描边 | 🟡（`assets.png` "首次体验"） |
| 状态标签（进行中/已完成） | 高 20px，圆角 9999，1px 描边，文字 11px | 🟡 |
| 顶部角标（即将上线/一单会员） | 高 18px，圆角 9999，12px；位于卡片右上、外溢 4px | 🟡 |
| 侧栏徽标（申请内测） | 纯文字 11px `#F5F8FF99`，**无底色** | ✅ |
| 会员金徽标 | 高 20px，圆角 9999，金底 `#FFD700`→`#E1CEA6`，深字 10px/700 | ✅ |

### 3.9 表格与列表行

| 项 | 规格 | 级别 |
|---|---|---|
| 行高 | ❌ 未取证 | ❌ |
| 表头底 | ❌ | ❌ |
| 分隔 | 1px `#DBE7FF1F`（推定） | 🟡 |

### 3.10 弹窗与抽屉

| 项 | 规格 | 级别 |
|---|---|---|
| 深色弹窗面板 | 底 `#1C1D23`（`--background-sheet`），圆角 12px，内距 24px，阴影 `shadow-xl` | ✅（色）/🟡（几何） |
| 遮罩 | `#000000B2`（70%） | ✅ |
| **登录弹窗** | **纯白 `#FFFFFF`，400×626，圆角 12px**，右上关闭 24×24 `#0A0A0C`；内容区留白极大，加载态为紫色环形 spinner `#9B46FF` | ✅ |
| 抽屉 | 底 `#F5F8FF0A` 级半透明 + blur（`--mi-bg-sidebar-mobile: #40444DCC`） | 🟡 |

### 3.11 空态

| 项 | 规格 | 级别 |
|---|---|---|
| 结构 | 居中；**插画/图标（约 80×64，非圆形底板）** + 一行灰字；无按钮 | ✅（`task.png` y330–400） |
| 文字 | 12–13px，`#F5F8FF66`，居中 | ✅ |
| 垂直位置 | 内容区垂直居中偏上（约 45%） | 🟡 |

### 3.12 Toast / 进度条

| 项 | 规格 | 级别 |
|---|---|---|
| Toast 底 | `--fill-toast-01 = #00000033`；成功/信息/警告/错误分别 `#0FBC5F20` / `#069AFF20` / `#FFD70020` / `#F83F3F20` | ✅（色）/❌（几何） |
| 进度条 | 品牌色 `#9B46FF` 填充；高度未取证 | ✅（色）/❌（高） |
| 进度条语义色 | 默认 `--color-brand-solid-primary`，成功 `#1ED266`，警告 `#FF9933`，危险 `#F83F3F` | ✅ |

### 3.13 分镜卡

❌ 未取证（`film-creation.png` 内被内容图占满）。仅能确认：卡片圆角 12–16px、含封面图 + 底部信息条。

---

## 4. 与我方现状的偏差表

> 我方值均**读代码核实**。严重度：**P0** = 一眼可见的风格不一致；**P1** = 细节偏差；**P2** = 可忽略/可选。

### 4.1 壳层（影响每一页）

| # | 竞品值 | 我方现状（file:line） | 偏差 | 严重度 | 建议改法 |
|---|---|---|---|---|---|
| S1 | chrome `#0B0B10` / 侧栏 `#101015` / 内容 `#0B0B10` | `--bg-app: #0a0a0e`，且 html/body、`.shell`、`.sidebar`、`.content` 全用它（`tokens.css:62`、`tokens.css:170`、`app.vue:288`、`app.vue:296`） | 三层表面塌成一层，全站看起来"一整块黑" | **P0** | 新增 `--bg-chrome:#0b0b10`、`--bg-sidebar:#101015`、`--bg-content:#0b0b10`、`--bg-panel:#191a22`；`--bg-app` 仅留给 html/body |
| S2 | 内容区是 `#191A22` 圆角 12px 面板，右缩 10px / 下缩 22px | `.content` 无底无圆角（`app.vue:637-640`） | 缺"卡片式内容承载层"，页面内容直接贴在页面上 | **P0** | `.main` 内加 `.content-panel{background:var(--bg-panel);border-radius:12px 12px 0 0;margin:0 10px 22px 0}` |
| S3 | 顶栏底 = 页面色 `#0B0B10`，不透明 | `.topbar{background:#000000cc;backdrop-filter:blur(8px)}`（`app.vue:466-467`） | 实测渲染成 `#020203`，比竞品暗 9 个灰阶；顶栏像"浮在黑洞上" | **P0** | 改成 `background: var(--bg-chrome)`，去掉 blur（或仅在 `scrollY>0` 时加 `rgba(11,11,16,.86)`） |
| S4 | 侧栏右分隔 `#25262F` | `border-right:1px solid var(--border-1)` = 白 8% over `#0a0a0e` ≈ `#1e1e21`（`app.vue:297`） | 分隔线太弱 | P1 | `border-color:#25262f`（随 S1 侧栏变 `#101015` 后自动成立） |
| S5 | 侧栏项节距 46px | 高 40px + `margin-bottom:2px` = 42px（`app.vue:363`、`app.vue:368`） | 列表偏挤 | P1 | `height:44px` + `margin-bottom:2px`；或 `height:40px` + `margin-bottom:6px` |
| S6 | 选中态**无底色块** | `.item.active{background:linear-gradient(90deg,#ffffff1a,#ffffff08);font-weight:600}`（`app.vue:388-392`） | 渐变胶囊在竞品体系里不存在（竞品全部是平色 alpha 填充） | P1 | `background: var(--bg-active)`（白 10%），去掉渐变；字重保持 500 |
| S7 | 无"品牌 logo 渐变方块 + 17px 字"证据 → 竞品为 32px 图 + 17px/700 | `.logo-mark` 34×34 渐变紫 + `.logo-text` 17px/700（`app.vue:316-332`） | 尺寸略大 2px | P2 | `width/height:32px;border-radius:10px` |

### 4.2 顶栏（每页首屏可见）

| # | 竞品值 | 我方现状（file:line） | 偏差 | 严重度 | 建议改法 |
|---|---|---|---|---|---|
| T1 | 所有顶栏控件 **40px 高** | mini-pill 34px（`app.vue:492`）、icon-btn 36px（`app.vue:480`）、recharge 36px（`app.vue:521`）、credits 36px（`app.vue:552`）、login-btn 36px（`app.vue:624`） | 整排控件**比竞品矮 4–6px**，顶栏显空、控件显小 | **P0** | 全部统一 `height:40px`（建议引入 `--control-h-lg:40px`） |
| T2 | 胶囊底 `#0A0A0E` + 描边白 14–16% | `.mini-pill{background:var(--bg-surface) #191a21;border:1px solid var(--border-1) 8%}`（`app.vue:495-496`） | 底色偏亮、描边偏弱，胶囊"发灰" | **P0** | `background:#0a0a0e;border-color:#2c2c30` |
| T3 | 控件间距 7–8px | `.right{gap:10px}`（`app.vue:476`） | 偏松 2–3px | P2 | `gap:8px` |
| T4 | 图标按钮 42×40 | `.icon-btn{width:36px;height:36px}`（`app.vue:479-480`） | 小 6px | P1 | `width:42px;height:40px` |
| T5 | 头像 32×32 | `.avatar{width:36px;height:36px}`（`app.vue:576-577`） | 大 4px | P1 | 32×32 |
| T6 | 金色文字 `#E1CEA6` / 弱 `#DCC7A1`，深底 | `.recharge{background:#292115;border:1px solid #f5c45133;color:#f5c451}`（`app.vue:524-526`） | 我方是**高饱和柠檬金**，竞品是**低饱和香槟金**，气质差一档 | P1 | `color:#e1cea6;border-color:#e1cea633;background:#1d1a12`；内部 `.sep`/`.span` 同步 |
| T7 | 积分胶囊 61px 宽、星形图标品牌紫 | `.credits` 用 `--bg-surface` 底 + `.spark{color:var(--brand-400) #b07aff}`（`app.vue:554-563`） | 底色/图标紫都不对 | P1 | 底 `#0a0a0e`、描边 `#2c2c30`、spark `#9b46ff` |

### 4.3 基础组件

| # | 竞品值 | 我方现状（file:line） | 偏差 | 严重度 | 建议改法 |
|---|---|---|---|---|---|
| C1 | 控件圆角 **10px** | `border-radius: var(--radius-md)` = 6px（`Button.vue:34`、`TextField.vue:58`、`SelectField.vue:51`、`TextAreaField.vue` 同） | 全站按钮/输入框角全部偏尖 | **P0** | 新增 `--radius-control:10px`，三处替换 |
| C2 | 按钮高 40px | `.btn.md{height:34px}`（`Button.vue:50`）；`.btn.sm 28px`（`:45`）；`.btn.lg 42px`（`:55`） | 主规格矮 6px；且 42px 与竞品 40/48 两档不吻合 | **P0** | md→40px、lg→48px、sm→32px |
| C3 | hover **变亮** `#A05AFF` | `.primary:hover{background:var(--brand-600) #8a3ae6}`（`Button.vue:69`） | **悬停变暗**，与竞品相反；且 `#8a3ae6` 不在竞品色板内 | **P0** | `background:#a05aff`；补 `:active{background:#a564ff}` |
| C4 | disabled = 品牌 40% | `.btn:disabled{opacity:.55}`（`Button.vue:112`） | 用整体透明度，文字/图标一起变灰 | P2 | primary 用 `background:#9b46ff66;color:#ffffff99` |
| C5 | ghost = 透明 + 白 6% hover | `.ghost{background:var(--bg-surface);border:1px solid var(--border-2)}`（`Button.vue:83-85`） | 有实底，比竞品"重" | P1 | `background:transparent;border-color:#2c2c30`，hover `#ffffff0f` |
| C6 | secondary 用品牌 alpha（`#9b46ff`/`#6b5cff` 系） | `.secondary{background:#7e70ff1f;color:var(--brand-300);border-color:#7e70ff45}`（`Button.vue:73-75`） | `#7e70ff` 是第三支紫，与主色 `#9b46ff` 混用 | P2 | 底/边改 `#9b46ff` alpha，文字 `#cf9fff` |
| C7 | 输入框高 **32px**、底 `#121216`、边 `#2E303A` | `.input{height:34px;background:var(--bg-surface) #191a21;border:1px solid var(--border-2)}`（`TextField.vue:55-57`） | 高了 2px，底色偏亮（输入框比容器亮 = 层级反了） | **P0** | `height:32px;background:#121216;border-color:#2e303a` |
| C8 | 同 C7 | `.select{height:34px;background:var(--bg-surface);border:var(--border-2)}`（`SelectField.vue:48-50`） | 同上 | **P0** | 同上 |
| C9 | focus 仅 1px 品牌描边 | `.input:focus{border-color:var(--brand-500);box-shadow:0 0 0 3px #7e70ff2e}`（`TextField.vue:74-75`）、`SelectField.vue:65-66` | 多了 3px 紫色外发光（竞品无此表现）；且用 `#7e70ff` | P1 | 去掉 box-shadow，或改 `0 0 0 2px #9b46ff33` |
| C10 | 卡片圆角 12px、底 `#191A22` 级、无阴影 | `.card{background:var(--bg-surface) #191a21;border-radius:var(--radius-lg) 8px;box-shadow:var(--shadow-sm)}`（`Card.vue:25-28`） | 圆角偏小 4px；深色下投影无意义 | P1 | `border-radius:12px`，去掉 shadow（或降到 `--shadow-sm` 仅浅色用） |
| C11 | 卡片内距 24px | `.body.padded{padding:var(--space-5) 20px}`（`Card.vue:67`）、`.head{padding:16px 20px}`（`Card.vue:46`） | 小 4px | P1 | 改 `var(--space-6)` |

### 4.4 TabBar / Tag / Modal / EmptyState（组件层，一改全站生效）

| # | 竞品值 | 我方现状（file:line） | 偏差 | 严重度 | 建议改法 |
|---|---|---|---|---|---|
| B1 | 选中 = **白字 `#FFFFFF`** | `.tab.active{color:var(--brand-600) #8a3ae6}`（`TabBar.vue:50`） | 紫色文字在深底上对比度仅 3.1:1，且与竞品完全不同的视觉语言 | **P0** | `color:#fff` |
| B2 | 下划线 **2px `#FFFFFF`** | `.tab.active::after{background:var(--brand-500) #9b46ff}`（`TabBar.vue:59`） | 紫色下划线是"另一个产品"的语言 | **P0** | `background:#fff` |
| B3 | 下划线宽度 = 文字宽度，无内缩 | `left:var(--space-3);right:var(--space-3)` = 左右各缩 12px（`TabBar.vue:56-57`） | 短了 24px | P1 | `left:0;right:0`（或 `inset-inline:0`） |
| B4 | Tab 高 ≈40px，字 14px/500 | `padding:12px 16px`（`TabBar.vue:38`）→ 高约 42px | 接近，可保留 | P2 | 统一 `padding:12px 16px` 但去掉容器 `border-bottom` |
| B5 | Tab 容器无全宽底线 | `.tabs{border-bottom:1px solid var(--border-1)}`（`TabBar.vue:27`） | 多了一条全宽线 | P1 | 去掉 `border-bottom` |
| B6 | 徽标 20px 高、11px | `.tag.md{height:22px;font-size:var(--text-xs) 12px}`（`Tag.vue:30-32`） | 高 2px / 字大 1px | P2 | `height:20px;font-size:11px` |
| B7 | 弹窗底 `#1C1D23` | `.panel{background:var(--bg-raised) #1f1f2a;border-radius:var(--radius-xl) 12px}`（`Modal.vue:37-39`） | 底色偏紫亮；圆角正确 | P1 | `background:#1c1d23` |
| B8 | 遮罩 70% | `background:rgba(0,0,0,.62)`（`Modal.vue:25`） | 浅 8% | P2 | `rgba(0,0,0,.7)` |
| B9 | 空态 = 插画 + 一行灰字，无圆底板 | `.icon{48×48;border-radius:50%;background:var(--bg-sunken)}`（`EmptyState.vue:24-31`）+ 有 `.title` 主文案（`:34-38`） | 我方多了"圆底图标 + 标题 + 描述"三层，比竞品重 | P1 | 去掉圆底（`background:transparent`），标题降为 13px `#F5F8FF8F` |
| B10 | 进度条色 `#9B46FF` | `.fill{background:var(--brand-500)}`（`Progress.vue:38`） | ✅ 一致 | — | 无需改 |
| B11 | Skeleton | `height:36px;border-radius:var(--radius-full)`（`Skeleton.vue:22-23`） | ❌ 无竞品证据 | P2 | 保持现状 |

### 4.5 令牌层内部不一致（必须先修，否则改组件是白改）

| # | 问题 | 证据 | 严重度 | 建议 |
|---|---|---|---|---|
| K1 | `--control-h: 40px` 已定义，但**只有 4 处**使用；`height:34px` 硬编码在 **14 个文件** | `tokens.css:40`；`grep height: 34px` → `SelectField.vue`、`Button.vue`、`TextField.vue`、`layouts/app.vue`×2、`CreateProjectModal.vue`、`SubjectLibrary.vue`×2、`novel-market/index.vue`、`projects/[id].vue`×2 等 | **P0** | 把 34px 全部换成 `var(--control-h-md:32px)` / `var(--control-h-lg:40px)` |
| K2 | 三支紫混用：`--brand-500 #9b46ff`（正确）／`#7e70ff`（软底/描边）／`#7769ff`（首页） | `Button.vue:73,75,79`；`Tag.vue:51-53`；`TabBar.vue:75`；`pages/home.vue:423-424,443,476`；`pages/tools.vue:141` | P1 | 收敛为两支：实心 `#9b46ff`，alpha 填充 `#9b46ff` 或 `#6b5cff` |
| K3 | 状态色与竞品不同 | `--success:#5fd08a`、`--warning:#f5b544`、`--danger:#f56767`、`--info:#63b3ff`（`tokens.css:43-50`） vs 竞品 `#1ED266`/`#FF9933`/`#F83F3F`/`#2EAAFF` | P1 | 直接替换 |
| K4 | `--bg-hover` 5% vs 竞品 6% | `tokens.css:66` `#ffffff0d` vs `--background-02bg #ffffff0f` | P2 | 改 `#ffffff0f` |
| K5 | `--border-3` 20% 不在竞品阶梯（16/24） | `tokens.css:83` `#ffffff33` | P2 | 改 `#ffffff3d`（24%） |
| K6 | 边框用纯白，竞品是冷调 `#C2CCF1` | `tokens.css:81-83` | P1 | 新增 `--border-cool-1/2/3: #c2ccf114/#1f/#29`，组件优先用冷调 |
| K7 | 过渡时长 120/200/320ms，竞品默认 150ms | `tokens.css:145-147` | P2 | `--duration-fast:150ms;--duration-base:200ms` |

### 4.6 页面级（按可见面积排序）

| # | 竞品值 | 我方现状（file:line） | 偏差 | 严重度 | 建议改法 |
|---|---|---|---|---|---|
| P1 | 主按钮 `#9B46FF` 实色 | 首页主 CTA `background:linear-gradient(120deg,#5d4ff0,#8a7dff)`（`pages/home.vue:443`） | 渐变紫，且 `#5d4ff0` 不在竞品色板 | **P0** | `background:var(--brand-500)` |
| P2 | 圆角上限 24px（`--radius-3xl`），常用 12–16px | 首页大卡片 `border-radius:32px`（`pages/home.vue:471`） | 32px 超出竞品圆角体系，显得"圆过头" | **P0** | 改 16px（或保留一个 24px 档） |
| P3 | 无页面级光晕 | 首页 `radial-gradient(50% 50% at 50% 50%,#7769ff2e,transparent 70%)`，高 420px（`pages/home.vue:393-394`） | 竞品所有页面底**纯平**，无光晕 | P1 | 删除，或降到 `#7769ff0f` |
| P4 | 工具卡应**亮于**页面底（`#1A1A1E`/`#232328`） | 工具卡 `linear-gradient(180deg,#060608,#020203)`（`pages/tools.vue:234`）、`linear-gradient(180deg,#0d0d12,#050507)`（`:243`） | **层级反转**：卡片比页面（`#0a0a0e`）更暗 | **P0** | 改 `#1a1a1e` / `#232328`，或 `var(--bg-panel)` |
| P5 | 体系外颜色不存在 | 首页标签 `#d3f36b` 柠檬绿（`home.vue:596-597`）、`linear-gradient(90deg,#ff7a45,#ff4d6a)`（`home.vue:601-602`）、`#2a1744`（`tools.vue:141`） | 引入 3 个体系外色相，破坏整体一致性 | P1 | 用 `#1ED266` / `#F83F3F` / `#9B46FF1F` 替代 |
| P6 | Tab 下划线白 | 定价页 `background:var(--brand-500)` + `height:2px`（`pages/pricing.vue:501-503`） | 同 B1/B2 | **P0** | 白 |
| P7 | 分段控件 底 `#0B0B10`/选中 `#232328` | 定价页 `background:#0f0f12`（`:510`）、选中 `#26262c`（`:523`） | 底偏亮 4、选中偏亮 3 | P1 | `#0b0b10` / `#232328` |
| P8 | 页面标题 ≈26px | 首页 28px（`home.vue:405`）与 30px（`home.vue:664`）两档混用；工具页 24px（`tools.vue:126`） | 三档不统一，且都比竞品大 | P1 | 统一 `26px/700`，次级 `20px/600` |
| P9 | 登录弹窗 **纯白 400×626** | 深色 `var(--lm-bg)`，`width:400px;min-height:617px;border-radius:12px`（`pages/login.vue:443-452`） | 宽/圆角一致，**底色完全相反** | **P0** | 见 §6 决策项 |
| P10 | 登录弹窗内距大留白 | 我方 44px 高输入框（`login.vue:562`） | 竞品输入框 32px | P1 | 改 40px（弹窗内可放宽） |

### 4.7 两条独立缺陷（第二轮增补 · 需单独立项修）

> 这两条不属于"令牌对齐"，是**渲染逻辑错误 / 页面范式不一致**，必须单独成条派工。

#### D1 · 语言切换器在 4 个页面被重复渲染（功能缺陷 + 视觉污染）

**现象**：壳层顶栏已有一个语言切换器，页面内容区又各渲染了一个，同一屏出现两个"简体中文"下拉。

**证据（代码，已逐处核实）**：

| 位置 | 代码 | 落在哪个壳 |
|---|---|---|
| 壳层顶栏（唯一应该存在的那一个） | `layouts/app.vue:222` `<LangSwitcher class="lang-in-topbar" />` | 所有 `layout:"app"` 页面 |
| 工具箱页内容区 | `pages/tools.vue:69` `<LangSwitcher />` | 顶栏**下方**重复 |
| 定价页内容区 | `pages/pricing.vue:360` `<LangSwitcher />` | 顶栏**下方**重复 |
| 设置页内容区 | `pages/settings.vue:58` `<LangSwitcher />` | 顶栏**下方**重复 |
| 任务页内容区 | `pages/tasks.vue:234` `<LangSwitcher />` | 顶栏**下方**重复 |
| 落地页（`layout:false`，**无壳层**） | `pages/index.vue:73` | ✅ 合法，应保留 |
| 登录页（默认 layout，**无壳层顶栏**） | `pages/login.vue:235` `tone="light"` | ✅ 合法，应保留 |

4 个页面 `definePageMeta` 均为 `layout:"app"`（`tools.vue:14`、`pricing.vue:4`、`settings.vue:2`、`tasks.vue:4`），所以必然与 `app.vue:222` 重复。

**像素佐证（1600×1000 现抓图 `_acceptance/ui-align/current/`）**：

| 页面 | 顶栏那个（正确） | 内容区那个（多余）位置 |
|---|---|---|
| tools.png | y15–44 区段，控件高 30px | **x1440–1574 / y85–112**（页面标题"工具箱"右侧，紧贴"工具箱创作资产"紫按钮） |
| settings.png | 同上 | **x1352–1486 / y104–131** |
| tasks.png | 同上 | **x1350–1487 / y97–124**（紧贴"批量下载 zip"按钮右侧，中间夹一个 🌐） |
| pricing.png | 同上 | **x1343–1480 / y≈430–460**（混在"当前余额 4984 积分"同一行，看起来像筛选项） |

证据图：`ev-dup-lang-topbar.png`（顶栏那个）、`ev-dup-lang-content.png`（内容区那个）。

**顺带暴露的 4 个组件级视觉问题**（`components/i18n/LangSwitcher.vue`，与 §2.6 基线逐项冲突）：

| 项 | 竞品基线 | 我方值（file:line） | 严重度 |
|---|---|---|---|
| 图标用 🌐 **彩色 emoji** | 竞品顶栏全部是单色线性图标（`stroke-width 1.6`，`currentColor`） | `LangSwitcher.vue:42` `<span class="lang-switcher__icon">🌐</span>` | **P0**（深色界面里出现一个蓝绿色 emoji，是整条顶栏唯一的彩色噪点） |
| 控件高 | 40px | `height:30px`（`LangSwitcher.vue:63`） | P0（与顶栏其余控件差 10px） |
| 圆角 | 10px | `border-radius:8px`（`:65`） | P1 |
| 底色 | `#0A0A0E` | `background:var(--bg-raised)` = `#1f1f2a`（`:67`） | P1（比顶栏胶囊明显偏紫亮） |
| 文字 / 描边 | 13px / `#2C2C30` | 12px / `var(--border-2)` 12%（`:69`、`:66`） | P1 |

**建议修法**（不要自行改代码，按此派工）：
1. 删除 `pages/tools.vue:69`、`pages/pricing.vue:360`、`pages/settings.vue:58`、`pages/tasks.vue:234` 四处 `<LangSwitcher />`（保留 `index.vue:73`、`login.vue:235`）。
2. `LangSwitcher.vue:42` 的 🌐 换成内联 SVG 线性地球（16px，`stroke="currentColor"`，`stroke-width:1.6`，与 `app.vue` 顶栏其它图标同参数）。
3. `:63` 高 30→40、`:65` 圆角 8→10、`:67` 底 `#1f1f2a`→`#0a0a0e`、`:66` 描边→`#2c2c30`、`:69` 字 12→13px。
4. 顺带修 `:74-76` 硬编码的 chevron 定位（`calc(100% - 13px) 13px` 是按 30px 高调的，改 40px 后 y 要改 19px）。

**竞品对照**：竞品顶栏**没有**语言切换器（`task.png` 顶栏 x918–1571 全部控件依次为：创作手册 / 商务合作 / 铃铛 / 帮助 / 会员订阅 / 积分 / 头像）。所以这一处不应"加到内容区凑数"，而应只保留一处、并考虑是否放进头像下拉（竞品做法）。

---

#### D2 · `/tools` 工具箱页与竞品是**两种范式**（4 列纯文字卡 vs 5 列封面卡）

**现象**：竞品是图文封面卡（靠封面图建立辨识度），我方是纯文字深色卡（只有标题+一行描述），信息密度和"货架感"完全不同。

**像素级比对（两组图同为 1600×1000 与 1440×900 的 1:1 CSS 像素）**：

| 维度 | 竞品（`_acceptance/ref2/tools-recheck.png`） | 我方（`_acceptance/ui-align/current/tools.png` + 代码） | 严重度 |
|---|---|---|---|
| 列数 | **5 列** | **4 列**（`tools.vue:219` `repeat(4, minmax(0,1fr))`） | **P0** |
| 卡片尺寸 | **212 × 212（正方形）**，量测 x266–477 / y186–397 | **313 × 84（扁长条）**（实测宽 313；高 84 见 `tools.vue:230`） | **P0** |
| 卡片间距 | 20px（266→498→729→961→1192；186→418→649） | 20px（`tools.vue:221`）✅ 一致 | — |
| 卡片圆角 | 8–12px（左上角 x266 于 y193 到达，曲线跨度 7px；受封面暗角影响，下界 8px） | **16px**（`tools.vue:232`） | P1 |
| 卡片内容 | 封面图铺满 + 底部黑色渐变压字 | 无图，`justify-content:center` 文字居中（`tools.vue:225-240`） | **P0** |
| 标题 | 单字进距 19.75px（4 字墨迹宽 79px）→ **≈20px / 600**（同图内 14px 导航项墨迹高 13px 作标尺） | **18px / 700**（`tools.vue:249-250`） | P1（略小且更粗） |
| 描述 | 12–13px，**两行截断**（墨迹带 y365–378） | 13px，**单行 `nowrap` 截断**（`tools.vue:256-260`） | P1（信息量少一半） |
| 角标 | 卡内左上，半透明黑底 + 白字（如 `M2` / `2.2M`），距边约 8px | **无** | P1 |
| 内容区左右内距 | **24px**（侧栏 x239 边界 → 首卡 x266） | `padding:20px 24px 40px`（`tools.vue:113`）✅ 左右对 | — |
| 页头右侧 | 只有一个紫色主按钮"工具箱创作资产" | 紫色按钮 + **额外一个 `#2a1744` 紫色提示框 280px 宽**（`tools.vue:136-143`） | P1（竞品没有这个浮层） |
| 页头标题 | 25–26px（墨迹高 23px） | 24px/700（`tools.vue:126`） | P2 |
| 页头按钮 | 与主按钮同规格（40px/r10/`#9B46FF`） | `height:36px;border-radius:8px`（`tools.vue:172,176`） | P1 |

> **对上一轮数字的修正**：主理人口述"卡片约 176×200、标题 15px/600"。实测（同图内以 14px 导航项墨迹 13px 标尺反推）为 **212×212 正方形、标题 ≈20px**。176 这个数只有在 5 列塞进 960px 内容宽时才成立，而竞品内容宽是 1200px。实现时按 212/20px 走，别按 176/15px。

**为什么用"程序化渐变封面"而不是复制竞品图片**（4 条理由，按权重）：

1. **版权**：竞品封面全是真人/实拍剧照（电影质感人像、产品图），来自万兴自有素材库，无授权不可复制。
2. **素材缺口**：我方 `app/apps/web/public/images/` 只有 3 张剧集图，**没有任何工具封面**。要凑 20 张卡就要新增 20 张摄影级素材，等于把"改 UI"变成"拍一组图库"，会直接阻塞本轮。
3. **深色适配**：实拍高光图在 `#0A0A0E` 底上会"打洞"（大片亮区域破坏深色节奏），竞品是靠极重的底部渐变压住才成立的；渐变封面不会有这个问题。
4. **可维护性**：渐变+图标的方案零体积、可确定性生成、随 i18n 增删卡自动增减，且与竞品"平色 alpha 填充"的体系（§2.1 `--background-02bg…05bg`）同源，不引入外来语言。

**替代方案：程序化渐变封面（色相取自竞品自有调色板，非自创）**

6 个色相全部来自竞品 `--palette-alpha-dark-*` 原生基色（见 §2.4 与 `vars.json`），保证"不复制图片但用同一套色"：

| 槽位 | 基色 | 来源令牌 |
|---|---|---|
| 0 iris | `#9B46FF` | `--base-hue-iris-50` |
| 1 ice-blue | `#34D2EB` | `--palette-alpha-dark-ice-blue-*` |
| 2 sunset-orange | `#FF9933` | `--palette-alpha-dark-sunset-orange-*` |
| 3 polar-green | `#2DE099` | `--palette-alpha-dark-polar-green-*` |
| 4 magenta | `#FF75D8` | `--palette-alpha-dark-magenta-red-*` |
| 5 coral-red | `#FF5C5C` | `--palette-alpha-dark-coral-red-*` |

确定性分配（同一工具每次刷新颜色不变，且不随 i18n 文案变化）：

```ts
// 用稳定的 tool.id 做散列，绝不用数组下标——否则新增一个工具会让后面全部换色
const ACCENTS = ["#9b46ff", "#34d2eb", "#ff9933", "#2de099", "#ff75d8", "#ff5c5c"] as const;
function accentOf(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}
```

卡片结构与规格（可直接照着写）：

```
.tool-card   : 5 列 / 1:1 正方形 / radius 12px / 无描边 / overflow:hidden
.cover       : 卡片上半 62%（约 132px），
               background:
                 radial-gradient(120% 90% at 12% 0%, {accent}38 0%, transparent 62%),
                 linear-gradient(160deg, {accent}24 0%, #0a0a0e 78%);
.cover-icon  : 居中 40×40 线性图标，stroke:{accent}，opacity .55
.cover-fade  : 底部 56px，linear-gradient(180deg, transparent, #0a0a0e 92%)
.badge       : 左上 8px/8px，高 18px，radius 9999，bg #00000066，字 10px/600 #FFFFFF
.title       : 15–20px/600（建议 18px 折中，上限 20px），#FFFFFF，距底 44px，距左 12px
.desc        : 12px/400 #F5F8FF8F，line-clamp:2，距左 12px，距底 12px
hover        : translateY(-2px) + 描边 1px #ffffff29（不换底，避免闪）
```

> 标题字号说明：竞品量测 ≈20px，但那是"图上压字"（需要更重才能压住图）。我们渐变封面本身对比度更低，**18px/600 是更稳的折中**；若之后换成真封面图再回到 20px。

响应式断点（取代 `tools.vue:284-302` 现有规则）：`≥1440 → 5 列`、`1024–1439 → 4 列`、`768–1023 → 3 列`、`<768 → 2 列`。

**同时要删的两处**：
- `tools.vue:136-143` `.tip`（`#2a1744` 紫色提示框）——竞品页头没有，且 `#2a1744` 是体系外色。
- `tools.vue:211` `.tab.on{background:#232328}` 保留 ✅（与竞品分段控件一致），但 `.tab` 的 `border-radius:7px`（`:199`）应改 9999 或 8px。

---

## 5. 设计决策摘要（前 10 个最该改的点）

> 排序原则：`影响面（多少页/多少控件）÷ 改动成本（几行）`。全部只改视觉，不动结构。

| 序 | 动作 | 改哪里 | 影响面 | 成本 | 期望收益 |
|---|---|---|---|---|---|
| **1** | **顶栏控件统一 40px 高 + 胶囊底 `#0A0A0E`/描边 `#2C2C30` + 去掉 `#000000cc`+blur 改 `#0B0B10`** | `layouts/app.vue:466,480,492,495-496,521,552,624` | 每一页首屏最显眼一行 | 1 文件 ~12 行 | 立刻从"控件偏小、顶栏发黑"变成竞品的松弛感 |
| **2** | **壳层三层底色分开：chrome `#0B0B10` / sidebar `#101015` / 内容面板 `#191A22` r12 右缩 10 下缩 22** | `tokens.css:62` 新增 4 个令牌；`app.vue:288,296,637` | 全站 100% 页面 | 2 文件 ~15 行 | 建立明暗层级，解决"一整块黑" |
| **3** | **控件圆角 6px → 10px；按钮 40px、输入 32px；把 14 处 `height:34px` 收进令牌** | `Button.vue:34,50,55`；`TextField.vue:55,58`；`SelectField.vue:48,51`；`tokens.css` 加 `--radius-control:10px` | 所有表单/按钮/弹窗 | 3 文件 ~10 行 | 最高频控件的"手感"一次到位 |
| **4** | **Tab 选中态：紫字→白字，紫下划线→白 2px 下划线，去掉 12px 左右内缩与容器全宽底线** | `TabBar.vue:27,50,56-59`；`pages/pricing.vue:501-503` | 每个列表页顶部 | 2 文件 ~6 行 | 修掉最刺眼的一处"产品语言错位" |
| **5** | **主按钮 hover 由变暗改变亮 `#A05AFF`，补 pressed `#A564FF`** | `Button.vue:68-70` | 全站所有主按钮 | 1 文件 3 行 | 交互反馈方向与竞品一致 |
| **6** | **工具卡层级反转修正：`#060608→#020203` 改为 `#1A1A1E`/`#232328`** | `pages/tools.vue:234,243` | 工具页整屏卡片 | 1 文件 2 行 | 卡片从"比背景更黑"变成"浮起" |
| **7** | **首页主 CTA 渐变紫 → `#9B46FF` 实色；32px 大卡圆角 → 16px；删除 420px 紫色光晕** | `pages/home.vue:443,471,393-394` | 首页（流量入口） | 1 文件 4 行 | 首屏气质从"AI 营销页"回到"专业工具" |
| **8** | **侧栏选中态：渐变胶囊 → 白 10% 平底，去掉 600 字重；项节距 42→46px** | `app.vue:363,368,388-392` | 全站侧栏 | 1 文件 5 行 | 侧栏安静下来，不与内容抢注意力 |
| **9** | **状态色对齐竞品：`#1ED266/#FF9933/#F83F3F/#2EAAFF`；边框改冷调 `#C2CCF1` alpha 阶** | `tokens.css:43-50,81-83` | 全站 Tag/Toast/进度/所有描边 | 1 文件 ~10 行 | "冷金属"质感，是竞品深色界面的底色秘密 |
| **10** | **收敛三支紫：`#7e70ff`/`#7769ff` 全部并回 `#9b46ff`（实心）或 `#6b5cff`（alpha）** | `Button.vue:73-79`；`Tag.vue:51-53`；`TabBar.vue:75`；`home.vue:423-424,476`；`tools.vue:141` | 所有次要按钮/徽标/首页装饰 | 5 文件 ~12 行 | 消除"同一个产品三种紫"的廉价感 |

### 附：不急但值得记一笔

- 顶栏金色胶囊：`#f5c451` → `#E1CEA6`（香槟金），1 行，观感提升明显，可并入第 1 项一起做。
- `--radius-panel: 20px`（`tokens.css:39`）与竞品 12/16/24 阶梯不吻合，且已散落在 `task-card` 等处使用，建议改为 `--radius-panel: 16px`。
- 首页三处卡内渐变边框（`home.vue:477`）是竞品没有的装饰手法，保留会持续制造"两套语言"，建议下一轮再删。

### 5.1 第二轮增补的两条，建议插到最前面（都不是"调色"，是"改错"）

| 序 | 动作 | 改哪里 | 影响面 | 成本 | 为什么排前面 |
|---|---|---|---|---|---|
| **D1** | **删掉 4 个页面里重复的 `<LangSwitcher />`，并把组件本身改成线性图标 + 40px/10px/`#0A0A0E`** | 删：`pages/tools.vue:69`、`pages/pricing.vue:360`、`pages/settings.vue:58`、`pages/tasks.vue:234`；改：`components/i18n/LangSwitcher.vue:42,63,65,66,67,69,74-76` | 4 个页面各少一个控件；顶栏 1 个控件对齐 | 5 文件 ~10 行 | 同屏两个"简体中文"是**明显到用户会来报障**的问题；且 🌐 彩色 emoji 是整条顶栏唯一彩色噪点 |
| **D2** | **工具箱页从 4 列纯文字卡改成 5 列渐变封面卡（程序化生成，不引素材）** | `pages/tools.vue:216-261`（网格与卡片）、`:113` 内距保留、删 `:136-143` 提示框、`:284-302` 断点重写 | 工具页整屏 | 1 文件 ~60 行 + 1 个色相工具函数 | 这是全站**唯一"货架型"页面**，4 列扁条卡没有任何辨识度；且现有卡比页面底更暗（层级反转，见 P4），改结构时一并修掉 |

> D2 的详细对比数据与渐变实现方案见 §4.7。

---

## 6. 需要主理人拍板的 1 个决策（不是偏差，是取向）

**竞品登录弹窗是纯白卡片（400×626，圆角 12px，白底黑字）**，像素实测见 `ev-login-modal.png`（原图 `rea-reelmate/login-modal.png`，白色包围盒 x512–911 / y90–715）。
我方登录弹窗是**深色**（`pages/login.vue:452` `var(--lm-bg)`，400×617）。

- 若目标是"像竞品" → 应改白底（影响所有输入框、按钮、错误提示配色，工作量 ≈ 1.5 人日）。
- 若目标是"产品自身调性"（全深色更统一） → **保持深色是合理的差异化**，但需要把弹窗内控件对齐 §3.5（32/40px 高、10px 圆角、`#121216`/`#f5f5f5` 底）。

建议：**保持深色**，只做控件规格对齐（成本 0.5 人日），并在报告里显式记为"有意偏离"。

---

## 7. 附：证据图

| 文件 | 内容 |
|---|---|
| `ev-sidebar-2x.png` | 竞品 240px 侧栏 2× 放大（证明无选中底色块） |
| `ev-topbar-2x.png` | 竞品顶栏 2× 放大（40px 胶囊、7–8px 间距） |
| `ev-rail-4x.png` | 竞品 62px 图标栏 4× 放大（圆角卡 + 1px 描边） |
| `ev-tabs-4x.png` | 竞品 Tab 4× 放大（白字 + 白下划线） |
| `ev-login-modal.png` | 竞品登录弹窗（白色 400×626） |
| `ev-dup-lang-topbar.png` | **我方** tools.png 顶栏 3× 放大：第一个语言切换器（正确位置）+ 🌐 彩色 emoji |
| `ev-dup-lang-content.png` | **我方** tools.png 内容区右上 2× 放大：第二个语言切换器（D1 缺陷） |

### 7.1 本轮使用的两组同尺寸图

| 组 | 路径 | 尺寸 | 用途 |
|---|---|---|---|
| 我方现状 | `_acceptance/ui-align/current/`（home / tools / t2v / pricing / projects / tasks / assets / settings / works / agent / canvas / reelflow） | 1600×1000 | 与竞品逐像素比对 |
| 竞品参考 | `_acceptance/ref-authed/`（pricing / task / assets / settings / novel-market / workflow-canvas …） | 1600×1000 | 同尺寸基准 |
| 竞品工具页 | `_acceptance/ref2/tools-recheck.png` | 1440×900（1:1 CSS px，侧栏实测 240px 与 1600 档一致） | D2 的唯一证据源 |

---

*本文所有数值均标注证据级别。凡标 ❌ 处一律留空，未做任何推测填充。*
