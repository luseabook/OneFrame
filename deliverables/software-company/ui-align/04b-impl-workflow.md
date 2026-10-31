# 04b 一帧 OneFrame 短剧工作流 · 前端逐页功能清点

> 清点对象：`E:/wanxing/app/apps/web`（Nuxt 3 + Vue 3 + 手写 CSS）
> 方法：**只读源码**，以 `file:line` 为唯一证据；不评价好坏、不给修改建议。
> 路径口径：表中 `file:line` 除注明外均相对根目录 `E:/wanxing/app/apps/web/`。
> 文案口径：页面文字几乎全部走 `t()`，下文"界面原文"取自 `i18n/locales/zh-CN.json`（行内注明所属命名空间）。
> 计数口径：§2 表格**一行 = 一个可操作控件/交互**（含置灰、未接线者）。

---

## §0 范围与排除（先划边界）

| 结论 | 证据 |
|---|---|
| 短剧工作流共 **7 条路由**（含 1 个 query 变体 `/projects?create=1`） | 见 §1 |
| `components/film/FilmCellEditor.vue`、`components/film/FilmReviewDrawer.vue` **不在本工作流** | 只被 `pages/film/[id].vue:517`、`:547`、`:582` 引用；`/film` 是「影视版任务表」（`pages/film/index.vue:1-19` 头注释自述"对照竞品 `/web/v1/film/projects/*`"，"项目本体表尚未建"） |
| `components/canvas/*`（含 `CanvasAgentPanel` 等 14 个）**不在本工作流** | 仅被 `pages/canvas/index.vue`、`pages/canvas/[id].vue` 引用；本工作流 7 页均无 import |
| `components/Director3D.vue` **在**本工作流 | `pages/projects/[id].vue:2473`（镜头级 3D 定格）、`:2546`（项目级场景快照）两处挂载 |
| `components/subject/SubjectLibrary.vue`、`components/extraction/ProjectQualityPanel.vue` 只出现在 `/assets` 的两个 tab | `pages/assets.vue:181-182` |
| `/assets` 在本工作流里只是"旁挂页"：分镜页有两处出口指向它 | `pages/projects/[id].vue:1852`（去资产库）、`:1990`（本地上传） |

---

## §1 路由与视图清单

### 1.1 路由总表

| # | 路由 | 文件（行数） | 页面内视图/标签页 | 视图切换机制 |
|---|---|---|---|---|
| 1 | `/projects`（含 `?create=1` 直接弹窗） | `E:/wanxing/app/apps/web/pages/projects/index.vue`（474） | 2 个 tab：**项目 / 已导出** | `const tab = ref<"projects" \| "exports">("projects")` `:20`；按钮 `:130-135`；`?create=1` 在 `onMounted` 里自动开弹窗 `:120-123` |
| 2 | `/projects/:id` | `E:/wanxing/app/apps/web/pages/projects/[id].vue`（4504） | **6 个主视图**：剧本 / 资产 / 分镜 / 导出(投递) / 时间线导出 / 资产校验；主视图内再套 4 组子视图 | 主视图 `tab` `:47`，6 个 key `:61`；下拉选择器 `:1664-1681`，`setView()` `:577-585`；深链 `?tab=` 与"落到第一个未完成步骤"逻辑 `initialTab()` `:63-71`，`onMounted` 末尾赋值 `:524` |
| 2a | ├ 资产视图子 tab | 同上 | 4 个：**角色 / 场景 / 道具 / 其他** | `assetTab` `:588`，`assetTabOptions` `:589-594`，按钮 `:1753-1763` |
| 2b | ├ 分镜视图中列子 tab | 同上 | 3 个：**全部 / 图片 / 视频** | `stageTab` `:600`，按钮 `:1939-1949` |
| 2c | ├ 分镜视图右列子 tab | 同上 | 2 个：**图片生成 / 视频生成** | `genTab` `:606`（默认 `video`），按钮 `:2007-2008` |
| 2d | ├ 视频生成内 5 个模式 | 同上 | **参考生视频 / 首帧生视频 / 首尾帧生视频 / 文生视频 / AI改视频** | `mode` `:607`，`modeOptions` `:609-615`，按钮 `:2013-2025`；可用性 `modeEnabled()` `:631-638`（`ai_edit` 恒 `false`） |
| 2e | └ 资产校验内 2 个阶段 | 同上 | **资产清单校验 / 批量生成资产** | `confirmStage` `:1490`，面包屑按钮 `:2331-2337` |
| 3 | `/reelflow/list` | `E:/wanxing/app/apps/web/pages/reelflow/list.vue`（678） | 2 个 tab：**项目 (N) / 已剪辑** | `tab` `:33`；`switchTab()` `:118-122`；按钮 `:215-221` |
| 4 | `/reelflow/edit/:id` | `E:/wanxing/app/apps/web/pages/reelflow/edit/[id].vue`（2077） | 无 tab，固定三区（左栏剧集资产 / 中区播放器 / 底部时间线）+ 2 个模态层 | 三区 CSS Grid `:1428-1435`；模态由 `showPublish` `:690`、`showClipAssets` `:800` 控制 |
| 5 | `/assets` | `E:/wanxing/app/apps/web/pages/assets.vue`（457） | 3 个 tab：**资产 / 主体库 / 抽取与匹配** | `tab` `:15`，`TABS` `:17-21`，按钮 `:167-179`；后两个 tab 渲染组件 `:181-182` |
| 6 | `/novel` | `E:/wanxing/app/apps/web/pages/novel/index.vue`（500） | 4 个 tab：**全部 / 草稿 / 已定稿 / 已归档**；弹窗内 2 模式：**小说改编 / 纯原创** | `tab` `:28`，按钮 `:186-189`；模式 `mode` `:78`，segmented `:244-247` |
| 7 | `/novel/:id` | `E:/wanxing/app/apps/web/pages/novel/[id].vue`（1165） | **7 个 tab**（章节/内容分析/章节大纲/分集大纲/核心角色/分集剧本/编辑 Agent）；原创本子（`source_type===2`）最前面**多 1 个「原创链」** | `Tab` 类型 `:38`；`ADAPT_TABS` `:431-439`；`TABS` 计算 `:442-444`；按钮 `:497-499`；`ensureTab()` 懒加载 `:396-411` |

### 1.2 工作流实际跳转链路（谁把用户送进去）

| 起点 | 终点 | 证据 |
|---|---|---|
| 侧栏「剧本创作」 | `/projects?create=1` | `layouts/app.vue:15` |
| 侧栏「全部项目」 | `/projects` | `layouts/app.vue:22` |
| 侧栏「剪辑台」 | `/reelflow/list` | `layouts/app.vue:24` |
| 侧栏「小说改编」 | `/novel` | `layouts/app.vue:17` |
| 项目卡 | `/projects/:id` | `pages/projects/index.vue:144` |
| 建项成功后 | `/projects/:id`；若带 `redirect=reelflow` 则 `/reelflow/edit/:id` | `pages/projects/index.vue:105-113` |
| 剪辑台「创建项目」 | `/projects?create=1&redirect=reelflow` | `pages/reelflow/list.vue:191` |
| 剪辑台项目卡 | `/reelflow/edit/:id` | `pages/reelflow/list.vue:195` |
| 剪辑台顶栏「← 返回分镜创作」 | `/projects/:id` | `pages/reelflow/edit/[id].vue:967` |
| 片段发布「分享页」 | `/share/:token` | `pages/reelflow/edit/[id].vue:1244` |
| 小说详情建好后 | `/novel/:id` | `pages/novel/index.vue:145` |
| 小说 → 项目（拆集） | **无入口**（见 §5-16） | — |

---

## §2 逐页功能点清单

### 2.1 `/projects`（项目列表）—— 5 条

| 区块 | 功能点（界面原文） | 行为与实现 | 位置 |
|---|---|---|---|
| 顶部 tab | **项目** | 切 `tab='projects'`，纯前端切换（不重新请求）；数据在 `onMounted` 一次拉取 | `pages/projects/index.vue:130-132` |
| 顶部 tab | **已导出** | 切 `tab='exports'`，**不调任何接口**；固定渲染静态空态「暂无导出记录 / 在项目流水线内完成分镜并导出后，成片记录会出现在这里」→ 该 tab 永为空 | `pages/projects/index.vue:133-135`、`:181-190`（`zh-CN.json:426-427`） |
| 项目网格 | 项目卡（整卡可点） | `NuxtLink` 跳 `/projects/:id`；封面按 `drama_type` 给 3 套渐变 `:145`；右上角 `ratio` chip `:146`；`is_sample` → 「示例」、`archived_at` → 「已归档」` :147-148`；底部「剧目类型 · 创建日期」`:153-157` | `pages/projects/index.vue:143-160` |
| 列表底部 | **加载更多** | `GET /projects?page&page_size=50` 追加下一页（`reset=false`），按 id 去重；仅当本页满 50 且 `list.length < total` 时出现；加载中文案变「加载中」并 `disabled` | `pages/projects/index.vue:95-99`、`:174-178` |
| 底部悬浮 | **创建项目**（FAB） | 打开 `CreateProjectModal`；建项成功回调 `onCreated` 决定跳 `/projects/:id` 或 `/reelflow/edit/:id` | `pages/projects/index.vue:192-203`、`:105-113` |

> 该页**没有**搜索、排序、重命名、删除、归档、更多「⋯」菜单（列表卡只有跳转，`pages/projects/index.vue:144`）。

### 2.2 新建项目弹窗（`CreateProjectModal`）—— 11 条

| 区块 | 功能点（界面原文） | 行为与实现 | 位置 |
|---|---|---|---|
| 左列·上传 | 虚线区「请上传剧本或分镜单，也可以从剧本库选择或粘贴文本」点击选文件 | `input[type=file]` 接受 `.txt,.md,.csv,.docx,.xlsx,.doc`（`:39`），点击触发 `fileInput.click()` | `components/CreateProjectModal.vue:202-224`、`:74-76` |
| 左列·上传 | 拖拽上传（`dragover/dragleave/drop`） | `onDrop` → `parseFile(file)`，拖入时边框/底色高亮 | `components/CreateProjectModal.vue:203-211`、`:127-131` |
| 左列·上传 | 文件校验 | 扩展名不匹配 → 「仅支持 xlsx/xls/csv/doc/docx/txt/md 格式」；>8MB → 「文件超过 8MB，请拆分后上传或粘贴文本」 | `components/CreateProjectModal.vue:81-88` |
| 左列·上传 | 文件卡「移除」 | 清空已解析文本/文件名/告警；`parsing` 时 `disabled` | `components/CreateProjectModal.vue:238`、`:133-139` |
| 左列·上传 | **没有文件？直接粘贴文本** / **改用上传文件** | 切换 `pasteMode`，切换时清空另一侧内容 | `components/CreateProjectModal.vue:244-246`、`:141-151` |
| 左列·上传 | 粘贴框 + `N/50000` 计数 | `maxlength=50000`；提交时再 `slice(0,50000)` | `components/CreateProjectModal.vue:248-255`、`:165` |
| 右列 | **项目名称** 输入 + `N/50` 计数 | `maxlength=50`；`Enter` 触发 `submit`；满 50 字计数变黄 | `components/CreateProjectModal.vue:260-270` |
| 右列 | **剧目类型**（3 卡：国内仿真人剧 / 海外仿真人剧 / 2D/3D动漫） | 选中态描边；值 `1/2/3` 提交为 `drama_type` | `components/CreateProjectModal.vue:272-288`、`:30-34` |
| 右列 | **画面比例**（2 卡：9:16 / 16:9） | 值提交为 `ratio` | `components/CreateProjectModal.vue:290-315`、`:35-38` |
| 底部 | **立即创作** | `POST /projects`（`title/drama_type/ratio/source_type`（有文本=3 否则 2）/`source_text`/`source_file_name`）；成功 `toast.success("项目已创建，开始创作吧")` → `emit('created')`；失败在弹窗内红条显示后端 msg；`disabled` 条件 = 标题为空或 >50 或提交中 | `components/CreateProjectModal.vue:153-182`、`:322-324` |
| 头部 | **✕** / 点击遮罩关闭 | `submitting` 时 `close()` 直接 return（提交中不可关） | `components/CreateProjectModal.vue:195`、`:69-72`、`:188` |

