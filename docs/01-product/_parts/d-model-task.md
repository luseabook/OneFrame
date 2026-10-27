# D6 · 模型聚合层 / 统一任务系统 / AI 能力矩阵

> 竞品：万兴剧厂 ReelMate（www.reelmate.cn）。本文只做竞品侧抽取，不含 OneFrame 规划。
>
> **证据口径**：`model-all.json` / `model-video.json` / `model-image.json` / `task-list.json` 指 `rea-reelmate\cli-out\` 下同名文件；`model-catalog-summary.json` 在 `rea-reelmate\` 根下。`routes.txt` 行号即 `rea-reelmate\routes.txt` 行号（去 i18n 前缀后 927 条）。`报告 §N` 指 `rea-reelmate\REELMATE-逆向分析报告.md`。`_models.md`、`model.md`、`task.md`、`node.md`、`credits.md`、`error-codes.md` 指 `rea-reelmate\cli-skill\reelmate-cli-skill\` 下同名文件，行号为该文件行号。`core-lib` 指前端反编译产物 `rea-reelmate\scripts\files\origins\2bdb9ddf...\assets\core-lib-CKH7gQsw.js`（单行压缩，按符号名引用）。
>
> **标「推断」者为工程判断，非文档直述。**
>
> **统计脚本**：`$env:TEMP\rm-stats.mjs`、`rm-stats2.mjs`、`rm-stats3.mjs`、`rm-stats4.mjs`、`rm-ai.mjs`（Node.js 24，读 `model-*.json` 结构化统计，未写入仓库）。所有数字均由脚本产出。

---

## 1. 域定位

模型聚合层是 ReelMate 的**供给侧抽象层**：把 11 个供应商的 46 个模型（含自营 4 条线）收敛成**一份带参数枚举的目录 + 8 个生成端点**，让上游 5 个产品场景各自筛选/排序/推荐，而不各自维护模型名单。

统一任务系统是**消费侧的结算单元**：所有生成（图/视频/语音/音乐/音效/克隆/超分/去字幕/改视频/资产匹配/拆分镜）都走「提交 → `task_id` → 轮询 → 终态 → 产物」这一条流水线，差异只落在提交参数上。

一句话：**竞品自研的不是模型，而是「把 N 个不可控的外部模型伪装成 1 个可控内部能力」的目录协议 + 任务协议**——目录协议负责「能不能用、怎么参数化」，任务协议负责「扣不扣钱、什么时候算完」。二者共同构成可替换性基础：换供应商只改目录记录，不动端点、不动前端、不动工作流（`报告 §5` 结语：「模型层完全可替换」）。

---

## 2. 统一任务系统

### 2.1 端点族

| 层 | 端点 | 作用 | 证据 |
|---|---|---|---|
| 创建 | `/web/v1/ai/<capability>` | 各能力各自一个创建端点，返回 `task_id` | `routes.txt` L135–197 |
| 查询（单） | `GET /web/v1/task/{task_id}` | 单任务详情 | L880 |
| 查询（批） | `POST /web/v1/task/result` | `{task_type, pid, task_ids[]}` 批量拉结果，**走多区域数据面** | L873 |
| 列表 | `GET /web/v1/task` | 空间任务列表（`request_type=task_list`） | L871；`报告 §12.3` |
| 取消 / 重试 / 重生 / 删除 | `/{task_id}/cancel`、`/retry`、`/regenerate`、`/{task_id}`(DELETE) | 生命周期；重试与重生**均重复扣费** | L881、L885、L884；`task.md:131`、`:153` |
| 反馈 / 分享 | `/{task_id}/feedback`、`/{task_id}/share`、`/share/{share_id}/info`、`/share/{share_id}/batch-download` | 任务反馈、分享落地与分享页批量下载 | L883、L886、L878、L877 |
| 下载 | `/{task_id}/download`、`/result/batch-download`、`/result/folder` | 单产物 / 批量打包 / 产物目录 | L882、L874、L875 |
| 工作流重试 / 首交互 / 策略 | `/task/workflow/retry`、`/task/is_first/interact`、`/ai/task/strategy-info` | 整链重跑、首交互标记、限流策略 | L879、L872、L170 |

**关键结论**：**创建端点「每能力一个」（63 个 `/ai/` 端点），查询与生命周期端点「全平台共用一套」（16 条 `/web/v1/task` 去重）**——这是「统一任务系统」的字面依据。

### 2.2 状态机

`core-lib:TASK_STATUS` 整数枚举：

| 值 | 名称 | 值 | 名称 |
|---:|---|---:|---|
| 1 | `WAITING` | 5 | `CLOSED` |
| 2 | `RUNNING` | 6 | `TIMEOUT` |
| 3 | `DONE` | 20 | `NOSPACE` |
| 4 | `FAILED` | 96 | `TALKING_SHORT`（口播时长不足） |
| | | 10001 | `PROJECT_NULL` |

轮询终止条件（`core-lib` 内 `continueCondition` 默认值）：`q => !q || q?.status === 1`——**「有返回且 status 仍为 1 就继续等」**。注意用的是 `===1` 而非 `[1,2].includes()`，说明「续等」判定只绑 `WAITING`；`RUNNING`(2) 是否续等由调用方注入 `continueCondition` 覆盖（`usePolling` 支持 `loopByTaskId({continueCondition})`）。

**审核态（内容合规）——四处分立，未进主状态机**：

| 位置 | 机制 | 证据 |
|---|---|---|
| 提交侧 | 生成端点前挂**腾讯云无感验证码**，票据走 `X-Captcha-Ticket` + `X-Captcha-Randstr` | `报告 §6`、`§12.3` |
| 文本侧 | `/web/v1/text-sensidetect` 独立内容敏感检测 | `routes.txt` L887 |
| 任务侧 | `/web/v1/df/resources/seedance-review-status`——**Seedance 主体（真人角色）单独一套审核状态** | `routes.txt` L667 |
| 上传侧 | 独立失败枚举：`sensitiveFail=1`/`uploadFail=2`/`formatFail=3`/`sizeFail=4`/`resolutionFail=5`/`uploadTimeout=6` | `CtSMsPHi.js:$` |
| CLI 侧 | 退出码 `8` = 内容审核未通过，「**不要自动重试**」 | `error-codes.md:15` |

> 「推断」：审核态没并进 `TASK_STATUS`，而是分散为（a）任务 status 的特定失败值、（b）上传自有失败枚举、（c）独立 `seedance-review-status` 三处。这是历史叠加——**统一任务系统在「合规」这条轴上并未真正收敛**。另注意 `status=2` 存在双重语义：`TASK_STATUS.RUNNING=2` 与上传任务 `r?.status===2`（成功）/`===3`（敏感失败）冲突，即不同 `task_type` 共用 `status` 字段但编码不同。

### 2.3 轮询节奏

| 参数 | 值 | 证据 |
|---|---|---|
| `useTaskPolling` 默认 `retryInterval` | **5000ms** | `core-lib:useTaskPolling`（`retryInterval:s=5e3`） |
| 底层 `usePolling` 默认 | 2000ms、`maxRetries:3` | `core-lib:usePolling` |
| `unlimited`（任务轮询默认） | `true`——不限次数 | 同上 |
| 批量分组 | 按 `task_type` 分组成 `{task_type, pid, task_ids[]}` 一次 POST | `core-lib:useTaskPolling` 内 `u()` |
| 完成后积分刷新 | `debounce(refreshCreditsInfo(3), 300ms)` | `core-lib:refreshCreditsAfterTasksDone` |
| CLI 侧等待 | `task wait --timeout`，**默认无超时** | `task.md:85-86` |
| 文档建议窗口 | `30m`（单视频）/ `2h`（示例） | `generate-video.md:116`、`task.md:95` |

前端「5s 一次、按类型批量、不限次数」vs CLI「单任务阻塞、默认无超时」——两套节奏是取向差异：前端为省请求做批量，CLI 为脚本化做阻塞（`报告 §12.9`）。

### 2.4 结果拉取（多区域数据面）

```js
// core-lib:domainMap / handleTaskResult
var domainMap = { sz:"https://api-conn.reelmate.cn", eus:"https://api-conn-eus.reelmate.ai",
                  eop:"https://api-conn-eop.reelmate.ai", sgp:"https://api-conn-sgp.reelmate.ai" };
