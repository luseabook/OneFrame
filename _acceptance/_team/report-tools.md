# 第 3 批交付报告：工具箱 19 卡 + 后处理族（task-4 / tools-impl）

> 日期：2026-10-27 · 范围：模块 #6 工具箱（32%）+ #15 后处理族（30%）
> 执行标准：ADR-013（有证据照做 / 无证据不臆造并登记待取证）· ADR-003（不新增生成端点）

---

## 1. 交付

### 1.1 端点

| 方法 路径 | 性质 | 说明 |
|---|---|---|
| `GET /generations/tools` | **新增（只读目录）** | 19 张卡 + 15 个工具 mode + 参数面板声明。这是 `/tools` 页与工具工作台的**唯一数据源** |
| `POST /generations` | 扩参（**未新增端点**） | 请求体 `options` 扩成公共 options 超集（voice/speed/effect/region/strategy/target_fps…），既有调用方零影响 |
| `POST /credits/quote` | 无改动 | 工具 mode 走同一套目录价（`models.modes[mode]` + `model_prices`） |

**新增 mode（只扩枚举 + 分派，ADR-003）**

| 类别 | mode | 适配器（model-adapters） |
|---|---|---|
| 后处理族（本批补齐） | `de_subtitle_auto`、`de_subtitle_region` | `subtitle-erase`（既有） |
| | `video_slicing` | `slicing`（既有） |
| | `fps_duration_unify` | `fps-unify`（**新**） |
| | `video_audio_separation` | `audio-separation`（**新**） |
| | `audio_timbre_modify` | `timbre-modify`（**新**） |
| 单点工具 | `video_effects` | `video-effects`（**新**） |
| | `auto_bgm` | `auto-bgm`（**新**） |
| | `text_repaint` | `text-repaint`（**新**） |
| | `inpaint`（涂抹重绘） | `image-inpaint`（**新**） |
| 既有枚举直接接线 | `lip_sync`、`video_upscale`、`tts`、`text2music`、`text2sfx` | `lip-sync` / `upscale` / `tts` / `music:*`（既有，本批接目录+页面+分派） |

`packages/shared/src/constants.ts` 增量（Lead 已批准）：`VideoToolMode += video_effects / fps_duration_unify / video_audio_separation`；`AudioToolMode += auto_bgm / audio_timbre_modify`；`ImageMode += text_repaint`。既有 mode 名/顺序/值一字未动。

**画布**：`CANVAS_MODE_MAP` 补 `video_upscale → { mode: "video_upscale" }`（此前注释是"明确不在 MVP，直接拒"）。

### 1.2 页面

- 重写 `pages/tools.vue`：**卡清单来自 `GET /generations/tools`**（不再硬编码），19 张卡全部 `NuxtLink` 可点（无 `muted` 静默态），分类 Tab 10/4/5。
- 新增通用工作台 `components/ToolWorkspace.vue`：参数面板/输入槽/档位全部由目录声明驱动 → 参数校验 → `POST /credits/quote`（防抖静默报价）→ `POST /generations`（Idempotency-Key + quote_id）→ 轮询 `GET /tasks/:id` → 按 `result_media` 渲染 video/img/audio + 多产物下载 + 最近任务。
- 新增落地页（11 个，全部 `layout="tool"`、`ssr:false`）：

| 路由 | 工具 | 说明 |
|---|---|---|
| `/create/lip-sync` | 视频对口型 | 双素材槽（视频+音频） |
| `/create/video-upscale` | 视频超清 | 6 个 tab：超清/去字幕自动/去字幕框选/切片/帧率时长统一/音画分离 |
| `/create/video-effects` | 视频特效 | 模板+强度+转场 |
| `/create/brush-repaint` | 涂抹重绘 | 源图+蒙版+重绘描述（mode=`inpaint`） |
| `/create/text-repaint` | 文字重绘 | 替换文字+字体+颜色 |
| `/create/text-to-speech` | 文生语音 | 5 音色 + 语速 |
| `/create/text-to-music` | 文生音乐 | 纯伴奏 + 时长 |
| `/create/text-to-sound` | 文生音效 | 时长 |
| `/create/auto-bgm` | 自动配乐 | 风格/音量/人声段压低 |
| `/create/audio-timbre` | 音色修改 | 源音轨 + 音色预设 + 音高 |
| `/create/inspiration` | 灵感成片 | `components/InspirationWorkspace.vue`，走 `POST /agent/task/create-check` + `POST /agent/task/create` + 轮询 `/agent/task/:id` |