> 文案承诺「也可以从剧本库选择」( `:222` )，但弹窗内**没有剧本库入口按钮**（左列只有上传、粘贴两条路）。

### 2.3 `/projects/:id`（单集工作台）—— 105 条

#### 2.3.1 顶栏（7 条）

| 区块 | 功能点（界面原文） | 行为与实现 | 位置 |
|---|---|---|---|
| 顶栏左 | **←** 返回项目列表 | `NuxtLink to="/projects"`，`title`「返回项目列表」 | `pages/projects/[id].vue:1662` |
| 顶栏左 | 视图选择器（当前视图名 + ▾） | 打开 `viewMenu`，列出 6 项（剧本/资产/分镜/导出/时间线导出/资产校验），每项带一行说明；点击 `setView()` 切 `tab`；切到 `timeline` 会 `loadTimeline()`，切到 `batch` 会校正模型 | `pages/projects/[id].vue:1663-1681`、`:577-585` |
| 顶栏左 | 来源 Tag（**小说改编 / 导入剧本 / 一句话想法**） | 按 `project.source_type`（1/3/其他）渲染不同 tone 的 Tag | `pages/projects/[id].vue:1683-1685` |
| 顶栏右 | 元信息「9:16 · N 集 · N 角色」 | 纯展示，读 `project.ratio / episodes.length / characters.length` | `pages/projects/[id].vue:1688` |
| 顶栏右 | **3D 导演台** | 打开**项目级** `Director3D`（带 `project-id`/`episode-id`，组件内部管 30s 自动保存+心跳+版本冲突） | `pages/projects/[id].vue:1689`、`:2546-2552` |
| 顶栏右 | **保存** | `PATCH .../storyboards/:sid` 保存当前选中镜的 `shot_desc/video_prompt/duration_s`；`disabled = busy 或 未选镜` | `pages/projects/[id].vue:1690`、`:727-730`、`:402-414` |
| 顶栏右 | 账户胶囊 `AccountPills` | 复用全局账号入口（本页用 `layout:"blank"`，无侧栏，靠它承载账户/积分） | `pages/projects/[id].vue:1691`、`:20` |

#### 2.3.2 ① 剧本（分集大纲）—— 6 条

| 区块 | 功能点（界面原文） | 行为与实现 | 位置 |
|---|---|---|---|
| 面板头 | **生成大纲** / **重新生成** | 已有分集时文案变「重新生成」并**先弹二次确认**（「重新生成会覆盖已编辑的分集标题与梗概，确定继续？」）；确认后 `POST /projects/:id/outline/generate`，成功 `loadProject()` + info「已生成 N 集大纲，请确认」；`disabled=busy` | `pages/projects/[id].vue:1712-1714`、`:381-400`、`:179-185` |
| 面板头 | **确认大纲** | `PUT /projects/:id/outline`（整体提交 ep_no/title/synopsis）→ `loadProject()`，info「大纲已确认」；无分集时 `disabled` | `pages/projects/[id].vue:1715`、`:187-199` |
| 分集卡 | 分集标题输入 | `@input` 600ms 防抖 `PATCH .../episodes/:eid`（只发 title/synopsis）；成功 info「大纲已自动保存」；失败**静默吞掉**（`catch {}`，不打扰输入） | `pages/projects/[id].vue:1727`、`:201-216` |
| 分集卡 | 本集梗概 textarea | 同上（`maxlength=1000`） | `pages/projects/[id].vue:1728-1734` |
| 分集卡 | **进入分镜 →** | `selectEpisode(ep.id)` 切当前集并 `loadEpisode()`；**不切 tab**（用户需自己再用视图选择器切「分镜」） | `pages/projects/[id].vue:1735`、`:553-556` |
| 空态 | 「从大纲开始」+ **生成大纲** | `EmptyState` 图标 ✎，描述「AI 会把剧本或想法拆成 3~6 集…」，按钮同 `maybeGenerateOutline` | `pages/projects/[id].vue:1738-1745` |

#### 2.3.3 ② 资产（角色/场景/道具/其他）—— 22 条

| 区块 | 功能点（界面原文） | 行为与实现 | 位置 |
|---|---|---|---|
| 头部 | 4 个 tab **角色 / 场景 / 道具 / 其他** | 切 `assetTab`；计数 `(N)` 随 tab 变 | `pages/projects/[id].vue:1752-1763` |
| 头部 | **新建{场景/道具/其他}** | 仅非角色 tab 显示；打开资产编辑弹窗（新建态） | `pages/projects/[id].vue:1765-1773`、`:837-847` |
| 头部 | **定妆图** 张数下拉（1/2/3/4 张） | 仅角色 tab 显示；值 `portraitCount` 作为 `portrait` 接口的 `count` | `pages/projects/[id].vue:1774-1779`、`:286` |
| 头部 | **生成角色** | `POST .../characters/generate {count:5}`（**硬编码 5**）→ `loadProject()`，info「角色已生成；生成定妆图后可定稿」 | `pages/projects/[id].vue:1780`、`:274-280` |
| AI 提取条 | **提取本集剧本** | `POST .../assets/extract {episode_id}`；成功 info 拼「新增 N，更新 N，跳过重复 N」；`disabled = extracting 或 无选中集` | `pages/projects/[id].vue:1791`、`:982-1007` |
| AI 提取条 | **AI 智能提取**（提取中变「提取中…」） | `POST .../assets/extract {}`（全项目范围） | `pages/projects/[id].vue:1792-1794` |
| 草稿横幅 | 「有 N 个资产待定稿…」+ **一键定稿 N 个** | 只定稿**已有参考图**的草稿（逐条 `PATCH .../assets/:aid {status:2}`）；无图则报「待定稿的资产都还没有参考图：先点「生成图」（或导入图片）再定稿」 | `pages/projects/[id].vue:1797-1802`、`:1014-1040` |
| 角色卡 | **生成定妆图** / **重新生成** | `POST .../characters/:cid/portrait {count}` → info「定妆图任务已提交（taskId），完成后自动定稿」→ `startPortraitPoll()`（2s 轮询 `loadProject`，最多 20 次） | `pages/projects/[id].vue:1818-1820`、`:282-291`、`:335-350` |
| 角色卡 | **定稿** | 仅当 `portrait_asset_id && status!==2` 显示；`POST .../characters/:cid/finalize` → info「{name} 已定稿，可被分镜引用」 | `pages/projects/[id].vue:1821-1823`、`:327-333` |
| 角色卡 | **候选图** | 仅当 `source_task_id && status===2` 显示；`GET .../portrait/candidates` → 打开定妆图候选弹窗 | `pages/projects/[id].vue:1824`、`:293-300` |
| 角色卡 | **转通用资产** | 仅当 `portrait_asset_id && status===2` 显示；`POST .../characters/:cid/to-asset` → info「已转存为通用资产（tags）…」 | `pages/projects/[id].vue:1825`、`:264-272` |
| 角色空态 | **AI 智能提取**（带「即将开放」chip） | **恒 `disabled`**，`title`「智能提取资产即将开放」 | `pages/projects/[id].vue:1837-1840` |
| 角色空态 | **生成角色** | 同 `generateCharacters` | `pages/projects/[id].vue:1847` |
| 角色空态 | **去资产库** | `NuxtLink to="/assets"`（本地上传角色的替代路径） | `pages/projects/[id].vue:1852` |
| 场景/道具卡 | **生成图** / **重新生成图** | `POST .../assets/:aid/generate-image {}` → info「已提交生成（model），正在等待结果…」→ 轮询候选图 45 次×2s；超时报「生成超时：稍后可在资产卡上点「候选图」再试」 | `pages/projects/[id].vue:1872-1874`、`:1107-1143` |
| 场景/道具卡 | **候选图** | `GET .../assets/:aid/candidates` → 打开参考图候选弹窗；失败「暂无可选候选图」 | `pages/projects/[id].vue:1875`、`:1145-1158` |
| 场景/道具卡 | **编辑** | 打开资产编辑弹窗（回填 name/description/prompt/ref_image_uri） | `pages/projects/[id].vue:1876`、`:837-847` |
| 场景/道具卡 | **定稿** | `PATCH .../assets/:aid {status:2}` → info「「{name}」已定稿，可作为参考图注入分镜」 | `pages/projects/[id].vue:1877`、`:872-878` |
| 场景/道具卡 | **取消定稿** | `PATCH {status:1}` → info「已更新」 | `pages/projects/[id].vue:1878` |
| 场景/道具卡 | **删除** | `DELETE .../assets/:aid` → 刷新资产并 `loadEpisode()`，info「已删除「{name}」」；**无二次确认** | `pages/projects/[id].vue:1879`、`:880-887` |
| 场景空态 | **新建{kind}** | 打开资产编辑弹窗 | `pages/projects/[id].vue:1889` |
| 场景空态 | **导入{kind}**（原生 file 选择） | 前端校验 ≤8MB → `POST /assets/upload`（base64）→ `POST .../assets {kind, name=文件名, ref_image_uri}` → info「已导入，定稿后会作为参考图注入分镜生成」 | `pages/projects/[id].vue:1894-1897`、`:890-926` |

#### 2.3.4 ③ 分镜工作台（左·分镜条 / 中·素材区 / 右·生成台）—— 23 条

