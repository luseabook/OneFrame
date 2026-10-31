# UI 对齐 · 施工记录（03）

> **范围**：只改视觉与交互形态，**不动** `useApi` / `composables` / `server` / 后端契约 / 路由 / i18n 文案。
> **代码基线**：`E:/wanxing/app/apps/web`（Nuxt 3 + Vue 3 + 手写 CSS）。
> **施工单**：`02-page-diff.md` §10（GL1–GL20）+ §11（批次 1 / 批次 2），按 team-lead 的裁定做了 3 处收窄（见 §5）。
> **施工时间**：2026-10-29。

---

## 0. 一句话结论

批次 1（全局令牌 + 壳层 + 基础组件，14 条 GL）+ 批次 2 的两处结构性改造（工具箱 5 列封面卡、首页容器/圆角/实色 CTA）已全部落地，
`vue-tsc` 与 `nuxt build` 均通过；1600×1000 截图与像素量测确认：**壳层三层色差成立（`#101015` / `#0B0B10` / `#191A22`）、顶栏控件全部 40 高且间距 8、Tab 白字白 2px 白线、工具箱 5 列 253×253 正方形封面卡、首页案例墙 4 列**。
共改 **17 个文件**（新增 1 个组件），页面内 `height:34px` 未动（按裁定只收 6 个全局控件文件）。

---

## 1. 改动映射表

> 列含义：**条目 | 文件:行（改后） | 改前 → 改后 | 竞品参考点**
> 竞品坐标均为 `_acceptance/` 下同名截图的原图像素。

### 1.1 批次 1 · 令牌层

| 条目 | 文件:行 | 改前 → 改后 | 竞品参考点 |
|---|---|---|---|
| GL1 | `assets/css/tokens.css:88-95` | 新增 `--bg-chrome:#0b0b10` / `--bg-sidebar:#101015` / `--bg-content:#0b0b10` / `--bg-panel:#191a22` / `--sidebar-line:#25262f` | `ref-authed/task.png`：chrome y0–63 / 侧栏 (100,300) / 面板 x240–1589,y64–977 三点取样 |
| GL5+GL19 | `tokens.css:95` | 新增 `--gold-text:#e1cea6` | `ref-authed/task.png` 顶栏金色胶囊文字 |
| GL6 | `tokens.css:47-55` | 新增 `--control-h-sm/md/lg = 32/40/48`、`--radius-control:10px`、`--control-bg:#121216`、`--control-line:#2e303a` | 01 文档 §2.6：白按钮 y514→y523 左缘 x383→374（r≈10）；输入框 y153–184（高 32） |
| GL7 | `tokens.css:20-22` | 新增 `--brand-hover:#a05aff` / `--brand-pressed:#a564ff`（`#8a3ae6` 保留供旧引用） | `--brand-02hover #A05AFF` / `--brand-03pressed #A564FF` |

### 1.2 批次 1 · 壳层（`layouts/app.vue`）