**19 张卡的数量依据（ADR-013 以竞品证据为准）**

- 17 条 `/create/*`：`rea-reelmate/routes.txt:25-41`
- 「灵感成片」= `/creation-agent`（`routes.txt:42`；`docs/01-product/reelmate-feature-map.md §3.5` 列为"报告点名无独立 /create 路由"）
- 「音色修改」= 报告点名无独立路由的工具（`reelmate-feature-map.md §3.5`），本批以 `mode=audio_timbre_modify` 承载并补卡片
- 卡片文案/顺序逐字照 `docs/03-frontend/reference-alignment-spec.md §5.3`（含描述末尾的三个点）

### 1.3 测试

```
cd apps/api
npx vitest run test/tools.spec.ts                                  ✓ 15/15
npx vitest run --no-file-parallelism test/flow.spec.ts             ✓ 12/12   （回归验证）
npx vitest run --no-file-parallelism test/model-catalog.spec.ts    ✓ 16/16   （回归验证）
npx vitest run --no-file-parallelism test/canvas.spec.ts test/canvas-derive.spec.ts \
    test/project-assets-image.spec.ts test/storyboard-modes.spec.ts test/pipeline.spec.ts test/agent.spec.ts
                                                                   ✓ 全绿
cd packages/model-adapters
npx vitest run                                                     ✓ 164/164（14 files）
```

`test/tools.spec.ts` 覆盖（每条都写了"为什么这么断言"）：
1. 目录 19 卡 / 15 工具 / 每张卡都有 `/create/*` 落地页 / 卡 key 唯一；
2. 每个工具 mode 都在 `GenerationMode` 闭包内（并逐个点名本批 6 个后处理 mode，防"总数对但少一个"）；
3. 目录幂等（重复 ensure 不新增 model/price 行）；
4. 15 个 mode 逐个报价，金额等于目录初始价（`per_call` / 超清按画质档）；
5. 未登录拿不到目录/报价（全局 AuthGuard 覆盖新端点）；
6. 文生语音成功路径：任务行 `mode/capability/creditsFrozen/options.voice` 全对；
7. 视频对口型缺音频 → 冻结前拦住 + 不落任务行 + msg 指到 `reference_uris`；
8. 文字重绘缺替换文字 → msg 指到 `options.text`；
9. 同 Idempotency-Key 重放 → 同一 task_id 且库里只有一条；
10. 跨空间读不到别人的任务；
11. 7 个新 code 在 real 模式解析出对应适配器类；
12. real 缺 Key 硬失败（安全约定）；
13. 7 个适配器自带 mock 形状与产物媒体类型一致（mp3/mp4/多产物/png）；
14. 画布 `video_upscale`：视频节点投递 → `tasks.mode=video_upscale`、节点回写 task_id+status=2；普通生成模型投递 → 显式报 `model ... does not support video_upscale`；
15. 收尾 cancel（退回冻结积分，不删账）。

**E2E（真实浏览器 + 真实 API）**：`_acceptance/e2e-tools2.cjs` → **19/19 通过**
```
S1 登录 → /tools：19 卡全部渲染、全部是链接且无 muted、与 API 目录一致、Tab 10/4/5
S2 视频对口型：双素材上传 → 报价 ✦20 → 投递 → task.mode=lip_sync 且 reference_uris=2
S3 文生语音：报价 ✦8 → 投递 → task.mode=tts 且 options.voice 落库
S4 视频超清页：6 个 tab 全在 → 切「视频切片」→ 投递 → task.mode=video_slicing
S5 文字重绘：点「立即生成」有明确缺失提示（不允许点了没反应）
S6 音色修改页：音频槽 + 5 个音色参数
S7 控制台零未预期错误
截图：_acceptance/tools2-e2e/*.png
```