| 区块 | 功能点（界面原文） | 行为与实现 | 位置 |
|---|---|---|---|
| 左栏 | **AI拆分镜**（带「首次免费」角标） | 已有分镜时先弹二次确认（「AI 拆分镜会整体替换本集现有分镜（含已编辑的描述与提示词），确定继续？」）；确认后 `POST .../storyboards/generate {shot_count}`（`shotCount=10` 但**页面上没有输入框**，见 §5-11）→ `loadEpisode()`，info「已生成 N 个分镜」；`disabled = busy 或 无选中集` | `pages/projects/[id].vue:1908-1910`、`:388-400`、`:364-374` |
| 左栏 | 分镜条（镜号 + 缩略 + 状态） | 点击 `selectShot(id)`；缩略取**首个绑定角色的定妆图**（无图则灰块）；状态文案按 `video_task_id` →「已投递」、`status===5` →「已定稿」、否则「未定稿」 | `pages/projects/[id].vue:1913-1927`、`:650-656` |
| 左栏 | **+ 添加分镜**（带「即将开放」chip） | **恒 `disabled`**，`title`「单镜增删即将开放」 | `pages/projects/[id].vue:1929-1932` |
| 中列 | 3 个 tab **全部 / 图片 / 视频** | 切 `stageTab`；`video` tab 把素材区换成"出片结果列表"，且**忽略图片筛选**（`全部` 与 `图片` 渲染同一网格，见 `stageMaterials` 未被使用 §5-4） | `pages/projects/[id].vue:1939-1949`、`:600`、`:658-666` |
| 中列 | **分镜描述** textarea | `@blur` 触发 `saveSelectedShot()` → `PATCH .../storyboards/:sid` | `pages/projects/[id].vue:1952-1958` |
| 中列 | 素材卡右上 **✕**（移出本镜） | `PUT .../storyboards/:sid/assets {asset_ids: 去掉该 id 后的全集}`（整体替换语义）→ info「素材已更新（N 个）」 | `pages/projects/[id].vue:1961-1969`、`:942-946`、`:929-940` |
| 中列 | 视频 tab：出片结果行 | 只读渲染 `batchItems`：已投递 Tag / 失败原因 Tag / taskId 后 8 位 / `statusLabel(taskMap[task].status)` | `pages/projects/[id].vue:1976-1987`、`:667-673` |
| 中列 | **本地上传** 链接 | `NuxtLink to="/assets"`（跳出工作台，无内嵌上传） | `pages/projects/[id].vue:1989-1991` |
| 右列 | **图片生成** tab | 整个 tab 是 `EmptyState`：「图片生成暂未接入 / 当前后端只提供分镜视频生成…图片生成（定妆图）在「资产」视图的角色卡上操作。」+ 按钮「去资产生成定妆图」（跳 `tab='characters'`） | `pages/projects/[id].vue:2125-2133`、`:2007` |
| 右列 | **视频生成** tab（默认） | 切换到视频参数面板 | `pages/projects/[id].vue:2008`、`:606` |
| 右列 | 5 个生成模式 tab | **参考生视频 / 首帧生视频 / 首尾帧生视频 / 文生视频 / AI改视频**；`modeEnabled()`：`ai_edit` 恒 false，`first_frame` 需 ≥1 张合格资产图或该镜已有首帧，`first_last` 需 ≥2；不可用时 `disabled` + `off` 样式 + hover hint | `pages/projects/[id].vue:2013-2025`、`:631-645` |
| 右列 | 首帧区 **3D 定格** | 打开镜头级 `Director3D`；捕获后 `onDirectorCaptured()`：`POST /assets/upload` → `PATCH .../storyboards/:sid {first_frame_uri}` → info「已把 3D 定格设为镜头 N 的首帧…」；`firstFrameBusy` 时文案变「上传中…」 | `pages/projects/[id].vue:2028-2052`、`:2039-2041`、`:1054-1085` |
| 右列 | 首帧区 **清空** | `PATCH .../storyboards/:sid {first_frame_uri:null}` → info「已清空该镜首帧，首帧模式将回退到绑定资产」 | `pages/projects/[id].vue:2042-2050`、`:1088-1104` |
| 右列 | **模型** 下拉 | 选项来自 `GET /models?capability=video&visible=true&mode=<当前模式>`；切模式会重取并刷新报价 | `pages/projects/[id].vue:2054-2059`、`:621-629`、`:766-769` |
| 右列 | **3D导演台**（选择素材行右侧） | 打开同一镜头级 `Director3D`（`title`「打开 3D 导演台（three.js）」） | `pages/projects/[id].vue:2067-2070` |
| 右列 | 额度提示 | 只读文案「已上传素材数：图片 {img}/30 · 视频 0/10 · 音频 0/10 · 总素材 {total}/50」，其中视频/音频两位**恒为 0**（前端无对应计数） | `pages/projects/[id].vue:2071-2073` |
| 右列 | **项目资产** 卡（＋） | 打开项目资产抽屉 | `pages/projects/[id].vue:2076`、`:955-961` |
| 右列 | **更多素材源** 卡（＋，带「即将开放」chip） | **恒 `disabled`**，`title`「更多素材源即将开放」 | `pages/projects/[id].vue:2077-2080` |
| 右列 | **匹配资产**（带「即将开放」chip） | **恒 `disabled`**，`title`「自动匹配项目资产，敬请期待」 | `pages/projects/[id].vue:2086-2088` |
| 右列 | **放大编辑**（带「即将开放」chip） | **恒 `disabled`**，`title`「全屏编辑提示词，敬请期待」 | `pages/projects/[id].vue:2089-2091` |
| 右列 | **提示词** textarea | `@blur` 保存；无选中镜时换成 `disabled` 占位框「先选择左侧分镜」 | `pages/projects/[id].vue:2094-2101` |
| 右列 | 时长 number（1~30 秒） | 只写 `selectedShot.duration_s`（clamp 1~30），随「保存」或 blur 落库 | `pages/projects/[id].vue:2104-2111`、`:677-683` |
| 右列 | **立即生成**（右侧显示 `✦ N` 报价） | 先 `saveShot()` 再 `POST .../storyboards/generate-videos {shot_ids:[当前], budget_credits_max, model, mode}`；成功 info「镜头 N 已投递…」；失败按 `batchReason()` 给原因（资产未定稿/超预算/余额不足/未提交）→ error「镜头 N 未投递：…」；报价由 `POST /credits/quote/batch` 单条计算，失败则**不显示数字** | `pages/projects/[id].vue:2112-2120`、`:732-754`、`:714-726` |

> 分镜视图空态（未选到任何镜）：「还没有分镜 / 选择左上「AI拆分镜」按本集剧本生成分镜表；生成后可逐镜编辑。」+ **生成分镜**（`pages/projects/[id].vue:1994-2001`）。

#### 2.3.5 ④ 导出（投递 + 矩阵 + zip）—— 13 条

| 区块 | 功能点（界面原文） | 行为与实现 | 位置 |
|---|---|---|---|
| 面板头 | **批量投递 N 镜** | `POST .../storyboards/generate-videos {shot_ids: 全部, budget_credits_max, model}`（**不带 mode**，按 `universal_reference` 语义走）；按返回 `items` 统计：全失败且是 400105 → error「全部镜头未投递：N 个镜头的绑定角色未定稿…」；全失败且 745703 → 「预算上限不足以覆盖…」；否则 info「已提交 N 个镜头，N 个因角色未定稿跳过…」；随后 `startTaskPoll()` + `loadEpisode()` + `loadMatrix()`；`disabled = busy 或 无分镜` | `pages/projects/[id].vue:2145`、`:416-451` |
| 分发条 | **模型** 下拉 | 选项来自 `models`（`GET /models?capability=video&visible=true` 再按 `scene_modes.storyboard_reference_video` 过滤，`loadModels()`） | `pages/projects/[id].vue:2150-2155`、`:173-177` |
| 分发条 | **预算上限** number | 绑定 `budget`（默认 1000），`@input` 置 `budgetTouched=true`（该标记**从未被读取**，见 §5-3） | `pages/projects/[id].vue:2156-2159`、`:45`、`:84` |
| 分发条 | **按报价预填** | 拆"已投递/未投递"两组：未投递镜头走 `POST /credits/quote/batch`；已消耗按 `taskMap` 的 `credits_settled/frozen` 累加；`budget = max(1, 已消耗+报价)`；info 二选一：「续投预算预填：已消耗 X + 剩余 N 镜报价 Y = Z 积分」/「批量报价 Y 积分；预算已预填」 | `pages/projects/[id].vue:2160`、`:218-262` |
| 分发条 | **导出本集 zip** / 提交中… | `POST .../exports` → `startExportPoll()`（1.5s，最多 30 次）；成功 info「导出任务已提交，正在打包…」；失败 error=后端 msg | `pages/projects/[id].vue:2162-2164`、`:474-512` |
| 分发条 | **下载 zip** | 仅 `exportJob.download_url` 存在时出现，新窗口打开 | `pages/projects/[id].vue:2165` |
| 分发条 | 导出状态 Tag（**排队中 / 打包中 / 失败**） | `exportJob.status` 1/2/4 三态；status=3 时改显示「下载 zip」 | `pages/projects/[id].vue:2166-2168` |
| 分发条 | **重试** | 仅 `exportJob.status===4` 出现；`POST .../exports/:xid/retry` → 本地重置为 status=1 并重新轮询，info「导出已重新排队」 | `pages/projects/[id].vue:2169`、`:315-325` |
| 横幅 | 预算触顶（745703） | `budgetExceeded` 为 true 时黄条：「部分镜头因预算触顶未投递（745703）。提高预算后可继续投递。」 | `pages/projects/[id].vue:2172` |
| 横幅 | 余额不足（745701） | 任一条目 code=745701 时黄条：「余额不足，部分镜头未投递（745701）。充值后可继续投递剩余镜头。」 | `pages/projects/[id].vue:2173-2175` |
| 横幅 | 角色未定稿 + **去完成角色定稿 →** | 任一角色 `status!==2` 时黄条「有 N 个角色未定稿，其绑定镜头会被拒绝（400105）。」+ 按钮跳 `tab='characters'` | `pages/projects/[id].vue:2176-2179` |
| 矩阵 | **分镜矩阵**（图例：成功/在途/失败/未投递） | 每集一行，格子按 `matrixClass()` 上色（成功 `task_status===3 或 shot.status===5`；失败 `4/7`；在途 `1/2 或 status===3`；否则未投递）；**点任一格 → `openMatrixShot(ep.id)`**：切到该集并跳到「分镜」视图（丢掉当前 tab 上下文） | `pages/projects/[id].vue:2181-2206`、`:160-171`、`:167-171` |
| 结果 | **投递结果** 列表 | 逐条渲染 `batchItems`：镜号、已提交/失败原因 Tag、taskId 后 8 位、任务状态 Tag | `pages/projects/[id].vue:2208-2219` |

> 结果为空时：「准备批量出片 / 确认角色定稿并生成分镜后，选择模型与预算，一键投递全部镜头。」（`pages/projects/[id].vue:2220-2225`）。

#### 2.3.6 ⑤ 时间线导出 —— 12 条

| 区块 | 功能点（界面原文） | 行为与实现 | 位置 |
|---|---|---|---|
| 左栏 | 素材筛选下拉（**全部 / 已出片**） | `tlFilter`：`finalized` 时只列 `video_task_id` 非空的镜 | `pages/projects/[id].vue:2230-2237`、`:1198-1200` |
| 左栏 | 镜头行（点击加入时间线） | `addShotClip(shot)`：本地 push 片段（id=`${shot.id}-${Date.now()}`）→ 有 task 则取 `GET /tasks/:tid/results/0/download-url` → `saveTimeline(true)`（700ms 防抖 `PUT .../timeline`） | `pages/projects/[id].vue:2239-2249`、`:1316-1333` |
| 中区 | 播放器（当前片段的 `<video muted playsinline>`） | 由 `activeClip` 决定；**无播放/进度控件**，靠底部 `playhead` 驱动 | `pages/projects/[id].vue:2256-2269`、`:1201-1208` |
| 中区 | 气泡「更新分镜：时间线不会自动同步…」 | 纯文案 | `pages/projects/[id].vue:2255` |
| 底栏 | **更新分镜** | 按本集 `video_task_id` 非空的镜重建 `clips`（全部替换，无"保留用户裁剪"逻辑，与 reelflow 版不同）；info「已按本集 N 个已出片镜头重建时间线」/「本集还没有已出片镜头…」 | `pages/projects/[id].vue:2278`、`:1336-1358` |
| 底栏 | **播放 / 暂停** | `togglePlay()`：`requestAnimationFrame` 推进 `playhead`；时间线空时报 error「时间线还是空的：从左侧点选分镜加入」 | `pages/projects/[id].vue:2279`、`:1381-1405` |
| 底栏 | 时间码 `00:00 / 00:00` + 「N 个片段」 | `fmtTime()` 只到「分:秒」（无小时位，与剪辑台三段式不同） | `pages/projects/[id].vue:2280-2281`、`:1189-1194` |
| 底栏 | **缩放** range（16~120，步进 4） | 绑定 `pxPerSec` | `pages/projects/[id].vue:2282-2285` |
| 底栏 | **合成导出成片** | 先 `persistTimeline(true)` 落库，再 `POST .../timeline/export {}` → 2s 轮询 `GET .../timeline/export/:id`（最多 120 次 = 4 分钟）；status 3 → info「合成完成，可下载 mp4（含 AI 生成水印）」；4 → error「合成失败：msg」；提交失败 error=msg | `pages/projects/[id].vue:2287-2289`、`:1424-1477` |
| 底栏 | 导出状态 Tag（—/排队中/渲染中/已完成/失败） | `tlExportLabel` 映射 0~4 | `pages/projects/[id].vue:2290-2292`、`:1413-1422` |
| 底栏 | **下载 mp4** | 仅 `tlExportUrl` 存在时出现，新窗口打开 | `pages/projects/[id].vue:2293` |
| 轨道 | 空白处点击 seek + 片段 **‹ / › / ✕** | 点击轨道 `seekTo(offsetX/pxPerSec)`；片段按钮分别 `moveClip(-1)`、`moveClip(1)`、`removeClip()`；每次改动都 `saveTimeline(true)`；刻度尺每 5s 一格 | `pages/projects/[id].vue:2296-2324`、`:2299-2303`、`:1360-1379` |

