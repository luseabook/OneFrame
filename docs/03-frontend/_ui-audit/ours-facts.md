# 我方（OneFrame）短剧工作流 UI 事实清单

> 审计对象：OneFrame（万星 AI 漫剧/短剧 SaaS）前端 `app/apps/web`，以**代码为唯一事实来源**，截图仅用于确认界面实际形状。
> 代码基线：`git bd4d9cc8`（2026-10-29 04:53:42，`fix(project): 新建/导入后的项目页默认落在「分镜」是错的…`），工作区 `pages/` 无未提交改动。
> 审计时间：2026-10-29 05:33–05:50（Asia/Shanghai）。
> 标记约定：无标记 = 代码/截图可判定的事实；🟡 = 代码推断（无法仅凭前端代码断言运行时行为）；❌ = 未取证（见 §4）。
> 职责边界：本文件只写「我方现状」，不含竞品结论、不含修改建议的实现方案。

---

## §0 路由 ↔ 页面文件 ↔ 当前截图 ↔ 最后更新

### 0.1 主表

| # | 路由 | 页面文件（行数 / 字节 / mtime） | 壳层 | 当前可用截图（文件 · mtime） | 截图是否晚于代码 |
|---|---|---|---|---|---|
| 1 | `/home` | `pages/home.vue`（849 / 25 694 / 10-28 05:28） | `app`（侧栏 240 + 顶栏 64） | `_acceptance/out-frontend/qa-_home.png` · 10-29 04:51 | ✅ 晚 |
| 2 | `/projects` | `pages/projects/index.vue`（383 / 9 164 / 10-27 11:36） | `app` | `qa-_projects.png` · 10-29 04:52 | ✅ 晚 |
| 3 | `/projects/:id`（单集分镜工作台／6 视图） | `pages/projects/[id].vue`（4 413 / 142 182 / 10-29 04:42） | `app` | `qa-project-109027782763577344.png`（04:51，**资产视图·角色空态**）、`now-project.png`（05:28，**分镜视图·0 分镜**）、`qa-project-1793165104599021.png` = `qa-project-tab-default.png`（04:50/04:51） | ✅ 晚（同一提交后 9 分钟） |
| 4 | `/assets` | `pages/assets.vue`（457 / 13 209 / 10-27 21:26） | `app` | `qa-_assets.png` · 10-29 04:52（**资产 tab·空态**） | ✅ 晚 |
| 5 | `/reelflow/list`（剪辑台项目列表） | `pages/reelflow/list.vue`（583 / 17 473 / 10-27 22:33） | `blank`（无侧栏无顶栏，`app.vue:46` `blankPaths = ["/canvas", "/reelflow"]`） | `qa-_reelflow_list.png` · 10-29 04:52；旧：`_acceptance/rf-01-list.png`、`rf-06-list-empty.png`（10-27 05:53） | ✅ 晚 |
| 6 | `/reelflow/edit/:id`（剪辑台·三区） | `pages/reelflow/edit/[id].vue`（2 069 / 66 051 / **10-28 05:19**） | `blank` | ❌ **无 10-29 截图**（`qa-report.json` 的 49 条路由不含该页）；现存最新为 `_acceptance/rf-05-editor-dom.png`、`rf-07-editor-empty.png`（10-27 05:5x） | ❌ **图早于代码**（详见 §4.1） |
| 7 | `/tasks`（任务中心，短剧出片结果的观测口） | `pages/tasks.vue`（644 / 19 639 / 10-27 10:01） | `app` | `qa-_tasks.png` · 10-29 04:52（**空态**） | ✅ 晚（但只覆盖空态） |
| 8 | 3D 导演台（非路由，浮层组件，两个实例入口都在 `/projects/:id`） | `components/Director3D.vue`（1 560 / 50 982 / **10-27 17:02**） | Teleport 到 `body` | `docs/03-frontend/evidence/reelflow-impl/p8-director.png`、`p8-camera-view.png`（10-25 21:40） | ❌ 图早于代码 |
| 9 | 创建项目弹窗（非路由组件；首页卡 + `/projects` FAB + 侧栏「剧本创作」共用） | `components/CreateProjectModal.vue`（760 / 18 389 / 10-25 15:23） | Teleport 到 `body` | ❌ 无 10-29 截图；旧 `_acceptance/project-modal.png`（10-25 15:28） | ❌ 图早于代码 |
| 10 | 剪辑台/工作台共用壳层 | `layouts/app.vue`（664 / 21 816 / 10-28 05:25）、`layouts/blank.vue`（42 / 1 470 / 10-26 07:46） | — | 见各页 | — |
| 11 | 设计令牌 | `assets/css/tokens.css`（222 / 6 343 / 10-25 18:36） | — | — | — |

### 0.2 入口关系（谁把用户送到哪里）

```
/home
 ├─ 「短剧工作流」卡  ──► openCreate() ──► CreateProjectModal ──► POST /projects ──► /projects/:id      (home.vue:230, 136-139)
 ├─ 「无限画布」卡    ──► comingSoon toast（不跳转）                                                     (home.vue:245, 33-35)
 ├─ 工具矩阵「剧本创作」► /projects?create=1（modal:true 但 onToolClick 走 modal 分支 → 直接开弹窗）        (home.vue:17, 41-45)
 ├─ 「最近项目」卡     ──► /projects/:id                                                                 (home.vue:354-366)
 └─ 未读徽章          ──► /tasks                                                                        (home.vue:215-217, 189-192)

layouts/app.vue 侧栏（mainNav，app.vue:13-30）
 ├─ 首页 → /home
 ├─ 剧本创作 → /projects?create=1      （= 创建项目弹窗）
 ├─ 全部项目 → /projects
 └─ 剪辑台 → /reelflow/list            （app.vue:24，i18n `sidebar.reelflow = "剪辑台"`，zh-CN.json:344）

/reelflow/list
 ├─ 「← 工作台」→ /home；「全部项目」→ /projects                        (list.vue:148, 151)
 ├─ 项目卡 → /reelflow/edit/:id                                        (list.vue:135-137)
 └─ 「＋ 创建项目」→ router.push("/projects?create=1")                 (list.vue:129-133)  ← 注意：离开 blank 壳进入 app 壳

/reelflow/edit/:id
 └─ 「← 返回分镜创作」→ /projects/:id                                  (edit/[id].vue:960)
```

**双入口事实**：首页「短剧工作流」与侧栏「剧本创作」**不是两条流程**，二者都只是「打开新建项目弹窗」；进入创作后唯一的工作面是 `/projects/:id`，剪辑面是 `/reelflow/*`。「无限画布」是独立域（`/canvas`），首页卡当前只弹 toast，属未完成入口（home.vue:245）。

---

## §1 每页明细

### 1.0 全局视觉规格（页面普遍引用的令牌）

来源 `app/apps/web/assets/css/tokens.css`（全站深色，注释自述对齐竞品一手 CSS）：

| 类别 | 令牌 | 取值 | 行号 |
|---|---|---|---|
| 品牌 | `--brand-500` | `#9b46ff` | 17 |
| | `--brand-300` / `--brand-400` | `#b8afff` / `#b07aff` | 15-16 |
| | `--brand-soft` / `--brand-soft-strong` / `--brand-border` / `--brand-on-soft` | `#9b46ff1f` / `#9b46ff33` / `#9b46ff59` / `#cf9fff` | 29-32 |
| | `--brand-40` | `rgba(155,70,255,.4)`（剪辑台选中胶囊、气泡底、拖拽 ghost） | 38 |
| 面板 | `--panel-tint` / `-strong` / `--panel-line` | `rgba(194,204,241,.08)` / `.12` / `.14` | 35-37 |
| 表面 | `--bg-app` / `--bg-surface` / `--bg-raised` / `--bg-sunken` | `#0a0a0e` / `#191a21` / `#1f1f2a` / `#0c0c10` | 62-65 |
| 文本 | `--text-1..5` | `#f5f8ff` / `cc` / `8f` / `66` / `3d` | 71-75 |
| 边框 | `--border-1..3` | `#ffffff14` / `1f` / `33` | 81-83 |
| 圆角 | `--radius-panel` / `--radius-2xl` / `--radius-full` | 20px / 1rem / 9999px | 39, 93, 95 |
| 控件高 | `--control-h` | 40px | 40 |
| 字号 | `--text-xs..5xl` | 0.75rem → 3rem（含行高变量） | 105-122 |
| 间距 | `--space-1..20` | 4px 基准 | 125-135 |
| 动效 | `--duration-fast/base/slow` | 120/200/320ms | 145-147 |
| 层级 | `--z-header/dropdown/modal/toast` | 100/200/400/500 | 150-154 |
| 布局 | `--header-h` / `--sidebar-w` | 64px / 240px | 157-158 |

侧栏折叠态 64px（app.vue:304-306），≤900px 自动折叠并把文案藏掉（app.vue:642-663）。

---

### 1.1 `/home` 工作台首页（双入口 + 工具矩阵 + 轮播 + 最近项目）

**DOM 结构**（`pages/home.vue:206-377`）

```
main.page (max-width:1200, padding 40/72/80, ::before 左上紫色光晕)           :380-397
├─ ClientOnly > OnboardingBar（"3 步做出第一集"；仅 onboarded===false）      :209-211, 90-95
├─ h1.hero-title「您的专属AI漫剧工作室」28px/700 居中                        :213-218, 402-408
│   └─ button.unread-badge「{count} 条新动态」→ /tasks                       :215-217
├─ p.ab-cta（仅 /home/ab 返回 active 变体时出现）                            :220-222, 166-168
├─ section.hero-cards（grid 640 + 480，gap 24）                             :224-260, 457-462
│   ├─ button.flow-card「短剧工作流」/「从剧本到成片，一站式创作爆款短剧」→ 创建弹窗 :230-244
│   └─ button.canvas-card「无限画布」/「创建画布，连接节点定制工作流」→ toast  :245-259
├─ section.tool-row（grid repeat(7,1fr)，gap 32）                           :262-307, 550-555
│   └─ 7 × (button.tool-card + p.tool-label)：剧本创作 / 剧本广场 / 视频转绘 /
│        视频转译 / 视频拉片 / 音色修改 / 错字重读                            :16-24
├─ section.carousel（190 高，左右箭头 + 3 张 banner，5s 自动轮播）           :309-341, 48-62
├─ div.dots（3 点）                                                          :332-341
└─ section.cases「最近项目」+「查看全部 →」/projects                           :343-373
CreateProjectModal v-model:open                                            :376
```

**组件清单**：`OnboardingBar`、`CreateProjectModal`（唯一弹窗）、`LangSwitcher`（在壳层顶栏，app.vue:222）。

**关键交互与步数**
- 首页 → 新建项目：点「短剧工作流」卡 **1 次**（home.vue:230 → 30-32 打开弹窗）。
- 工具卡：`onToolClick` 里 `if (!tool.enabled) return;`（home.vue:41-45）。7 张卡只有 `script` 是 `enabled: true`（home.vue:17）；`plaza/lips` 有「即将上线」角标、`spark` 有「一周会员」角标，`t2v/i2v/hd` **无角标**（home.vue:18-24）。四张带角标/无角标卡点击后**无任何反馈**（无 toast、无跳转；`comingSoon()` 只被 canvas-card 使用，home.vue:33-35、245）。
- 轮播：5s 自动 + 前后箭头 + 圆点（home.vue:55-62、309-341）。
- 未读：长轮询 `/home/unread`，失败退避 5s；点击清零并去 `/tasks`（home.vue:170-192）。