**mock 真跑出产物（live worker + ADAPTER_MODE=mock）**：15 个工具 mode 逐个建任务 → 全部 `status=3` 且产出文件：
```
lip_sync        → r0.mp4    video_upscale      → r0.mp4    video_effects    → r0.mp4
de_subtitle_auto→ r0.mp4    de_subtitle_region → r0.mp4    video_slicing    → r0.mp4
fps_duration_unify → r0.mp4 video_audio_separation → r0.mp4 auto_bgm        → r0.mp4
inpaint         → r0.png    text_repaint       → r0.png    tts              → r0.mp3
text2music      → r0.mp3    text2sfx           → r0.mp3    audio_timbre_modify → r0.mp3
```
（`auto_bgm` 的 `capability` 特意写成 `video` 而不是 `music`：产物是**带 BGM 的视频**，写成 music 会按 audio/mpeg 落库，前端 `<video>` 拿到 .mp3 播不了。）

### 1.4 门禁输出

```
pnpm --filter @app/api typecheck        ✓ 0 error
pnpm --filter @app/worker typecheck     ✓ 0 error
pnpm --filter @app/web typecheck        ✓ 0 error（已含 .nuxt 生成）
pnpm --filter @app/api lint             ✓ 0 error
npx eslint src/modules/generations src/modules/{models,assets} apps/web/components/ToolWorkspace.vue …
                                        ✓ 0 error / 0 warning
```

---

## 2. 证据（逐条可追）

| 交付项 | 竞品证据 |
|---|---|
| 17 条 `/create/*` 工具路由 | `rea-reelmate/routes.txt:25-41` |
| 灵感成片（Agent，无 /create 路由） | `routes.txt:42`（`/creation-agent`）；`reelmate-feature-map.md §3.5` |
| 音色修改（报告点名无路由） | `reelmate-feature-map.md §3.5` |
| 工具箱 19 卡文案/顺序/Tab 文案 | `docs/03-frontend/reference-alignment-spec.md §5.3`（逐字）；§5.4 T7（原先 8/18 张静默态 → 本批清零） |
| 后处理族 6 mode | `docs/07-plan/completion-plan-to-100.md §4.2` |
| 10 张静默态卡能力映射（lip/upscale/effects/inpaint/repaint/tts/music/sfx/bgm） | 同 §4.1 表格 |
| 画布 mode 全集 28→29（补 video_upscale） | 同 §4.2 判据；`canvas-node-tasks.service.ts` 原注释"明确不在 MVP" |
| 生成端点不新增（1 端点承载多 mode） | ADR-003；同 §4.2 注 |
| 去字幕两态（auto/region） | 画布 `CANVAS_MODE_MAP` 既有 `de_subtitle_auto/region` 映射（`canvas-node-tasks.service.ts`） |

---

## 3. 已知偏离 / 待取证