#### 2.3.7 ⑥ 资产校验 —— 14 条

| 区块 | 功能点（界面原文） | 行为与实现 | 位置 |
|---|---|---|---|
| 头部 | 面包屑 **资产清单校验 ➤ 批量生成资产** | 切 `confirmStage`（只切 UI，不请求） | `pages/projects/[id].vue:2331-2337` |
| 头部 | **搜索资产名称 / 描述** | 前端 `confirmSearch` 过滤 `name` 与 `description`（角色+场景+道具+其他合并） | `pages/projects/[id].vue:2339`、`:1501-1510` |
| 头部 | **重新提取** / 提取中… | `extractAssets('episode')`（同 ② 的提取接口） | `pages/projects/[id].vue:2340-2342` |
| 工具条 | **◀ 上一集 / 下一集 ▶** | `prevEpisode/nextEpisode`：边界 `disabled`；切换会连带刷新时间线（`watch(selectedEpisodeId)`） | `pages/projects/[id].vue:2346-2355`、`:1539-1552`、`:1479-1481` |
| 工具条 | 统计行「共 N · 草稿 N · 有图 N · 已选 N」 | 计算属性 `confirmStats`；**「已选 N」被渲染了两次**（模板内 `statsLine` 之后又单独输出 `{{ confirmStats.selected }}`） | `pages/projects/[id].vue:2356-2359`、`:1511-1519` |
| 工具条 | **选中缺图** | 只选 `!ref_image_uri && kind!=='character'`（角色无图走定妆图链路，见注释 `:1534`） | `pages/projects/[id].vue:2361`、`:1533-1538` |
| 工具条 | **全选 / 取消全选** | 按当前已选数是否等于总数切换 | `pages/projects/[id].vue:2362-2364`、`:1529-1532` |
| 列表 | 行 checkbox | `toggleConfirm(id)`；行内展示 名称/描述、类型、提示词、状态 Tag、引用镜数「N 镜」 | `pages/projects/[id].vue:2376-2396` |
| 底栏 | **🗑 删除勾选** | 逐条 `DELETE .../assets/:aid`（单条失败静默跳过），info「已删除 N 个资产」；**无二次确认** | `pages/projects/[id].vue:2405`、`:1616-1640` |
| 底栏 | **取消定稿** | `batchConfirmStatus(1)`：逐条 `PATCH {status:1}`，info「已取消定稿 ok/total」 | `pages/projects/[id].vue:2407`、`:1555-1581` |
| 底栏 | **批量定稿** | `batchConfirmStatus(2)`：**只处理有参考图的**，无则 error「所选资产都还没有参考图：先批量生成图再定稿」 | `pages/projects/[id].vue:2408` |
| 底栏 | **下一步，批量生成资产图** | 仅 `confirmStage==='list'` 时出现；`disabled` 条件含"未勾选" | `pages/projects/[id].vue:2409-2415` |
| 底栏 | **提交生成（N）** / 提交中… | `confirmStage==='generate'` 时替换上一条；`POST .../assets/:aid/generate-image {count:1}` 逐条提交，**角色会被跳过**并在 info 里追加「另有 N 个角色已跳过（请用「生成定妆图」）」 | `pages/projects/[id].vue:2416-2418`、`:1584-1613` |
| 空态 | 「未找到结果 / 先点右上「重新提取」从本集剧本抽取场景/道具」 | `confirmAssets.length===0` 时显示 | `pages/projects/[id].vue:2398-2402` |

#### 2.3.8 抽屉与 4 个弹窗 —— 8 条

| 区块 | 功能点（界面原文） | 行为与实现 | 位置 |
|---|---|---|---|
| 项目资产抽屉 | **角色 / 场景 / 道具 / 其他** 4 tab | 切 `assetTab`；打开时若当前 kind 为空会回落到「角色」 | `pages/projects/[id].vue:2430-2440`、`:955-961` |
| 项目资产抽屉 | 搜索框（placeholder「搜索你想要的{kind}」） | **未绑定 `v-model`、无 `@input`** → 输入无任何效果（§5-2） | `pages/projects/[id].vue:2441` |
| 项目资产抽屉 | 资产格子（选中态） | `toggleDrawerAsset(id)` 维护 `drawerSelection`（初值为当前镜已绑定 id） | `pages/projects/[id].vue:2446-2460`、`:962-966` |
| 项目资产抽屉 | **取消 / 应用到当前分镜** | 应用 = `setShotAssets(drawerSelection)`（`PUT .../storyboards/:sid/assets`）→ info「素材已更新（N 个）」并关闭；保存中按钮变「保存中…」 | `pages/projects/[id].vue:2465-2468`、`:967-975` |
| 资产编辑弹窗 | 名称/描述/提示词/参考图 uri + **保存** | 空名称 → error「请填写资产名称」；有 id → `PATCH .../assets/:aid`，无 id → `POST .../assets {kind,...}`；成功后刷新资产列表 | `pages/projects/[id].vue:2483-2494`、`:849-870` |
| 参考图候选弹窗 | 候选图点击采用 | `POST .../assets/:aid/select {task_id,index}` → 刷新资产（采纳即定稿），info「已采用为参考图并定稿…」 | `pages/projects/[id].vue:2497-2510`、`:1160-1172` |
| 定妆图候选弹窗 | 候选图点击 | `POST .../characters/:cid/portrait/select {task_id,index}` → `loadProject()`，info「已切换定妆图并定稿」；空列表显示「没有可用候选图。」 | `pages/projects/[id].vue:2513-2527`、`:302-313` |
| 重生成确认弹窗 | **取消 / 确定** | 覆盖大纲或 AI 拆分镜前的护栏；确定 → `confirmRegenerate()` | `pages/projects/[id].vue:2530-2543`、`:395-400` |

### 2.4 `/reelflow/list`（剪辑台项目列表）—— 7 条

| 区块 | 功能点（界面原文） | 行为与实现 | 位置 |
|---|---|---|---|
| 顶栏 | **← 工作台** | `NuxtLink to="/home"`，`title`「返回工作台」 | `pages/reelflow/list.vue:207` |
| 顶栏 | **剪辑台**（品牌名）+ **全部项目** | 品牌名纯文本；「全部项目」跳 `/projects` | `pages/reelflow/list.vue:208`、`:210` |
| tab 行 | **项目 ({N})** | 切 `tab='projects'`；切 tab 会 `load()` 回第 1 页（两个 tab 共用同一份 `/works` 数据） | `pages/reelflow/list.vue:215-217`、`:118-122` |
| tab 行 | **已剪辑** | 切 `tab='exported'`，但**不发新请求**：在已加载的 `list` 上做前端过滤（`timeline_duration_s > 0` 且按时长倒序）→ 若作品在第 2 页及以后，此 tab 看不到（§5-13） | `pages/reelflow/list.vue:218-220`、`:158-162` |
| 卡片 | 作品卡（整卡可点） | 跳 `/reelflow/edit/:id`；封面 `cover_uri` 或按 `drama_type` 渐变；圆形 ▶；`ratio` chip；`is_sample` → 「示例」；正文三行：标题、「剧型 · N 集 · 00:00」、「最后编辑于 …」；底部状态徽标（**已成片/制作中/已归档/草稿**）+ 「{done}/{total} 已出片」；按 `updated_at` 分「今天/昨天/最近 7 天/更早」四组 | `pages/reelflow/list.vue:230-276`、`:125-155`、`:260-272` |
| 列表底部 | **加载更多** | `page_size=48`；请求序号 `loadSeq` 丢弃过期响应；追加去重；失败回退页码 | `pages/reelflow/list.vue:107-112`、`:61-105`、`:334-338` |
| 底部悬浮 | **创建项目** | `router.push("/projects?create=1&redirect=reelflow")`（借 `/projects` 的建项弹窗，建完回剪辑台） | `pages/reelflow/list.vue:342-347`、`:188-192` |

> 该页刻意**不做**卡片「⋯」菜单（重命名/删除），头注释给了理由（`pages/reelflow/list.vue:16-18`）。「已剪辑」tab 的卡片只显示「N 集已剪 · 成片 00:00」两行（`:311-317`）。

### 2.5 `/reelflow/edit/:id`（时间线编辑器）—— 30 条