**状态**
- 加载：`recentLoading` 只渲染文本「加载中…」（home.vue:351），**无骨架**。
- 空态：`recent-empty`「还没有项目，创建第一个开始创作」+「创建项目」按钮（home.vue:369-372；`home.emptyRecent` zh-CN.json:777）。
- 错误：`loadRecent` catch 后直接置空数组，**首页最近项目区不给任何错误提示**（home.vue:80-82）。
- 板块显隐/排序：`GET /home/config` 驱动 `sectionVisible/sectionOrder`，拿不到就全可见、按内置顺序（home.vue:105-141）——运营可关掉「短剧工作流」卡而不报错。

**关键文案原文**（zh-CN.json:709-781）
`heroTitle:"您的专属AI漫剧工作室"`、`workflowTitle:"短剧工作流"`、`workflowDesc:"从剧本到成片，一站式创作爆款短剧"`、`canvasTitle:"无限画布"`、`canvasDesc:"创建画布，连接节点定制工作流"`、`comingSoon:"{name}即将上线，敬请期待"`、`recentTitle:"最近项目"`、`emptyRecent:"还没有项目，创建第一个开始创作"`、`dramaType:{domestic:"国内仿真人剧", overseas:"海外仿真人剧", anime:"2D/3D动漫"}`。

**视觉规格**：hero-cards 卡 `min-height:160px; padding:40px 48px; border-radius:32px`（home.vue:463-473）；flow-card 用 radial-gradient + 1px 渐变描边 + 右侧点阵遮罩（home.vue:474-493）；tool-card `height:96px; border-radius:16px`，禁用态 `opacity:.75`（home.vue:556-580）；banner 高 190（home.vue:646）；空态文案 `font-size:14px/12px`（home.vue:605-614 同族）。

---

### 1.2 创建项目弹窗 `components/CreateProjectModal.vue`

**DOM 结构**（`:186-329`）

```
Teleport > div.mask(@click.self=close)                                       :188, 333-342
└─ section.dialog[role=dialog][aria-modal=true]  宽 min(860px,96vw)，radius 16  :189, 344-354
   ├─ header.head：h2「新建项目」+ sub「项目设置将决定后续所有剧集的创作风格与画面比例，请谨慎选择。」+ ✕ :190-196
   ├─ div.body (grid 300px 1fr, gap 24)                                      :392-396
   │  ├─ 左 col：label「上传剧本」+ div.dropzone(min-height 186, 虚线)
   │  │   未选文件：图标 +「请上传剧本或分镜单，也可以从剧本库选择或粘贴文本」+「支持 xlsx/xls/csv/doc/docx/txt/md 格式」
   │  │   已选文件：📄 + 文件名 + 「{FORMAT} · {n} 字」/「解析中…」+「移除」+ warnings   :202-242
   │  │   button.link「没有文件？直接粘贴文本」/「改用上传文件」               :244-246
   │  │   textarea.paste(maxlength 50000) + 「{n}/50000」                      :248-255
   │  └─ 右 col：label「项目名称」+ input(maxlength 50)+ 计数「n/50」          :260-270
   │       label「剧目类型 ?」+ 3 张 type-card（图 + 名，选中 = 品牌描边）     :272-288
   │       label「画面比例 ?」+ 2 张 ratio-card（9:16 手机图标 / 16:9 显示器） :290-315
   ├─ p.error（校验/接口错误单行显示）                                        :319, 697-704
   └─ footer.foot：button.submit「立即创作」/「创建中…」                        :321-325
```

**组件清单**：无子组件（自带 Teleport + Transition）；文案**全部硬编码中文**，未接 `useI18n`（全文件无 `t()` 调用）。

**关键交互与闸门**
- 提交可用条件：标题 1–50 字且非提交中（`canSubmit` :44），未满足时按钮 disabled（`:322`）。
- 校验顺序：空标题 → 「请填写项目名称」；>50 → 「项目名称不能超过 50 字」；文件格式/大小在 `parseFile` 前置校验（`:81-88`：`仅支持 xlsx/xls/csv/doc/docx/txt/md 格式`、`文件超过 8MB，请拆分后上传或粘贴文本`）。
- 剧本解析：`POST /projects/parse-script`（:101-104），失败/无文本给「未能从文件中提取到文本…」（:108-111）。
- 提交：`POST /projects`，`source_type = 有文本 ? 3 : 2`，`source_text` 截断 5 万字（:165-173）；成功 toast「项目已创建，开始创作吧」→ emit created（:174-176）。
- 关闭：✕ 或点遮罩（:69-72、188）；**无 ESC 关闭、无 focus trap**。

**状态**：`parsing`（解析中）、`submitting`（创建中…）、`dragging`（拖拽高亮）、`error`、`warnings`（解析告警列表）。

**视觉**：dialog radius 16 / bg `--bg-surface`（:344-354）；type-img 58 高（:640-646）；submit 全圆 `linear-gradient(90deg,#6b5cff,#a06bff)`，disabled `#4a3f8f`（:714-731）；≤760px 单列（:743-759）。

---

### 1.3 `/projects` 项目列表（app 壳内）

**DOM 结构**（`pages/projects/index.vue:74-144`）

```
div.projects-page (max-width:1280, padding 8/0/120, min-height calc(100vh-160px))  :147-155
├─ nav.tabs：项目 / 已导出（active = 白字 + 2px `--brand-500` 下划线）              :75-82, 157-188
├─ p.err（加载失败单行）                                                            :84
├─ v-if tab==='projects'
│  ├─ Skeleton(:rows=4) ／ div.grid(auto-fill minmax(230px,1fr), gap16)            :87-106, 198-202
│  │   └─ NuxtLink.proj-card → /projects/:id
│  │       封面 aspect 16/10 + 点阵遮罩 + ratio-chip(9:16) + 示例/已归档 flag + 覆盖层标题
│  │       body：标题（**与封面标题重复**）+ 「剧目类型 · 创建日期」                  :90-105
│  └─ 空态 div.empty：「点击下方创建一个新项目」+（total===0 时）「上传剧本或粘贴文本，AI 帮你拆集、定妆、出分镜」 :108-117
└─ 已导出 tab：静态空态「暂无导出记录」/「在项目流水线内完成分镜并导出后，成片记录会出现在这里」 :120-129
FAB div.fab-wrap（fixed 底部居中）：「＋ 创建项目」                                  :131-140, 343-369
CreateProjectModal                                                              :142
```

**关键交互与步数**
- `?create=1` 深链：mounted 后打开弹窗并 `router.replace("/projects")` 清掉参数（:66-69）。侧栏「剧本创作」与剪辑台「创建项目」都走这条。
- 创建成功 → `router.push('/projects/'+id)`（:58-61）。
- 卡片点击 = 直接进项目工作台；**无 ⋯ 菜单、无重命名/删除/归档入口**（整页未出现 PATCH/DELETE 调用）。
- 请求：`/projects?page=1&page_size=50`，**无分页控件**（:44）；超过 50 个项目不可见且无提示。

**状态**：loading=`Skeleton`（初值 true，:16）、error 单行、空态（两种文案按 `total` 区分，:116）、已导出 tab 永为空态（该 tab 无数据源，:120-129 硬编码空态）。

**关键文案**（zh-CN.json:412-427）：`tabProjects:"项目"`、`tabExports:"已导出"`、`emptyCreate:"点击下方创建一个新项目"`、`emptyHint:"上传剧本或粘贴文本，AI 帮你拆集、定妆、出分镜"`、`exportsEmpty:"暂无导出记录"`、`create:"创建项目"`、`sampleFlag:"示例"`、`archivedFlag:"已归档"`。

**视觉**：proj-card `radius:12px; border:1px --border-1`，hover `translateY(-2px)`（:204-215）；FAB `height:46px; radius:999px; 深色渐变 + 18/40 投影`（:351-365）。与 `/reelflow/list` 的 FAB（48 高、28 左右内距、15px 字）近似但**不是同一组件、数值略有差异**（list.vue:561-575）。

---

### 1.4 `/projects/:id` 单集分镜工作台（短剧主战场，6 视图）

**壳与顶栏**（`pages/projects/[id].vue:1627-1671`，样式 :2498-2522）

```
div.episode (height: calc(100vh - 64px); padding 12/16; overflow hidden)      :2498-2506
├─ header.ep-head
│  ├─ 左：← （/projects，title「返回项目列表」）                              :1632
│  │     div.picker > button.ctl--picker「{当前视图} ▾」+ 菜单(280 宽，6 项带 desc) :1633-1651, 2554-2596
│  │     span.ep-title 项目名 + 来源 Tag（小说改编 / 导入剧本 / 一句话想法）    :1652-1655
│  └─ 右：span.ep-meta「9:16 · {n} 集 · {n} 角色」+「3D 导演台」+「保存」        :1657-1661
├─ Transition > p.banner--error / p.banner--info / p.banner--busy「{动作}…」    :1665-1671
└─ 6 个互斥视图（v-if / v-else-if 链，切换靠 picker，**没有 tab 条**）
```

视图键与文案（zh-CN.json:2306-2326、539-545）：

| 键 | picker 文案 | 说明文案 |
|---|---|---|
| `outline` | 剧本 | 分集大纲与梗概，确认后进入资产 |
| `characters` | 资产 | 角色定妆（场景/道具需 AI 提取链路） |
| `storyboards` | 分镜 | 单集工作台：分镜条 / 素材区 / 生成台 |
| `batch` | 导出 | 批量投递、分镜矩阵与整集 zip |
| `timeline` | 时间线导出 | 合成预览、镜头排序与整集导出 |
| `confirm` | 资产校验 | 清单核对、批量定稿与批量生成参考图 |

**初始落点**：`?tab=` 深链优先；否则「第一个未完成步骤」——无分集→`outline`、无角色→`characters`、其余→`storyboards`（:57-67，mounted 后执行 :494）。这条是 10-29 04:53 的修复（第 105 批 QA）；`now-project.png`（05:28）显示项目 66（3 集 5 角色）落在 `分镜`，与规则一致。

#### ① 剧本（outline）`:1674-1715`
- 头：`剧本 · 分集大纲` + `编辑标题与梗概（自动保存）；确认后进入资产与分镜。`；按钮「生成大纲/重新生成」+「确认大纲」（:1676-1685）。
- 卡片网格 `.ep-grid`：`chip 第N集` + Tag `已确认/草稿` + `input.ep-title-input`（maxlength 100，`@input` 防抖 600ms 自动保存，:1696、197-212）+ `textarea.ep-synopsis`（maxlength 1000，同上）+ `mini-link「进入分镜 →」`（:1696-1704，注意：该链接**只切换集**，不切视图，:523-526）。
- 空态：`EmptyState icon="✎"`「从大纲开始」/「AI 会把剧本或想法拆成 3~6 集，每集含标题与梗概，可逐条修改。」+「生成大纲」按钮（:1707-1714）。
- 闸门/提示：`outlineGenerated:"已生成 {count} 集大纲，请确认"`、`outlineConfirmed:"大纲已确认"`、`outlineAutoSaved:"大纲已自动保存"`（zh-CN.json:2378-2380）。
- **无二次确认**：`generateOutline` 直接 `POST /outline/generate` 后 reload（:175-181）。