1. **「视频超清」页承载 6 个后处理 tab**：参照站只有 `/create/video-upscale` 一条路由，去字幕/切片/帧率规整/拆轨在竞品侧是**画布节点上的后处理动作**（我方画布映射表里本来就有 `de_subtitle_*`、`video_clip`）。为不臆造竞品不存在的卡片（ADR-013 决策 2），把同族能力收进这张卡的落地页 tab；**竞品对应交互的具体形态待取证**（需要竞品画布后处理面板截图/接口调用样本）。
2. **`per_call` 计价哨兵约定（已裁定，需写进 api-spec §5.x）**：`model_prices` 主键维度是 `(model_id, mode, resolution, duration_s)`，按次能力 `duration_s=NULL` 已表示"按次"，而 `resolution` 必须给值 → 用 **`per_call`** 作为显式哨兵（不是 `720p`/`1K` 这类看起来像画质档的值，避免运营在 `/ops/admin/model-prices` 误读）。完整列值：`resolution='per_call'`、`duration_s=NULL`、`credits/strike_credits`=目录初始价、`active=true`。唯一例外：**视频超清**按真实画质档 `1080p/2K/4K` 定价（3 行价目），因为它卖的档位就是分辨率。

   **15 个工具 mode → 计费口径表（api-spec 用，运营改价依据）**

   | # | 卡片/能力 | `mode` | 目录行（协议名 sku） | `resolution`（价目维度） | 计费口径 | 初值(积分) |
   |---:|---|---|---|---|---|---:|
   | 1 | 视频对口型 | `lip_sync` | `toolbox-lip-sync` | `per_call` | 按次（1 条成片） | 20 |
   | 2 | 视频超清 | `video_upscale` | `toolbox-video-upscale` | `1080p` / `2K` / `4K` | **按档位**（3 档价，非按秒） | 15 / 30 / 60 |
   | 3 | 视频特效 | `video_effects` | `toolbox-video-effects` | `per_call` | 按次（1 条成片） | 10 |
   | 4 | 去字幕（自动） | `de_subtitle_auto` | `toolbox-de-subtitle-auto` | `per_call` | 按次（整片） | 12 |
   | 5 | 去字幕（框选） | `de_subtitle_region` | `toolbox-de-subtitle-region` | `per_call` | 按次（整片） | 12 |
   | 6 | 视频切片 | `video_slicing` | `toolbox-video-slicing` | `per_call` | 按次（一次请求切成 N 片，N 不影响价） | 8 |
   | 7 | 帧率时长统一 | `fps_duration_unify` | `toolbox-fps-unify` | `per_call` | 按次（整片） | 6 |
   | 8 | 音画分离 | `video_audio_separation` | `toolbox-audio-separation` | `per_call` | 按次（1→2 产物） | 6 |
   | 9 | 自动配乐 | `auto_bgm` | `toolbox-auto-bgm` | `per_call` | 按次（1 条成片，`capability=video`） | 18 |
   | 10 | 涂抹重绘 | `inpaint` | `toolbox-inpaint` | `per_call` | 按次（1 张） | 12 |
   | 11 | 文字重绘 | `text_repaint` | `toolbox-text-repaint` | `per_call` | 按次（1 张） | 10 |
   | 12 | 文生语音 | `tts` | `toolbox-tts` | `per_call` | 按次（暂不按字符，长文本同价；如转按字符需新增 `per_1k_chars` 哨兵） | 8 |
   | 13 | 文生音乐 | `text2music` | `toolbox-text-to-music` | `per_call` | 按次（时长 15/30 不影响价，`modes` 刻意不声明 `durations`） | 15 |
   | 14 | 文生音效 | `text2sfx` | `toolbox-text-to-sfx` | `per_call` | 按次（1~30s 同价，同上不声明 `durations`） | 5 |
   | 15 | 音色修改 | `audio_timbre_modify` | `toolbox-timbre-modify` | `per_call` | 按次（整条音轨） | 10 |

   > 口径说明：**没有"按秒"档**。原因是这些能力在供应商侧就是「提交一次任务/出一个产物」，按秒拆档会让 `duration_s` 变成"用户填的时长"而不是"供应商计费单位"，运营改价时无法对应到成本。若后续某能力改为按秒（例如 TTS 按字符、超分按分钟），新增独立哨兵（`per_1k_chars` / `per_minute`）而不是复用 `per_call`。