| 区块 | 功能点（界面原文） | 行为与实现 | 位置 |
|---|---|---|---|
| 顶栏 | **← 返回分镜创作** | `NuxtLink :to="/projects/:id"` | `pages/reelflow/edit/[id].vue:967` |
| 顶栏 | **时间线导出**（选中态胶囊） | **纯静态 `span`，不可点**（`rf-pill--on`），无第二个视图可切 | `pages/reelflow/edit/[id].vue:968` |
| 顶栏 | **保存** | `persistTimeline(false)` → `PUT .../timeline`，成功 `toast.success("时间线已保存")`，失败 `toast.error("保存失败：msg")`；保存中 `loading` 态 | `pages/reelflow/edit/[id].vue:969`、`:238-272` |
| 顶栏 | 集数下拉（`第N集`） | 仅 `episodes.length>1` 显示；切集触发 `watch(selectedEpisodeId)`：停播、清定时器、关弹窗、清发布列表、重载分镜+时间线 | `pages/reelflow/edit/[id].vue:978-981`、`:901-918` |
| 顶栏 | 导出状态 Tag（**排队中/渲染中/已完成/失败**） | `EXPORT_LABEL` 映射 1~4，按状态给 tone | `pages/reelflow/edit/[id].vue:983-985`、`:606-612` |
| 顶栏 | **下载 mp4** | 仅合成成功后出现（`exportUrl`）；`download` 属性 + `@click.prevent="downloadComposed"`（`<a download>` 手动触发） | `pages/reelflow/edit/[id].vue:986`、`:678-687` |
| 顶栏 | **切片发布** | 打开发布弹窗：预填标题「{项目名} · 第N集 切片」、开始 0、结束=时间线总时长，并 `loadPublications()` | `pages/reelflow/edit/[id].vue:987-989`、`:719-727` |
| 顶栏 | **导出** / 合成中… | 先 `persistTimeline(true)`（失败则中止），再 `POST .../timeline/export {}` → 2s 轮询，最多 150 次（5 分钟）→ 超时报「导出超时（5 分钟未完成），请到任务中心查看」；成功 `toast.success("合成完成，可下载 mp4（含 AI 生成水印）")` | `pages/reelflow/edit/[id].vue:990-992`、`:614-675` |
| 左栏 | 素材筛选下拉（**已定稿 / 全部**） | 默认「已定稿」= 闸门（`status===5 && video_task_id`）；「全部」把未定稿也列出来但置灰不可加 | `pages/reelflow/edit/[id].vue:1005-1008`、`:66-86` |
| 左栏 | 素材行**单击**加入时间线 | 指针抬起时若未移动 → `addShot(shot, clips.length)` 追加到末尾；成功底部 note「已加入 分镜 N」 | `pages/reelflow/edit/[id].vue:1028`、`:477-484`、`:297-314` |
| 左栏 | 素材行**拖拽**入轨 | 原生 pointer events：`drag.indexAtX()` 算插入点，轨道显示 drop 标线，指针距轨道上下 90px 内才认；落点插入 → `scheduleSave()` | `pages/reelflow/edit/[id].vue:1028`、`:403-423`、`:443-507` |
| 左栏 | 未定稿行（`is-draft`） | `pointerdown` 直接 `toast.error("分镜 N 未定稿，不能进入时间线")`；行半透明 + `cursor:not-allowed`，副标题显示「未定稿：先去分镜页投递并等出片 · {status}」 | `pages/reelflow/edit/[id].vue:1018-1043`、`:403-408` |
| 左栏 | **更新分镜** | `rebuildFromStoryboards()`：按已定稿镜重建，**按 shot_id 复用已有片段（保留用户裁过的时长）**，并统计"被移除"数量；toast「已按 N 个已定稿镜头同步（移除 N 个不再定稿的片段）」；无已定稿镜 → `toast.error("本集还没有已定稿镜头…")` | `pages/reelflow/edit/[id].vue:1057`、`:327-350` |
| 左栏 | 轨道计数「轨道 N 段」 | 纯展示 `clips.length` | `pages/reelflow/edit/[id].vue:1058` |
| 中区 | 当前片段播放器（`<video muted playsinline>`，ref=`stageVideo`） | `activeClip` 由 `playhead` 累加定位；`onVideoError` 置 `unplayable` 并回落到占位 | `pages/reelflow/edit/[id].vue:1063-1078`、`:115-128`、`:592-595` |
| 中区 | **回到分镜预览** | 合成结果全屏预览时切回片段预览（`previewComposed=false`） | `pages/reelflow/edit/[id].vue:1064-1067` |
| 中区 | **播放成片 / 下载 mp4**（合成结果条） | 合成成功（`exportUrl` 存在）后出现；播放切到成片 `<video controls>`，下载调 `downloadComposed()` | `pages/reelflow/edit/[id].vue:1094-1098` |
| 中区 | 紫色气泡（标题「更新分镜」） | 纯文案：「时间线材料不会自动更新，点「更新分镜」将同步分镜创作页的全部定稿素材。」 | `pages/reelflow/edit/[id].vue:1089-1092` |
| 底栏 | **播放 / 暂停** | `togglePlay()`：`performance.now()` 起算 + rAF 推进；空轨道 → `toast.error("时间线还是空的：从左侧点选分镜加入")` | `pages/reelflow/edit/[id].vue:1104`、`:550-578` |
| 底栏 | 时间码 `00:00:00 / 00:00:00` + 「N 段 · 共 Ns」 | 三段式 `fmtTime()`；`countLine` 模板 | `pages/reelflow/edit/[id].vue:1105-1106`、`:103-112` |
| 底栏 | **片段资产** | `openClipAssets(activeClip)` 打开弹窗；`disabled = 无 activeClip` | `pages/reelflow/edit/[id].vue:1107-1115`、`:808-819` |
| 底栏 | **缩放** − / range(12~200) / ＋ | 三个控件都写 `pxPerSec`；刻度间隔自适应（1/2/5/10/15/30/60s，保证相邻刻度 ≥64px） | `pages/reelflow/edit/[id].vue:1117-1122`、`:135-144` |
| 轨道 | 空白处点击 seek | `onTrackClick`：排除 `.rf-clip/.rf-clip__rm/.rf-clip__trim` 上的点击；用 `clientX - rect.left + scrollLeft`（注释说明为何不用 `offsetX`） | `pages/reelflow/edit/[id].vue:1126-1131`、`:540-548` |
| 轨道 | 片段**拖拽换位** | `onClipPointerDown(...,'reorder')` + `onPointerMove` 算 `dropIndex` → 抬起时 `splice` 重排 + `scheduleSave()`（700ms 防抖） | `pages/reelflow/edit/[id].vue:1151`、`:425-441`、`:491-504` |
| 轨道 | 片段**右边缘拖动改时长** | `trim` 态：`delta = dx / pxPerSec`，clamp 1~30 写回 `duration`；**只做出点**（后端 clip 契约无 in/out，注释明说"硬做入点会写不进去"） | `pages/reelflow/edit/[id].vue:1158-1162`、`:459-468` |
| 轨道 | 片段 **✕** | `removeClip(clip_id)` 并 `scheduleSave()` | `pages/reelflow/edit/[id].vue:1156`、`:316-320` |
| 全局键盘 | Space 播放/暂停；←/→ 步进 1s（Shift=5s）；片段聚焦时 ←/→ 换位、Delete/Backspace 删除 | `onKeydown` 在 `window` 上监听，输入框内不劫持 | `pages/reelflow/edit/[id].vue:920-934`、`:509-526`、`:936-953` |
| 发布弹窗 | **标题 / 开始（秒）/ 结束（秒）/ 发布切片** | 结束≤开始 → 红字「切片的结束时间必须大于开始时间」；发布前先 `persistTimeline(true)`；`POST .../timeline/publish {title, slice:{start_ms,end_ms}}` → `toast.success("已提交发布，正在转码（1 排队 → 2 转码中 → 3 可播放）")` → 2s 轮询发布列表（最多 150 次，超时报「转码超时…」） | `pages/reelflow/edit/[id].vue:1186-1202`、`:745-773`、`:730-743` |
| 发布弹窗·记录 | 状态 Tag / 区间 / **已按区间裁剪** 或 **未裁剪（复制整片）** / **下载** / **复制 token** / **分享页** / **下架** | 状态 1~5 映射；`transcode_mode==='ffmpeg'` 才显示「已按区间裁剪」，否则「未裁剪（复制整片）」并 hover 显示 `transcode_reason`；下架用 `window.confirm` → `DELETE .../publications/:pid`；复制走 `navigator.clipboard` | `pages/reelflow/edit/[id].vue:1204-1257`、`:699-705`、`:775-797` |
| 片段资产弹窗 | **绑定镜头产物 / 清空绑定 / 从已定稿资产里点选** | 三个动作都打同一个端点 `POST .../timeline/clips/:cid/assets`（快照语义：整体替换）；`bindShotProductToClip` 要求 `clip.task_id`，否则报「该片段没有镜头产物（task_id 为空）」；资产列表只列 `status===2 && ref_image_uri` | `pages/reelflow/edit/[id].vue:1273-1302`、`:839-897`、`:813-815` |

### 2.6 `/assets`（资产库）—— 12 条

| 区块 | 功能点（界面原文） | 行为与实现 | 位置 |
|---|---|---|---|
| tab | **资产 / 主体库 / 抽取与匹配** | 切 `tab`；后两个 tab 直接挂组件 `SubjectLibrary` / `ProjectQualityPanel` | `pages/assets.vue:167-179`、`:181-182` |
| 头部 | **回收站** / **返回资产库** | `switchDeleted()` 改 `deleted=true/false` 并重拉；标题与图标随之变 | `pages/assets.vue:155-157`、`:95-98` |
| 头部 | **新建目录** | `window.prompt("新目录名称")` → `POST /asset-folders`；空值直接 return | `pages/assets.vue:158`、`:118-127` |
| 头部 | **上传图片** / 上传中… | 前端 `createImageBitmap` 压缩到 ≤1600px、JPEG 0.85 → `POST /assets/upload`（base64）→ 重拉列表；失败红条 | `pages/assets.vue:159-162`、`:49-84` |
| 过滤条 | 目录下拉（**全部目录**） | `folderFilter` → `GET /assets?folder_id=` | `pages/assets.vue:186-190`、`:36-39` |
| 过滤条 | 当前标签 chip（`tag ✕`） | 有 `tagFilter` 时显示，点击清除并重拉 | `pages/assets.vue:191-198`、`:129-132` |
| 卡片 | 卡片上的标签按钮 | 点击 `applyTag(tag)`（再点一次取消），走 `GET /assets?tag=` | `pages/assets.vue:214-222`、`:36-39` |
| 卡片 | **删除** | `window.confirm("删除资产 {name}？")` → `DELETE /assets/:id`（软删，回收站保留 7 天） | `pages/assets.vue:225`、`:100-108` |
| 卡片 | **恢复**（回收站内） | `POST /assets/:id/restore` → 重拉 | `pages/assets.vue:224`、`:86-93` |
| 空态 | **上传图片** | `EmptyState` + 触发隐藏 file input | `pages/assets.vue:231-241` |
| tab 2 | 主体库（角色/场景/道具的一致性载体） | `SubjectLibrary.vue`（829 行）：筛选（类型/审核态/星标/模板键）、新建、审核**通过/驳回**（驳回用 `window.prompt` 要原因）、删除（`window.confirm`）、参考图增删（`window.prompt` 要 uri）、**批量查审核状态**、**从项目资产转主体**；共 14 处接口调用 | `pages/assets.vue:181`；`components/subject/SubjectLibrary.vue:109/124/143/166/188/203/220/242/257/271/303/317/332`、`:70`（应用模板） |
| tab 3 | 抽取与匹配（项目维度） | `ProjectQualityPanel.vue`（584 行）：选项目 → 选集 → **创建抽取任务**、轮询草稿、**redo**、**批量落项目资产**、**匹配资源**、**清除匹配**（带 `dry_run` 预览）、**智能补充缺失**、**保存匹配**；共 12 处接口调用 | `pages/assets.vue:182`；`components/extraction/ProjectQualityPanel.vue:64/78/92/109/120/134/164/176/189/200/217/240` |

### 2.7 `/novel`（剧本工厂 · 本子列表）—— 12 条

| 区块 | 功能点（界面原文） | 行为与实现 | 位置 |
|---|---|---|---|
| 头部 | **新建改编** | 打开弹窗，`mode='adapt'` | `pages/novel/index.vue:180`、`:85-92` |
| 头部 | **新建原创剧本** | 打开弹窗，`mode='original'` | `pages/novel/index.vue:181` |
| tab | **全部 (N) / 草稿 / 已定稿 / 已归档** | `watch(tab)` → 重新 `GET /novel/list`（`status=1` / `status=16` / `archived=1`）；"全部" tab 的计数只在当前 tab 为"全部"时显示数字，否则显示 `·` | `pages/novel/index.vue:186-189`、`:47-53`、`:71` |
| 卡片 | 本子卡（整卡可点） | 跳 `/novel/:id`；展示状态徽标、来源（**小说改编/想法起稿/导入剧本/创意裂变/海外改编**）、`ratio`、标题、集数、更新时间；已归档时追加「已归档 · 时间」 | `pages/novel/index.vue:200-226` |
| 弹窗 | **小说改编 / 纯原创** segmented | 切 `mode`；只影响标题、textarea 行数/上限/占位、提交的 `source_type`（1/2） | `pages/novel/index.vue:244-247`、`:130-138` |
| 弹窗 | **剧本名称** | `TextField`，`maxlength=200`；上传文件后若为空会自动填文件名 | `pages/novel/index.vue:248-253`、`:116` |
| 弹窗 | **画面比例**（9:16 竖屏 / 16:9 横屏） | 提交为 `ratio` | `pages/novel/index.vue:254-260` |
| 弹窗 | **上传小说文件（txt / md / docx）** | `POST /projects/parse-script` 复用项目解析端点；若 `truncated` 弹 toast「文本超过上限，已截断到 N 字」；失败 toast「文件解析失败」 | `pages/novel/index.vue:261-267`、`:94-124` |
| 弹窗 | **小说正文 / 创作灵感** textarea | 改编 10 行/5 万字；原创 4 行/5 千字，带 hint | `pages/novel/index.vue:268-283` |
| 弹窗 | **创建并分章 / 创建原创本子** | `POST /novel`；成功 toast（「已创建并解析 N 章」/「已创建原创本子…」）→ 跳 `/novel/:id`；`disabled = 标题空 或 正文空 或 提交中` | `pages/novel/index.vue:285-290`、`:126-151` |
| 空态 | **粘贴小说改编 / 从一句灵感原创** | `EmptyState` + 两个按钮（同 openCreate） | `pages/novel/index.vue:228-238` |
| 错误条 | **重试** | 红条 + `err__retry` 按钮 → `load()`（本工作流里**少数带重试按钮**的页） | `pages/novel/index.vue:192-195` |

### 2.8 `/novel/:id`（改编工作台）—— 24 条