handleTaskResult = async e => {
  const dc = useUserStore().userInfo.data_center || "sz";
  const base = domainMap[dc]; if (!base) throw new Error("获取机房域名错误");
  return defFetch.post({ url:"/web/v1/task/result", params:e, baseUrl:base,
                         headers:{ Authorization: tokenInfo.access_token } });
};
```

四个数据面：深圳（国内）、美西、欧洲、新加坡。路由依据 `user-info.data_center`；取不到时**报错而非兜底**。

> 「推断」：**控制面单点 + 数据面分区域**——主站 `app.reelmate.cn` 只做控制（创建/计费/目录），产物轮询走区域域名。意义：产物在区域 OSS，就近拉取省跨境带宽，并便于按区域做数据合规隔离。

### 2.5 幂等 / 取消 / 重试 / 下载

| 机制 | 实现 | 证据 |
|---|---|---|
| **幂等键** | 写操作统一 `--idempotency-key`；重放命中回包带 `idempotent_replay=true`，此时**禁止换新 key 重新请求**，必须用回包 `task_id` 去 `task wait` | `_hard-gate.md:32` |
| **取消** | `task cancel`；Ctrl-C 按取消处理（退出码 5）；**中断等待不会自动取消远端任务** | `task.md:90`、`error-codes.md:19` |
| **重试 / 重生** | 仅对失败任务；文档两处强调「**会重复下单扣费**，提交前先 `--dry-run`」 | `task.md:131`、`:153` |
| **dry-run** | `cancel/retry/regenerate/delete/download` 与生成命令均支持，输出 `method`+`endpoint` 不发请求 | `task.md:109`、`node.md:301` |
| **单任务下载** | 读 `task_infos[].asset_info.file_id`；支持图/视频/混合多产物；默认 `overwrite=false`，**任一冲突整体失败**；同名加 `-2`/`-3` | `task.md:169-184` |
| **批量下载** | `/task/result/batch-download`、`/task/share/{id}/batch-download`、`/wf/batch-download`、画布 `/df/canvas/node/batch-download`(+`/list`、`/url`) | routes |
| **分页协议** | 全列表命令统一：默认只取第一页；`has_more=true` 时**不得把该列表当全量做批量操作或判定「记录不存在」** | `task.md:58` |
| **失败不盲重放** | 写操作即使网络超时也不盲目重放，先 `get` 或任务查询确认服务端状态 | `error-codes.md:23` |

### 2.6 退出码分类学（任务语义 → 进程语义）

| 码 | 含义 | 任务系统含义 |
|---:|---|---|
| 4 | 任务失败 | 终态失败；**仅 `retryable=true` 时重试** |
| 5 | 任务取消 | 用户中止或 Ctrl-C |
| 6 | 等待超时 | `task wait` 超时；改 `task get` 继续查，**不是重提交** |
| 7 | 积分不足 | 业务码 `745701 Insufficient Balance`；充值入口 `deeplink pricing` |
| 8 | 内容审核未通过 | 换/改素材，**不要自动重试** |
| 9 | 画布版本冲突 | 先 `canvas get` 读最新版本 |
| 10 | 节点锁竞争 | 等协作者释放锁 |

证据：`error-codes.md:5-19`。**推断**：把任务终态直接映射成进程退出码，本质是把异步任务系统「同步化」给 Agent/脚本用——让 LLM 无需理解 JSON 即可分支。这是 CLI 作为**产品外延**（而非调试工具）的关键设计。

### 2.7 业务错误码（任务创建失败的语义层）

`core-lib:TMV_ERROR_CODE` 与退出码互补，收敛生成侧拒绝原因：

| 码 | 枚举名 | 语义（i18n key） |
|---:|---|---|
| 745601 / 745602 | `TASK_Exceeded_1/2` | 基础版 / 会员档 并发-额度上限 |
| 745701 | `INSUFFICIENT_CREDITS` | `task_info.credit_limit` 积分不足 |
| 745611 | `TASK_Limit_Exceeded` | `task_info.wait_full` 排队已满 |
| 745704 / 745713 | `ONLY_MEMBERS_USE` / `BASIC_PLAN_SD_NOT_ALLOWED` | 会员专属 / 基础版禁 SD |
| 745620 / 745624 | `NANO_LIMIT` / `IDLE_TASK_LIMIT` | 无限额度提示 / 错峰额度限制 |
| 745623 | `PROMPT_CHANGE` | 提示词被改写 |
| **745629** | **`UNSUPPORTED_MODEL_MODE`** | **模型不支持该 mode** |
| 749132/3/4 | `CANVAS_CHAT_*` | 画布对话免费轮次 / 免费模型 / 上下文用尽 |
| 743405 / 743406 | `AGENT_TASK_ONLY_ONE` / `_DAILY_LIMIT` | Agent 任务并发 / 日限 |
| 747109 | `EXTRACTION_TASK_IN_PROGRESS` | 资产提取任务进行中 |

**`745629` 是「模型 × 模式」二维矩阵的运行时兜底校验**：文档层说「模型不支持该模式时 CLI 会报错，不自动换模式或换模型」（`_models.md:31`），服务端有对应业务码——这是目录协议与任务协议唯一的强耦合点。

---

## 3. AI 能力矩阵

### 3.1 端点分组（`/web/v1/ai/` 去重 63 个；`rm-ai.mjs` 全量归类，未归类 0）

| 能力域 | 数 | 端点 | 对应产品功能 |
|---|---:|---|---|
| 生成·图像 | 3 | `text-to-image`、`refer-image-to-image`、`redraw-to-image` | 画布生图、资产生图、重绘 |
| 生成·视频 | 9 | `text-to-video`、`image-to-video`、`refer-image-to-video`、`refer-media-to-video`、`video-to-video`、`refer-video-to-video`、`ip-template-to-video`、`ip-template/list`、`world-generate` | 画布生视频、分镜出片、IP 模板、3D 世界 |
| 语音·音频生成 | 5 | `text-to-audio`、`text-to-music`、`text-to-sfx`、`text-to-speech`、`text-to-speech/voice/list` | 旁白/配乐/音效/氛围（`audioKind` 四态） |
| 音色·克隆 | 8 | `voice-clone`、`voice-clone-list`、`voice-clone/:task_id`、`voice-clone/rename`、`timbre/list`、`timbre/collect`、`timbre-category/list`、`audio-timbre-modify` | 音色库、克隆全流程、音色改造 |
| 音频处理 | 4 | `audio-slicing`、`video-audio-separation`、`video-soundtrack`、`video-subtitle-voice-edit` | 切音频、音视频分离、配乐、字幕配音改 |
| 视频处理 | 12 | `video-convert`、`video-crop`、`video-super-resolution`、`image-super-resolution`、`image-batch-super-resolution`、`video-subtitle-erase`、`fps-duration-unify`、`advanced-lip`、`effect`、`video-process-session/create|detail|update-edit` | 超清/擦字幕/转码/裁剪/补帧/口型/特效 |
| 分析·识别 | 10 | `asset-match`(+`/result`、`/{task_id}/cancel`)、`face-recognition`、`identify-face`、`image-recognition`、`image-to-text`、`style-extraction`、`check-language`、`prompt-optimize` | 资产匹配（一致性核心）、人脸识别、图生文、风格提取、提示词优化 |
| LLM 对话 | 8 | `chat/completion`、`chat/abort`、`chat/session/create|list|clean`、`chat-sess-list`、`chat-msg-list`、`text-to-text` | 画布 Agent、剧本编辑 Agent、拆资产/拆分镜文本节点 |
| 计价·元信息 | 4 | `point-calculate`、`task/strategy-info`、`file-sign-url`、`publish` | 积分预估、策略、签名 URL、发布 |

### 3.2 能力 → 端点 → 模型的三角

| 能力 | 模型 type | 目录命中 | 生成端点 |
|---|---|---:|---|
| 图像生成 | `image` | 13 | `text-to-image` / `refer-image-to-image` |
| 视频生成 | `video` | 30 | 6 个视频端点（见 §7.1） |
| 文本/LLM | `file` | 3 | `chat/completion`（**不进目录生成模式**） |
| 音频（旁白/配乐/音效/氛围）/ 音色克隆 / 图像视频处理 | **无目录记录** | 0 | `text-to-speech`/`text-to-music`/`text-to-sfx`/`text-to-audio`；`voice-clone` 全流程；超分等 12 个 |

**关键洞察：46 个目录模型只覆盖「图像生成 + 视频生成」两类（13+30=43，另 3 条 `file` 无 `params`）。音频、克隆、处理类完全不进目录。**

理由：这些能力对用户是「功能」不是「模型选择」。`model.md:117` 明确「音频不传模型，因为 Web 实际按 `audioKind` 路由到旁白/配乐/音效接口」（`node.md:318` 给出四态枚举与各自时长档）。

> 「推断」：**模型目录 = 用户可感知的选择器，不是技术能力清单**。音频侧刻意隐藏供应商差异（按 `audioKind` 路由），图像/视频侧刻意**完全暴露**供应商差异（46 条里 42 条第三方）——这是有意为之的差异化策略，见 §6。

### 3.3 横切能力（音画同出 / 口型 / 多分镜 / 错峰）

| 能力 | 覆盖 | 证据 |
|---|---|---|
| 音画同出 | 18 条 `audio_video_support=true`；标签 `音频生成`/`口型同步` 各 19 次 | `model-video.json` |
| 口型驱动 | `mouth_drive` 三态：`optional`（可选默认开）/ **`required`（强制开，仅 Wan 2.6）** / `unsupported`（H3 系、Vidu Q2） | `rm-stats3.mjs` 5 段 |
| 多分镜叙事 | 仅 可灵3.0（`tags` 含「多分镜」）；TS 2.0 描述「支持上传多故事板进行多分镜叙事规划」 | `tags`、description |
| 首尾帧 | 8 条（`first_last_frame`） | §4.3 矩阵 |
| 错峰 `off_peak` | 分镜场景 10 条中 4 条支持（Happy Horse 1.1/1.0、可灵O3、Vidu Q2） | `rm-stats3.mjs` 1 段 |
| 画质档 `image_quality` | 仅 2 个模型有：TGI 2（low/medium/high）、TGI 2.5 系（+xhigh/max） | `rm-stats3.mjs` 4 段 |

> 「推断」：`mouth_drive` 是**角色对白一致性**的关键开关。Wan 2.6 设为 `required`（不可关）说明该模型写实口型时不允许用户关闭，否则产物不可用——「模型能力反向约束产品可用性」的实例。

---

## 4. 模型目录数据模型

### 4.1 一条模型记录的字段（46 条，脚本统计出现次数）

| 字段 | 次数 | 含义 |
|---|---:|---|
| `name` / `display_name` | 46 | 展示名；**提交 `--set ai_model_mark=` 填这个值**（`model.md:44`） |
| `type` / `types` | 46 | `file` / `image` / `video`（`model.md:45`） |
| `vendor` | 46 | 厂商/品牌归属，11 个取值（`model.md:49`） |
| `visible` | 46 | 可见性；**`model list` 只返回 true**（`model.md:46`） |
| `need_vip` | 46 | 是否会员模型（`model.md:52`） |
| `price` | 46 | `default_show` 规格价格，无则 `null`（`model.md:57`） |
| `metadata_missing` | 46 | CLI 是否缺本地补充元数据（**不表示不可用**，`model.md:60`） |
| `params` | 43 | 参数提示：`generation.<mode>` + 场景键（`model.md:59`） |
| `supported_modes` | 43 | 该模型支持的画布生成模式（`model.md:47`） |
| `mode_order` | 39 | 各 Web 模式清单中的下标，**0 起**（`model.md:48`） |
| `description` / `logo` | 43 / 43 | Web 中文说明 / 稳定资源键 |
| `tags` / `activity_tags` | 29 / 4 | 时长/音频/口型/活动标签（`model.md:53`） |
| `audio_video_support` / `max_image_num` | 18 / 13 | 音画同出 / 参考图上限（`model.md:54-55`） |
| `price_variants` / `use_mode` | 11 / 22 | 全价格规格 / `normal`+`grid`+`direct` 三态 |
| `grid_default` / `is_new` / `show` / `show_multi_view` | 5 / 5 / 4 / 4 | 网格默认、新品标、展示、多视图 |
| `promotions` / `default` / `is_direct_mode` | 1 / 2 / 1 | 促销（仅 `Wan 3.0`=`["60% off"]`）、默选、直连 |
| `is_hot` | **0** | 文档提及但**本目录 0 条命中**（`model.md:56`） |

`id` / `ai_model_mark` / `raw` / `pricing_aliases` **永不返回**（`model.md:40`、`:146`）——刻意隔离提交标识与展示标识。

### 4.2 `params` 嵌套结构

```
params
├── generation                    # 43/43 有 params 的模型都有
│   └── <mode>                    # 11 种之一，可多值
│       ├── mode                  # 冗余自述（值等于键名）
│       ├── endpoint              # ★ 该 mode 提交到哪个端点
│       ├── ratios[] / durations[] / counts[]
│       ├── resolutions[]         # ★ 提交值（机器值）
│       ├── resolution_options[]  # ★ {label, value} 展示值 ↔ 提交值
│       ├── default_ratio / default_resolution / default_duration / default_count
│       ├── max_prompt_length
│       ├── max_images / max_videos / max_audios / max_media / min_media
│       ├── duration_source / ratio_source        # 视频编辑类：跟随源素材
│       ├── mouth_drive / mouth_drive_default
│       ├── image_quality[] / default_image_quality
│       └── off_peak
├── script_to_scene_refer         # 4 条视频模型；仅 {enabled:true}
└── storyboard_reference_video    # 10 条视频模型；独立参数集（无 endpoint）
```

**★ 脚本验证的事实**：`studio_asset_image` **不是 `params` 顶层键，而是 `params.generation` 下的一个 mode**。`_models.md:26` 写作「`params.studio_asset_image` 非空」是省略 `generation.` 的简写。4 条命中模型（TGI 2.5 Flare / TGI 2.5 Sunburst / 天幕写实版 / TNB）**同时拥有 `generation.text2image` 与 `generation.studio_asset_image`，两者除 `mode` 字段外逐字段完全相同**（diff 差异 1 项）。

> 「推断」：`studio_asset_image` 是**纯语义别名**——同一端点、同一参数，换个 mode 名，目的是把「资产生图」这个产品场景从画布生图里**隔离成独立候选池**，让资产生图能推 TGI 2.5 系而不污染画布生图列表（画布 `text2image` 候选是另外 9 个模型）。

### 4.3 mode 枚举总表（11 个，脚本统计）

| mode | 模型数 | 端点 | 画幅 | 时长 | 分辨率提交值 | counts |
|---|---:|---|---|---|---|---|
| `text2video` | 7 | `text-to-video` | 16:9,9:16,1:1,4:3,3:4 | 5,6,10 | 768p,1080p,720p | 1–4 |
| `image2video` | 16 | `image-to-video` | 16:9,9:16,4:3,3:4,1:1 | 1–15 | 720p,1080p,1080p_sale,768p,4k | 1–4 |
| `first_frame` | 16 | `image-to-video` | 同上 | 1–15 | 同上 | 1–4 |
| `first_last_frame` | 8 | `image-to-video` | （无） | 1–15 | 720p,1080p,4k,768p | 1–4 |
| `universal_reference` | 10 | `refer-media-to-video`(9) / `refer-image-to-video`(1) | 16:9,9:16,21:9,4:3,3:4,1:1 | **2–30** | 720p_sale,720p,1080p,720p_hd,4k,1080p_sale,2K,768P | 1–4 |
| `video_edit` | 6 | `refer-video-to-video` | （无，跟随源） | 5,10 | 720p_sale,720p,1080p,720p_hd,4k,2K,768P | 1–4 |
| `video_extend` | 2 | `video-to-video` | （无，跟随源） | 3–30 | 720p_sale,720p,1080p | 1–4 |
| `text2image` | 13 | `text-to-image` | 13 档（1:1…21:9） | — | 1K,2K,4K,3K | 1–4 |
| `image2image` | 9 | `refer-image-to-image` | 13 档 | — | 1K,2K,4K,3K | 1–4 |
| `multi_reference` | 2 | `refer-image-to-image` | 13 档 | — | 1K,2K,4K | 1–4 |
| `studio_asset_image` | 4 | `text-to-image` | 13 档 | — | 1K,2K,4K | 1–4 |

**目录 mode 与画布节点 mode 不一致（重要对照）**：

| | 目录 mode | 画布节点 mode（`node.md:79-80`） | 画布多出的部分 |
|---|---:|---:|---|
| image | 4 | **16** | `upscale`/`crop`/`outpaint`/`inpaint`/`erase`/`panorama`/`multi_angle_360`/`panorama_360`/`lighting`/`multi_camera_grid_9`/`story_grid_4|9|25` |
| video | 7 | **13** | `video_reference`/`video_clip`/`video_upscale`/`de_subtitle_auto`/`de_subtitle_region`/`frame_capture` |
| 合计 | 11 | 29 | 18 个 |

> 「推断」：差额 18 个 mode 是**不需要选模型的纯处理/编辑类 mode**（超分、裁剪、扩图、多机位网格、字幕擦除、抽帧）——走 `ai/*` 独立端点而非目录模型。印证 §3.2：**目录只为「需要用户选模型的生成类 mode」存在**。

### 4.4 分辨率 label 与提交值分离（全表，脚本产出）

| 提交值 | 展示 label | 出现 mode |
|---|---|---|
| `720p` | 720P | 8 个视频 mode |
| `1080p` | 1080P | 8 个视频 mode |
| `4k` | 4K | universal_reference, video_edit, storyboard_reference_video, first_frame, first_last_frame, image2video |
| `768p` / `768P` | 768P | 前者 4 个 mode；后者 universal_reference, video_edit, storyboard_reference_video |
| `720p_hd` | **2K超清版** | universal_reference, video_edit, storyboard_reference_video |
| `720p_sale` | **1080P优惠版** | universal_reference, video_edit, video_extend, storyboard_reference_video |
| `1080p_sale` | **1080P优惠版 / 1080P全高清版 / 1080p优惠版** | 同一提交值 **3 种 label**，跨模型不一致 |
| `480p` | 480P | storyboard_reference_video（仅 Wan 3.0） |
| `1K`/`2K`/`3K`/`4K` | 同值 | 图像 mode |

**三个反直觉点**：
1. `720p_sale` label 是「**1080P**优惠版」——提交值 720p，展示值写 1080P。文档警告「不要把提交值念给用户，也不要按码口算中文（`720p_sale` 不是 720P优惠版）」（`_models.md:35`）。
2. `720p_hd` label 是「2K超清版」——提交值 720p_hd，展示值写 2K。
3. `1080p_sale` 一个提交值对应 **3 种 label**。

> 「推断」：这是**营销口径与技术口径分离**的产物——「1080P优惠版」是促销命名（暗示「720p 价格看 1080P」），技术提交值保持 720p，运营可不改后端就改 label。风险：同一 label 在不同模型下可能指不同真实分辨率，是**竞品最不优雅的一处设计**（见 §9 要点 5）。

### 4.5 `mode_order`：排序契约

`mode_order` 是 `{mode: index}`，index 从 0 起，表示该模型在 **Web 该模式清单中的下标**（`model.md:48`）。

覆盖：39/46 有值；**4 条 `studio_asset_image` 模型完全无 `mode_order`**。各键出现次数：`first_frame` 16、`image2video` 16、`universal_reference` 10、`text2image` 9、`image2image` 9、`first_last_frame` 8、`text2video` 7、`video_edit` 6、`script_to_scene_refer` 4、`video_extend` 2、`multi_reference` 2、**`studio_asset_image` 0**。

**排序规则**（`_models.md:33`）：按 `mode_order[目标模式]` **升序**；**缺该键者排在有键者之后**；禁止按 mark 字母序、展示名字母序或自拟顺序。

**脚本模拟的 4 个场景排序**：

| 场景 | 排序依据 | 结果（下标:模型） |
|---|---|---|
| 资产生图 | `mode_order.studio_asset_image` | **全部缺键 → 4 条并列，保持原顺序**：TGI 2.5 Flare → TGI 2.5 Sunburst → 天幕写实版 → TNB |
| 剧本拆分镜 | `mode_order.script_to_scene_refer` | 0:Seedance 2.5 → 1:Seedance 2.0 VIP → 2:Wan 3.0 → 3:Seedance 2.0 mini |
| 分镜/回填 | `mode_order.universal_reference` | 0:Seedance 2.5 → 1:Seedance 2.0 VIP → 2:Seedance 2.0 mini → 3:Wan 3.0 → 4:Minimax H3 优惠版 → 5:MiniMax H3 → 8:Happy Horse 1.1 → 9:Happy Horse 1.0 → 10:可灵O3 → 11:Vidu Q2 |
| 画布生图 | `mode_order.text2image` | 0:TGI 2 → 1:悠船 V8.2 → 5:即梦5.0Pro → 6:即梦5.0 → 7:即梦4.5 → 8:TNB 2 → 9:TNB Pro → 10:TNB Pro-Beta → 12:即梦4.0 |

**发现 1**：`universal_reference` 下标有空洞（无 6、7）——说明清单曾有模型下线，**index 是稳定槽位而非连续序号**。

**发现 2**：`script_to_scene_refer` 顺序（Seedance 2.5=0, VIP=1, **Wan 3.0=2, mini=3**）与 `universal_reference` 顺序（Seedance 2.5=0, VIP=1, **mini=2, Wan 3.0=3**）**不一致**——**每个场景有独立排序意图，不是全表统一排序**。

**发现 3**：资产生图 4 条全无 `mode_order.studio_asset_image`。按规则「缺键者排在有键者之后」，但因**全部缺键**，实际退化为「保持服务端原顺序」，即 **TGI 2.5 Flare 排第一**。而文档同时警告「资产生图**禁止**把列表第一项当默认（常见第一项是 TGI 2.5 Flare）」（`_models.md:41`）——这条警告正是对「全缺键导致顺序无意义」的防御。

> 「推断」：`studio_asset_image` 无 `mode_order` 是**未完成迁移的痕迹**——该场景键是后加的语义别名（§4.2），Web 侧尚无对应排序清单。这解释了为何文档反复强调「禁止拿画布 `text2image` 的 `mode_order` 当本场景排序依据」（`_models.md:26`）：一旦混用，TGI 2（index 0）会盖过 TGI 2.5 Flare，而资产生图要推的恰是 2.5 系。

---

## 5. 场景化模型过滤机制（核心设计）

### 5.1 五个场景键

| # | 场景键 | 服务的产品场景 | 成员筛选 | 排序依据 | 推荐规则 | 证据 |
|---:|---|---|---|---|---|---|
| 1 | `generation.<mode>` + `supported_modes` | **画布生图 / 生视频** | `visible=true` **且** `supported_modes` 含目标模式 **且** `params.generation.<mode>` 非空 | `mode_order[目标模式]` 升序 | 视频：候选含 `Seedance 2.0 VIP` 则推 | `_models.md:25`、`:42` |
| 2 | `generation.studio_asset_image` | **资产生图**（GUI 环节 3 + 资产提示词回填生图） | 仅 `params.generation.studio_asset_image` 非空且 `visible=true`；角色/场景/道具**共用这一套** | `mode_order.studio_asset_image`（**实际全缺键**） | 展示名含 `TGI 2` 则推；**禁止把第一项当默认** | `_models.md:26`、`:41` |
| 3 | `script_to_scene_refer` | **剧本拆分镜**（GUI 环节 4） | 仅 `params.script_to_scene_refer` 非空 | `mode_order.script_to_scene_refer` 升序 | 候选含 `Seedance 2.0 VIP` 则推；**禁止把第一项当默认（常见第一项是 Seedance 2.5）** | `_models.md:27`、`:43` |
| 4 | `storyboard_reference_video` | **分镜规划 / Excel 回填生视频** | 仅 `params.storyboard_reference_video` 非空；**不要用画布 `supported_modes` 是否含 `universal_reference` 来筛** | **`mode_order.universal_reference`**（成员用键 4，排序用键 1 的 mode 名） | 含 `Seedance 2.0 VIP` 则推；选项含 `1080P优惠版` 则标 | `_models.md:28`、`:33`、`:42`；`gui-backfill-shot-video.md:43` |
| 5 | `types` 含 `file` | **画布生剧本** | `model search 'TG Chat'` → 只取 `type`/`types` 含 `file` 且 `visible=true` | 无需排序（唯一命中） | 含 `TG Chat 5.5` 时**直接采用，不列全、不走 HITL** | `_models.md:29`、`:20` |

### 5.2 五种切片的实际成员（脚本模拟，`visible=true` 共 43 条）

| 场景 | 成员数 | 成员 |
|---|---:|---|
| 画布生图 `text2image` | 9 | TGI 2、悠船 V8.2、即梦5.0Pro、即梦5.0、即梦4.5、TNB 2、TNB Pro、TNB Pro-Beta、即梦4.0 |
| **资产生图** `studio_asset_image` | **4** | TGI 2.5 Flare、TGI 2.5 Sunburst、天幕写实版、TNB |
| **剧本拆分镜** `script_to_scene_refer` | **4** | Seedance 2.5、Seedance 2.0 VIP、Seedance 2.0 mini、Wan 3.0 |
| **分镜/回填** `storyboard_reference_video` | **10** | Seedance 2.5、Seedance 2.0 VIP、Seedance 2.0 mini、Wan 3.0、Minimax H3 优惠版、MiniMax H3、Happy Horse 1.1、Happy Horse 1.0、可灵O3、Vidu Q2 |
| **画布生视频** `universal_reference` | **10** | 同上一行（成员集合**完全相同**） |
| 画布剧本 `file` | 3 | DeepSeek V4 Pro、Gemini 3.1 Pro Preview、TG Chat 5.5 |

**三个最关键的交叉结论**：

**(A) 资产生图 4 条 与 画布生图 9 条 交集为空**（脚本验证：「交集: (空)」）。
这解释了文档为何强硬禁止混用：「资产生图**只看** `params.studio_asset_image` 非空且 `visible=true`……本场景 0 条时停止，**不改走画布 `text2image` 清单，也不要用 `mode_order.text2image` / 画布 `supported_modes` 当本场景成员或排序依据**」（`_models.md:26`）。**两套候选池物理隔离，零重叠**：资产生图走自营 TGI 2.5/TNB/天幕线，画布生图走「TGI 2 + 第三方（悠船/即梦）+ TNB 2 系」。

> 「推断」：这是刻意的「**场景专用模型池**」。资产生图是影视流水线的工业环节（要角色/场景/道具三类一致性），只放**自营可控模型**（tomoviee 4 条）；画布生图是创意探索环节，放效果最好的聚合模型。两者不共享，避免「用户在错误场景选了错误模型」。

**(B) 场景 4（分镜）与场景 1 的画布 `universal_reference` 成员集合完全相同，但筛选依据完全不同。**
10 条一一对应，差异为零（脚本：「仅在 C: (无)」「仅在 D: (无)」）。但场景 4 的**成员**用 `storyboard_reference_video` 非空、**排序**用 `mode_order.universal_reference`；场景 1 的成员用 `supported_modes` 含 `universal_reference` **且** `params.generation.universal_reference` 非空。

文档明确：场景 4「**不要用画布 `supported_modes` 是否含 `universal_reference` 来筛——未开白时该模式会被摘掉，分镜规则仍可能在**」（`_models.md:28`）。

**这是全任务最重要的一条产品逻辑**：`supported_modes` 是**账号级动态可见性**（未开白会被服务端摘掉），场景键是**静态能力声明**。同一模型「画布能不能用」与「分镜场景是否可用」是**两个独立开关**。用 `supported_modes` 筛分镜会导致：账号未开白时，明明能出分镜的模型被误判不可用。

> 「推断」：这是双层可见性设计的必然产物——（1）目录静态能力（模型天生支持哪些 mode），（2）账号级动态能力（该账号开白了吗）。`supported_modes` 混了层（1）与层（2），场景键只表达层（1）。文档要求「账号未开白时 CLI 会从 `supported_modes` 摘掉对应模式，**不要用静态名单补回来**」（`_models.md:25`）——说明层（2）不可由客户端推断。

**(C) 场景 3（拆分镜）4 条 ⊂ 场景 4（分镜）10 条。**
拆分镜 4 条全是「既能拆分镜又能出分镜视频」的模型。反过来说，分镜 10 条里有 6 条**不能拆分镜**（Minimax H3 系、Happy Horse 系、可灵O3、Vidu Q2）——只能「拿现成分镜提示词出视频」。

> 「推断」：`script_to_scene_refer` 是 `storyboard_reference_video` 的**真子集能力**——拆分镜要求「长文本理解 → 多镜头规划 → 逐镜出视频」的复合能力，只有 Seedance 2.5/VIP/mini 与 Wan 3.0 达标。文档对此有防御性表述：「不要用 `params.storyboard_reference_video` 非空或画布 `supported_modes` / `mode_order.universal_reference` 判断能不能拆分镜」（`gui-script-video-storyboard.md:62`）。

### 5.3 `storyboard_reference_video` 与 `generation.universal_reference` 的差异（逐字段 diff）

10 条同时有两者，差异：

| 字段 | `generation.universal_reference` | `storyboard_reference_video` | 一致性 |
|---|---|---|---|
| `endpoint` | 有 | **无此字段** | 场景键不带端点 → 复用 `generation` 的 |
| `ratios` / `durations` / `default_*` / `max_prompt_length` | 有 | 有 | 一致 |
| `resolutions` | 有 | 有 | **1 处不一致**：Wan 3.0 场景键多出 `480p` |
| 素材上限 | `max_images`/`max_videos`/`max_audios`/`max_media`（扁平） | `media_limits{image,video,audio,total}`（嵌套） | **结构不同，值相同** |
| 数量 | `counts[]` | `quantity[]` | **字段名不同，值相同** |
| `off_peak` | 部分模型有 | 全部有 | 场景键更完整 |

> 「推断」：`storyboard_reference_video` 是 `generation.universal_reference` 的**场景化投影**——同一份参数换一套字段名（`counts`→`quantity`，扁平→嵌套），加上 `off_peak`（错峰出片，分镜批量刚需，省积分）。没有 `endpoint` 是因为**走同一端点**，只需覆盖参数。这是「同一目录服务多场景」的最经济实现：**不复制端点，只复制参数视图**。

### 5.4 推荐规则的商业意图

| 场景 | 推荐 | 商业含义 |
|---|---|---|
| 资产生图 | `TGI 2`（含 2.5） | **自营图像线**——资产是流水线必经环节，量大，推自营控成本 |
| 画布视频 / 分镜 / 回填 / 拆分镜 | `Seedance 2.0 VIP` | **字节 Seedance VIP 档**——非最贵（2.5 更长更强），非最便宜（mini） |
| 分辨率 | 选项含 `1080P优惠版` 则标 | 促销款优先——实际是 720p 码率 |
| 图片交付 | 选项含 `2K` 则标；画幅含 `16:9` 则标 | 高性价比档 |

**关键**：三个视频场景全推 `Seedance 2.0 VIP`，**而目录排第一的常是 `Seedance 2.5`**（`mode_order.universal_reference` 里 2.5=0、VIP=1）。文档两次明令「禁止把列表第一项当默认」（`_models.md:41`、`:43`）。

> 「推断」：推 VIP 而非 2.5 是**成本/质量/时延三角的最优解**——2.5 支持最长 30s（VIP 15s），但价格与耗时更高；分镜是「几十镜 × 多集」的量级，用 2.5 会失控。推 VIP 说明**竞品把「推荐」当作成本护栏而非质量上限**。推「1080P优惠版」（实为 720p 码率）是同一逻辑：默认让用户走便宜档。

### 5.5 场景键的失效保护（fail-closed）

| 场景 | 0 条时的行为 | 明确禁止的降级 |
|---|---|---|
| 资产生图 | 停止，说明「当前项目没有可资产生图的模型」 | 不改走画布 `text2image`；不用 `mode_order.text2image`/`supported_modes` 当依据 |
| 剧本拆分镜 | 停止，说明「当前项目没有可拆分镜的参考生视频模型」 | 不改走「分镜规划 13 模表」；不用 `storyboard_reference_video`/`mode_order.universal_reference` 当依据 |
| 画布剧本 / 推荐值 | 停止不换模型；目录无该展示名时**只列候选，不伪造标识** | 不省略其它候选 |

证据：`_models.md:26-29`、`:46`。

> 「推断」：这是「**场景隔离优于可用性**」的取舍——宁可让用户看到空列表并被告知原因，也不让用户在错误模型上生成（错误模型的资产/分镜返工成本远高于「没得选」）。对 Agent 侧转化为「fail-closed，不许自行降级」的硬约束，避免 LLM 幻觉式替换模型。

---

## 6. 供应商全景表

### 6.1 按 `vendor` 分组（46 条，脚本统计）

| vendor | 数 | 自营/聚合 | 模型线 | 能力 |
|---|---:|---|---|---|
| **tomoviee** | **13** | **自营**（万兴天幕 SkyMedia） | TGI 2、TGI 2.5 Flare、TGI 2.5 Sunburst、TNB、TNB 2、TNB Pro、TNB Pro-Beta、天幕写实版、TS 2.0、TV 3.1、TV 3.1-Fast、天幕2.0、天幕2.1 | image×8、video×5 |
| jimeng | 8 | 聚合（字节 Seedance/即梦） | Seedance 2.5、Seedance 2.0 VIP、Seedance 2.0 mini、即梦5.0Pro、即梦5.0、即梦4.5、即梦4.0、即梦3.5 Pro | image×4、video×4 |
| kling | 7 | 聚合（快手可灵） | 可灵O3、可灵3.0、可灵2.6、可灵 2.5 Turbo、可灵 2.5 Turbo-Std、可灵 O1、可灵 2.1 | video×7 |
| hailuo | 5 | 聚合（MiniMax 海螺） | MiniMax H3、Minimax H3 优惠版、Hailuo 2.3、Hailuo 2.3-Fast、Hailuo 2.0 | video×5 |
| wan | 3 | 聚合（阿里通义万相） | Wan 3.0、Wan 2.6、Wan 2.5 | video×3 |
| happy-horse | 3 | 聚合 | Happy Horse 1.1、Happy Horse 1.0 ×2 | video×3 |
| vidu | 3 | 聚合（生数 Vidu） | Vidu Q2 ×2、Vidu Q3-Pro | video×3 |
| deepseek / google / openai | 1 / 1 / 1 | 聚合 | DeepSeek V4 Pro / Gemini 3.1 Pro Preview / TG Chat 5.5 | file×3 |
| midjourney | 1 | 聚合 | 悠船 V8.2 | image×1 |
| **合计** | **46** | 自营 13 / 聚合 33 | — | — |

**口径说明**：`vendor` 是「Web 模型配置中的厂商/品牌归属」（`model.md:49`），**不是**底层模型提供商。已知错位：`TG Chat 5.5` 的 `vendor=openai`，但 `报告 §12.6` 指出 TG Chat 5.5 是**自营文本线**（`tg_`/`sky_media.*` 前缀）。

> 「推断」：`vendor=openai` + 展示名 `TG Chat 5.5`（而非 GPT-5.5）是典型「**规避品牌**」手法——用自家品牌名包装，配置里保留 `openai` 便于内部路由。同类：`悠船 V8.2` 的 `vendor=midjourney`（悠船是 Midjourney 中文代理品牌）。**竞品在展示层系统性做了供应商脱敏**。

### 6.2 自营 vs 聚合的能力分工

| 维度 | 自营（tomoviee，13 条） | 聚合（33 条） |
|---|---|---|
| 图像 | **8 条**（占图像总量 13 的 62%）——主打资产/写实 | 5 条（悠船 + 即梦 4）——创意/风格 |
| 视频 | 5 条（天幕2.0/2.1、TS 2.0、TV 3.1/3.1-Fast）——**低价位、无 VIP 门槛** | 25 条——覆盖全档位 |
| `need_vip` | 3/13（23%） | 17/33（52%） |
| 资产生图场景键 | **4/4 全部自营** | 0 |
| 剧本拆分镜场景键 | 0 | 4/4 全部聚合（Seedance 系 + Wan 3.0） |
| 分镜场景键 | 0 | 10/10 全部聚合 |

**结论**：自营**守图像与低价视频**（资产生图 4 条全自营，流水线必经环节须控成本与可控性）；聚合**守高质量视频**（拆分镜 4 条 + 分镜 10 条全聚合，因这两环节拼「情绪演绎、口型、多镜头、长时长」，是效果决胜点）。天幕 2.0/2.1 是自营视频的「兜底档」：`need_vip=false`、只有 5s、无音画同出、无口型——「最便宜能用」选项。

### 6.3 会员门槛（`need_vip`）

20/46 = 43% 需 VIP。按供应商：kling **6/7**（最贵）、wan **3/3**（全 VIP）、jimeng 4/8、hailuo 4/5、tomoviee 3/13（自营最宽松）、vidu/happy-horse/midjourney/deepseek/google/openai 均 0。

> 「推断」：`need_vip` 与「模型档位」强相关——可灵、Wan 是高价档（`可灵3.0`=5.4、`Wan 2.6`=3），全设 VIP；自营只把最高端 3 条设 VIP。**自营线定位是「让所有人能用」，聚合线是「付费解锁」**。

---

## 7. 「生成端点只有 8 个」的设计含义

### 7.1 事实

脚本验证：`params.generation.*.endpoint` **去重恰好 8 个**，承载 93 个 `(模型 × mode)` 组合：

| 端点 | (模型,mode) 对数 | 承载 mode |
|---|---:|---|
| `image-to-video` | **40** | `image2video`(16)、`first_frame`(16)、`first_last_frame`(8) |
| `text-to-image` | 17 | `text2image`(13)、`studio_asset_image`(4) |
| `refer-image-to-image` | 11 | `image2image`(9)、`multi_reference`(2) |
| `refer-media-to-video` | 9 | `universal_reference`(9) |
| `text-to-video` | 7 | `text2video`(7) |
| `refer-video-to-video` | 6 | `video_edit`(6) |
| `video-to-video` | 2 | `video_extend`(2) |
| `refer-image-to-video` | **1** | `universal_reference`(1，仅 Vidu Q2) |
| **合计** | **93** | **11 个 mode** |

### 7.2 为什么收敛

**(1) 11 个 mode 塌缩成 8 个「输入拓扑」**——端点对应的是**输入模态组合**，不是产品功能：

| 端点 | 输入拓扑 |
|---|---|
| `text-to-image` | 纯文本 → 图 |
| `refer-image-to-image` | 文本 + 图 → 图 |
| `text-to-video` | 纯文本 → 视频 |
| `image-to-video` | 文本 + 1~2 图 → 视频 |
| `refer-media-to-video` | 文本 + 多类素材（图/视/音） → 视频 |
| `refer-image-to-video` | 文本 + 图 → 视频（Vidu 专用变体） |
| `refer-video-to-video` | 文本 + 源视频 → 视频（改） |
| `video-to-video` | 源视频 → 视频（续） |

`image2video` / `first_frame` / `first_last_frame` 三 mode **共用 `image-to-video`**，靠 `images[]` 长度区分：1 张=首帧，2 张=首尾帧，多张=参考。`text2image` / `studio_asset_image` 共用 `text-to-image`（纯语义别名）。`image2image` / `multi_reference` 共用 `refer-image-to-image`。

**(2) 差异全部下沉到参数**：`ratios[]`、`durations[]`、`resolutions[]`、`counts[]`、`max_images/max_videos/max_audios`、`max_prompt_length`、`mouth_drive`、`image_quality[]`、`off_peak`。**任何模型差异都不新增 URL**。

**(3) 「一 model 一 mark」路由在服务端**：提交体带 `ai_model_mark`（`报告 §12.3` 实测 `"ai_model_mark":"tomoviee_2.0"`），服务端据 mark 路由到实际供应商。CLI/前端只传展示名，由 CLI 解析成 mark（`model.md:3`）。**端点 → mark → 供应商**是三级路由，端点层最粗、最稳定。

### 7.3 收益与代价

收益：新增模型**零端点成本**（加一条目录记录即可）；客户端不感知供应商；计价可统一（`point-calculate` 一次算任意模型）；灰度/开白在 mark 层（团队开关矩阵 `cam/team/temp-info`，`报告 §12.8`）；审核/风控统一（8 端点统一挂验证码）。

代价（推断）：端点粗粒度导致**错误语义变粗**——`image-to-video` 承载 40 个 (模型,mode) 组合，任何模型侧参数错误只能靠 `745629` 或目录侧预校验兜底。**这也是为什么目录必须带完整枚举：目录是唯一的参数契约文档**。

---

## 8. 计价耦合

### 8.1 三条计价入口

| 端点 / 机制 | 用途 | 证据 |
|---|---|---|
| `POST /web/v1/ai/point-calculate` | **生成同源计价**：图片/视频按模型+参数询价，`{alg_code, params:"<JSON字符串>"}` | `routes.txt` L161；`credits.md:100`、`:106` |
| `/web/v1/asset/workflows/node-point-calc` | **工作流节点计价**：AI 拆分镜工作流按节点算 | `routes.txt` L221 |
| `credits estimate --set scenario=` | **场景公式计价**：不走模型，按 Web 公式算（`asset_extract`/`asset_match`/`script_split`/`asset_prompt_completion`/`asset_prompt`） | `credits.md:108-116` |

### 8.2 `alg_code` 与 `points_code` 命名规律

实测（`报告 §12.2`）：
```
POST /web/v1/ai/point-calculate
  body: {"alg_code":"text_to_video", "params":"<JSON字符串>"}
  resp: {"points_code":"tm_text2video_5s_720p", "cost":8,
         "credit_original":8, "credit_discount":1, ...}
```

| 层 | 命名 | 示例 | 作用 |
|---|---|---|---|
| 请求层 `alg_code` | **能力级 snake_case** | `text_to_video`、`text_to_image` | 一次调用只认能力，不认模型 |
| 响应层 `points_code` | **`<厂商前缀>_<能力>_<时长>_<分辨率>`** | `tm_text2video_5s_720p` | 精确到「模型×时长×分辨率」的计费 SKU |

`tm_` 前缀 = ToMoviee/天幕（自营计价命名空间）。`报告 §12.2`：文生视频 5s/720p = **8 积分**（10 积分 = 1 元，即 0.8 元）。

**关键警告**（`credits.md:106`、`:122`）：「CLI 按 Web `AlgCode` 映射，文生视频是 `text_to_video`，**不是**提交体里的 `tomoviee_text_to_video`」；「`alg_code` 必须是 Web `AlgCode` 或 dry-run 的 `credits_estimate.alg_code`，**禁止抄生成提交体的 `tomoviee_*`**」。

> 「推断」：这是**两套命名空间并存**的历史包袱——提交体用 `tomoviee_*`/`ai_model_mark`（模型级），计价用 `alg_code`（能力级）+ `points_code`（SKU 级）。典型错误是把模型 mark 当 alg_code 传，故文档反复警告。`points_code` 的 `<能力>_<时长>_<分辨率>` 结构说明**计价 SKU 是「模型 × 时长 × 分辨率」三维笛卡尔积的具名节点**——也解释了为什么每个模型的 `durations`/`resolutions` 枚举必须精确到个位数。

### 8.3 价格规格（`price_variants`）

11/46 条有 `price_variants`，单档结构：`{default_show, resolution, duration, member_price, original_price, time_limited_price, model_label, model_value, name, type}`。

**取价优先级**（`model.md:62`）：每档优先 `member_price`，缺失回退 `time_limited_price`，再回退 `original_price`；顶层 `price` 优先取 `default_show=true` 的规格，无价格则 `null`（表格显示 `-`）。

**12 个 `model_value` 去重**（脚本）：`tomoviee_tnb_pro`、`jimeng_4_0`、`vidu_q2_refer`、`vidu_q2_refer_discount`、`hailuo_hailuo_2_3_fast`、`hailuo_hailuo_2_3`、`kling_3.0`、`kling_2_6`、`kling_2_5_turbo_pro`、`wan_2_6_image2video`、`wan_2_5_image2video`、`kling_2_5_turbo_std`。

命名规律：`tomoviee_*` 自营；`jimeng_*` 即梦；`vidu_q2_refer` / `vidu_q2_refer_discount`——**`_discount` 后缀为优惠版单独 SKU**；`hailuo_hailuo_2_3_fast`——**厂商名重复**（命名瑕疵）；`kling_3.0` 与 `kling_2_6`——**版本号分隔符混用**（`.` 与 `_`）；`wan_2_6_image2video`——**带 mode 后缀**（Wan 的文生/图生是两个 SKU）。

> 「推断」：`model_value` 是**真正的计费主键**，与展示名（`name`）、提交标识（`ai_model_mark`）三方独立。文档明令「**不要把计费 SKU 当成模型展示名**」（`model.md:62`）。`vidu_q2_refer` 与 `vidu_q2_refer_discount` 价格相同（member 均 2.154/5S/1080P），差异只在 `time_limited_price`（1.7 vs 1.4）——说明「优惠版」靠限时价区分，不是独立定价档。

---

## 9. 该域产品逻辑要点

### 要点 1：模型目录是「多场景共用的可筛选视图」，不是能力清单

46 条模型、11 个 mode、8 个端点、5 个场景键构成**四维可切片的数据结构**：同一份目录，资产生图切出 4 条（全自营）、拆分镜 4 条（全 Seedance/Wan）、分镜 10 条（全聚合）、画布生图 9 条（混合）。**切片之间交集可为空（资产生图 ∩ 画布生图 = ∅）**，说明这是刻意的场景隔离而非自然分类。

产品价值：**新增产品场景时，只需在目录里加一个场景键 + 一套筛选/排序/推荐规则，不需要新端点、不需要新模型、不需要改前端**。这是「同一目录服务多场景」的真实含义——**扩展成本在产品层，不在架构层**。

### 要点 2：区分的不是「模型好坏」，而是「谁为成本负责」

三个视频场景全推 `Seedance 2.0 VIP`（而非目录第一的 2.5），分辨率推「1080P优惠版」（实为 720p 码率），资产生图推自营 TGI 2/2.5。**推荐规则的本质是成本护栏**：把用户默认引向「够用且便宜」的档位。

`need_vip` 分层（自营 23% vs 聚合 52%）与 `price_variants` 三档价格（原价/会员价/限时价）叠加，形成「**免费用户走自营低价 → 付费用户走聚合高质量**」的漏斗（`报告 §7`：「1080P 低至 0.2 元/秒」按时长计价营销）。

### 要点 3：双层可见性（静态能力 vs 账号开白）必须由服务端裁决

`supported_modes` 与场景键不是冗余，而是**两层不同语义**：`supported_modes` = 「这个账号现在能用哪些 mode」（含开白过滤，服务端会摘）；场景键（`studio_asset_image`/`script_to_scene_refer`/`storyboard_reference_video`）= 「这个模型天生支持这个场景」（静态，不受开白影响）。

文档反复警告「不要用 `supported_modes` 筛分镜场景」（`_models.md:28`）、「不要用静态名单补回来」（`:25`）——**客户端不可自行推断可见性**。这是 SaaS 权限模型的必然：**能力是商品的属性，可用性是订单的属性**，必须分离。

### 要点 4：统一任务系统的价值在「终止语义」，不在「统一端点」

创建端点「每能力一个」（63 个），生命周期只有一套（16 条）。真正的统一发生在**状态机（9 个整数码）+ 退出码（11 个码）+ 业务错误码（14 类）**三层映射上：`TASK_STATUS` 让前端知道「等不等」；退出码让 CLI/Agent 知道「重不重试」；`TMV_ERROR_CODE` 让产品知道「为什么失败、该推什么」——尤其 `745629 UNSUPPORTED_MODEL_MODE` 把目录协议与任务协议缝合起来。

**推断**：把任务终态映射成进程退出码（4/5/6/7/8）是**为 Agent 时代做的接口设计**——让 LLM 无需解析 JSON 即可分支，比 MCP/JSON-RPC 更早解决了「机器可消费的异步任务」。

### 要点 5：竞品最脆弱的地方是「展示口径与技术口径的分离」

`720p_sale` → 「1080P优惠版」、`720p_hd` → 「2K超清版」、`1080p_sale` → 三种 label。这种分离让运营可随时改文案而不动后端，但造成：同一 label 在不同模型下指向不同真实分辨率；用户无法从 label 反推实际码率；文档必须写「不要按码口算中文」这类防御性说明。

**推断**：这是竞品在「营销灵活性」与「产品一致性」之间选了前者。对复刻者而言**这是可改进的点**：label 可以营销化，但应保证「label ↔ 真实规格」的全局唯一映射，或在 UI 上同时暴露技术规格。

---

## 10. 未知项 / 证据缺口

| # | 未知项 | 影响 | 已知线索 | 建议验证 |
|---:|---|---|---|---|
| 1 | **`id` / `ai_model_mark` 取值规则** | 无法确认「展示名 → mark」是否 1:1（同名模型如何区分） | `model.md:40` 明确不返回；`报告 §5` 给出源码样例（`seedance_2.0_mini`、`kling_3.0`）；CLI 示例出现 `seedance_2.5`/`seedance_4.5`/`seedance_1.6` | 抓一次真实生成请求体，或读 CLI 二进制内的 mark 表 |
| 2 | **同名重复记录的区分机制** | `Vidu Q2`×2、`Happy Horse 1.0`×2 靠 `supported_modes` 不同区分，但用户看到两个同名项 | `_models.md:18`「仍全部列给用户」；`model params` 遇同名须补 `mode` 才能查 | 实测 UI 是否加括号/后缀 |
| 3 | **`status=2` 双重语义边界** | `TASK_STATUS.RUNNING=2` 与上传 `status===2`（成功）冲突，无法确定哪些 `task_type` 用哪套编码 | `core-lib:TASK_STATUS`；`CtSMsPHi.js` | 需一份含多 `task_type` 的真实 `task/result` 响应 |
| 4 | **`/web/v1/ai/result/batch` 与 `/task/result` 关系** | 前者出现在 bundle（`core-lib:fetchAiTaskInfoBatch`）但**不在 routes.txt**，后者是主轮询路径 | 前者 `defHttp.post({url:"/web/v1/ai/result/batch"})` | 可能是旧版遗留；需抓包确认是否存活 |
| 5 | **`mode_order` 空洞（6、7 缺失）成因 + 资产生图实际排序** | 无法确认空洞是「下线留稳定槽位」还是「下发被过滤」；也无法确定资产生图弹窗实际默认项 | 脚本：`universal_reference` 下标 5→8 跳跃；4 条 `studio_asset_image` 全无 `mode_order` | 多时间点目录对比 + 资产生图弹窗截图 |
| 6 | **`model-catalog-summary.json` 的生成口径** | 该文件对 `durations` 做 **8 项截断**、`resolutions` 用 label 而非提交值，**不能作权威源** | 脚本交叉验证：`summary.durations` 是 `cli-out` 前缀 **59/59** 命中 | 疑似人工整理或早期版本；本文枚举一律以 `cli-out` 为准 |
| 7 | **`temp-info` 团队模型开关矩阵布尔位** | `745601/745602` 暗示额度与模型档位挂钩，但具体开关未取到 | `报告 §12.8` 提到 `seedance_is_support`/`sd_480p`/`tsd` | 需 `cam/team/temp-info` 实测响应 |
| 8 | **音频/克隆/处理类为何不进目录** | 本文据「无目录记录」推断为「功能不选模型」，无法验证用户侧是否真的没有选择器 | `model.md:117`「音频按 `audioKind` 路由」 | 画布 audio 节点 UI 截图/实测 |
| 9 | **8 个生成端点的请求体差异 + `X-Model-Ver` 语义** | `报告 §12.3` 只给 `text-to-video` 完整请求体；`X-Model-Ver` 做版本控制但目录无版本号字段 | `报告 §6`、`§12.3` 称「五个视频端点共用此模式」 | 各端点 `--dry-run` 输出 + 多版本抓包 |
| 10 | **11 条 `price` 的单位** | `可灵3.0`=5.4 是「积分」还是「元」未验证 | `model.md:57` 只说「`default_show` 规格的价格」 | 需一次真实扣费流水对照 |

### 10.1 统计口径声明

| 数字 | 口径 | 脚本 |
|---|---|---|
| 46 条模型 / 30 视频 / 13 图像 / 3 文件 | `model-all.json` 的 `data` 数组长度（`data` 是裸数组，无 `list` 层）；按 `type` 分组 | `rm-stats.mjs` A 段 |
| 43 条有 `params` | `params` 非空计数（46 − 3 条 `file` 类） | `rm-stats.mjs` 字段统计 |
| 11 个 mode | `params.generation.<mode>` 键并集 ∪ 场景键名 ∪ `supported_modes` 并集，去重 | `rm-stats.mjs` C 段 |
| 93 个 (模型,mode) 对 | 遍历所有模型 `params.generation` 键数求和 | `rm-stats4.mjs` |
| 8 个生成端点 | `params.generation.*.endpoint` 去重 | `rm-stats.mjs` F 段 |
| 63 个 AI 端点 / 16 条任务端点 | `routes.txt` 中前缀 `/web/v1/ai/` 与 `/web/v1/task` 去重 | `rm-ai.mjs` / `Select-String` |
| 场景成员数（4/4/10/10/3） | 按 `_models.md` 规则对 43 条 `visible=true` 记录模拟筛选 | `rm-stats3.mjs` 7 段 |
| 11 条 `price` / 11 条 `price_variants` / 20 条 `need_vip` | 字段非 null / `need_vip===true` 计数 | `rm-stats.mjs` M/N 段 |

> **反例声明**：`model-catalog-summary.json` 与 `cli-out` 不一致（6 条模型 mode 集合不同、`durations` 截断到 8 项、`resolutions` 用 label 而非提交值）。**本文所有枚举、排序、矩阵均以 `cli-out/model-all|video|image.json` 为唯一权威源**，`summary` 仅作交叉验证发现矛盾用。
