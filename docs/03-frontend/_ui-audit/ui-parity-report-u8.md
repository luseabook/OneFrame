# UI 对齐报告（U8 · 93 条可比路由全量）

> **2026-11-04 复核**：本报告「26 条 ❌」已过时——其中 6 条已闭合（37/47/48/67/69 已建页、68 为等价视图），真 ❌ 为 20 条；补 38/44/63/68 入口、68 别名、39 短剧承接与 55 CLI 页后剩 **14 条**（全部非创作）。**以 `ui-parity-ledger.md` 为准**，本文保留为 2026-11-02 的采集快照。

> 基线 HEAD `a150ff3` · 采集日期 2026-11-02 · 分支 `main`（未 commit / 未 push）
> 口径来源：`docs/07-plan/ui-ux-parity-execution-plan.md` §1.1 / §4.3
> 逐单元证据：[U1](reports/U1.md) · [U2](reports/U2.md) · [U3](reports/U3.md) · [U4](reports/U4.md) · [U5](reports/U5.md) · [U6](reports/U6.md) · [U7](reports/U7.md)

## 0. 结论（先看这四行）

| 项 | 数 |
|---|---:|
| 台账行数（可比路由） | **93** |
| ✅ 对齐（L1 + L2 全过；数据页另加 L3） | **0** |
| 🟡 部分（我方已就绪，但有未闭层或竞品证据缺口） | **12** |
| ⏳ 待证据（竞品同状态动态证据缺失，不判通过） | **55** |
| ❌ 无对应入口 | **26** |
| **UI 对齐度（严格口径）** | **0 / 93 = 0.0%** |

**0 不是"什么都没做"，而是"L2 全站无法判定"。** L2 的定义是「操作步骤 / 交互与竞品一致」，而竞品 Web 的步数证据始终不存在（计划 §2.3 早已写明：竞品只暴露 Agent/CLI 分母，D4 已确认本轮拿不到录屏）。任何一条把 L2 写成 ✅ 都是在编证据。因此分子为 0，是口径如实执行的结果，不是回退。

分层实测计数（同一批 93 行）：

| 层 | ✅ | 🟡 | ⏳ | — | 说明 |
|---|---:|---:|---:|---:|---|
| L0 入口 | 41（直接路由）| 26（页面内视图）| — | 26 | 见台账 L0 列；本轮新增发现 `/director` 直链 404 |
| L1 视觉 | **3** | 9 | 55 | 26 | 只有 #32 / #50 / #53 做到了与竞品实测数值逐项相等（≤2px） |
| L2 交互 | 0 | 0 | 67 | 26 | 竞品步数无证据 → 全站不可判 |
| L3 行为/数据 | 0 | 13 | 54 | 26 | 数据页行为只在 mock 下验证，未做真实后端 UI 行为对照 |

## 1. 本轮采集方法与结果（可复跑）

### 1.1 我方全量 DOM / 截图基线

```bash
node _acceptance/_ui-parity-baseline.cjs \
  --project-id=108320690623676416 --episode-id=108320690661425152 --reelflow-id=108320690623676416 \
  --wait=3500 --shots=docs/03-frontend/evidence/ui-audit/ours-2026-11-02 --routes=<36 条>
```

- 输出：`docs/03-frontend/evidence/ui-audit/baseline-2026-11-01T20-10-43.json`（36 条路由）
- 截图：`docs/03-frontend/evidence/ui-audit/ours-2026-11-02/`（36 张 1424×805）
- 采集口径：只登录本机测试号（`13800138000`），只读页面，不点竞品、不触发竞品写操作。

### 1.2 单元级 e2e（本轮的交互证据）