| 条目 | 文件:行 | 改前 → 改后 | 竞品参考点 |
|---|---|---|---|
| GL1 | `layouts/app.vue:285` `.shell` | `background: var(--bg-app)` → `var(--bg-chrome)` | task.png y0–63 全为 `#0B0B10` |
| GL1 | `layouts/app.vue:295` `.sidebar` | 底 `--bg-app` → `--bg-sidebar`；`border-right:1px var(--border-1)`（白 8%）→ `1px #25262f` | task.png (100,300)=`#101015`；(239,300)=`#25262f` |
| GL1 | `layouts/app.vue:652` `.content` | 无底色 → `background: var(--bg-content)` | 无面板页内容底 = `#0B0B10` |
| GL3 | `layouts/app.vue:466` `.topbar` | `#000000cc` + `backdrop-filter:blur(8px)` → `var(--bg-chrome)`，**去 blur** | task.png 顶栏 y0–63 与页面同色（旧值实测渲染 `#020203`，暗 9 阶） |
| GL4 | `layouts/app.vue:504` `.mini-pill` | `height:34px` → `40px` | task.png 胶囊 y11–52（40 高） |
| GL4 | `layouts/app.vue:490` `.icon-btn` | `36×36` → `42×40` | task.png x1146–1187 / y11–52 |
| GL4 | `layouts/app.vue:530` `.recharge` / `:563` `.credits` / `:636` `.login-btn` | `36/36/36` → `40/40/40` | 同上；未登录「立即登录」胶囊 40 高 |
| GL4 | `layouts/app.vue:485` `.right` | `gap:10px` → `8px` | task.png 控件缝 7–8px |
| GL4 | `layouts/app.vue:590` `.avatar` | `36×36` → `32×32`（`font-size` 14→13） | task.png x1540–1571 / y16–47 |
| GL5 | `layouts/app.vue:500-509` `.mini-pill` | 底 `--bg-surface #191a21` + 边白 8% → 底 `#0a0a0e` + 边 `#2c2c30`；字号 12→13 | task.png 胶囊内部 29.6% 为 `#0A0A0E`；1px 描边白 14–16% |
| GL5 | `layouts/app.vue:490-498` `.icon-btn` | 底 transparent → `#0a0a0e`，边 → `#2c2c30` | 同上 |
| GL5 | `layouts/app.vue:563-571` `.credits` | 底 `--bg-surface` → `#0a0a0e`，补 `#2c2c30` 描边 | task.png 积分胶囊 61 宽、底 `#0A0A0E` |
| GL5/T7 | `layouts/app.vue:575-578` `.credits .spark` | `--brand-400 #b07aff` → `--brand-500 #9b46ff` | 竞品积分星形图标是品牌紫 |
| GL5+GL19 | `layouts/app.vue:530-561` `.recharge` | 底 `#292115`/边 `#f5c45133`/字 `#f5c451`（柠檬金）→ 底 `#1d1a12`/边 `#e1cea633`/字 `var(--gold-text)`；`.sep #e1cea640`、副标 `#e1cea6cc`、hover `#241f14` | task.png 顶栏金色胶囊：低饱和香槟金 `#E1CEA6` |
| GL14 | `layouts/app.vue:396` `.item.active` | `linear-gradient(90deg,#ffffff1a,#ffffff08)` + `font-weight:600` → `linear-gradient(90deg,#ffffff0f,#ffffff00)`，去掉 600（`:362` 统一 500），文字 `#ffffff` | task.png/`ev2-sidebar-active.png`：x14 `#1D1E25`（白 6%）→ x222 收净；选中文字峰值白，字重与未选中一致 |
| GL15 | `layouts/app.vue:356` `.nav` / `:362` `.item` | `padding:8px 12px` + `height:40/margin-bottom:2px`（节距 42）→ `padding:8px 14px` + `margin-bottom:8px`（节距 48）；项圆角 `--radius-lg(8)` → `--radius-control(10)` | `loggedin.png` 5 项图标中心 y99/147/195/243/291（等距 48）；选中块左沿 x14 |
| GL15 | `layouts/app.vue:430` `.foot .item` | 新增 `margin-bottom:0`（底部工具区保持 40 节距，不跟随 48） | task.png 底部工具区 y427/467/507/547 |
| GL10/S7 | `layouts/app.vue:317` `.logo-mark` | `34×34` → `32×32` | 竞品品牌图 32px（task.png y8–30） |
| GL4 配套 | `layouts/app.vue:661` 新增 `@media (max-width:1100px){.mini-pill{display:none}}` | 无 → 有（原断点 900）；与 `layouts/tool.vue` 已有的 1100 断点一致 | 控件统一 40 高后整排宽约 +10px，1000px 视口会横向滚动（实测 `scrollWidth` 1012→1000，已归零） |
| GL4 配套 | `layouts/app.vue:481-497` `.crumb` / `.right`、`:537-541` `.recharge`、`:572-576` `.credits` | `.crumb` 补 `min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`；`.right` 补 `flex-shrink:0`；`.recharge`/`.credits` 补 `white-space:nowrap;flex-shrink:0` | 修 GL4 带来的连带退化：1000px 视口下右侧控件簇被 flex 挤到换行（实测「会员订阅」被压成竖排、头像被切） |

### 1.3 批次 1 · 壳层（`layouts/tool.vue`）