#### ② 资产（characters）`:1718-1868`
- 头 `.av-head`：`资产 (N)` + 四 tab `角色/场景/道具/其他` + 右侧：`新建{kind}`（非角色时）、`定妆图 [1/2/3/4 张 ▾]`、`生成角色`（:1719-1750）。
- 角色卡 `.char-grid > .char-card`：定妆图或占位「未生成 / 定妆图」+ Tag `已定稿`/`待定稿` + 名称 + 描述 + 操作行：`生成定妆图|重新生成`、`定稿`（仅 `portrait_asset_id && status!==2` 时出现，:1790）、`候选图`（`source_task_id && status===2`）、`转通用资产`（:1787-1794）。
- 角色空态（三卡）：`AI 智能提取资产`（**按钮 disabled**，title「需要资产提取后端（P2）」）+ `生成角色` + `导入角色`（链接到 `/assets`）（:1801-1821）。
- 场景/道具/其他：`AI 智能提取` 条（标题旁「首次免费」，两个按钮「提取本集剧本」/「AI 智能提取」，:1754-1765）+ 草稿横幅 +「一键定稿 N 个」（:1766-1771）+ `.pa-card` 网格（生成图/候选图/编辑/定稿|取消定稿/删除，:1824-1849）+ 空态两卡（新建 / 导入）（:1850-1866）。
- 轮询：定妆图提交后 `startPortraitPoll` 2s × 20（≈40s，:331-346）；参考图 `pollAssetCandidates` 2s × 45（≈90s，:1096-1113）。
- 关键文案：`charactersGenerated:"角色已生成；生成定妆图后可定稿"`、`lookSubmitted:"定妆图任务已提交（{taskId}），完成后自动定稿"`、`draftBanner:"有 {draft} 个资产待定稿（其中 {noImg} 个还没有参考图）：定稿 + 有图才会作为参考图注入分镜生成。"`、`aiExtractDesc:"AI 分析剧本，提取出镜的场景/道具并生成资产提示词（结果为草稿，需校验定稿）"`（zh-CN.json:2384-2420、2487-2495）。

#### ③ 分镜工作台（storyboards）`:1870-2091` —— 三列
布局：`.work { grid-template-columns: 176px minmax(320px,1fr) 460px; gap:12px }`（:2944-2949）；≤1360 → `164px / 280px+ / 420px`（:3679-3683）；≤1180 → 单列、rail 限高 240、rail-list 转横向滚动、gen 最小高 420（:3684-3702）。

左栏 `.rail`（panel-tint, radius 20, padding 12，:2953-2962）：
- `button.rail-ai`「AI拆分镜」+ 右上「首次免费」小标（:1874-1876）。
- `p.rail-group`「分镜(N)」（:1877）。
- `button.shot-chip` 列表：序号 + 40px 缩略（取第 1 个绑定角色定妆图，:623-626）+ 状态文字 `已投递 / 已定稿 / 未定稿`（:1892）。
- `button.rail-add`「+ 添加分镜」**永久 disabled**，title「新增空白分镜需要后端支持（P1.5）」（:1895，i18n :2527-2528）。
- `p.rail-empty`「先点上方「AI拆分镜」按本集剧本拆分镜头」（:1896）。

中栏 `.stage`：
- `stage-tabs` 全部/图片/视频（:1901-1912）。
- `label 分镜描述` + `textarea.stage-desc`（`@blur` 保存，:1915-1921）。
- 素材区 `.mats`：每张绑定资产 = 缩略 + `✕`（title「移出本镜」）+ 名称 + `已定稿/草稿`（:1923-1937）；无素材时「暂无素材 / 点右侧「项目资产」勾选角色/场景/道具作为本镜参考」。
- 视频 tab：逐行显示投递结果（Tag `已投递` 或失败原因 + task_id 后 8 位 + 任务状态）（:1939-1950）。
- 脚注：`本地上传 [本地上传] · 时长由所选模型枚举约束`（:1952-1954，**该行把「本地上传」渲染了两次**）。
- 无选中镜：`EmptyState icon="▤"`「还没有分镜」/「选择左上「AI拆分镜」按本集剧本生成分镜表；生成后可逐镜编辑。」+「生成分镜」（:1957-1964）。

右栏 `.gen`（460px）：
- `gen-tabs` 图片生成 / 视频生成（:1970-1971）；图片生成 = `EmptyState`「图片生成暂未接入」（:2081-2089）。
- `mode-tabs` 5 模式：参考生视频 / 首帧生视频 / 首尾帧生视频 / 文生视频 / AI改视频（disabled，:1976-1988）；每项 `title` 为模式 hint（上表 §1.4 前的 i18n :2339-2350）。
- 首帧区（仅 first_frame/first_last/已有首帧时）：`3D 定格` + `清空`（:1991-2015）。
- `模型` select ← `GET /models?capability=video&visible=true&mode={modeApi}`（:591-599）。
- 常驻提示「参考生视频要求绑定资产「已定稿 + 有参考图」，否则该镜会被拒绝（400105）；文生视频只用提示词」（:2023-2025）；已有 task 时追加幂等提示「该镜已有投递任务（{id}）：同一镜头按幂等复用，切换模式不会重新出片；需要重拍请复制为新镜头或用任务重试」（:2026-2028）。
- `选择素材` + 右侧 `3D导演台` 链接（:2030-2033）；配额行「已上传素材数：图片 {img}/30 · 视频 0/10 · 音频 0/10 · 总素材 {total}/50」（:2034-2036，**数字全是前端静态拼的，不是接口值**——只有 `img` 与 `total` 来自绑定资产数，:784，其余写死 0/10/30/50，i18n :2555）。
- 两张卡：`＋ 项目资产`（打开抽屉）／`＋ 更多素材源`（disabled，title「更多素材源（P2）」）（:2038-2041）。
- `提示词` + `匹配资产`（disabled P3）/`放大编辑`（disabled P2）（:2043-2048）+ `textarea.gen-prompt`（blur 保存，:2050-2056）。
- 脚注「内容由 AI 生成，请仔细甄别 · 失败/取消不扣积分」（:2059）。
- 底：`720p` / `5 秒`（number 1–30，双向绑定 `selectedShot.duration_s`，:647-653）/ `1个` + `立即生成`（disabled 条件 `busy || !selectedShot`），按钮内带报价 `✦ {shotQuote}`（:2060-2077；报价来自 `/credits/quote/batch`，失败则不显示，:684-696）。

#### ④ 导出与投递（batch）`:2094-2182`
- 头「导出与投递」+ sub「预算触顶时该镜不投递（745703），余额不足整单拒绝；导出为整集 zip。」+「批量投递 N 镜」（:2097-2103；N=`shots.length`，不是"可投递数"）。
- `dispatch-bar`：模型 select（`models`，按 `storyboard_reference_video` 过滤，:169-173）+ `预算上限` number +「按报价预填」+「导出本集 zip」+ 下载 zip / 状态 Tag（排队中/打包中/失败）/「重试」（:2105-2126）。
- 三条黄色横幅：预算触顶（`budgetExceeded`）、余额不足（存在 745701）、角色未定稿（`characters.some(status!==2)`，附「去完成角色定稿 →」按钮切到资产视图）（:2128-2135）。
- 分镜矩阵 `.matrix-row`：图例 成功/在途/失败/未投递（:2140-2145）+ 按集一行 + 每镜一个 `.mcell`（class 由 `matrixClass` 决定，:156-161），title「镜{shot} · 状态{status} · 任务{status}」；点击 → `openMatrixShot(episodeId)`（切集 + 切到分镜视图，**:163-167 不定位到该镜**）。
- 投递结果列表：每镜 一行 `镜 N` + Tag `已提交`/失败原因（`batchReasons`：资产未定稿/超预算/余额不足/未提交，i18n :2354-2359）+ task 尾号 + 任务状态（:2164-2175）。
- 空态：`EmptyState icon="▶"`「准备批量出片」/「确认角色定稿并生成分镜后，选择模型与预算，一键投递全部镜头。」（:2176-2181）。

#### ⑤ 时间线导出（timeline）`:2185-2283`
布局：`.tl { grid-template-columns: 260px minmax(0,1fr); grid-template-rows: minmax(0,1fr) 200px; gap:12px }`（:3929-3935）。
- 左「剧集资产」+ 筛选 `全部 / 已出片`（:2186-2208）；行 = 序号 + 描述 + `已出片/未出片` 标记，**点一下即加入时间线**（`addShotClip`，:1286-1303，无确认、可重复加入）。
- 中 `.tl-stage`：紫色气泡「更新分镜：时间线不会自动同步，点下方「更新分镜」按本集已出片镜头重建」（:2211）+ 播放器或占位「请在左侧选择分镜资产加入至时间线」/「{name} 暂无可用视频文件（mock 阶段结果为占位字节）」（:2212-2229）。
- 底 `.tl-bar`：`更新分镜` / `播放|暂停` / `00:00 / 00:00`（mm:ss，:1159-1164）/ `{n} 个片段` / `缩放` 滑杆（16–120）/ `合成导出成片`（disabled 时 `!clips.length || 状态 1|2`）/ 状态 Tag（排队中/渲染中/已完成/失败）/ `下载 mp4`（:2232-2250）。
- 轨道：刻度固定 5s 一格（:2253-2260）；片段 width = `duration * pxPerSec`，操作只有 `‹  ›  ✕`（:2271-2275）；播放头 `.tl-head`；空提示「时间线为空：从左侧点选分镜加入」（:2277）。
- 说明行「时间线按分集保存在服务端（本浏览器有本地缓存兜底）；「合成导出成片」由服务端 ffmpeg 按时间线渲染 mp4 并叠加「AI 生成」水印。」（:2281）。
- 持久化：`localStorage['timeline:{projectId}:{episodeId}']` 缓存 + 服务端 700ms 防抖 PUT（:1157-1202、1236-1264）；服务端不可用 → 横幅「时间线仅保存在本地：{msg}」（:1226-1232）。

#### ⑥ 资产校验（confirm）`:2284-2376`
- 面包屑两段：`资产清单校验 ➤ 批量生成资产`（:2286-2293）+ 搜索框「搜索资产名称 / 描述」+「重新提取」（:2295-2298）。
- 工具栏：`◀ 上一集` / `第N集` / `下一集 ▶` + 统计「共 {total} · 草稿 {drafts} · 有图 {withImage} · 已选 {selected}」**紧接着又单独渲染了一次已选数**（:2312-2315）+「选中缺图」「全选/取消全选」（:2317-2320）。
- 表格六列：勾选 / 资产（名 + 描述）/ 类型 / 提示词 / 状态 Tag / 引用「{n} 镜」（:2323-2352）。
- 空态：🔍「未找到结果」/「先点右上「重新提取」从本集剧本抽取场景/道具」（:2354-2358）。
- 底栏：`🗑 删除勾选` / `取消定稿` / `批量定稿` / `下一步，批量生成资产图`（list 阶段）或 `提交生成（N）`（generate 阶段）（:2360-2375）。
- 批量动作均为「逐条 for 循环 + 单条失败不阻塞」，结束后只在 banner 报 ok/total（:1525-1610）。