| 区块 | 功能点（界面原文） | 行为与实现 | 位置 |
|---|---|---|---|
| 顶栏 | **← 剧本工厂** | `NuxtLink to="/novel"` | `pages/novel/[id].vue:463` |
| 顶栏 | **定稿完成改编** / **已定稿** | `POST /novel/:id/finalize {snapshot_episodes:true}`；成功 toast「已定稿（status=16），可作为制片工坊的拆集来源」（幂等时「本子已处于定稿状态」）；`disabled = 已定稿 或 loading`；**页面上没有「撤回定稿」按钮**（§5-17） | `pages/novel/[id].vue:473-480`、`:378-391` |
| 顶栏 | 状态徽标 / 比例 / 模型来源（**mock 模式（无 Key，确定性输出）** 或「真实模型」） | 读 `summary.finalized`、`novel.ratio`、`llm_mode` | `pages/novel/[id].vue:466-470` |
| 步骤条 | `NovelStepper`（分章→内容分析→章节大纲→分集大纲→核心角色→分集剧本→定稿） | 仅非原创本子显示；点击某一步 → `pickStep()` 映射到 tab 并懒加载 | `pages/novel/[id].vue:484-489`、`:41-49`、`:413-416` |
| tab | 7/8 个 tab | 首次进入懒加载（`loadedTabs` 去重；失败会从集合删除以便重试） | `pages/novel/[id].vue:496-500`、`:396-411` |
| 章节 | 章数输入 + **重新分章** | `POST /novel/:id/split {chapter_count?}` → toast「已切分为 N 章」→ 重拉 summary+chapters；`disabled = 暂无章节`（**首次分章在创建时已完成，这里只做 re-split**） | `pages/novel/[id].vue:515-518`、`:87-100` |
| 章节 | 章节列表（点击看正文） | `GET /novel/:id/chapters/:no`；标题会去掉「第N章」前缀再展示 | `pages/novel/[id].vue:526-537`、`:79-85`、`:421-424` |
| 内容分析 | 角色卡数 + **内容分析** | `POST /novel/:id/content-analysis {character_count}` → toast「内容分析完成：角色卡 N 张」→ 重拉 summary+analysis | `pages/novel/[id].vue:554-555`、`:121-134` |
| 内容分析 | **重新生成角色卡** | `POST .../content-analysis/novel_character_cards/generate {count}` → toast「已重新生成角色卡（同名会合并…）」 | `pages/novel/[id].vue:556`、`:158-169` |
| 内容分析 | **世界观** 3 个字段（时代背景 / 地理·场景基调 / 总述） | 本地表单，回填自 `content-analysis/detail` | `pages/novel/[id].vue:561-577`、`:108-119` |
| 内容分析 | **保存世界观** | `PUT .../content-analysis/worldview`（把 factions/rules/relations 原样带回，避免覆盖丢失）→ toast「世界观已保存」 | `pages/novel/[id].vue:576`、`:136-156` |
| 内容分析 | 角色卡 **编辑** → 弹窗 6 字段 + **保存** | `PATCH .../novel_character_cards/:id`（姓名/类型/描述/外貌/性格/生图提示词）→ toast「角色卡已保存」 | `pages/novel/[id].vue:589`、`:712-733`、`:185-205` |
| 章节大纲 | **生成章节大纲** | `POST .../chapter_outline/generate {}` → toast「已生成 N 条章纲」 | `pages/novel/[id].vue:604`、`:215-226` |
| 章节大纲 | 逐条 **保存** | `PATCH .../chapter_outline/:id {title,synopsis}` → toast「第 N 章纲已保存」 | `pages/novel/[id].vue:607-613`、`:228-238` |
| 分集大纲 | 集数 + **生成分集大纲** | `POST .../episode_outline/generate {episode_count?}` → toast「已生成 N 集大纲」 | `pages/novel/[id].vue:621-622`、`:249-262` |
| 分集大纲 | 逐条 **保存** | `PATCH .../episode_outline/:id` | `pages/novel/[id].vue:626-632`、`:264-274` |
| 核心角色 | **生成核心角色** | `POST .../core_character/generate {count:3}`（**硬编码 3**）→ toast「已标记 N 个核心角色」 | `pages/novel/[id].vue:639`、`:284-295` |
| 分集剧本 | **生成选中集 / 生成全部集** | 有无勾选决定文案；`POST .../script-generate {episode_nos?}`；`missing` 非空时 toast「已生成 N 集；还缺第 X 集」 | `pages/novel/[id].vue:660-662`、`:321-338` |
| 分集剧本 | 逐集 checkbox | 维护 `selectedNos`，只影响生成范围 | `pages/novel/[id].vue:672-677`、`:371-375` |
| 分集剧本 | 集列表（点击打开） | `GET .../episode/:id`，把正文填入 textarea；右侧显示 `N 字 · vN` 与状态（**已确认/草稿**） | `pages/novel/[id].vue:678-683`、`:311-319` |
| 分集剧本 | **保存正文** | `PATCH .../episode/:id {script_text}` → toast「已保存（版本 vN）」→ 刷新列表（保存必产生新版本） | `pages/novel/[id].vue:691`、`:340-355` |
| 分集剧本 | **确认这集** | `POST .../episode/:id/confirm` → toast「本集已确认」 | `pages/novel/[id].vue:692`、`:357-369` |
| 编辑 Agent | `NovelAgentChat`（会话/发消息/逐集 diff 应用或驳回/全部应用/撤销/心跳） | 已定稿时 `locked`（`pages/novel/[id].vue:704`）；组件共 10 处接口调用 | `pages/novel/[id].vue:701-708`；`components/novel/NovelAgentChat.vue:47/52/64/85/108/133/150/169/187/200` |
| 原创链 | `NovelOriginalChain`（创意方案→素材→总纲→章纲→集纲→剧本→定稿） | 仅原创本子（`source_type===2`）；组件共 30 处接口调用 | `pages/novel/[id].vue:506-508`、`:441-444`；`components/novel/NovelOriginalChain.vue:75-353` |

---

## §3 接口调用清单

> 所有请求都经 `composables/useApi.ts` 统一封装：前缀 `/v1`（`useApi.ts:36`）、信封 `{code,msg,data}` 解包（`:47-53`）、`Authorization` + `X-Lang` + `X-Space-Id` 三个头（`:25-32`）、401101/401102 自动 `refresh` 重试一次（`:48-51`）、非 0 code 抛 `ApiError`（`:52`）。
> 计数：7 个页面自身共列出 **78 条端点调用**（★ 标记者为死代码，后端有端点但无控件调用）；另有 4 个内嵌组件共 66 个调用点（未逐条展开，只给调用点位置）。

### 3.1 项目 / 剧本 / 分镜（`script` 域）

| 方法 · 路径 | 调用点 | 用途 | 契约对照 |
|---|---|---|---|
| `GET /projects` | `pages/projects/index.vue:71` | 项目列表分页 | 前端内联 `{list,total}`；`types/api.ts:102` 的 `Paginated<T>` **未被使用** |
| `POST /projects` | `components/CreateProjectModal.vue:166` | 新建项目（含 `source_text` 直接建） | 返回 `ProjectDto`（`types/api.ts:109-126`） |
| `POST /projects/parse-script` | `components/CreateProjectModal.vue:101`；`pages/novel/index.vue:110` | 上传文件解析成纯文本 | 返回 `{text,format,chars,warnings}`；novel 侧多读 `truncated`（`novel/index.vue:117`，内联类型里已声明） |
| `GET /works` | `pages/reelflow/list.vue:75` | 剪辑台作品列表（带 `episode_count/shot_count/done_count/cover_uri/timeline_duration_s`） | 后端契约含 `has_more`/`tabs`（`types/api.ts:173-180`），**页面只用 `list/total`**，`has_more` 未消费、改按"本页满 48"自算（`list.vue:40`） |
| `GET /projects/:id` | `pages/projects/[id].vue:117`；`pages/reelflow/edit/[id].vue:174` | 项目详情 + 分集 + 角色 | 后端实返 `{project,episodes,characters}`（`apps/api/src/modules/script/script.service.ts:451`）；剪辑台只取 `project/episodes` |
| `GET /projects/:id/episodes/:eid` | `pages/projects/[id].vue:135`；`pages/reelflow/edit/[id].vue:185` | 单集 + 该集分镜 | `{episode,storyboards}`，元素形状 `EpisodeDto`/`StoryboardDto`（`types/api.ts:182-189`、`:280-297`） |
| `GET /projects/:id/shot-materials` | `pages/projects/[id].vue:144` | 分镜素材兜底列表 | 失败静默置空（`:147-149`），不阻塞页面 |
| `GET /projects/:id/matrix` | `pages/projects/[id].vue:154` | 分镜矩阵（每集每镜状态） | `MatrixDto`（`types/api.ts:267-270`）一致 |
| `POST /projects/:id/outline/generate` | `pages/projects/[id].vue:181` | 生成分集大纲 | 返回 `EpisodeDto[]`（页面用来取 `result.length`） |
| `PUT /projects/:id/outline` | `pages/projects/[id].vue:189` | 整批保存/确认大纲 | 无返回消费 |
| `PATCH /projects/:id/episodes/:eid` | `pages/projects/[id].vue:206` | 分集标题/梗概防抖保存 | 失败静默（`:211-213`） |
| `POST /projects/:id/characters/generate` | `pages/projects/[id].vue:276` | 生成角色卡（`count:5` 硬编码） | — |
| `POST /projects/:id/characters/:cid/to-asset` | `pages/projects/[id].vue:266` | 角色定妆图转通用资产库 | 返回 `{asset_id,tags}` |
| `POST /projects/:id/characters/:cid/portrait` | `pages/projects/[id].vue:284` | 生成定妆图（异步任务） | 返回 `{task_id}`，随后 2s 轮询 `loadProject` |
| `GET /projects/:id/characters/:cid/portrait/candidates` | `pages/projects/[id].vue:295` | 取定妆图候选 | `{task_id,candidates[{index,url}]}` |
| `POST /projects/:id/characters/:cid/portrait/select` | `pages/projects/[id].vue:305` | 选定候选（采纳即定稿） | `{task_id,index}` |
| `POST /projects/:id/characters/:cid/finalize` | `pages/projects/[id].vue:329` | 角色定稿 | — |
| ★ `POST /projects/:id/episodes/:eid/script-draft/generate` | `pages/projects/[id].vue:355` | 生成剧本草稿 | **死代码**：函数 `generateScriptDraft` 全页仅出现 1 次（定义处），无任何控件调用 |
| `POST /projects/:id/episodes/:eid/storyboards/generate` | `pages/projects/[id].vue:367` | AI 拆分镜 | 入参 `{shot_count}`；`shot_count` 取自 `shotCount=10`（` :46`）但**无 UI 可改** |
| `PATCH /projects/:id/episodes/:eid/storyboards/:sid` | `pages/projects/[id].vue:404`、`:1069`、`:1092` | 保存分镜描述/提示词/时长；写/清首帧 | 后端接受 `first_frame_uri: null` 表示清空（`apps/api/src/modules/script/script.service.ts:998-1001`） |
| `POST /projects/:id/episodes/:eid/storyboards/generate-videos` | `pages/projects/[id].vue:419`（批量）、`:736`（单镜） | 投递出片 | 返回 `{budget_exceeded, items[{shot_id,task_id,submitted,code,reason}]}`；单镜调用多传 `mode`（`:738`），批量不传 |
| `PUT /projects/:id/episodes/:eid/storyboards/:sid/assets` | `pages/projects/[id].vue:933` | 分镜↔资产绑定（整体替换） | 返回 `{asset_ids}` |
| `POST /assets/upload` | `pages/projects/[id].vue:909`、`:1064`；`pages/assets.vue:76` | base64 上传（素材导入 / 3D 定格 / 资产库上传） | 返回 `{id,uri}`（3D 定格还读 `url`） |
| `GET /projects/:id/assets` | `pages/projects/[id].vue:820`（带 `?kind=`）；`pages/reelflow/edit/[id].vue:813`（不带 kind） | 项目资产（场景/道具/其他） | 后端实返 `{list}`（`script.service.ts:1449`），无 `total`；页面声明的正是 `{list}` |
| `POST /projects/:id/assets` | `pages/projects/[id].vue:864`、`:914` | 新建 / 导入项目资产 | `kind='character'` 会被后端 400101 拒绝（`script.service.ts:1455-1460`），前端只用非角色 kind |
| `PATCH /projects/:id/assets/:aid` | `pages/projects/[id].vue:862`、`:874`、`:1026`、`:1566` | 编辑 / 定稿（`status:2`）/ 取消定稿（`status:1`） | — |
| `DELETE /projects/:id/assets/:aid` | `pages/projects/[id].vue:882`、`:1627` | 删除资产（单条 / 批量） | — |
| `POST /projects/:id/assets/extract` | `pages/projects/[id].vue:988` | AI 提取场景/道具草稿（可按集） | 返回 `{created,updated,skipped,items,truncated}` |
| `POST /projects/:id/assets/:aid/generate-image` | `pages/projects/[id].vue:1112`、`:1600` | 生成参考图（异步） | 返回 `{task_id,model}` |
| `GET /projects/:id/assets/:aid/candidates` | `pages/projects/[id].vue:1130`、`:1149` | 取参考图候选 | 轮询 45 次×2s（`:1127`） |
| `POST /projects/:id/assets/:aid/select` | `pages/projects/[id].vue:1164` | 采用候选图（即定稿） | `{task_id,index}` |