| 条目 | 文件:行 | 改前 → 改后 | 竞品参考点 |
|---|---|---|---|
| GL1 | `layouts/tool.vue:85` `.tool-page` | 底 `--bg-app` → `--bg-chrome` | 同 GL1 |
| GL4 | `layouts/tool.vue:105` `.back` | `36×36` → `40×40` | 工具壳返回键与顶栏控件同档 |
| GL4 | `layouts/tool.vue:92` `.head` | `min-height:62px` → `64px` | 顶栏 64 |
| GL4 | `layouts/tool.vue:129` `.actions` | `gap:10px` → `8px` | 同 GL4 |
| GL4 | `layouts/tool.vue:134` `.mini-pill` | `height:34`/底 `--bg-surface`/边白 8% → `40`/`#0a0a0e`/`#2c2c30`，字号 12→13 | 同 GL5 |
| GL4 | `layouts/tool.vue:155` `.icon-btn` | `36×36` → `42×40`，补 `background:#0a0a0e`、边 `#2c2c30` | 同 GL4 |
| GL5+GL19 | `layouts/tool.vue:173-201` `.recharge` | `#141414`/白 14%/灰字 → `#1d1a12`/`#e1cea633`/`#e1cea6`；`.sep`/副标同步 | 同 GL5 |
| GL5 | `layouts/tool.vue:203-217` `.credits` | 底 `--bg-surface` → `#0a0a0e` + `#2c2c30`；`.spark` → `--brand-500` | 同 GL5 |
| GL4 | `layouts/tool.vue:221` `.avatar` | `36` → `32` | 同 GL4 |
| GL4 | `layouts/tool.vue:231` `.login-btn` | `height:34` → `40`，字号 13→14，padding 16→20 | 同 GL4 |

### 1.4 批次 1 · 基础组件

| 条目 | 文件:行 | 改前 → 改后 | 竞品参考点 |
|---|---|---|---|
| GL6 | `components/Button.vue:35` | `border-radius: var(--radius-md)`(6) → `var(--radius-control)`(10) | 01 §4.3-C1 |
| GL7 | `Button.vue:47/52/57` | `sm 28` / `md 34` / `lg 42` → `32` / `40` / `48`（走 `--control-h-*`） | 01 §3.3：主按钮 40、大号 48 |
| GL7 | `Button.vue:72/75` | `:hover` `#8a3ae6`（变暗）→ `--brand-hover #a05aff`（变亮）；新增 `:active` `#a564ff` | `--brand-02hover` / `--brand-03pressed` |
| GL7/C4 | `Button.vue:121-125` | `.primary:disabled` 未定义（吃整体 `opacity:.55`）→ `background:#9b46ff66;color:#ffffff99;opacity:1` | `--brand-04disabled` = `#9B46FF 40%` |
| GL8 | `components/TextField.vue:57-60` | `height:34` / 底 `--bg-surface #191a21` / 边白 12% / r6 → `32` / `#121216` / `#2e303a` / r10 | settings.png 搜索框 y153–184、底 `#121216`、边 `#2E303A` |
| GL8 | `TextField.vue:76-78` | `:focus` 带 `box-shadow:0 0 0 3px #7e70ff2e` → 仅 1px 品牌描边 | 竞品无外发光 |
| GL8 | `components/SelectField.vue:49-52` | 同 TextField（34/`--bg-surface`/白 12%/r6 → 32/`#121216`/`#2e303a`/r10） | 同 GL8 |
| GL8 | `SelectField.vue:65-67` | 去掉 focus 的 3px 紫晕 | 同上 |
| GL8 | `components/TextAreaField.vue:43-45` | 底 `--bg-surface`/白 12%/r6 → `#121216`/`#2e303a`/r10（并去 focus 紫晕 `:61-63`） | 同上 |
| GL9 | `components/TabBar.vue:22-26` | 容器 `border-bottom:1px var(--border-1)` → 删除 | 01 §3.7「Tab 容器无全宽分隔线」 |
| GL9 | `TabBar.vue:51-53` | `.tab.active{color:var(--brand-600)}` → `#ffffff` | pricing-full.png 选中文字峰值 `#FFFFFF` |
| GL9 | `TabBar.vue:55-63` | 下划线 `left/right:var(--space-3)`（各缩 12px）+ 紫 → `left:0;right:0` + `#ffffff`；`bottom:-1px`→`0` | pricing-full.png 下划线 y90–91 / x239–303 白，宽=文字宽 |
| GL17 | `components/EmptyState.vue:24-33` | 48×48 **实心圆底** + 22px 字形 → 无底（`background:transparent`）+ 40px 字形 + `opacity:.7` | task.png 空态 y300–400：约 80×64 插画、无圆底板 |
| GL17 | `EmptyState.vue:36-46` | 标题 16px/500 `#F5F8FFCC` + 描述 14px → 标题 13px/400 `#F5F8FF8F`，描述 12px | 同上：一行 12–13px 灰字 |

### 1.5 批次 1 · 语言切换器（GL11 + D1 组件级修法）