#### 浮层与弹窗（同页）
| 名称 | 位置 | 要点 |
|---|---|---|
| 项目资产抽屉 | `:2378-2427` | 4 tab（角色/场景/道具/其他）+ 搜索框（**无 v-model**，:2397）+ 提示「仅「已定稿 + 有参考图」的资产会被后端采纳，否则该镜投递会被拒绝（400105）」+ 网格（已选高亮）+ 取消/应用（:2421-2424） |
| Director3D（P9 首帧） | `:2429-2436` | `:open=director3dOpen`，`@captured="onDirectorCaptured"` → 上传 + PATCH `first_frame_uri`（:1024-1055） |
| 资产编辑 Modal | `:2439-2450` | 名称/描述/提示词/参考图 uri 四字段，宽 520 |
| 参考图候选 Modal | `:2453-2466` | 720 宽，点图即采用（`selectAssetCandidate`，采用即定稿，:1130-1142） |
| 定妆图候选 Modal | `:2469-2483` | 720 宽，点图即切换并定稿（`chooseCandidate`，:298-309） |
| Director3D（P8 场景） | `:2486-2492` | `:open=directorOpen`，`project-id/episode-id/actors`，**无 @captured**（定格只下载 PNG，不回写首帧） |

**状态总览（本页）**：`busy`（横幅「{动作}…」+ 全局禁用）、`error`（红横幅）、`info`（蓝横幅）、各视图空态、`extracting/uploading/confirmBusy/exporting/assetImageBusyId/firstFrameBusy/drawerSaving` 局部忙态、`loading` 页面级（尚未见全局骨架，仅 picker 前置 `run()` 包住首屏加载，:484-493）。
轮询：定妆 2s×20、任务 2s×30（:423-442）、导出 1.5s×30（:463-482）、资产候选 2s×45。
**错误只到横幅**：所有 action 经 `run()` 统一 catch 成 `error.value`（:98-110）；成功也只写 `info.value`，两者都在顶栏下方单行、**无关闭按钮、下一次动作即覆盖**。

---

### 1.5 `/assets` 资产库（三视图）

**DOM 结构**（`pages/assets.vue:139-245`）

```
div.assets (max-width:1280, padding 32/72/80)                                :249-253
├─ header.head：h1（资产 / 回收站 / 主体库 / 抽取与匹配）+ p.sub（按 tab 变）+ 右侧动作组 :141-164
│    资产 tab 动作：回收站|返回资产库 / 新建目录 / 上传图片                       :154-163
├─ nav.tabs[role=tablist]：资产 / 主体库 / 抽取与匹配（下划线 active）           :167-183
├─ <SubjectLibrary v-if subjects> / <ProjectQualityPanel v-else-if quality>    :181-182
└─ v-else（资产 tab）
   ├─ div.filters：目录 select +（有 tag 时）标签 chip ✕，否则提示「点资产卡片上的标签可快速筛选」 :186-199
   ├─ p.err                                                                   :201
   ├─ Skeleton(:rows=3)                                                       :203
   └─ grid(auto-fill minmax(168px,1fr), gap16) > article.asset-card
        thumb aspect 4/3（hover 缩放 1.04）+ 名称 + 标签 chips + 删除|恢复        :206-229
      空态 EmptyState（icon ♻|▣）+「还没有资产」/「上传参考图，或从任务结果转存；角色定妆图转存后可在任意项目复用。」+「上传图片」 :231-241
```

**关键交互**
- 上传：`<input type=file accept="image/png,image/jpeg,image/webp" hidden>` → 前端 canvas 压缩到长边 ≤1600、jpeg 0.85 → `POST /assets/upload`（:49-84、159）。
- 目录：`prompt()` 取名字后 `POST /asset-folders`（:118-127）——**浏览器原生 prompt**，与全站弹窗范式不一致。
- 删除：原生 `confirm("删除资产 {name}？")`（:101）；回收站里可「恢复」（:86-93、224）。
- 标签筛选：点卡片标签 = 切换 `tag` query 并重载（:129-132）。
- 视图切换只改 `tab`，**不重置 error/不重置列表**（:175 直接赋 `tab = item.value`）。

**组件清单**：`Button`、`Skeleton`、`EmptyState`、`SubjectLibrary`（`components/subject/SubjectLibrary.vue`）、`ProjectQualityPanel`（`components/extraction/ProjectQualityPanel.vue`）。

**主体库**（SubjectLibrary.vue:355-525）：筛选条（类型 / 审核态 / 名称搜索 / 只看星标 / IP模板键 / 刷新 / 批量查审核态）+「从项目资产保存为主体」+「新建主体」+ 创建表单 + 卡片（封面/审核徽章/星标/模板键/风格模板应用/参考图缩略 ✕/通过/驳回/删除）+ 空态「主体库是空的」+ 脚注「共 N 个主体 · 审核三态：审核中 / 已通过 / 已驳回（驳回不可自动重试）」。

**抽取与匹配**（ProjectQualityPanel.vue:271-400）：项目/集选择 + 「抽取流水线」块（任务类型 select / 开始抽取 / 重做 / 草稿落为项目资产(N) / 状态徽章 / 草稿列表）+ 「资产 × 分镜匹配」块（执行匹配 / 保存快照 / 智能补充缺失(N) / 重置匹配 / 三列计数 角色·场景·道具 / 三列明细）。

**状态与已知瑕疵（代码可判定）**
- `loading` 初值 `false`（:24），模板 `Skeleton v-if loading / v-else …`（:203-205）→ **首帧先渲染空态**（onMounted 里 `load()` 才把 loading 置 true，:134-136、34）。网络慢时会出现「还没有资产」→ 骨架 → 列表 的跳动。
- 三个视图共用同一 `error`（:26、:201），切到主体库/抽取面板后该错误行不再显示但值仍存在。

**关键文案**（zh-CN.json:553-583）：`titleAssets:"资产"`、`subAssets:"共 {total} 个 · 上传图片自动压缩到 ≤1600px；删除后保留 7 天可恢复。"`、`tabSubjects:"主体库"`、`tabQuality:"抽取与匹配"`、`newFolder:"新建目录"`、`uploadImage:"上传图片"`、`filterHint:"点资产卡片上的标签可快速筛选"`、`emptyAssetsDesc:"上传参考图，或从任务结果转存；角色定妆图转存后可在任意项目复用。"`、`deleteConfirm:"删除资产 {name}？"`。

**视觉**：卡片范式 C（实底面板 + 1px 白 8% 边框 + 16 圆角，hover 只提亮边框，:378-388）；tag-chip 用 `--brand-soft`（:341-362，注释明确"不能用 --brand-50 亮色实体，否则白块"）；≤1024/768 两级留白降级（:434-456）。

---

### 1.6 `/reelflow/list` 剪辑台项目列表

**DOM 结构**（`pages/reelflow/list.vue:144-282`）

```
div.rl (height:100dvh; flex column; bg --bg-app; overflow hidden)              :285-292
├─ header.rl-top (64 高)：a.rl-back「← 工作台」/ span.rl-brand「剪辑台」/ a.rl-link「全部项目」 :147-152, 295-331
├─ nav.rl-tabs：「项目 ({count})」/「已导出」，active = 白字 + 2px --brand-500 下划线 :155-162, 334-363
├─ p.rl-err（加载失败单行，无重试）                                              :164, 365-372
├─ div.rl-scroll (flex1, overflow-y auto, padding 16/24/120)                    :166, 374-379
│  ├─ Skeleton(:rows=4)                                                        :167
│  ├─ 项目 tab：按日分组 section.rl-group > p.rl-group__label(今天/昨天/最近 7 天/更早) + div.rl-grid :171-217
│  │    div.rl-grid { grid-template-columns: repeat(auto-fill, minmax(300px,330px)); gap:24px }        :391-395
│  │    article.rl-card[role=button][tabindex=0]（Enter 可开）                 :174-215
│  │      ├─ div.rl-cover（aspect 16/7.2；封面或按剧型渐变；▶ 40px 圆；右上 ratio chip；左上「示例」flag）:184-189, 413-461
│  │      └─ div.rl-card__body
│  │           p.rl-card__title / p.rl-card__meta「剧型 · N 集 · 时长」/ p.rl-card__edited「最后编辑于 …」
│  │           div.rl-card__foot：span.rl-badge(草稿|制作中|已成片|已归档) + span.rl-card__shots「{done}/{total} 已出片」 :190-214
│  ├─ 项目空态：84px 插画 +「点击下方创建一个新项目」+「项目出片后在这里剪成整集：拖入已定稿分镜、排序、导出 mp4」 :220-229
│  └─ 已导出 tab：rl-grid（卡片同构，ratio chip 位置改显示成片时长；meta = 「{n} 集已剪 · 成片 mm:ss」）/ 空态 :233-271
└─ div.rl-fab-wrap(fixed 底部居中) > button.rl-fab「＋ 创建项目」                 :275-280, 554-582
```

**数据源**：`GET /works?page=1&page_size=48`（注释说明用 works 而非 projects，因为一张请求就能带 `episode_count/shot_count/done_count/cover/timeline_duration_s/timeline_episode_count`，list.vue:12-14、52-55）。**固定第 1 页、无分页/加载更多**（:34、:52）。

**关键交互与步数**
- 卡片 → `/reelflow/edit/:id`（:135-137）；键盘 Enter 同效（:182），**Space 不响应**。
- 「已导出」tab = `timeline_duration_s > 0` 本地过滤 + 按成片时长倒序（:98-103），不是导出记录。
- 「＋ 创建项目」→ `router.push("/projects?create=1")`（:129-133）：离开 blank 壳、跳到 app 壳的项目列表并开弹窗。
- 分组：`dayKey` 按本地日差 0/1/≤7/其它（:65-77）。

**状态**：`loading` 初值 true（:30）→ 首屏直接骨架，无空态闪跳；`error` 单行文本；两套空态（项目/已导出）；卡片状态徽章 4 态（:198-211）。

**关键文案**（zh-CN.json:1015-1044）：`brand:"剪辑台"`、`backHome:"← 工作台"`、`allProjects:"全部项目"`、`tabProjects:"项目 ({count})"`、`tabExported:"已导出"`、`today/yesterday/last7/earlier:"今天/昨天/最近 7 天/更早"`、`episodes:"{count} 集"`、`editedAt:"最后编辑于 {time}"`、`stateReady/Producing/Archived/Draft:"已成片/制作中/已归档/草稿"`、`shots:"{done}/{total} 已出片"`、`emptyCreate:"点击下方创建一个新项目"`、`emptyHint:"项目出片后在这里剪成整集：拖入已定稿分镜、排序、导出 mp4"`、`exportedEmptyTitle:"暂无导出记录"`、`clippedEpisodes:"{count} 集已剪"`、`finalDuration:"成片 {duration}"`、`createProject:"创建项目"`。

**视觉**：卡 `radius:16; border:1px #ffffff12; bg --panel-tint`，hover `translateY(-2px)`（:397-410）；封面 `aspect-ratio:16/7.2`（:413-419）；FAB `height:48; padding 0 28; radius 999; 渐变 #24242c→#19191f`（:561-575）。