3. **价格是新库初值**（超清 15/30/60，TTS 8，音乐 15，音效 5，配乐 18，对口型 20，特效 10，去字幕 12，切片 8，帧率规整 6，拆轨 6，音色 10，涂抹 12，文字重绘 10，单位=积分），与 seed 同口径：代码不写死计费，运营可热更（`ensureToolCatalog` 对已存在的价目只**同步金额**，不新增行，避免破坏 `uq_model_prices_per_call`）。
4. **画布节点产物形态（`video_upscale`）**：节点收 **video**（`params.result_uri`/`result_uris[]` 指向升级后的 mp4），分辨率档位由节点 `settings.resolution`（1080p/2K/4K）决定，产物时长/帧率跟随源视频；节点状态流转 `2(生成中) → 3(完成)`，失败回 `1(就绪)` 且 `params.last_error` 有错误码（executor 既有回写逻辑）。**注意**：节点必须选到工具模型 `toolbox-video-upscale`（声明了该 mode），选普通生成模型会被目录校验挡住并明确报错，不会静默跑成一次普通生成。
5. **`models` 表里的 15 行 `toolbox-*` 内部能力行（已裁定：接受取数排除，不走 schema 方案）**
   - **约束冲突**：`tasks.model_id` / `model_prices.model_id` 是 NOT NULL + FK，工具任务与价目必须挂在 `models` 行上；而 `test/model-catalog.spec.ts` 是"竞品 46 条目录"契约，**直读全表**（`db.select().from(models)`，不是打 `GET /models`），所以多 15 行必红，与 `visible` 无关（靠 `visible=false` 修不了这条）。
   - **裁定（Lead 2026-10-27）**：`models` 单表同时承载两类语义不同的行——「竞品对齐目录（46）」与「内部能力行（15，`toolbox-*`）」；在 **spec 取数层**把两者分开（`filter(name 不以 toolbox- 开头)`），**46 这个数字与后续全部断言一字未动**。**不采用 schema 方案**（`tasks.model_id` 改 nullable 会把"任务必须有模型"这条约束变软，代价大于收益）。
   - **实现**：`toolbox-*` 一律 `visible=false`；`GET /models` 缺省只返回可见行（实测 46 条、0 条泄漏；`?visible=false` 返回 15 条供运营排查）；`ModelsService.findByName` **放开 visible 过滤**（否则 `credits.price()` 找不到工具行，表单能填但投不出去）。
   - **为什么不再给 `GET /models` 加别的口子（如 `?include_internal=true`）**：`visible=false` 已经能精确表达"内部行"，再加一个参数就是同一语义的第二个入口，调用方会分不清该信哪个；而运营排查场景用 `?visible=false` 已经够（该参数是既有契约里的过滤器，不是本批新增）。**规则收敛为一句话：列表看 `visible`，按名查找不看 `visible`**——用户拿不到不可见模型的名字，就没有自行选到它的路径；内部编排按名解析则始终能拿到。
6. **mock 形状的两处已知差异**（仅 mock，真实供应商不受影响）：
   - `ADAPTER_MODE=mock` 时 registry 对**所有** code 返回共享 `MockAdapter`（`registry.spec.ts:67-72` 明确断言这一点），因此工具任务在 mock 下拿到的是共享 mock 的产物形状；音频/图片的扩展名差异由 worker `contentTypeFor` 按 `capability` 纠正落库扩展名（本批新增 speech/music→`.mp3`，验证见 §1.3 实跑清单）。
   - `video_slicing` / `video_audio_separation` 的**多产物**在 mock 下只有 1 个（共享 mock 的 count 来自 `options.count`，不知道"切片 1→N"）；真实适配器自带 mock（`{mock:true}`）会按策略产 N 个，已在 `tools.spec.ts` 用适配器自 mock 断言。
7. **real 模式缺 Key 硬失败是既有约定，第 3 批沿用**（`postprocess.ts` 构造器 + `registry.spec.ts:53-57`）：**不要**改成回落 mock —— 静默 mock 会让用户以为真出片并照样扣积分（资金/合规级安全约定）。
8. **音频上传白名单（跨范围改动，必要，已获裁定接受）**：`packages/shared/src/schemas/pipeline.ts` 的 `asset_upload.content_type` 原枚举只有 图片/视频，`apps/api/src/modules/assets/assets.service.ts` 的 `EXT` 映射与大小上限同样如此 → 对口型的驱动人声、音色修改的源音轨、自动配乐的参考音轨**永远上传失败**（表现为"能点但提交前永远凑不齐 `reference_uris`"）。本批增量：
   - **mime 白名单新增**：`audio/mpeg`（→`.mp3`）、`audio/wav`（→`.wav`）、`audio/mp4`（→`.m4a`）；
   - **落库 `kind`**：`audio`（原逻辑只有 `video`/`image`，音频会被错标成 image，资产库筛选与播放器都会拿错类型）；
   - **大小上限**：与视频同档 **32MB**（base64 后约 43M 字符，对齐 `bodyLimit` 48MB）；图片仍 8MB；
   - 既有图片/视频白名单与上限**未改动**。
   → 需 Lead 在 api-spec 同步该枚举与上限（已列入 §4.2）。