| 脚本 | 断言 | 结果 | 关键覆盖 |
|---|---:|---|---|
| `ui-parity-u1.cjs` | 26 | 26/26 | 批量 mode、四处状态一致、删除撤销、刷新不丢、切片越界、弹窗 Esc/遮罩/Space |
| `ui-parity-u2.cjs` | 58 | 58/58 | 匹配受理 vs 结果、抽屉 616px 几何、预选、绑定落库、提取失败可重试 |
| `ui-parity-u3.cjs` | 41 | 41/41 | 只读预览、去剪辑台、真实导出记录、列表命名两种口径 |
| `ui-parity-u4.cjs` | 58 | 58/58 | 298 / 1102×164 盒、保存三态、撤销重做、拖拽裁剪、3D 359/704/359 与默认值 |
| `ui-parity-u5.cjs` | 37 | 37/37 | 三卡、校验→批量生成、进度重试、幂等绑定（不重复计费） |
| `ui-parity-u6.cjs` | 51 | 51/51 | 首页三态、引导三步、工具卡反馈、toast 位置、英文弹窗 |
| `ui-parity-u7.cjs` | 40 | 40/40 | 1024/900/768 无溢出无裁切、焦点链、可访问名、英文环境 |
| **合计** | **311** | **311/311** | 全部付费/写接口 `page.route` 拦截，零真实生成/导出 |

> U7 原计划 43 条；本轮 1024/900/768 三档首页「关键按钮在视口内」因 CTA 文案未匹配而**跳过**（脚本只打印 note，不 push 断言），实际执行 40 条。跳过的 3 条不计为通过，311 不能与旧 314 直接比较。

### 1.3 i18n 与静态门禁

```bash
node _acceptance/i18n-key-parity.cjs        # 4073 keys × 5 语言，missing 0 / extra 0
node _acceptance/i18n-key-parity.cjs --cjk  # 模板硬编码中文：新增 0
pnpm --filter @app/web typecheck            # 0 error
pnpm --filter @app/web lint                 # 0 error / 26 warning（全既存）
pnpm test                                   # 12/12 task；1990 通过 + 1 跳过（与基线一致）
```

## 2. 本轮由基线采集新发现的缺陷（都已登记，未混进 ✅）

| # | 现象 | 影响 | 处置 |
|---:|---|---|---|
| 1 | `GET /director` → **404**（3D 导演台只以覆盖层存在，无独立路由） | 竞品 `/director` 可直链；我方深链/分享不可用 | 台账 #53 L0 记 🔶（页面内视图）；如需 1:1 就补一个承接路由，本轮未做 |
| 2 | `/reelflow/list` 每次访问打一次 `GET /v1/exports?page=1&page_size=20` → **404** | 后端尚无空间级导出日志端点（D3 已定本期不新增）；列表页标签因此恒为「已剪辑」 | 属既定决策的已知代价；若后端补端点，tab 会自动切「已导出」 |
| 3 | 基线采集 `/projects` 的 `finalUrl` 落到 `/create/video-effects`（httpStatus null） | 采集时序问题（上一路由未完成导航），非产品缺陷；直连 `/projects` 实测 200 | 采信 U7 的 `/projects` 断言与本次直连复核 |
| 4 | 采集器 `controls` 全为 0 | 采集脚本的控件选择器（`.btn-primary` 等）与本项目 class 不匹配 | 不影响截图与 DOM 盒数据；U8 未据此判定任何一条 |

## 3. 93 条逐条判定