截图对照 `qa-_reelflow_list.png`（1440×900）：顶栏三项、`项目 (5)` 激活下划线、分组「今天」、**每行 4 张卡**（1440 − 48 留白 = 1392 / (330+24) ≈ 3.9 实测 4 列）、卡片字形与「草稿」「0/0 已出片」、底部胶囊「＋ 创建项目」均与代码一致。

---

### 1.7 `/reelflow/edit/:id` 剪辑台（三区，短剧成片出口）

**DOM 结构**（`pages/reelflow/edit/[id].vue:955-1307`）

```
div.rf (height:100dvh; flex column; padding 0 8 8; overflow hidden)            :1311-1319
├─ header.rf-top (64)
│  ├─ 左：a.rf-pill「← 返回分镜创作」/ span.rf-pill--on「时间线导出」（--brand-40 底，cursor:default）/ Button「保存」 :958-963
│  ├─ 中：b.rf-title 项目名 / span.rf-dirty「未保存」（dirty 时）                 :965-968
│  └─ 右：select.rf-select 第N集（>1 集才有，否则纯文本）/ Tag 导出状态 / a「下载 mp4」/
│        Button「切片发布」/ Button.rf-export「导出」|「合成中…」                 :970-986
├─ p.rf-err（loadError 单行）                                                  :989
└─ div.rf-body (grid 290px + 1fr；rows 1fr + 150px；gap 8)                      :992, 1420-1431
   ├─ aside.rf-rail（grid-row span 2；panel-tint；radius 20；内部滚动）          :994-1052, 1434-1444
   │   head：「剧集资产」+ select「已定稿 / 全部」                                :995-1001
   │   hint：「只列**已定稿**（出片完成）的分镜素材——未定稿进不了时间线。」+「共 {finalized} / {total} 个镜头。」 :1002-1007
   │   list：div.rf-asset[data-shot-no][data-finalized]（40 缩略 / 描述或「分镜 N」/「已定稿 · 5s」或「未定稿 · {status}」/ ＋） :1009-1036
   │   EmptyState（无素材 / 无分镜两套文案）                                     :1037-1045
   │   foot：Button「更新分镜」+「轨道 {count} 段」                               :1048-1051
   ├─ section.rf-stage（bg --bg-sunken；radius 20；居中）
   │   ├─ 成片模式：video[src=exportUrl][controls] + button.rf-switch「回到分镜预览」 :1056-1059
   │   ├─ 片段模式：video[muted][playsinline]（key=clip_id）                      :1060-1070
   │   ├─ 占位：「{name} 暂无可用视频文件」+（mock 时）「（当前是 mock 适配器的占位字节，配真实 Key 后即可播放）」/「请在左侧选择分镜资产加入至时间线」 :1071-1078
   │   ├─ div.rf-bubble（右下，--brand-40）「更新分镜」+「时间线材料不会自动更新，点「更新分镜」将同步分镜创作页的全部定稿素材。」 :1081-1084
   │   └─ div.rf-exportdone（左下）「合成完成 · 已完成」+「播放成片」+「下载 mp4」   :1086-1090
   └─ footer.rf-tl（高 150）
       bar：button.rf-play「播放/暂停」/「00:00:00 / 00:00:10」/「{n} 段 · 共 {s}s」/
            Button「片段资产」/ 缩放「−」「滑杆」「＋」                            :1095-1115
       track：ruler（tick 自适应 1/2/5/10/15/30/60s，保证 ≥64px 间距）/ clips（width=duration×pxPerSec；
             b 名称 + em 时长 + ✕ 移除 + 右缘 trim 把手）/ 空提示 / 播放头          :1118-1162, 135-144
浮层：
├─ 切片发布 Modal[role=dialog]：标题输入 + 开始(秒) + 结束(秒) + 「发布切片」+ 发布记录列表
│   （标题/状态 Tag/区间「Ns ~ Ns」/裁剪模式标（已按区间裁剪 | 未裁剪（复制整片））/下载/复制 token/分享页/下架）
└─ 片段资产 Modal：已绑定列表（source/name/uri）+「绑定镜头产物」+「清空绑定」+「从项目已定稿资产中选择」按钮组
div.rf-ghost（拖拽跟随）+ p.rf-note（info / exportError 二选一，单行）             :1298-1305
```

**组件清单**：`Button`、`Tag`、`EmptyState`、`useToast`（右下角 2.6s 自动消失，`components/ToastHost.vue:4-19`）。

**交互与实现要点（代码自述 + 可验证）**
- 「已定稿」闸门：`status === 5 && video_task_id`（:71-73）；默认只列已定稿，`全部` 视图把未定稿列成半透明不可拖（`is-draft`，cursor not-allowed，title「未定稿：先去分镜页投递并等出片」，:1017-1019、1502-1505）。点/拖未定稿 → `toast.error("分镜 {no} 未定稿，不能进入时间线")`（:405-408、298-301）。
- 加入时间线：按下行 = `onRailPointerDown`（:403-423），松开时只有 `dropIndex !== null` 才 `addShot`（:471-481）；`dropIndex` 仅在指针**移动过**（`moved`）且落在轨道纵向窗口（`isOverTrack`，:396-401）时赋值（:443-455）。因此 **「单击加入」在代码上不成立**：纯单击（无位移）不会加入任何片段；可用路径只有「拖入轨道」或「聚焦后按 Enter」（`@keydown.enter`，:1021，追加到末尾）。**而三处文案都承诺点击即可加入**（`railItemTitleOk:"点击加入时间线，或拖到下方轨道"` zh-CN.json:2076、`pickAssetHint:"请在左侧选择分镜资产加入至时间线"` :2087、`timelineEmptyAdd:"时间线还是空的：从左侧点选分镜加入"` :2028）→ 见 §3-10。
- 轨道内换位：`reorder` 拖拽，`<3px` 阈值，插入线 `.is-dropbefore`（:443-500、1800-1809）。
- 裁剪：仅右边缘（出点），`duration` clamp 1–30（:460-469）；注释明确「后端 clip 契约只有 duration，硬做入点写不进去」（:460-463）。
- 键盘：`Space` 播放/暂停、`←/→` seek（Shift ×5）（:913-927）；片段聚焦后 `←/→` 换位、`Delete/Backspace` 移除（:502-519）。
- 保存：任何变更 → `dirty=true` + 700ms 防抖 `PUT .../timeline`；服务端回填 `clip_id` 同步回本地（:232-272）。
- 「更新分镜」：按本集全部已定稿镜头重建，已有镜头保留时长与顺序，移除的镜头数量写进 toast（:327-350）。
- 导出：先 `PUT` 落库再 `POST .../timeline/export`；2s 轮询 150 次（5 分钟）后写 `exportError` =「导出超时（5 分钟未完成），请到任务中心查看」（:607-668，i18n :2035）；完成 → toast「合成完成，可下载 mp4（含 AI 生成水印）」+ 舞台左下角完成条 + 顶栏「下载 mp4」。
- 切片发布：先落库再 `POST .../timeline/publish`；仅校验 `end > start`（:740-743）；记录列表轮询 2s×150 直到无 1/2 状态（:723-736）；「下架」用原生 `confirm`（:768-770）。
- 片段资产：快照语义（每次提交整体替换，已有绑定自动带上），只列「status===2 且有 ref_image_uri」的项目资产（:801-824、1265-1294）。
- 换集：清空播放/导出/发布状态并重载该集分镜与时间线（:894-911）。

**状态**：`loading`（`rf-body.is-loading` → opacity .6 + pointer-events none，:1428-1431）、`loadError` 横幅、`saving`/`exporting`/`publishing`/`clipAssetBusy` 按钮级 loading、`dirty`「未保存」、`info`/`exportError` 单行 note、`drag`/`dragGhost` 拖拽态、两处空态（无素材 / 时间线为空）、`unplayable`（`<video>` error → 占位文案，:585-588）。

**视觉要点**：左栏 290 / 底栏 150 / 三区 gap 8（:1420-1427）；rail/tl 用 `--panel-tint` + `--radius-panel`；stage 用 `--bg-sunken`；播放键 `--brand-500`（:1688-1698）；片段渐变 `linear-gradient(160deg,#2a2140,#17141f)`（:1777-1789）；浮层 720 宽、`--radius-panel`、遮罩 `rgb(0 0 0/55%)` + blur 2（:1911-1931）。

截图对照：`rf-05-editor-dom.png`（10-27）实测左栏宽度、150 高时间线、紫色气泡、`00:00:00 / 00:00:10`、`− 滑杆 ＋`、两个 5s 片段与首段选中紫边，与代码一致；`rf-07-editor-empty.png`（10-27）实测「全部」筛选下 4 条未定稿行（半透明 +「未定稿 · 状态 1」）、空轨道提示、右下红色 toast「本集还没有已定稿镜头：先去分镜页投递并等出片」。**但两张图都缺 10-28 新增的顶栏「切片发布」与底栏「片段资产」按钮**。

---

### 1.8 `/tasks` 任务中心（短剧出片结果的观测口）

- 5s 自动轮询（`setInterval(load, 5000)`，tasks.vue:163），页头「任务中心」+ sub「按「次」查看执行状态；成果请到作品库按剧查看。」（:227-236）。
- 状态 tab：全部/排队中/生成中/已完成/失败/已取消 + 右侧「共 N 条」（:173-180、239-251）。
- 表格列：任务（尾 8 位按钮）/ 状态 Tag / 模式 / 积分（`credits_frozen`）/ 创建时间 / 操作（下载[仅 status=3] / 取消[1|2] / 重试[4]）（:267-288）。
- 到期提醒横幅「有 {count} 个任务结果将在 7 天内到期，请尽快 [转存资产库]（到期后自动清理）。」（:259-262）。
- 详情弹窗：任务 ID / 状态 / 模式 / 提示词 / 比例·分辨率 / 结果 uri + 成果处理（转存资产、生成分享链接、加入项目当分镜）（:310-330 起）。
- 空态：`◷`「暂无任务」/「在工具箱或流水线投递后会出现在这里；可用顶部状态筛选查看。」+「去生成」→ `/create/text-to-video`（:292-300）。
- **与短剧的关系**：剪辑台/工作台的出片任务只能在这里观测（矩阵里只有状态色块）；`加入项目当分镜` 是短剧素材的旁路入口（`POST /projects/:id/shot-materials`，:110-121）。

---

### 1.9 3D 导演台 `components/Director3D.vue`（两个入口，浮层）

- 顶栏：「3D导演台」+ 分段「导演视角/机位视角」+（项目上下文）同步状态点/文案/「保存」/「👥 N 人在编辑」+ 快捷键提示图标 + ✕（:932-957）。
- 版本冲突条：「场景已被他人更新到 v{N}，你的改动还没保存。要覆盖服务端，还是载入最新版本？」+「覆盖服务端」/「载入最新」（:960-968）。
- 左栏「素材区」（搜索角色、`＋ 3D 世界`、角色 chips 点击移除）+「3D场景」（角色标签、网格吸附 0.5m、场景缩放 60–200%、地面透明度 0–1、平移 XYZ、旋转 XYZ）+「姿态预设」（应用下拉 / 存为预设，个人|团队）（:971-1054）。
- 中栏视口：three.js canvas +「重置视角」+ 6 图标工具条（加站位/切视角/重置/定格下载 PNG/标签/全屏）（:1056-1068）。
- 右栏「机位区」：机位1（当前）/ 预览框（FOV）/ 位置 XYZ / FOV 10–120 / 注视目标（手动|场景中心|第一个角色）+ XYZ / 操作：定格截图、切换视角、复制场景、删除场景 + 说明（项目上下文自动保存到服务端 30s + 心跳）（:1070-1142）。
- 两个实例的差异（`projects/[id].vue:2429-2436` vs `:2486-2492`）：只有 P9 实例（首帧）接 `@captured` 把定格上传成该镜首帧；P8 实例（顶栏「3D 导演台」）在项目上下文里定格只下载 PNG。