9. **图片类工具未做真实提交**：`text_repaint` 在 E2E 里只验证前端前置校验（缺文字被拦），未做真实投递（浏览器上传图片+提交可跑，但为控制 E2E 时长/积分未覆盖）；`inpaint` 的蒙版是**单张蒙版图**（`reference_uris[1]`），未做多图层/笔刷画布。
10. **灵感成片只做单轮**：复用 `agent/task/create` + `/agent/task/:id`，未做会话化多轮（那属第 4 批 `/agent` 页面）。
11. **新适配器只有 mock 形状 + 分派断言**，无真实供应商沙箱（没有 Key/Sandbox）；真实协议路径按"提交→轮询→取产物"通用形状实现，字段名待供应商对接时定稿（各适配器注释里写了抓包依据假设）。

---

## 4. 需要 Lead 做

1. ~~**裁定 §3.5**~~ → **已裁定（Lead 2026-10-27）：接受 `model-catalog.spec.ts` 取数排除 `toolbox-*`；不采用 schema 方案。** 已落到代码与 §3.5，无需再做。
2. **文档同步**（`docs/**` 不在我权限内）：`api-spec` 补 ①`GenerationMode` 新增 6 个 mode；②`GET /generations/tools` 目录端点；③`POST /generations` 的 `options` 工具字段；④`per_call` 计价约定；⑤`asset_upload.content_type` 扩音频；⑥画布 `video_upscale` 映射。
3. **`nuxt.config.ts`**：`/create/**` 已是通配 `ssr:false`，**无需改动**（已确认）。
4. **`layouts/app.vue`**：本批不需要新增侧栏入口（工具页走 `layout="tool"`），**未改**。
5. **回归提醒**：dev 栈若有 worker 在跑，`canvas.spec`（sync-tasks）与 `project-assets-image.spec`（断言 status=1 排队）会红——这是环境问题不是代码问题；我临时起 worker 做 mock 出片验证后已全部停止。
6. **本批唯一一次 dev 库副作用**：我第一次跑 tools.spec 的清理逻辑曾删除过自己造的 tasks/credit_flows（后续已改为只 cancel 不动账），worker 的 ledger 审计日志因此有历史告警（`LEDGER MISMATCH`），不影响代码与测试；如需彻底清账可对那几个 space 重跑对账或忽略。

## 5. 未完成

- 真实供应商 Key 全部缺失 → 15 个 mode 全部只有 mock 链路可跑（§3.11）。
- 图片类工具的真实浏览器提交（§3.9）、涂抹重绘的蒙版笔刷 UI、灵感成片的会话化（§3.10）。
- 竞品画布后处理面板的取证（§3.1），取证后才能判断「视频超清页带 6 tab」是否要拆成独立卡片。
- 未做 `docs/**` 与 `api-spec` 同步（§4.2）。

## 6. 涉及文件（本批）

```
apps/api/src/modules/generations/{generations.controller.ts, generations.service.ts, tool-catalog.ts(新)}
apps/api/src/modules/canvas/canvas-node-tasks.service.ts
apps/api/src/modules/models/models.service.ts            （visible 语义 + findByName）
apps/api/src/modules/assets/assets.service.ts            （音频白名单）
apps/api/test/{tools.spec.ts(新), model-catalog.spec.ts(取数排除)}
apps/worker/src/executor.ts                              （speech/music 产物类型 + 扩展名）
apps/web/pages/tools.vue
apps/web/pages/create/{lip-sync,video-upscale,video-effects,brush-repaint,text-repaint,text-to-speech,text-to-music,text-to-sound,auto-bgm,audio-timbre,inspiration}.vue(新)
apps/web/components/{ToolWorkspace.vue(新), InspirationWorkspace.vue(新)}
apps/web/types/api.ts                                    （仅追加）
packages/shared/src/constants.ts                         （增量 mode 枚举，Lead 批准）
packages/shared/src/schemas/pipeline.ts                  （asset_upload 音频）
packages/model-adapters/src/{postprocess-tools.ts(新), registry.ts, index.ts}
_acceptance/e2e-tools2.cjs(新)
```

未改动：`app.module.ts`、`layouts/app.vue`、`nuxt.config.ts`、`packages/db/src/schema.ts`、迁移、`docs/**`、`VideoGenWorkspace.vue`、`MediaGenWorkspace.vue`、已适配器实现文件、他人的 spec。