| 条目 | 文件:行 | 改前 → 改后 | 竞品参考点 |
|---|---|---|---|
| GL11 | `pages/tools.vue`（原 `:69`） | 删除页内 `<LangSwitcher />` | 竞品工具箱页头右上只有一个按钮（tools-recheck.png x1276–1405） |
| GL11 | `pages/pricing.vue`（原 `:360`） | 删除页内 `<LangSwitcher />` | pricing-full.png 页内无语言控件 |
| GL11 | `pages/settings.vue`（原 `:58`） | 删除页内 `<LangSwitcher />` | 竞品设置页无取证，但同屏两个切换器是缺陷 |
| GL11 | `pages/tasks.vue`（原 `:234`） | 删除页内 `<LangSwitcher />` | task.png 工具条内无语言控件 |
| GL11 | `layouts/app.vue:222` / `pages/login.vue:235` / `pages/index.vue:73` | **保留**（顶栏唯一入口 / 登录页无顶栏 / 落地页无顶栏） | 同 02 §10.4 |
| D1 | `components/i18n/LangSwitcher.vue:42-52` | 🌐 **彩色 emoji** → 内联 SVG 线性地球（16px、`stroke:currentColor`、`stroke-width:1.6`） | 顶栏其余图标同参数；emoji 是深色界面上唯一彩色噪点 |
| D1 | `LangSwitcher.vue:77-84` | `height:30` / `r8` / 底 `--bg-raised #1f1f2a` / 边白 12% / 字 12 → `40` / `r10` / `#0a0a0e` / `#2c2c30` / 字 13 | 同 GL4/GL5 |
| D1 | `LangSwitcher.vue:90-91` | chevron 定位 `13px` → `19px`（40 高时的垂直中线） | — |

### 1.6 批次 1 · 页面级（GL9 / GL11 / GL16 / GL2）

| 条目 | 文件:行 | 改前 → 改后 | 竞品参考点 |
|---|---|---|---|
| GL2 | `pages/tasks.vue:357-363` `.tasks` | `max-width:1280;margin:0 auto;padding:32px 72px 80px`（无底色）→ `background:var(--bg-panel);border-radius:12px;margin:0 10px 22px 0;padding:28px 40px 40px;min-height:calc(100vh - 64px - 22px)` | task.png 面板 x240–1589 / y64–977，圆角 12、右缩 10、下缩 22 |
| GL9 | `pages/tasks.vue:394-427` `.tabs/.tab` | 去容器 `border-bottom`；15px/600 → 14px/500；选中 `var(--text-1)` → `#ffffff`；未选 `--text-3` → `#9d9d9f`；下划线紫 → `#ffffff`，`bottom:-1px`→`0` | pricing-full.png 下划线 y90–91 白；未选 Tab 峰值 `#9D9D9F` |
| GL16 | `pages/tasks.vue:374` `.head h1` | `var(--text-2xl)`(24) → `26px` | assets.png「资」「产」单字宽 26 |
| GL9 | `pages/assets.vue:283` `.tabs` | 去容器 `border-bottom:1px var(--border-1)` | 01 §3.7 |
| GL9 | `pages/assets.vue:301-313` `.tab.on` | `color:var(--text-1);font-weight:600` + 紫下划线 → `color:#ffffff`（去 600）+ `#ffffff` 下划线、`bottom:0` | assets.png y152–175 角色页签下 2px 白线 |
| GL16 | `pages/assets.vue:264` `.head h1` | `var(--text-2xl)` → `26px` | assets.png y92–121 |
| GL9 | `pages/pricing.vue:481-504` `.price-tab` | 15px/600 + 紫下划线 → 14px/500 + `#ffffff` 下划线、`bottom:0`；未选 `#9d9d9f` | pricing-full.png y90–91 / x239–303 白线 |
| GL9 | `pages/projects/index.vue:225-250` `.tab` | 15px/600 + `background:var(--brand-500)` → 14px/500 + `#ffffff`，`.tab.active` 文字 `#ffffff`、`bottom:0`（**仅行级替换，未触碰该文件的其它在途改动**） | ref/proj-01-list.png 页签白下划线 |
| GL16 | `pages/settings.vue:109-113` `h1` | `24px` → `26px` | 同 GL16 |

### 1.7 批次 2 · 工具箱 TB1 + TB2（`pages/tools.vue` + 新增 `components/ToolCard.vue`）