---

## §2 端到端用户动作序列（创建项目 → 导出成片）

> 口径：以代码里的真实按钮/闸门为准；点击次数按「1 次点击 = 1 次鼠标/触控确认」（输入文字单独标注）。任务级等待（生成/转码）不计点击但标注提示文案。
> 证据：`_acceptance/e2e-full.cjs`（10-25 全链路脚本，真实 UI + API + worker）与 `_acceptance/e2e-reelflow.cjs`（10-27，36 项断言）用的是同一套选择器（`.ctl--picker` → `.picker__item[data-view]`、`.shot-chip`、`.gen-btn`、`.rf-asset`），可反向验证下面每一步在真实 DOM 上确实可点。

### 2.1 分阶段表

| 阶段 | 用户看到什么 | 用户动作（点击） | 闸门 / 提示 / 反馈 | 代码位置 |
|---|---|---|---|---|
| **0 登录** | 登录页手机号 + 验证码 + 协议勾选 | 4 段（输入手机号、点「发送验证码」、输入验证码、勾选、点「立即登录」） | — | `e2e-full.cjs:17-29` |
| **1 创建项目** | 首页「短剧工作流」卡（或侧栏「剧本创作」/ 剪辑台 FAB） | ① 点入口卡（1）② （可选）拖入剧本文件或点「没有文件？直接粘贴文本」并粘贴 ③ 填项目名称（必填，≤50 字）④ 点「立即创作」（1） | 标题空/超 50 → 按钮 disabled + 行内错误；文件 >8MB 或格式不符 →「仅支持 xlsx/xls/csv/doc/docx/txt/md 格式」/「文件超过 8MB…」；成功 toast「项目已创建，开始创作吧」 | `home.vue:230`、`CreateProjectModal.vue:153-182, 44, 81-88`、`projects/index.vue:58-61` |
| **2 落到正确步骤** | 新建后进入 `/projects/:id`，落在「第一个未完成步骤」= 剧本（无分集）；顶部蓝条「这个项目还没有分集：先在第 ① 步点「生成大纲」，确认后进入角色与分镜。」 | 0（自动） | 深链 `?tab=` 可覆盖 | `projects/[id].vue:57-67, 494-500`；i18n `noEpisodesHint` :2401 |
| **3 生成/确认大纲** | 剧本视图：`生成大纲` 按钮 / 空态「从大纲开始」 | ① 点「生成大纲」（1）② 逐条改标题/梗概（输入，自动保存，0 点击）③ 点「确认大纲」（1） | 蓝条「已生成 {count} 集大纲，请确认」；改标题时「大纲已自动保存」。**重新生成会直接覆盖，无二次确认** | `:1674-1715, 175-212` |
| **4 角色与定妆** | 切到「资产」视图（picker 菜单 2 次点击）：`资产 (N)` + 角色卡 / 空态三卡 | ① picker（1）② 菜单「资产」（1）③ 点「生成角色」（1）④ 每个角色点「生成定妆图」（N 次）⑤ 若出现「候选图」→ 点开（1）+ 点选一张（1）⑥ 若出现「定稿」→ 点（1） | 定妆图提交后蓝条「定妆图任务已提交（{taskId}），完成后自动定稿」；缺图角色卡显示「未生成」占位；未定稿角色会使该角色绑定镜头在投递时被 400105 拒绝（导出视图黄条「有 {n} 个角色未定稿…」） | `:1718-1821, 270-329, 1787-1794, 2132-2135` |
| **5 AI 拆分镜** | 切「分镜」视图：左栏「AI拆分镜 首次免费」+「分镜(0)」+ 空态「还没有分镜」 | ① picker（1）② 菜单「分镜」（1）③ 点「AI拆分镜」（1） | 蓝条「已生成 {count} 个分镜」；**重跑会整体替换现有分镜，无二次确认** | `:1870-1897, 360-370` |
| **6 逐镜绑定资产** | 中栏「分镜描述」+ 素材区（空时「暂无素材 / 点右侧「项目资产」勾选…」）+ 右栏「项目资产」卡 | 每镜：① 点「＋ 项目资产」（1）② 在抽屉里勾选资产（每项 1 次）③ 点「应用到当前分镜」（1） | 抽屉提示「勾选的资产会作为本镜参考图注入生成；仅「已定稿 + 有参考图」的资产会被后端采纳，否则该镜投递会被拒绝（400105）。」；应用后蓝条「素材已更新（N 个）」 | `:1915-1937, 2038-2039, 2378-2427` |
| **7 逐镜生成** | 右栏「视频生成」：5 模式 tabs + 模型 select + 配额行 + 提示词 + 参数（720p/5 秒/1 个）+「立即生成 ✦{报价}」 | 每镜：① 确认/改提示词（输入，blur 保存 0 点击）② 点「立即生成」（1） | 报价来自 `/credits/quote/batch`（失败则不显示数字）；提交后蓝条「镜头 {no} 已投递，可在「导出」视图查看进度」；失败行内红条「镜头 {no} 未投递：{资产未定稿/超预算/余额不足}」；`AI改视频` 模式永久 disabled | `:1974-2078, 684-724, 601-615` |
| **8 批量投递** | 切「导出」视图：`导出与投递` + 模型/预算 + 「按报价预填」+「批量投递 N 镜」+ 矩阵 + 投递结果 | ① picker（1）② 菜单「导出」（1）③ 点「按报价预填」（1，可选）④ 点「批量投递 N 镜」（1） | 预填蓝条「批量报价 {quoted} 积分；预算已预填」/续投「续投预算预填：已消耗 {spent} + 剩余 {shots} 镜报价 {quoted} = {suggested} 积分」；全部失败给可行动原因（`submitAllBlockedNotReady` / `submitAllBlockedOverBudget`）；部分失败报「已提交 N 个镜头，X 个因…跳过」 | `:2094-2182, 386-421, 214-258` |
| **9 等出片 / 观测** | 矩阵色块（成功/在途/失败/未投递）+ 投递结果行 + `/tasks` 列表与详情 | 0（自动轮询 2s×30；`/tasks` 5s） | 无人工「定稿」动作：`storyboards.status=5` 由 worker 出片后写入；剪辑台闸门要求 `status===5 && video_task_id` | `:423-442, 156-161, 2137-2175, tasks.vue:163` |
| **10 进剪辑台** | 侧栏「剪辑台」→ 列表页（blank 壳，无侧栏）→ 项目卡 | ① 点侧栏「剪辑台」（1）② 点项目卡（1） | 若从 `/projects/:id` 走，注意该页无「去剪辑台」按钮，只能靠侧栏或手输地址 | `layouts/app.vue:24`、`list.vue:135-137` |
| **11 组时间线** | 剪辑台三区：左「剧集资产（只列已定稿）」/ 中播放器 / 底时间线 | 每个片段：① 从左栏**拖**到轨道（1 次拖拽；单击不入轨）② （可选）拖右缘改时长 ③ （可选）轨道内拖动换序；也可先点「更新分镜」一键按本集已定稿镜头重建（1） | 未定稿行半透明不可拖，点了给 toast「分镜 {no} 未定稿，不能进入时间线」；「更新分镜」toast「已按 {count} 个已定稿镜头同步（移除 {removed} 个不再定稿的片段）」；自动保存 700ms，顶栏出现「未保存」→ 消失 | `:994-1051, 297-350, 1118-1162, 232-272` |
| **12 导出成片** | 顶栏「导出」/ 底栏状态 Tag「排队中 → 渲染中 → 已完成」 | ① 点「导出」（1）② 等 2s 轮询 ③ 点顶栏「下载 mp4」或舞台左下「下载 mp4」（1） | 空时间线 → toast「时间线为空：先把分镜加入时间线」；成功后 toast「合成完成，可下载 mp4（含 AI 生成水印）」；5 分钟未完成 →「导出超时（5 分钟未完成），请到任务中心查看」 | `:607-680, 1086-1090, 976-986` |
| **13（可选）切片发布** | 「切片发布」弹窗：标题 + 开始/结束秒 + 发布记录 | ① 点「切片发布」（1）② 填标题/起止 ③ 点「发布切片」（1）④ 转码完成后「复制 token」或「分享页」（1） | 仅校验 end>start；前置是本集已有一次成功合成（status=3），否则 400105；记录行显示「已按区间裁剪 / 未裁剪（复制整片）」 | `:712-790, 1167-1251` |

### 2.2 步数结论

- **最短可出片路径**（1 集、1 角色、1 镜；不含登录、不含生成等待）：
  `创建 2（入口+立即创作）+ 1 处文本输入 + 大纲 2 + 切资产 2 + 生成角色 1 + 定妆图 1 + 候选/定稿 1~2 + 切分镜 2 + AI拆分镜 1 + 立即生成 1 + 切导出 2 + 批量投递 1 + 进剪辑台 2 + 拖入 1 + 导出 1 + 下载 1`
  = **约 21–22 次点击 + 1 处文本输入**（含生成角色这条最省事的路径）。若走「不生成角色、直接文生视频」可再省 3 次，但该路径需要手动切到「文生视频」模式（+1 次）。
- **典型真实剧目**（3 集 × 10 镜，3 个主要角色，逐镜走完整链路）：
  - 固定开销 ≈ 14 次（创建 2 + 大纲 2 + 切视图/集 6 + AI拆分镜 3 集 × 1 + 批量投递 3 集 × 1）
  - 角色 ≈ 3 × (生成角色 1 + 定妆 1 + 候选 1 + 定稿 1) ≈ 12 次（**无批量定妆、无批量候选**）
  - 逐镜绑定 + 生成 ≈ 30 × (抽屉 2 + 生成 1) ≈ 90 次
  - 剪辑 ≈ 2（进台）+ 30（拖入）+ 1（导出）+ 1（下载）= 34 次
  - 合计 **≈ 150 次点击**，其中 30 镜的绑定与生成占 60%。
- **一键能力盘点（代码可判定）**：一键「大纲」、「批量投递（当前集全部镜）」、「按报价预填」、「更新分镜（重建时间线）」、「一键定稿（仅非角色草稿资产，`:984-1010`）」、「批量定稿/删除/生成（资产校验视图，逐条循环）」、「合成导出成片」、「批量下载 zip（任务页）」。**没有**：一键定妆+定稿、一键「从大纲到成片」、跨集批量投递、跨集批量导出。

---

## §3 从代码可判定的 UX 缺陷 / 风险（含用户受阻方式与额外步数）

> 排序：影响面 × 不可恢复性。每条都可用 `文件:行号` 复核；🟡 为依赖后端行为的推断。