### 3.2 导出 / 时间线 / 发布

| 方法 · 路径 | 调用点 | 用途 | 契约对照 |
|---|---|---|---|
| `POST /projects/:id/episodes/:eid/exports` | `pages/projects/[id].vue:480` | 整集 zip 导出 | `ExportDto`（`types/api.ts:272-278`） |
| `GET /projects/:id/episodes/:eid/exports/:xid` | `pages/projects/[id].vue:499` | 轮询导出状态（1.5s×30） | 同上 |
| `POST /projects/:id/episodes/:eid/exports/:xid/retry` | `pages/projects/[id].vue:318` | 失败重试 | 无返回消费 |
| `GET /projects/:id/episodes/:eid/timeline` | `pages/projects/[id].vue:1270`；`pages/reelflow/edit/[id].vue:196` | 读该集时间线 | 返回 `{clips[{clip_id,shot_id,task_id,name,duration,assets?}]}`；剪辑台多读 `assets`（`TimelineClipAssetDto`，`types/api.ts:1371-1377`） |
| `PUT /projects/:id/episodes/:eid/timeline` | `pages/projects/[id].vue:1237`；`pages/reelflow/edit/[id].vue:246` | 保存时间线（全量覆盖） | 服务端回填 `clips[].clip_id`；两页都做了"长度相等才回填"的保护（`[id].vue:1250`、`edit:259`） |
| `POST /projects/:id/episodes/:eid/timeline/export` | `pages/projects/[id].vue:1438`；`pages/reelflow/edit/[id].vue:627` | 服务端 ffmpeg 合成 mp4 | 返回 `{export_id,status}` |
| `GET /projects/:id/episodes/:eid/timeline/export/:exportId` | `pages/projects/[id].vue:1458`；`pages/reelflow/edit/[id].vue:647` | 轮询合成（2s；项目页 120 次、剪辑台 150 次） | 返回 `{export_id,status,download_url,error}`；状态 1~4 |
| `POST /projects/:id/episodes/:eid/timeline/publish` | `pages/reelflow/edit/[id].vue:757` | 切片发布 | 入参 `{title,slice:{start_ms,end_ms}}` |
| `GET /projects/:id/episodes/:eid/timeline/publications` | `pages/reelflow/edit/[id].vue:710` | 发布记录列表 | `TimelinePublicationDto`（`types/api.ts:1334-1360`）一致，含 `transcode_mode/transcode_reason` |
| `DELETE /projects/:id/episodes/:eid/publications/:pubId` | `pages/reelflow/edit/[id].vue:778` | 下架 | `window.confirm` 前置 |
| `POST /projects/:id/episodes/:eid/timeline/clips/:clipId/assets` | `pages/reelflow/edit/[id].vue:845`、`:867`、`:886` | 片段资产绑定（快照语义；`{clear:true}` 清空） | 入参 `{asset_ids,task_id}` 或 `{clear:true}` |

### 3.3 模型 / 积分 / 任务 / 资产库

| 方法 · 路径 | 调用点 | 用途 | 契约对照 |
|---|---|---|---|
| `GET /models?capability=video&visible=true` | `pages/projects/[id].vue:174` | 批量投递用模型（再按 `scene_modes.storyboard_reference_video` 过滤） | `ModelDto`（`types/api.ts:51-67`） |
| `GET /models?...&mode=` | `pages/projects/[id].vue:623` | 单镜生成按当前模式取模型 | 同上；切模式触发重取（`:766-769`） |
| `POST /credits/quote/batch` | `pages/projects/[id].vue:244`、`:721` | 预算预填 / 单镜报价 | 后端返回 `total_credits/total_strike_credits/balance_after_estimate/sufficient/line_items`（`credits.service.ts:257-263`）；页面内联类型只取 3 个字段。`types/api.ts:69 QuoteResponse` 是**单条报价**形状，本工作流未使用 |
| `GET /tasks?ids=` | `pages/projects/[id].vue:461` | 批量轮询出片任务（2s×30） | `TaskDto[]`（`types/api.ts:80-100`） |
| `GET /tasks/:tid/results/0/download-url` | `pages/projects/[id].vue:1309` | 项目页时间线取片段播放地址 | 「结果序号 **0**」 |
| `GET /tasks/:tid/results/1/download-url` | `pages/reelflow/edit/[id].vue:149` | 剪辑台取片段播放地址 | 「结果序号 **1**」——两页取的不是同一份产物 |
| `GET /assets` | `pages/assets.vue:39` | 资产库列表（`deleted/folder_id/tag`） | `AssetDto`（`types/api.ts:220-230`） |
| `POST /assets/:id/restore` | `pages/assets.vue:88` | 回收站恢复 | — |
| `DELETE /assets/:id` | `pages/assets.vue:103` | 删除（软删） | `window.confirm` 前置 |
| `GET /asset-folders` | `pages/assets.vue:112` | 目录列表 | 返回 `Array<{id,name}>`，失败静默置空 |
| `POST /asset-folders` | `pages/assets.vue:122` | 新建目录 | `window.prompt` 取名 |

### 3.4 小说改编链（`novel` 域，页面自身）

| 方法 · 路径 | 调用点 | 用途 | 契约对照 |
|---|---|---|---|
| `GET /novel/list` | `pages/novel/index.vue:59` | 本子列表（status/archived 过滤） | `NovelListDto`（`types/api.ts:705-710`） |
| `POST /novel` | `pages/novel/index.vue:131` | 新建本子（创建即分章） | 返回 `NovelDto`，`chapter_count` 可选（`types/api.ts:522-523`） |
| `GET /novel/:id/summary` | `pages/novel/[id].vue:58` | 七步进度 + counts + finalized | `NovelSummaryDto`（`types/api.ts:633-647`） |
| `GET /novel/:id/chapters` | `pages/novel/[id].vue:72` | 章节列表 | `NovelChapterSummaryDto`（`:541-547`） |
| `GET /novel/:id/chapters/:no` | `pages/novel/[id].vue:81` | 章节正文 | `NovelChapterDto`（`:549-551`） |
| `POST /novel/:id/split` | `pages/novel/[id].vue:92` | 重新分章 | 返回 `{count}` |
| `GET /novel/:id/content-analysis/detail` | `pages/novel/[id].vue:109` | 世界观 + 角色卡 | `{worldview,characters}` |
| `POST /novel/:id/content-analysis` | `pages/novel/[id].vue:124` | 跑内容分析 | 返回 `{characters}` |
| `PUT /novel/:id/content-analysis/worldview` | `pages/novel/[id].vue:140` | 保存世界观 | 需回传 factions/rules/relations 以免覆盖 |
| `POST /novel/:id/content-analysis/novel_character_cards/generate` | `pages/novel/[id].vue:161` | 重新生成角色卡 | — |
| `PATCH /novel/:id/content-analysis/novel_character_cards/:nccId` | `pages/novel/[id].vue:189` | 单卡编辑 | 6 字段 |
| `GET /novel/:id/chapter_outline/list` | `pages/novel/[id].vue:211` | 章纲列表 | `NovelChapterOutlineDto`（`:579-586`） |
| `POST /novel/:id/chapter_outline/generate` | `pages/novel/[id].vue:218` | 生成章纲 | 返回 `{count}` |
| `PATCH /novel/:id/chapter_outline/:ncoId` | `pages/novel/[id].vue:231` | 单条章纲保存 | — |
| `GET /novel/:id/episode_outline/list` | `pages/novel/[id].vue:245` | 集纲列表 | `NovelEpisodeOutlineDto`（`:588-595`） |
| `POST /novel/:id/episode_outline/generate` | `pages/novel/[id].vue:254` | 生成集纲 | 返回 `{count}` |
| `PATCH /novel/:id/episode_outline/:neoId` | `pages/novel/[id].vue:267` | 单条集纲保存 | — |
| `GET /novel/:id/core_character/list` | `pages/novel/[id].vue:280` | 核心角色列表 | `NovelCharacterDto`（`:567-577`） |
| `POST /novel/:id/core_character/generate` | `pages/novel/[id].vue:287` | 生成核心角色（`count:3` 硬编码） | — |
| `GET /novel/:id/episode/list` | `pages/novel/[id].vue:304` | 分集剧本列表 | `NovelEpisodeSummaryDto`（`:597-605`） |
| `GET /novel/:id/episode/:neId` | `pages/novel/[id].vue:313` | 单集正文 | `NovelEpisodeDto`（`:607-615`） |
| `POST /novel/:id/script-generate` | `pages/novel/[id].vue:326` | 生成剧本（可指定集） | 返回 `{count,missing[]}` |
| `PATCH /novel/:id/episode/:neId` | `pages/novel/[id].vue:344` | 保存正文（产生新版本） | 返回 `NovelEpisodeDto`（含 `version`） |
| `POST /novel/:id/episode/:neId/confirm` | `pages/novel/[id].vue:361` | 确认该集 | — |
| `POST /novel/:id/finalize` | `pages/novel/[id].vue:381` | 定稿（status=16） | 返回 `{status,replayed}` |

### 3.5 内嵌组件触达的端点（只给调用点，不展开行）

| 组件 | 调用点数 | 调用点 |
|---|---|---|
| `NovelAgentChat.vue`（编辑 Agent） | 10 | `:47`（会话列表）、`:52`（会话详情）、`:64`（建会话）、`:85`（退出）、`:108`（发消息）、`:133`（逐集 apply）、`:150`（逐集 reject）、`:169`（全部 apply）、`:187`（abort）、`:200`（heartbeat） |
| `NovelOriginalChain.vue`（原创链） | 30 | `:75-87`（state/idea/materials/summary_outline/chapters_outline/episodes_outline/episode/list）、`:97`、`:120`、`:136`、`:147`、`:159`、`:171-185`、`:208-229`、`:240-250`、`:261-270`、`:285-296`、`:304-315`、`:319-337`、`:344`、`:353` |
| `SubjectLibrary.vue`（主体库） | 14 | `:70`、`:90`、`:109`、`:124`、`:143`、`:166`、`:188`、`:203`、`:220`、`:242`、`:257`、`:271`、`:303`、`:317`、`:332` |
| `ProjectQualityPanel.vue`（抽取与匹配） | 12 | `:64`、`:78`、`:92`、`:109`、`:120`、`:134`、`:164`、`:176`、`:189`、`:200`、`:217`、`:240` |

---

## §4 状态与空态