> 判定规则：
> - **✅**：L1 + L2 全过（数据页另加 L3）；
> - **🟡**：入口有、我方已就绪，但至少一层未过或无竞品证据；
> - **⏳**：竞品同状态证据缺失，不判通过；
> - **❌**：无对应入口。
>
> 「本轮证据」列只列**本轮真实产出**的文件；没有证据的行一律 ⏳，不用"应该如此"补齐。
| # | 竞品路由 | 层 | L0 | L1 | L2 | L3 | 本轮证据 | 单条判定 | 说明 |
|---:|---|:--:|:--:|:--:|:--:|:--:|---|---|---|
| 1 | `/` | A | 🟢 | 🟡 | ⏳ | 🟡 | docs/03-frontend/evidence/ui-audit/u6/u6-01-home-1424.png | 🟡 | 我方 1424 截图已采集；竞品 1424 卡宽未测量、无步数证据 |
| 2 | `/register/public-beta-invite` | B | 🔶 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 3 | `/tutorial` | B | ❌ | — | — | — | — | ❌ | 无对应入口 |
| 4 | `/mobile-landing` | C | 🔶 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 5 | `/share-land` | B | 🔶 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 6 | `/profile` | A | 🔶 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 7 | `/setting` | B | 🔶 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 8 | `/user-center` | B | 🔶 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 9 | `/user-settings` | B | 🔶 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 10 | `/user-language` | C | ❌ | — | — | — | — | ❌ | 无对应入口 |
| 11 | `/user-update` | C | ❌ | — | — | — | — | ❌ | 无对应入口 |
| 12 | `/adjust` | C | ❌ | — | — | — | — | ❌ | 无对应入口 |
| 13 | `/pricing` | A | 🟢 | 🟡 | ⏳ | 🟡 | docs/03-frontend/evidence/ui-audit/ours-2026-11-02/03-pricing.png | 🟡 | 竞品静态截图有，FAQ/页脚未取证 |
| 14 | `/create/text-to-video` | A | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 15 | `/create/image-to-video` | A | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 16 | `/create/lip-sync` | B | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 17 | `/create/reference-to-video` | B | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 18 | `/create/video-refer` | B | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 19 | `/create/video-upscale` | B | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 20 | `/create/video-extend` | B | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 21 | `/create/video-edit` | B | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 22 | `/create/video-effects/effect` | B | 🔶 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 23 | `/create/image-to-image` | B | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 24 | `/create/text-to-image` | B | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 25 | `/create/brush-repaint` | B | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 26 | `/create/text-repaint` | B | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 27 | `/create/text-to-speech` | B | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 28 | `/create/text-to-music` | B | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 29 | `/create/text-to-sound` | B | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 30 | `/create/auto-bgm` | B | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 31 | `/series-manage` | A | 🔶 | 🟡 | ⏳ | 🟡 | docs/03-frontend/evidence/ui-audit/u3/u3-04-list-clipped.png; u3-05-list-exported.png | 🟡 | 双 tab 与卡形态已对齐，导出历史内容无竞品证据 |
| 32 | `/series-manage/:id()` | A | 🟢 | ✅ | ⏳ | 🟡 | docs/03-frontend/evidence/ui-audit/u1/u1-01-mode-text.png; u2/u2-03-drawer-geometry.png | 🟡 | 三栏 160/592/640 gap8 与竞品实测一致；竞品步数无证据，L2 无法判 |
| 33 | `/series-manage/episode/:id()` | A | 🔶 | 🟡 | ⏳ | 🟡 | docs/03-frontend/evidence/ui-audit/u3/u3-01-timeline-readonly.png | 🟡 | 项目页时间线形态已对齐；竞品编辑态无证据 |
| 34 | `/series-manage/asset-confirm` | A | 🔶 | 🟡 | ⏳ | 🟡 | docs/03-frontend/evidence/ui-audit/u2/u2-04-drawer-scene-only-subject.png | 🟡 | 抽屉外框 616px 零偏差；竞品有数据态未取证 |
| 35 | `/series-manage/asset-extract` | A | 🔶 | 🟡 | ⏳ | 🟡 | docs/03-frontend/evidence/ui-audit/u2/u2-08-extract-done.png | 🟡 | 提取链路已接线；竞品有数据态未取证 |
| 36 | `/episode-list` | C | 🔶 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 37 | `/script-manage` | C | ❌ | — | — | — | — | ❌ | 无对应入口 |
| 38 | `/script-view/:id()` | C | ❌ | — | — | — | — | ❌ | 无对应入口 |
| 39 | `/short-film/:id()` | C | ❌ | — | — | — | — | ❌ | 无对应入口 |
| 40 | `/novel-market/:id()` | B | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 41 | `/novel-to-script/:id()` | B | 🔶 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 42 | `/novel-to-script-agent/:id()` | B | 🔶 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 43 | `/novel-to-script-agent/create` | C | 🔶 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 44 | `/novel-to-script-agent/workbench` | C | ❌ | — | — | — | — | ❌ | 无对应入口 |
| 45 | `/creation-agent` | B | 🔶 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 46 | `/agent` | B | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 47 | `/agent/bigscreen` | C | ❌ | — | — | — | — | ❌ | 无对应入口 |
| 48 | `/agent/editor` | C | ❌ | — | — | — | — | ❌ | 无对应入口 |
| 49 | `/reelflow/list` | A | 🟢 | 🟡 | ⏳ | 🟡 | docs/03-frontend/evidence/ui-audit/u3/u3-04-list-clipped.png | 🟡 | 命名按 D3；导出日志行内容无竞品证据 |
| 50 | `/reelflow/edit/:projectId()` | A | 🟢 | ✅ | ⏳ | 🟡 | docs/03-frontend/evidence/ui-audit/u4/u4-01-editor-1424.png | 🟡 | 左栏 298 / 时间线 1102x164 / 顶栏 64 与竞品实测逐项相等；竞品步数无证据 |
| 51 | `/canvas` | A | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 52 | `/workflow-canvas` | B | 🔶 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 53 | `/director` | A | 🔶 | ✅ | ⏳ | 🟡 | docs/03-frontend/evidence/ui-audit/u4/u4-08-director-3d.png | 🟡 | 359/704/359 与 300%/50deg/0,1.2,0 复测相等；退出与拖拽无竞品证据 |
| 54 | `/director/:projectId()` | B | 🔶 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 55 | `/cli` | C | ❌ | — | — | — | — | ❌ | 无对应入口 |
| 56 | `/implement` | C | ❌ | — | — | — | — | ❌ | 无对应入口 |
| 57 | `/tools` | A | 🟢 | 🟡 | ⏳ | 🟡 | docs/03-frontend/evidence/ui-audit/ours-2026-11-02/04-tools.png | 🟡 | 静态结构；禁用卡原因已补，步数无证据 |
| 58 | `/asset` | A | 🟢 | 🟡 | ⏳ | 🟡 | docs/03-frontend/evidence/ui-audit/u5/u5-02-three-cards.png | 🟡 | 三卡与白 CTA 已落地；竞品有数据态未取证 |
| 59 | `/user-assets` | A | 🔶 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 60 | `/team` | B | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 61 | `/team/dashboard` | B | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 62 | `/team/knowledge-base` | B | 🔶 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 63 | `/project-members` | C | ❌ | — | — | — | — | ❌ | 无对应入口 |
| 64 | `/film` | A | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 65 | `/film-creation` | B | 🔶 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 66 | `/film/:id()` | A | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 67 | `/film/assets` | B | ❌ | — | — | — | — | ❌ | 无对应入口 |
| 68 | `/film/projects/:id()/tasks` | C | ❌ | — | — | — | — | ❌ | 无对应入口 |
| 69 | `/film/team` | C | ❌ | — | — | — | — | ❌ | 无对应入口 |
| 70 | `/creator-center` | B | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 71 | `/creator-center/:id()` | B | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 72 | `/creator-center/earnings` | B | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 73 | `/creator-center/preview/:id()` | C | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 74 | `/creator-center/publish` | C | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 75 | `/partner-center` | C | ❌ | — | — | — | — | ❌ | 无对应入口 |
| 76 | `/partner/invite` | B | 🔶 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 77 | `/ad-drama/create` | B | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 78 | `/ad-drama/workspace` | B | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 79 | `/video-redraw/create` | B | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 80 | `/video-redraw/workspace` | B | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 81 | `/refer-video` | C | ❌ | — | — | — | — | ❌ | 无对应入口 |
| 82 | `/video-effects` | C | 🔶 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 83 | `/activities` | B | 🟢 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 84 | `/activities/:activityKey()` | C | 🔶 | ⏳ | ⏳ | ⏳ | — | ⏳ | 竞品同状态证据缺失，未取证 |
| 85 | `/activities/wanju-vc/submission` | C | ❌ | — | — | — | — | ❌ | 无对应入口 |
| 86 | `/activity/jushuoyuelu/jushuoyuelu-contest-apply` | C | ❌ | — | — | — | — | ❌ | 无对应入口 |
| 87 | `/activity/jushuoyuelu/jushuoyuelu-contest-apply.:html()` | C | ❌ | — | — | — | — | ❌ | 无对应入口 |
| 88 | `/activity/jushuoyuelu/jushuoyuelu-contest-mvp-creator-apply` | C | ❌ | — | — | — | — | ❌ | 无对应入口 |
| 89 | `/activity/jushuoyuelu/jushuoyuelu-contest-mvp-creator-apply.:html()` | C | ❌ | — | — | — | — | ❌ | 无对应入口 |
| 90 | `/channel/education` | C | ❌ | — | — | — | — | ❌ | 无对应入口 |
| 91 | `/channel/education/buy` | C | ❌ | — | — | — | — | ❌ | 无对应入口 |
| 92 | `/channel/education/invite` | C | ❌ | — | — | — | — | ❌ | 无对应入口 |
| 93 | `/task` | A | 🟢 | ⏳ | ⏳ | 🟡 | — | ⏳ | 竞品零截图 |
## 4. 缺口清单（按能否自行闭合分组）