| # | 缺陷 | 代码位置 | 用户会怎样受阻 / 多花几步 |
|---|---|---|---|
| **1** | **「批量投递」不带用户选的生成模式**：右侧 5 模式只在单镜 `submitShot` 里传 `mode`，批量 `submitBatch` 的请求体只有 `shot_ids/budget_credits_max/model`；`setView('batch')` 还专门把模型重置为支持 `storyboard_reference_video` 的那个 | `projects/[id].vue:386-396`（无 `mode`）、`:702-709`（有 `mode`）、`:552-554` | 用户在「视频生成」里选「文生视频」逐镜验证通过，切到导出点「批量投递」→ 后端按默认参考生视频执行，未绑定合格资产的镜头全部 400105 失败。用户看到「已提交 0 个镜头」或大量跳过，只能回分镜页逐镜重投：3 集 30 镜 ≈ **+60 次点击**，且已消耗的报价白算。🟡（后端默认 mode 未在前端体现） |
| **2** | **项目页「时间线导出」把「已出片」等同于「有 video_task_id」**，与剪辑台闸门（`status===5 && video_task_id`）口径不一致 | `projects/[id].vue:1168-1170`（筛选）、`:2204`（文案「已出片」）、`:1308`（重建只筛 task_id） vs `reelflow/edit/[id].vue:71-73` | 只要投递过（哪怕还在排队/失败），项目页左栏就写「已出片」、可加入时间线；合成导出时才暴露缺段。用户以为材料齐了，进剪辑台发现大量片段不可用 → 回分镜页等任务、再回来重建：**+6~8 步 + 一次失败的导出等待（2s 轮询到 5 分钟超时）** |
| **3** | **剪辑台「创建项目」把用户送出剪辑台，创建完也不回剪辑台** | `reelflow/list.vue:129-133` → `projects/index.vue:66-69, 58-61` | 点「＋创建项目」→ 跳到带侧栏的 `/projects` 并弹窗；「立即创作」后落到 `/projects/:id`（分镜工作台）。想回去剪：侧栏「剪辑台」→ 在列表里重新找该项目，**+2 步且上下文丢失**（回来的是列表而非刚才的空剪辑台） |
| **4** | **剪辑台列表硬截断 48 条，无分页/加载更多/总数提示** | `reelflow/list.vue:34, 52-53` | 项目 >48 的用户：`项目 (N)` 里的 N 是后端 total，但页面永远只有第 1 页 48 张；看不到的项目没有任何入口提示 → 只能改去 `/projects`（其上限是 50，同样无分页，`:44`）。**项目越多越致命，且用户无法判断"是没有还是没加载"** |
| **5** | **「已导出」tab 名不符实**：筛的是 `timeline_duration_s > 0` 的项目，不是导出记录 | `reelflow/list.vue:98-103`；文档自认「还没有一张真正的导出历史表视图」`docs/03-frontend/reference-reelflow-spec.md:765-766` | 用户点「已导出」想找 mp4 下载，看到的是"剪过的项目"卡片；真正下载入口在每个项目的剪辑台里（顶栏「下载 mp4」/ 完成条）。找一部已导出的成片：**每个候选项目 +2 步（进剪辑台→看导出是否完成）+ 返回** |
| **6** | **片段 ✕ 无确认、无撤销，700ms 后即落库** | `reelflow/edit/[id].vue:1148`（✕ 直接 `removeClip`）、`:316-320`、`:232-236`（防抖保存） | 误点一下，片段消失并自动保存到服务端；唯一"找回"是「更新分镜」，但它会丢弃已裁剪的时长与自定义顺序（`:327-350` 的保留只对仍存在的 clip 生效）。代价：重新拖入 + 重新裁剪 N 段 ≈ **每段 +2 步** |
| **7** | **离开剪辑台会丢掉 <700ms 内未落库的改动** | `reelflow/edit/[id].vue:232-236`（700ms 防抖）、`:937-946`（`onUnmounted` 里 `clearTimeout(saveTimer)`，**不 flush**）、`:960`（「← 返回分镜创作」是普通路由跳转，无 `beforeunload`/守卫） | 拖完片段立刻点返回/刷新 → 这次拖动丢失且无任何提示；用户会以为"自动保存"兜住了。重做 1~N 步 |
| **8** | **切片发布只校验 end>start，不校验时长上界；越界时后端回退为「复制整片」** | `reelflow/edit/[id].vue:738-743`（仅 `pubEndS <= pubStartS`）、`:1183-1190`（无 max）、`:1214-1225`（事后才显示「未裁剪（复制整片）」） | 用户填 `结束=999`（或时间线只有 30s 就填 90）→ 发布出去的其实是整集，且要等转码完成才知道。修：下架 + 重发（**+3 次点击 + 一轮转码等待**），并有一次"以为发了片段实际发了全片"的内容风险 |
| **9** | **剪辑台两个浮层不能点遮罩关闭、无 ESC、无焦点陷阱** | `reelflow/edit/[id].vue:1167-1171`、`:1254-1258`（`.rf-modal` 无 `@click.self`）、`:1911-1919`；`aria-modal` 未设置（有 `role="dialog"`） | 用户点空白处关不掉（与全站 `Modal`/`CreateProjectModal` 的 `@click.self` 行为不一致，`:188`）；键盘用户 Tab 会跑到浮层后面的轨道/左栏。每次关闭多一次精准点击；误以为页面卡住 |
| **10** | **剪辑台左栏「点击加入时间线」实际不生效**：`onRailPointerDown` 起拖，`onPointerUp` 只在 `dropIndex !== null` 时才 `addShot`，而 `dropIndex` 只在指针**移动**且落在轨道纵向窗口内才被赋值；纯单击（`moved=false`）永远走不到添加分支 | `reelflow/edit/[id].vue:403-423`、`:471-481`、`:443-455`、`:396-401`；文案 `railItemTitleOk:"点击加入时间线，或拖到下方轨道"`（zh-CN.json:2076）、`pickAssetHint:"请在左侧选择分镜资产加入至时间线"`（:2087）、`timelineEmptyAdd:"时间线还是空的：从左侧点选分镜加入"`（:2028） | 用户按提示"点选"分镜 → 无任何反应（只有拖动时才出现跟随气泡），会以为素材不可用或没权限，反复点击。真正可用的是"拖到轨道"或聚焦后按 Enter（`:1021`），而这两条都没有文案提示。首次组时间线通常要多试 3~5 次才找到手势 |
| **11** | **资产页首帧先渲染空态** | `pages/assets.vue:24`（`loading = ref(false)`）、`:203-205`、`:134-136` | 首屏先出「还没有资产」，随后跳成骨架再变列表；网络慢时用户会认为资产丢了，可能重复点「上传图片」（+1 次误操作 + 一次重复上传） |
| **12** | **「新建目录」用浏览器原生 `prompt()`** | `pages/assets.vue:118-127` | 与全站深色弹窗范式冲突、不可校验、无取消回调；移动端/部分内嵌浏览器会直接屏蔽 prompt → 功能失效且无提示 |
| **13** | **「＋ 添加分镜」永久 disabled，只能靠「AI拆分镜」整集重生成**（且重生成无二次确认） | `projects/[id].vue:1895`（disabled + title「需要后端支持（P1.5）」）、`:360-370`（直接赋值 `shots`） | 对 40 镜中某 3 镜不满意：不能删/加单镜，只能整集重生成，**覆盖掉所有人工编辑过的分镜描述与提示词**（这些是 blur 自动保存的，用户会认为安全）。代价：整集 ≈ 100+ 次编辑重来 |
| **14** | **「重新生成大纲」无二次确认** | `projects/[id].vue:175-181`、按钮 `:1681-1683` | 误点即用新结果覆盖已改过的分集标题/梗概（且 `saveEpisodeDebounced` 已把它们写库，覆盖不可逆）。恢复靠手改 ≈ **每集 +2 步** |
| **15** | **角色定妆只能逐卡操作；「一键定稿」只覆盖非角色资产** | `projects/[id].vue:1787-1794`、`:984-1010`（`draftAssets` 只来自 scene/prop/other，`:948-950`） | 10 个角色 = 10×(生成定妆图 + 候选图 + 定稿) ≈ **25–30 次点击**；没有"全部角色一键定妆/一键定稿"，也无法批量选主图 |
| **16** | **角色空态卡写着「首次免费」，按钮却 disabled，且同卡文案承认"后端链路建设中"** | `projects/[id].vue:1804-1808`（`button.btn-white disabled` + title「需要资产提取后端（P2）」）、i18n `aiExtractChars`（zh-CN.json:2521、2490） | 承诺与能力矛盾：用户看到"免费"点不动，也没有替代路径（只有「去资产库」通用链接），会反复点击/以为权限不够。同类问题：`匹配资产（P3）`、`放大编辑（P2）`、`更多素材源（P2）` 都是 disabled + 仅 title 说明（`:2040, 2046-2047`），触屏设备没有 hover 就读不到原因 |
| **17** | **项目资产抽屉的搜索框没有绑定**：`<input class="drawer__search" type="search" :placeholder="搜索你想要的{kind}">` 无 `v-model`、无 `@input` | `projects/[id].vue:2397` | 用户按提示输入关键词 → 列表毫无变化（`drawerAssets` 只看 `assetTab`，`:919-924`）。只能滚动找；用户会判断"搜索坏了"或"这一个也搜不到"，逐镜绑定成本从 2 步涨到"翻列表" |
| **18** | **项目页时间线 seek 用了 `offsetX`**（剪辑台同功能已改为 `clientX - rect + scrollLeft` 并在注释里说明 offsetX 不含 scrollLeft） | `projects/[id].vue:2252` vs `reelflow/edit/[id].vue:528-541` | 时间线横向滚动后点右侧刻度区，播放头被甩到片头 → 定位失败，用户反复点（每次 +1 次点击且误判"播放器坏了"） |
| **19** | **「本地上传」文案重复渲染**：同一 i18n 键先纯文本、再作为链接文本各出现一次 | `projects/[id].vue:1952-1953` | 视觉噪音「本地上传 本地上传 · 时长由所选模型枚举约束」；用户不确定是否两个不同入口（截图 `p1-workspace.png` 实测可见） |
| **20** | **资产校验统计行把「已选」打印两次** | `projects/[id].vue:2312-2315`（`statsLine` 已含 `{selected}`，下一行又输出 `{{ confirmStats.selected }}`） | 显示成「… · 已选 3 3」；用户对数字产生怀疑，批量操作前会再核对一遍 |
| **21** | **创建项目弹窗与 3D 导演台完全硬编码中文，不随语言切换** | `components/CreateProjectModal.vue:192-323`（全文无 `useI18n`）、`components/Director3D.vue:933-1141` | 顶栏有 5 语言切换（`layouts/app.vue:222` `LangSwitcher`），切到 en/ja/es/pt-BR 后**短剧工作流的第一步（新建项目）整窗仍是中文**——新语种用户在最关键的首屏步骤读不懂提示（"项目名称"必填、"立即创作"），大概率放弃 |
| **22** | **工具矩阵里 4 张卡点击零反馈**：`t2v/i2v/hd` 无角标也没 disabled 语义，`plaza/lips/spark` 有角标但同样不响应（`comingSoon` 只服务 canvas 卡） | `pages/home.vue:16-24, 41-45, 264-305`（`onToolClick` 首行 `if (!tool.enabled) return`） | 用户点「视频拉片/音色修改/错字重读」无任何变化（无 toast、无跳转、光标仍是 pointer），会连续点击并怀疑首页坏了。对照：画布卡有 toast |
| **23** | **批量投递只能"当前集全部镜头"，不能勾选** | `projects/[id].vue:2101`（`submitBatch`）、`:392`（`shot_ids: shots.value.map(...)`） | 只想投 5 个镜头的用户必须走单镜「立即生成」×5（+5 次点击 + 5 次报价）；按钮文案「批量投递 N 镜」里的 N 是 `shots.length`，与实际可投递数不符 |
| **24** | **任务中心轮询失败静默** | `pages/tasks.vue:163`（`void load().catch(() => undefined)`）、`:27-43` | 网络抖动时列表停在旧状态、无「最后更新时间」提示 → 用户认为任务卡死，可能重复投递（浪费积分）或重复点「重试」（`:86-95` 无幂等提示） |
| **25** | **两套时间线并存且能力不对等**：项目页 `timeline` 视图只能 `‹ ›` 移动、无拖拽/裁剪/键盘/切片发布；剪辑台有全套 | `projects/[id].vue:2185-2283`（无拖拽、无发布）vs `reelflow/edit/[id].vue:352-519, 1167-1251` | 用户从项目页点「时间线导出」，用着发现拖不动、也没法发布，必须另找侧栏「剪辑台」再做一遍：**+2 步并且要在两个界面里理解两套"更新分镜"语义**（项目页按 `video_task_id` 重建、剪辑台按 `status===5` 保留时长） |
| **26** | **可访问性缺口**：浮层 `role="dialog"` 无 `aria-modal`/无焦点管理；关闭按钮只有「✕」字符无 `aria-label`；列表卡片 `role="button"` 无自定义 focus 样式（依赖全局 `:focus-visible`）；禁用态说明只写在 `title` | `reelflow/edit/[id].vue:1167-1171, 1254-1258, 1171, 1258`；`projects/[id].vue:2040, 2046-2047, 1895`；`assets/css/tokens.css:219-222` | 键盘/读屏用户无法可靠得知"对话框打开了""这是关闭按钮""为什么这个按钮点不了"；触屏用户完全没有 title 提示。影响任务可达性，不是纯装饰问题 |
| **27** | **配额行是前端静态拼装**：`图片 {img}/30 · 视频 0/10 · 音频 0/10 · 总素材 {total}/50`，其中 `img`/`total` 只是绑定资产数 | `projects/[id].vue:2034-2036` + i18n `boundCount`（zh-CN.json:2555） | 用户以为有服务端配额校验与剩余量，实际"30/10/50"是写死的文案；超出真实上限时只在投递后失败，用户无从预估（可能整轮白跑） |