| 条目 | 文件:行 | 改前 → 改后 | 竞品参考点 |
|---|---|---|---|
| TB1 | `pages/tools.vue:179-186` `.grid` | `repeat(4,minmax(0,1fr))` + `gap:20px` → `repeat(5,minmax(0,1fr))` + `gap:12px` | tools-recheck.png 列 x184–395 / 407–618 / 630–841 / 853–1064 / 1076–1287（列距 12） |
| TB1 | `pages/tools.vue:88-91` | `<NuxtLink class="tool-card"><h3>{{title}}</h3><p>{{desc}}</p></NuxtLink>`（纯文字卡，313×84）→ `<ToolCard :card="card" />`（数据仍来自 `/generations/tools`，**前端不写死卡清单**） | 同图卡 212×212 正方形 |
| TB1 | `components/ToolCard.vue`（新增，163 行） | 新版卡结构：封面层 `position:absolute;inset:0`（`radial-gradient` 光斑 + 30° 线性渐变）+ 左上 28px 线性图标 + 底部渐变压字层 `linear-gradient(180deg,transparent 42%,rgba(6,6,8,.86) 100%)` + 标题 16/600 白 + 描述 12px `#f5f8ff99` 两行 `line-clamp:2`；`aspect-ratio:1/1`、`border-radius:12px`、`overflow:hidden` | tools-recheck.png / `ev2-tools-cards.png`：封面铺满 + 底部黑色渐变压字 + 左下标题/描述 |
| TB1 色相 | `ToolCard.vue:26-52` | 5 组品牌色区间（紫 `#9b46ff→#6b5cff`、青 `#22b8cf→#1c7ed6`、橙 `#ff922b→#f76707`、绿 `#12b886→#0ca678`、红 `#f06595→#cc5de8`），由 `card.key` 的 **murmur 末混淆散列**确定性取色（不用数组下标；末混淆是为了让相邻卡不同色） | 色相全部取自竞品调色板，未引入体系外色 |
| TB1 hover | `ToolCard.vue:126-133` | `translateY(-1px)` + 背景变亮 → `translateY(-2px)` + `border:1px solid #ffffff1f`，`150ms cubic-bezier(.4,0,.2,1)`（并加 `prefers-reduced-motion` 降级） | `--default-transition-duration .15s` / `cubic-bezier(.4,0,.2,1)` |
| TB2 | `pages/tools.vue`（原 `:234,:243`） | `background:linear-gradient(180deg,#060608,#020203)`（**比页面更黑**）+ hover `#0d0d12→#050507` → 由封面渐变承担，卡不再暗于页面 | tools-recheck.png 卡内 `#1a1a1e`–`#232328` > 页底 `#0b0b10` |
| TB1 | `pages/tools.vue:60-68` | 删除页头 `.tip` 提示卡（280px，`#2a1744`/`#d9d2ff`/`#a78bfa` 三个体系外色） | tools-recheck.png 页头右上**只有一个**「工具箱创作资产」（x1276–1405 / y80–116）；02 §11 批次 2 明列「删 :136-143 提示框」 |
| TB1 断点 | `pages/tools.vue:196-222` | `1100→2 列 / 640→1 列` → `≥1440:5 / ≤1439:4 / ≤1100:3 / ≤767:2` | 01 §4.7 D2「响应式断点」 |
| GL16 | `pages/tools.vue:118-122` `h1` | `24px` → `26px` | tools-recheck.png 页标题墨迹 y88–109 |

**1.7 收尾打磨（验收后追加，主理人反馈「20 张卡读作纯色色块 + 小图标，竞品是封面图 + 底部压字」）**

| 条目 | 文件:行 | 改前 → 改后 | 竞品参考点 |
|---|---|---|---|
| TB1 打磨① 图标 | `components/ToolCard.vue:110-122` `.card-icon` | `28×28` / `top:14 left:14` / `opacity:.85` → **`44×44`** / `top:16 left:16` / `opacity:.9` + `filter:drop-shadow(0 2px 6px rgba(0,0,0,.45))`（`svg` 同步 44） | 竞品卡 212×212 里白色主体（人物/物件）占视觉重量约 1/5；我方原 28px 在 253 卡里仅 1/9，缩略图上几乎不可见。drop-shadow 让线条"浮"在渐变上（实拍主体有投影） |
| TB1 打磨② 质感 | `ToolCard.vue:102-106` `.card-cover` | 纯渐变 → 渐变 + `box-shadow: inset 0 0 90px rgba(6,6,8,.42)` 内阴影 vignette | 竞品封面四角天然衰减（实拍暗角）；无暗角时平面渐变读作"色卡" |
| TB1 打磨② 高光 | `ToolCard.vue:44-53` `coverStyle` | 2 层（radial 光斑 + 30° 线性）→ **3 层**：`linear-gradient(115deg, rgba(255,255,255,.14), rgba(255,255,255,0) 42%)` 置顶 + 原 2 层 | 竞品封面有方向性打光；高光层必须在 scrim **之下**（否则冲淡底部白字对比度） |
| TB1 打磨③ 压字 | `ToolCard.vue:124-130` `.card-scrim` | `transparent 42%, rgba(6,6,8,.86)` → `transparent **34%**, rgba(6,6,8,**.92**)` | tools-recheck.png 卡 y137–345 的压字关系：黑色起点在卡高 1/3 处（而非 42%），最深端接近纯黑，12px 描述在任意色相上都过 4.5:1 |