| 页面 | 加载态 | 空态 | 错误态 | 有无重试按钮 | 位置 |
|---|---|---|---|---|---|
| `/projects` | **有骨架屏**：`<Skeleton :rows="4">`（3~4 条灰条 + shimmer 动画，`components/Skeleton.vue:1-47`） | 92px 线性文件夹插画 + 「点击下方创建一个新项目」+ 「上传剧本或粘贴文本，AI 帮你拆集、定妆、出分镜」；「已导出」tab 另有 64px 下载插画 + 「暂无导出记录 / 在项目流水线内完成分镜并导出后，成片记录会出现在这里」 | 顶部红条 `<p class="err">` 只显示 `error` 文案，**与空态同屏**（列表已被清空） | **无** | `index.vue:141`、`:162-171`、`:181-190`、`:138` |
| `/projects/:id` | **无骨架屏**；`busy` 时顶部蓝色 banner「{步骤名}…」+ 呼吸圆点（`.pulse`） | 4 类：① `EmptyState`（剧本 ✎ / 分镜 ▤ / 投递 ▶）；② 左栏 `.rail-empty`「先点上方「AI拆分镜」按本集剧本拆分镜头」；③ 抽屉 `.drawer__empty`「未搜索到相关资源」；④ 资产校验 `.cf-empty` 🔍「未找到结果」 | error banner（红）+ info banner（蓝）+ busy banner（紫），三者独立 `Transition` 淡入 | **无**（靠重按原按钮） | `[id].vue:1696-1702`、`:1738-1745`、`:1933`、`:1994-2001`、`:2220-2225`、`:2461-2464`、`:2398-2402` |
| `/reelflow/list` | **有骨架屏**：`Skeleton :rows="4"`，两个 tab 各自一份 | 项目 tab：84px 胶片插画 + 「点击下方创建一个新项目」+「项目出片后在这里剪成整集…」；已剪辑 tab：下载插画 + 「暂无导出记录」 | 顶部红条 `.rl-err`，**不清空已有列表**（仅追加失败时回退页码） | **无** | `list.vue:226`、`:293`、`:279-288`、`:321-330`、`:223`、`:87-97` |
| `/reelflow/edit/:id` | **无骨架屏**：`loading` 时三区整体 `opacity:.6 + pointer-events:none`（`.rf-body.is-loading`） | 5 类：左栏 `EmptyState`（无素材 / 无分镜两种文案）；中区 `.rf-placeholder`「请在左侧选择分镜资产加入至时间线」；轨道 `.rf-clips__empty`「时间线为空：从左侧点选分镜加入…」；发布列表「还没有发布记录」；片段资产「该片段还没有绑定资产」/「项目里还没有已定稿且有参考图的资产」 | 顶部红条 `.rf-err`（仅 bootstrap 失败）；操作失败走 toast；合成失败走底部 `.rf-note.is-err` | **无** | `edit/[id].vue:1000`、`:1436-1439`、`:1045-1053`、`:1079-1086`、`:1165-1167`、`:1256`、`:1286`、`:1301`、`:997`、`:1311-1313` |
| `/assets` | **有骨架屏**：`Skeleton :rows="3"` | `EmptyState`（回收站 ♻ / 资产 ▣）+ 「上传图片」按钮 | 红条 `.err`，与空态同屏 | **无** | `assets.vue:203`、`:231-241`、`:201` |
| `/novel` | **有骨架屏**：`Skeleton :rows="4"` | `EmptyState` ✎ + 「还没有剧本项目」+ 两个入口按钮 | 红条 + **行内「重试」按钮** | **有** | `index.vue:198`、`:228-238`、`:192-195` |
| `/novel/:id` | **有骨架屏**：`Skeleton :rows="6"` | 每个 tab 各自的 `.pane__hint` 一行灰字（如「还没有世界观。点右上「内容分析」…」），或 `EmptyState`（章节/分集剧本） | 顶部红条 + **「重试」按钮**（重跑 `loadSummary`）；单步操作失败走 toast | **有**（仅页面级） | `novel/[id].vue:503`、`:491-494`、`:521-523`、`:665-667`、`:578`、`:595`、`:606`、`:625`、`:652` |

---

## §5 已知未实现 / 半成品

> 全量 grep（`TODO|FIXME|未做|下一轮|暂不支持|占位|建设中|尚未|暂未`）在 7 页 + 4 组件里**没有命中任何 TODO/FIXME**（唯一"占位"字样出现在 `pages/projects/[id].vue:1042` 与 `pages/reelflow/edit/[id].vue:51`，都是图片兜底注释）。也就是说：未实现的部分不是"留在注释里"，而是**以置灰/「即将开放」/空态/死代码的形式留在界面上**。共 25 条，按类型分：置灰 6 处、未接线 4 处、死代码 3 处、缺失入口 2 处、半成品 6 处、假数据 2 处、虚假承诺 1 处、说明 1 处。

| # | 类型 | 位置 | 原文（注释 / 界面文案） |
|---|---|---|---|
| 1 | 置灰 | `pages/projects/[id].vue:1837-1840` | 角色空态「**AI 智能提取**」按钮 `disabled` + chip「即将开放」，`title`「智能提取资产即将开放」（i18n `projectDetail.ui.soonExtractHint`） |
| 2 | 置灰 | `pages/projects/[id].vue:1929-1932` | 左栏「**+ 添加分镜**」按钮 `disabled`，`title`「单镜增删即将开放」；i18n `addShotDisabled`「新增空白分镜需要后端支持（P1.5）」 |
| 3 | 置灰 | `pages/projects/[id].vue:2077-2080` | 右列「**更多素材源**」卡 `disabled`，`title`「更多素材源即将开放」；i18n `moreSourcesDisabled`「更多素材源（P2）」 |
| 4 | 置灰 | `pages/projects/[id].vue:2086-2088` | 「**匹配资产**」`disabled`，`title`「自动匹配项目资产，敬请期待」；i18n `matchAssetsDisabled`「按提示词自动匹配项目资产（P3）」 |
| 5 | 置灰 | `pages/projects/[id].vue:2089-2091` | 「**放大编辑**」`disabled`，`title`「全屏编辑提示词，敬请期待」；i18n `zoomEditDisabled`「放大编辑（P2）」 |
| 6 | 置灰 | `pages/projects/[id].vue:632` | 生成模式「AI改视频」：`if (key === "ai_edit") return false;`；i18n `mediaModes.aiEditHint`「需要源视频输入，当前不支持」；CSS 注释自述「本页 **5 个暂未接通**的入口」` :2952-2953` |
| 7 | 未接线 | `pages/projects/[id].vue:2441` | 项目资产抽屉的搜索框 `<input class="drawer__search" … />` **没有 `v-model`、没有 `@input`**，输入无任何效果（placeholder 仍写「搜索你想要的{kind}」） |
| 8 | 未接线 | `pages/projects/index.vue:181-190` | 「已导出」tab 不请求任何接口，固定渲染空态「暂无导出记录」；`tab` 变量在模板里只用于切换，无数据源 |
| 9 | 未接线 | `pages/projects/[id].vue:2125-2133` | 右列「图片生成」tab 整块是空态：「图片生成暂未接入 / 当前后端只提供分镜视频生成（storyboard_reference_video）…」（i18n `imageNotWired`） |
| 10 | 未接线 | `pages/projects/[id].vue:46`、`:369` | 拆分镜参数 `shotCount = ref(10)` **无任何输入控件**，`POST .../storyboards/generate` 永远按 10 镜请求 |
| 11 | 死代码 | `pages/projects/[id].vue:352-362` | `generateScriptDraft()`（对应 `POST .../script-draft/generate`）**无调用方**，全页仅 1 次出现 |
| 12 | 死代码 | `pages/projects/[id].vue:596`、`:539-544`、`:546-551`、`:559-564`、`:100`、`:658-666`、`:1211` | 定义了但**从未在模板中使用**：`assetItems`（:596）、`steps`（:539）、`stepDone`（:546）、`epShortTitle`（:559）、`allShotsSelected`（:100）、`stageMaterials`（:658）、`timelineDirty`（:1211）。其中 `stageMaterials` 的缺失导致中列「全部 / 图片」两个 tab 渲染完全相同的内容（模板直接用 `boundAssets`，`:1961`） |
| 13 | 死代码 | `pages/projects/[id].vue:84`、`:256`、`:2158` | `budgetTouched` 只被写（`@input` 置 true、预填时置 false），**从未被读取** |
| 14 | 缺失入口 | `pages/novel/[id].vue:384`；`components/novel/NovelOriginalChain.vue:356`、`:642-643` | toast 写「已定稿（status=16），**可作为制片工坊的拆集来源**」，但 web 端全量 grep `source_novel_id` / 「拆集」/ `reopen` 均**无任何调用点**——小说定稿后没有进入 `/projects` 的按钮 |
| 15 | 缺失入口 | `pages/novel/[id].vue:473-480` | 「定稿完成改编」一旦成功即 `disabled`，页面上**没有「撤回定稿」**；后端其实有 `POST /novel/:ntId/reopen`（`apps/api/src/modules/novel/novel.controller.ts:372`）；只有 `NovelOriginalChain.vue:642-643` 用文字提示「要改稿需在「改编链 → 定稿」处撤回定稿」，而那处也无入口 |
| 16 | 半成品 | `pages/reelflow/edit/[id].vue:968` | 顶栏「**时间线导出**」是 `span.rf-pill--on`（选中态胶囊），**不可点击**，页面无第二个视图可切 |
| 17 | 半成品 | `pages/reelflow/edit/[id].vue:157-162` | 「已剪辑」tab 在**已加载的那一页**数据上做前端过滤（`timeline_duration_s > 0`），分页外作品不会出现 |
| 18 | 半成品 | `pages/reelflow/edit/[id].vue:459-461` | 裁剪只支持出点：「trim：右边缘拖动 = 改时长（出点）。**入点固定 0**——后端 clip 契约只有 duration，没有 in/out 字段，所以这里只做「出点」；硬做入点会写不进去（假功能）」 |
| 19 | 半成品 | `assets.vue:101`、`:119`；`reelflow/edit/[id].vue:776`；`SubjectLibrary.vue:137`、`:199`、`:253` | 交互退化为浏览器原生弹窗：`window.confirm("删除资产 {name}？")`、`window.prompt("新目录名称")`、`confirm("下架「{title}」？…")`、`prompt("参考图的 storage key …")` |
| 20 | 半成品 | `pages/projects/[id].vue:1127`、`:468`、`:510`、`:1475`；`pages/reelflow/edit/[id].vue:668`、`:737` | 轮询都有硬上限：资产候选 45×2s、出片任务 30×2s、zip 导出 30×1.5s、合成 120×2s、剪辑台合成 150×2s、发布 150×2s；到点只提示一次，不续轮 |
| 21 | 半成品 | `pages/projects/[id].vue:2473`、`:2546` | 同一页**挂载两个 `Director3D` 实例**（镜头级定格 + 项目级场景快照），顶栏与右列各有一个入口，二者互不共享场景状态 |
| 22 | 假数据 | `pages/projects/[id].vue:2071-2073` | 额度行文案写死「图片 {img}/30 · **视频 0/10 · 音频 0/10** · 总素材 {total}/50」——视频/音频两个计数**永远是 0** |
| 23 | 假数据 | `pages/projects/[id].vue:276`；`pages/novel/[id].vue:287` | 「生成角色」永远 `{count:5}`、「生成核心角色」永远 `{count:3}`，无 UI 可调（对比：定妆图张数、角色卡数、集数都有输入控件） |
| 24 | 虚假承诺 | `components/CreateProjectModal.vue:222` | 虚线上传区文案写「请上传剧本或分镜单，**也可以从剧本库选择**或粘贴文本」，但弹窗内没有「剧本库」按钮，只有上传与粘贴两条路 |
| 25 | 说明 | `pages/reelflow/edit/[id].vue:51-52`；i18n `editor.mockPlaceholderNote` | 「源文件探测失败（mock 占位字节）：仅在 UI 提示，不影响导出」；界面提示「（当前是 mock 适配器的占位字节，配真实 Key 后即可播放）」 |

> 类型合计与上表 25 行一一对应（其中 #6 的 CSS 注释覆盖第 1~5 条中的 5 个控件，故"置灰"按控件计 6 处）；「置灰或未接线」口径 = 置灰 6 + 未接线 4 + 死代码 3 + 假控件类 1（#7）+ 虚假承诺 1（#24）= **15 处**。

---

*本报告只做客观清点，不含评价与改造建议。所有行号均来自本次实际读取的源码。*