### 4.1 只能靠竞品动态证据（D4 未解锁，全部 ⏳）

1. 分镜卡定稿 / 有资产 / 生成中 / 失败态（影响 #32 的 L1/L2）
2. 匹配结果 UI 与项目资产抽屉有数据态（#34 / #35）
3. 导出面板 / 进度 / 下载 / `已导出` tab 内容（#31 / #33）
4. 五种生成模式各自的参数区差异（#32）
5. 3D 导演台有数据态与退出路径（#53）
6. 提示词库 / 提示词优化（#32）
7. `⋮` 菜单、`未开始 ▾`、时间线 `全部 ▾` 选项（#31 / #33 / #50）
8. 窄屏与移动端（#4 / 全站）
9. 「首次免费」触发条件（计费文案）
10. **竞品 Web 全站操作步数**（决定 L2 全站不可判）

### 4.2 我方自己能补的（不依赖竞品）

| 缺口 | 影响 | 建议 |
|---|---|---|
| L2 的「我方交互完整性」尚未单列成表 | 无法区分"我方没做"与"竞品没证据" | 在台账新增一列「我方 e2e 断言数」，与本轮 311 条对齐 |
| #53 `/director` 无直链 | 深链 404 | 加一个薄路由承接 `Director3D` 覆盖层 |
| 空间级导出日志端点缺失 | 列表 tab 恒为「已剪辑」 | D3 已定本期不做；后端补端点后前端自动生效 |
| 竞品 1424 下的卡宽/密度未测量 | #1 / #31 的 L1 只能 🟡 | 需要 1424 视口的竞品静态截图（现有 640 来自 1664 稿） |
| 对比度未量化（U7 遗留） | a11y 只做到焦点环可见 | 引入 axe-core 单开一批 |
| 窄屏未覆盖编辑器/工作台/画布 | U7 只测 4 个页面 | 扩到 6–8 个页面 × 3 档 |