> **打磨的约束**：只改 `components/ToolCard.vue` 的样式与 `coverStyle` 的叠层数组——**DOM 结构未动**、`card.key` 的散列取色逻辑未动、未引入任何资产/依赖（20 张卡仍是程序化渐变，不是封面图）。


### 1.8 批次 2 · 首页 HM1 / HM2 / HM3（`pages/home.vue`）

| 条目 | 文件:行 | 改前 → 改后 | 竞品参考点 |
|---|---|---|---|
| HM1 | `pages/home.vue:380-386` `.page` | `max-width:1200;padding:40px 72px 80px`（内宽 1056）→ `max-width:1480;padding:40px 48px 80px`（1600 视口内宽 1264） | `loggedin.png` 内容带 1328（x280–1607，视口 1664 / 侧栏 240 / 内距 48） |
| HM1 | `pages/home.vue:463-469` `.hero-cards` | `gap:24px` → `12px` | loggedin.png 卡1 640 + 隙 12 + 卡2 480 = 1132 |
| HM1 | `pages/home.vue:740-747` `.case-grid` | `repeat(auto-fill, 322px)` + `gap:13`（1056 容器只放得下 **3 列**）→ `repeat(4, minmax(0,1fr))` + `gap:12` | loggedin.png 案例墙 4 卡 x280–602/615–937/950–1272/1285–1607（列距 12–13） |
| HM2 | `pages/home.vue:443-451` `.ab-btn` | `linear-gradient(120deg,#5d4ff0,#8a7dff)` + 紫描边 → `background:var(--brand-500)`，hover `--brand-hover` | pricing-full.png「立即登录」胶囊实色 `#9b46ff` |
| HM2 | `pages/home.vue:809-819` `.recent-create` | `linear-gradient(90deg,#7e70ff,#a45fff)` → `var(--brand-500)`，补 hover | 同上 |
| HM3 | `pages/home.vue:470-480` `.flow-card,.canvas-card` | `border-radius:32px` → `16px` | 圆角阶梯上限 24（`--radius-3xl`），常用 12/16 |
| GL16 | `pages/home.vue:405-409` `.hero-title` | `28px` → `26px` | loggedin.png 大标题墨迹高 21px ≈ 26/700 |

> **HM1 的一处实现取舍**：案例墙没用「`auto-fill` + 固定 322px」，改成「显式 4 等分」。原因：1600 视口下容器内宽 1264，固定 322 仍只放 3 列（322×4+12×3=1324 > 1264）；竞品自身就是 4 等分，按列数对齐、宽度自适应才能既 4 列又不溢出。

---

## 2. 自验结果

### 2.1 静态校验

| 命令 | 结论 |
|---|---|
| `npx vue-tsc --noEmit -p tsconfig.typecheck.json` | **通过（0 error，无 `@ts-ignore`）** |
| `NUXT_API_PROXY=http://127.0.0.1:3002 npx nuxt build` | **通过**（`Σ Total size: 7.27 MB (1.69 MB gzip)`；构建产物新增 `ToolCard.*.css/js`，无新增依赖） |

> 构建时显式带 `NUXT_API_PROXY=http://127.0.0.1:3002`：该值会被烘进 `routeRules['/v1/**'].proxy`，必须与 `apps/api/.env` 的 `PORT=3002` 一致（默认值 3000 在本机被另一个项目 `E:/ecpm` 占用）。

### 2.2 像素/几何量测（1600×1000，改后截图）