---

## §4 截图缺口（未取证，禁止靠猜）

> 判定依据：`_acceptance/out-frontend/qa-report.json` 的 49 条路由清单 + 各 png 的 mtime 与对应源文件 mtime 对比。**凡「图早于代码」的，都不能作为当前实现的证据。**

### 4.1 严重缺口（页面存在、当前实现无任何截图）

1. **`/reelflow/edit/:id` 整个页面无 10-29 截图**。QA 49 条路由不含该页（`qa-report.json` 全量 route 列表）；现存最新是 `_acceptance/rf-05-editor-dom.png`、`rf-07-editor-empty.png`（10-27 05:5x），而 `pages/reelflow/edit/[id].vue` mtime 为 **10-28 05:19**。因此以下**当前存在**的界面从未被截图：
   - 顶栏「**切片发布**」按钮（`:980-982`）与切片发布弹窗（`:1167-1251`，含"未裁剪（复制整片）"标注）；
   - 底栏「**片段资产**」按钮（`:1099-1107`）与片段资产弹窗（`:1254-1296`）；
   - 导出完成态（`:1086-1090` 完成条 + 顶栏「下载 mp4」）与「播放成片」切换；
   - 拖拽中（ghost 气泡、轨道 `.is-drop` 高亮、插入线）与裁剪中（`trim` 把手可见态）；
   - 「全部」筛选下的 4+ 行未定稿（`rf-07` 有 4 行，但缺"更多行"的滚动表现）；
   - 窄屏（≤1100px 单列、rail 180 高，`:1899-1908`）。
2. **3D 导演台**：只有 10-25 的 `p8-director.png` / `p8-camera-view.png`；`Director3D.vue` mtime 10-27 17:02（含协作者、姿态预设、版本冲突条）。**当前版的同步状态条、冲突条、预设区、复制/删除场景按钮均无截图**。
3. **创建项目弹窗**：只有 10-25 15:28 的 `project-modal.png`（早于 10-25 15:23 之后的任何改动未取证）；**当前版的已选文件态、粘贴态、错误态、剧目类型/比例选中态无截图**。
4. **`/projects/:id` 五个视图的"有数据"形态**：
   - 有：`qa-project-109027782763577344.png`（资产·角色空态）、`now-project.png`（分镜·0 分镜）；
   - 缺：**有角色卡的资产视图**、**有分镜的三列工作台（当前实现）**、**导出/投递视图（矩阵有数据）**、**时间线导出视图（当前实现）**、**资产校验视图（当前实现）**。
   - 旧图 `docs/03-frontend/evidence/reelflow-impl/p1-workspace.png`(10-25)、`p6-confirm-list.png`(10-25)、`p3-*`、`p35-*`、`tl-0*` 覆盖的是 10-25 版本，与当前代码（10-29）在顶栏、模式 tabs 顺序、按钮集合上均不同。
5. **浮层/弹窗族无当前截图**：项目资产抽屉（`:2378-2427`）、参考图候选弹窗（`:2453-2466`）、定妆图候选弹窗（`:2469-2483`）、资产编辑 Modal（`:2439-2450`）。

### 4.2 状态缺口（页面有图，但状态未取证）

| 页面 | 已有截图 | 缺的状态 |
|---|---|---|
| `/home` | `qa-_home.png`（有数据、含新手引导条） | 双入口卡 hover/focus 焦点环；「无限画布」comingSoon toast；无未读/有未读两态；`/home/config` 关掉某板块后的布局；5 语言版本 |
| `/projects` | `qa-_projects.png`（有数据） | 「已导出」tab（永为空态）；空态（无项目）；创建弹窗从 `?create=1` 打开；>48 项目的表现 |
| `/projects/:id` | 资产空态、分镜空态 | 剧本视图（有集）；角色有定妆图/未定稿两态；场景/道具网格；草稿横幅 + 一键定稿；分镜有数据（左栏 chip 三态、素材区、视频 tab 结果行）；5 模式各 disabled 态；400105 拒绝后的红条；矩阵有数据 + 图例；时间线有片段；资产校验有数据 + 勾选态；顶栏 6 视图 picker 展开态；错误横幅 |
| `/assets` | 资产 tab 空态 | **主体库 tab**、**抽取与匹配 tab**（两个子面板均无 10-29 截图）；回收站；有数据网格；上传中态；目录下拉展开 |
| `/reelflow/list` | 有数据（5 项目）+ 旧空态 | 「已导出」tab（有数据 + 空态，当前实现）；加载失败（`.rl-err`）；>48 项目；窄屏 |
| `/reelflow/edit/:id` | 见 §4.1 | 见 §4.1 |
| `/tasks` | 只有空态（`qa-_tasks.png`） | 有任务列表（各状态 Tag、操作按钮可用性）、任务详情弹窗、到期提醒横幅、批量下载结果 |
| 全局 | — | 多语言（en / ja / es / pt-BR）关键页；窄屏 ≤1180 / ≤900 / ≤768；Toast 三色；键盘焦点可见性 |

### 4.3 无法从现有证据判定的问题（需真机/接口联调才能回答，标 ❌）

1. ❌ 真实供应商（`ADAPTER_MODE=real`）下 `<video>` 能否播放、剪辑台预览是否回退到占位（当前 mock 的占位字节行为见 `reference-reelflow-spec.md:769`）。
2. ❌ `POST .../generate-videos` **不带 `mode`** 时后端的实际默认值（§3-1 的推断依赖它）。前端只能看到批量请求体里没有该字段（`projects/[id].vue:386-396`）。
3. ❌ 切片发布 us 界面的上界校验/后端是否会拒绝越界 slice（§3-8 的"回退复制整片"依据是 UI 里的 `transcode_mode` 显示逻辑，`:1214-1225`）。
4. ❌ 服务端 48/50 条截断之外是否另有接口可翻页（前端未调用任何分页参数，`list.vue:52`、`projects/index.vue:44`）。
5. ❌ 3D 导演台在无 WebGL / 无 GPU 环境下是否降级（组件内未见降级分支，需运行时验证）。

---

## 附：本次审计用到的取证清单（可复现）

**代码**（全部只读）
- `app/apps/web/pages/home.vue`、`pages/projects/index.vue`、`pages/projects/[id].vue`（4 413 行，分段全读）、`pages/assets.vue`、`pages/reelflow/list.vue`、`pages/reelflow/edit/[id].vue`、`pages/tasks.vue`
- `app/apps/web/components/CreateProjectModal.vue`、`Director3D.vue`、`ToastHost.vue`、`EmptyState.vue`、`Skeleton.vue`、`Tag.vue`、`Button.vue`、`subject/SubjectLibrary.vue`、`extraction/ProjectQualityPanel.vue`
- `app/apps/web/layouts/app.vue`、`layouts/blank.vue`、`app.vue`（`blankPaths`）
- `app/apps/web/assets/css/tokens.css`
- `app/apps/web/i18n/locales/zh-CN.json`（`tasks` 213-279、`sidebar` 336-357、`projects` 412-427、`assets` 553-583、`home` 709-781、`reelflow` 1015-1044、`editor` 2015-2138、`projectDetail` 2304-2667）

**截图（read_image 实看）**
- `_acceptance/out-frontend/qa-_reelflow_list.png`（10-29 04:52）
- `_acceptance/out-frontend/qa-project-109027782763577344.png`（10-29 04:51，资产/角色空态）
- `_acceptance/out-frontend/now-project.png`（10-29 05:28，分镜/0 分镜）
- `_acceptance/out-frontend/qa-_projects.png`、`qa-_assets.png`、`qa-_home.png`、`qa-_tasks.png`（10-29 04:51-04:52）
- `_acceptance/rf-05-editor-dom.png`、`_acceptance/rf-07-editor-empty.png`（10-27 05:5x，旧版剪辑台）
- `docs/03-frontend/evidence/reelflow-impl/p1-workspace.png`、`p6-confirm-list.png`（10-25，旧版工作台与资产校验）

**脚本/报告（交叉验证选择器与链路）**
- `_acceptance/qa-report.json`（49 路由全站抓图清单，用于判定截图缺口）
- `_acceptance/e2e-full.cjs`（全链路点击序列）、`_acceptance/e2e-reelflow.cjs`（36 断言，见 spec §20.6）、`_acceptance/qa-now-state.cjs`（`now-project.png` 的来源）
- `docs/03-frontend/reference-reelflow-spec.md` §20（我方实施记录，仅作交叉核对，结论以代码为准）