## 5. 下一步建议（顺序不含日期承诺）

1. **先补 L2 的证明链**：把本轮 311 条断言按路由归档进台账「我方交互证据」列；这一列不参与严格分子，但能让"不是我方没做"这件事可复核。
2. **拿 D4 的录屏**：只要一次有积分账号的只读录屏（生成 1 镜 + 一次匹配 + 一次导出），就能把 #32 / #34 / #35 / #31 的 L1/L2 从 ⏳ 推进到可判。
3. **补两条直链缺口**：`/director` 承接路由、空间级导出日志端点（后者影响 #31 / #49 的 tab 语义）。
4. **竞品 1424 静态截图**：用于 #1 / #31 的卡宽与密度（现有 640 是从 1664 稿推的，不能当 1:1 依据）。
5. **不要动口径**：在拿到证据前，任何把 ⏳ 改 ✅ 的操作都是虚报；本报告的 0/93 就是当前证据下的真值。

## 6. 取证合规声明

- 未打开、未登录、未截图、未点击、未录制竞品；未执行竞品任何写操作（分享、购买、生成、删除均未触发）。
- 竞品数值全部来自仓库内既有只读证据：`docs/03-frontend/evidence/ui-compare/`（2026-10-25/26 捕获）、`_ui-audit/ref-facts.md`。
- 未提取/复用任何浏览器会话凭据；所有 e2e 只登录本机测试号，SMS 验证码从本地 Redis 读取。
- 所有付费/写接口在 e2e 里一律 `page.route` 拦截并 fulfill；未触发任何真实生成、导出或计费。