| 验收点 | 量测值 | 期望（竞品） | 结论 |
|---|---|---|---|
| 侧栏底 | `(100,300)` = `#101015` | `#101015` | ✅ |
| 页面 chrome（顶栏/内容底） | `#0B0B10` | `#0B0B10` | ✅ |
| 内容面板（/tasks） | `(1200,700)` = `#191A22` | `#191A22` | ✅ |
| 面板右侧缝 / 底部缝 | `(1594,500)`、`(800,995)` = `#0B0B10` | 右缩 10 / 下缩 22 | ✅ |
| 顶栏控件高 | mini-pill 40 / lang 40 / icon-btn 40 / recharge 40 / credits 40 | 40 | ✅ |
| 顶栏图标按钮宽 | 42 | 42 | ✅ |
| 顶栏控件间距 | 8,8,8,8,8,8 | 7–8 | ✅ |
| 侧栏项节距 | 48,48 | 48 | ✅ |
| 侧栏选中块 | x=14 / 宽 211 / 高 40 | x14–222 / 圆角 10 | ✅（宽差 3px） |
| Tab（/tasks、/assets、/pricing、/projects） | 选中 `#FFFFFF` + 2px 白线、宽=文字宽 | 同 | ✅ |
| 工具箱网格 | 5 列 × 253×253，列距 12，行距 12（x264/529/794/1058/1323） | 5 列正方形、列距 12 | ✅（253 是 1600 视口的等比结果，1440 视口即 212） |
| 封面卡图标 | `44×44` @ `top/left 16`、`opacity .9`、`drop-shadow(0 2px 6px rgba(0,0,0,.45))`（`getComputedStyle` 实测） | 白色主体占卡约 1/5 | ✅（打磨前 28px） |
| 封面卡叠层 | `.card-cover` 背景 3 层 + `box-shadow: inset 0 0 90px rgba(6,6,8,.42)`；`.card-scrim` `transparent 34% → rgba(6,6,8,.92)` | — | ✅ |
| 封面卡暗角实测（橙卡 2x 放大） | 左缘 `#B66625` / 右缘 `#B4530E` 对比同高内部 `#D47222` / `#D26310`（边缘约 −14% 亮度） | 封面四角衰减 | ✅ |
| 描述文字对比度 | 描述区背景 `#27160A`、文字 `#F5F8FF99` 合成 `#A3A6AD` → **6.6:1**（最亮橙卡，最坏情况） | ≥ 4.5:1 | ✅ |
| 首页案例墙 | 4 列 | 4 列 | ✅ |
| 横向溢出（1000px 视口） | `scrollWidth 1000 = innerWidth`，无越界元素 | 无横向滚动 | ✅（修前 1012） |
| 断点 | 1280：工具 4 列 / 首页 4 列；1000：工具 3 列 / 首页 2 列 | — | ✅ |

### 2.3 截图

产物目录：`_acceptance/ui-align/after/`

| 文件 | 说明 |
|---|---|
| `after/home.png` | 首页：4 列案例墙、双卡 16 圆角、内容带加宽 |
| `after/tools.png` | 工具箱：5 列渐变封面卡（44px 图标 + 暗角 vignette + 34% 起压字）、页头只剩一个紫色 CTA（验收后已按打磨条目重抓覆盖） |
| `after/_card-zoom.png` | 单卡 2× 放大（打磨取证：图标清晰度、暗角、压字对比度），非页面级截图 |
| `after/tasks.png` | 任务中心：`#191A22` 面板 + 右 10 / 下 22 缝 + 白字白线 Tab |
| `after/assets.png` / `settings.png` / `pricing.png` / `projects.png` / `t2v.png` | 其余页面回归确认（Tab 白线、无重复语言切换器、标题 26px） |
| `after/home-1280.png` / `home-1000.png` / `tools-1280.png` / `tools-1000.png` | 断点验证 |

改前对照：`_acceptance/ui-align/current/`（同尺寸 1600×1000）。

> **抓图方式（重要）**：本轮本地后端栈（API `:3002` + Postgres `:55432`）**没有在运行**，`ui-align-authed.cjs` 的短信登录走不通、所有 `requiresAuth` 页面会重定向到 `/login`。因此改用新增的 `_acceptance/ui-align-mock.cjs`：用 Playwright 拦截 `/v1/**` 返回固定夹具（信封与后端一致 `{code,msg,data}`，工具卡清单**从 `tool-catalog.ts` 源码解析**），渲染的仍是真实 `.output` 产物。**夹具只影响数据，不影响任何被验收的样式/几何。** 后端起来后重跑 `node ui-align-authed.cjs http://127.0.0.1:3011 after` 即可得到真实数据版本。

---

## 3. 未做项与原因

| 项 | 原因 |
|---|---|
| **GL2 全局内容面板** | 按主理人裁定：竞品只有 `/task`、`/novel-market` 有面板，`assets/settings/pricing` 内容区都是平色 `#0A0A0E`。**只给 `/tasks` 加面板**，其余页面保持平色，也未动其它页面的 `padding-top`。 |
| **GL10 全量替换 14 个文件的 `height:34px`** | 按主理人裁定只做 6 个「全局控件」文件（`Button/TextField/SelectField/TextAreaField/layouts/app/layouts/tool`）。页面内的 `CreateProjectModal.vue`、`SubjectLibrary.vue`、`projects/[id].vue`、`Director3D.vue`、`novel-market`、`index.vue`、`reelflow/list.vue` 等**保持原值**，避免大面积回归。`components/AccountPills.vue`（他人新增、顶栏未引用）也未动。 |
| **TK1 任务中心工具条重排**（分段控件 + 复选 + 批量操作搬进工具条） | 明确不做（批次 2 但本轮未派）。当前仅落地 GL2 面板 + GL9 Tab + GL16 标题；`批量下载` 仍在页头右上。 |
| **PJ1/PJ2/PJ3 项目卡结构 / 日期分组 / `⋮` 菜单** | 明确不做。`pages/projects/index.vue` 只有 GL9 的行级替换（Tab 白字白线），未触碰他人正在做的卡片结构。 |
| **首页轮播 coverflow / 案例墙 / 自动播放暂停 / 新手引导条** | 明确不做（轮播需要运营图与手势；引导条是功能件）。`home.vue` 的 `::before` 紫色光晕也未删（GL 清单未含 P3），它仍在内容区左上角可见。 |
| **登录弹窗改白底（P9/LG1）** | 主理人裁定保留深色（有意偏离）。本轮**未**改 `pages/login.vue` 的任何颜色；登录页输入框圆角/高度的对齐（GL6/GL8）靠组件层已生效的部分传递，未做页面内改色。 |
| **GL12 三支紫收敛 / GL13 状态色与冷调描边 / GL18 Tab 三形态选型 / GL20 过渡时长** | 不在本轮派工清单内（只派了 GL1/3/4/5/6/7/8/9/11/14/15/16/17/19）。剩余紫仍存在：`#7e70ff`（`Button.secondary`/`Tag.brand`/`TabBar.badge`/`home` 装饰）、`#7769ff`（`home` 未读徽标与光晕）、`#6d5bd0`（`login`）、`#a45fff`（`VideoGenWorkspace`）。 |
| **`EmptyState` 换真插画** | GL17 只要求「去圆底 + 减重」，现用 40px 字形（`▣`/`◷`/`◍`）近似插画位置；真插画需新素材，未做。 |
| **`/pricing` SKU 卡第 4 张被右边缘裁切** | **改前既有问题**（`current/pricing.png` 同样裁切），源于 `.pricing{max-width:1120px}` 与 4 列固定宽度的冲突，不在本轮条目内，未改。 |

---

## 4. 风险与后续建议

1. **侧栏节距 42→48 后，导航变长**：当前侧栏有 10 个主导航 + 6 个团队导航，1600×1000 下 `.nav` 已出现内部滚动（`.nav{overflow-y:auto}` 保证 `.foot` 不被挤出）。竞品只有 5+2 项所以不滚。若想彻底避免滚动条，建议下一轮把「广告剧/视频转绘/ReelFlow」等收进折叠分组，而不是回退节距。
2. **工具箱渐变封面的可辨识度**：20 张卡 5 个色相，「同色相邻」在数学上不可完全避免（已用散列末混淆把相邻同色压到最少）。真正的解法是等后端补 `cover_url`：`ToolCard.vue` 只要把 `.card-cover` 的 `background-image` 换成 `url(...)`，DOM/尺寸/断点都不用动。
3. **`--bg-panel` 与 `--bg-surface`（`#191a22` vs `#191a21`）差 1 灰阶**：两者语义不同（内容面板 / 卡片），保留两个令牌；后续若做 GL2 全局面板，需要把卡片色拉开到 `#1A1A1E`。
4. **`layouts/app.vue` 的 1100px 折叠断点是 GL4 的连带修复**：如果之后把「创作手册/商务合作」从 `disabled` 胶囊改成真入口，需要重新核对该断点下的可用宽度。

---

## 5. 与施工单的三处口径收窄（主理人裁定，已在实施中执行）

| 项 | 文档口径 | 本轮执行 |
|---|---|---|
| GL2 | 全站内容面板 | **仅 `/tasks`**（+ `/novel-market` 不在本轮） |
| GL10 | 14 个文件的 `height:34px`/`36px` | **仅 6 个全局控件文件** |
| GL14 | 侧栏选中渐变幅度 + 去 600 | 按裁定 `#ffffff0f → #ffffff00`，字重回到与未选中一致的 500 |
