# API 规范 v1

> v1.2 · 基础域名 `https://api.<domain>/v1` · 与 database.md / PRD 同步演进
> 本文件是契约的唯一事实来源；实现用 OpenAPI 生成（drizzle/nest 自动 + 本文件人工对账）
> v1.1 · 2026-10-24 · 按启动前审查报告修订（P0-04/05/10、P1-03/05/08/10/11/12/22/24、P2-03/08/21/23）
> v1.2 · 2026-10-24 · 按《逆向一致性审查》修订：模型目录字段对齐 46 模型目录（mode_order/endpoint/default_*/resolution label）、批量报价与折扣字段、mode/scene 键补 `studio_asset_image` 等、预算触顶改逐镜 200 部分成功、新增 share/split/导出部分成功规则、错误码来源标注与 400104/400105/400106、任务与资产定稿门槛（RE-01~RE-20）
> v1.3 · 2026-10-24 · 与实现同步：`/models` 增 `audio_video_support`；错误码 400104~400107 已落 `packages/shared`；P1 数据层 16 表见 database v1.3
> **v2.0 · 2026-10-26 · 四新域契约（F1）**：新增 §14 四域端点总则与端点族清单（`canvas` 73 / `agent` 12 / `cam` 39 / `film` 37，共 161 条本体）；
> 错误码表新增 400108、746004、746005；`credit_flows.kind` 扩 4 个配对枚举（见 database §12.3）。
> 逐端点方法/请求/响应见 `_acceptance/_gap/contract-draft-{canvas-agent,cam-film}.md`；跨域裁决见 `f1-lead-decisions.md`。
> **v2.6 · 2026-10-26 · 文本类能力 + 后台定价可写**：新增 §14.4.6（剧本优化 / 拆解分镜 / 拆分资产 3 条）+ §14.4.7（资产匹配 3 条），
> 把 `TextMode` 进 `tasks.mode` 枚举（按次计价）；后台补 `POST/DELETE /ops/admin/model-prices`，
> 让"新能力上架定价"不必改代码。同时修掉计费缺陷：`duration_s IS NULL` 的档位原先不受唯一键约束，
> 同一档位可重复插入、扣费金额不确定（补部分唯一索引 `uq_model_prices_per_call`，迁移 0017）。
> 验收：`apps/api/test/canvas-derive.spec.ts`（5 例，含"改价后报价立刻变"）+ E2E S19（4 项）。
> **v2.7 · 2026-10-26 · 视频拆解（`video-parse`，2 条）**：视频节点上的「拉片」动作落地为
> `tasks.mode=video_parse`（按次计价，价目后台可调），产出 JSON（角色/场景/道具）由 worker
> 写回 `params.result_text`，前端复用「拆分资产」的候选列表一键建资产节点；见 §14.4.8。
> 证据：`rea-reelmate/routes.txt:370-371` + bundle 请求配置（POST body=json、GET 无 query）+
> `VideoNode` emits `video-parse`、`task_type=video_parse`；**请求体字段名/响应内层结构未取证**，
> 按 ADR-013「对齐行为不对齐字段名」协议自研。
> 验收：`canvas-derive.spec`（+2 例）、`adapters.spec` mock 形状（+1 段断言）、E2E S20（5 项）。
> **v2.8 · 2026-10-27 · `cam` 团队管理收口（6 条）**：`PATCH /cam/team/info`（改名/席位/开关）、
> `GET /cam/team/group/{id}/stats`、`GET /cam/team/member/{id}`、`PATCH …/member/{id}/name`、
> `POST /cam/team/batch-points-allocation`（逐条独立）、`GET /cam/team/points-flow/export`（CSV 现签链接）。
> 未实现清单收敛为项目维度流水（项目↔流水映射待定）与待取证项（BYOK/temp-info）；
> 密码/凭证类端点标注**不适用**（我方手机号+短信验证码，无密码语义）。验收：`team.spec` 10 例 + E2E 16 项。
> **v2.5 · 2026-10-26 · 节点产物批量下载落地**：新增 §14.4.5（3 条：打包 / 下载单列表 / 现签链接）+ 迁移 0016
> `canvas_download_lists`。同时修掉两个"接口成功、用户用不了"的缺陷：
> 签名链接基址默认指向 3000（另一个项目的端口）、`.zip` 缺 content-type。
> 当前 canvas 剩余：需新能力的派生族 10 条、`pinned-timelines` 4 条（待取证）、`group-recover` 1 条（需改软删）。
> 验收：`apps/api/test/canvas-download.spec.ts`（5 例，含"签名链接真能下到 zip"）+ E2E S18（7 项）。
> **v2.4 · 2026-10-26 · 表格节点 Excel 导入落地**：新增 §14.4.4（`table/import` + `table/confirm-sheet` 2 条），
> 补齐 canvas 域最后一个"有明显 UX 空白"的节点类型；同时把 Fastify 请求体上限从默认 1MB 抬到 16MB
> （base64 上传路径此前被默认值挡在 ~0.7MB，接口文档写的 8MB 形同虚设）。
> 当前 canvas 只剩非核心派生族未做（`video-parse` 等 5 条、节点批量下载 3 条、`pinned-timelines` 3 条）。
> 验收：`apps/api/test/canvas-table.spec.ts`（8 例）+ E2E S17（8 项）。
> **v2.3 · 2026-10-26 · agent 域落地回写（迁移 0015）**：新增 §14.9 —— `agent` 本体 9 条 + 画布内对话 C7 族 11 条（共 20 条）
> 与 SSE 实装结论；修正 §14.6 的 stream-token 形态（原设"一次性 60s"，实装为"120s 可复用 + 绑定会话"，理由见该节）；
> §14.4 里"画布内对话/SSE 归 agent 域、尚未实现"改为已实现并指向 §14.9。
> 验收：`apps/api/test/agent.spec.ts`（13 例）+ `pwsh _acceptance/canvas-acceptance.ps1`。
> **v2.2 · 2026-10-26 · canvas 第二批端点**：新增 §14.4.3（节点派生任务 4 / 整画布模板 6 / 素材 5 / 批注 10 / 固定组+组模板 10），画出"画布能出片"的完整链路。验收：`pwsh _acceptance/canvas-acceptance.ps1`（api 46 例 + 浏览器 E2E 56 项）。
> **v2.1 · 2026-10-26 · canvas 前端落地回写**：§14.4.1 补 `commit` 的 `id_map` 语义（本地临时 id → 雪花 id；修正前非数字 id 直接 500，整图提交不可用）；新增 §14.4.2 记录画布前端已实现能力与"明确不做"清单。


## 1. 通用约定

**信封**

```jsonc
// 成功
{"code": 0, "msg": "", "data": { /* ... */ }}
// 失败
{"code": 745701, "msg": "Insufficient Balance", "data": null}
```

**通用请求头**

| 头 | 必填 | 说明 |
|---|---|---|
| Authorization | 登录接口外全必填 | `Bearer <access_jwt>` |
| X-Space-Id | 多空间接口必填 | 默认个人空间（与 database.users.data_center 的数据面路由解耦） |
| X-Lang | 否 | zh-CN(默认)/en-US |
| Idempotency-Key | 创建类必填 | UUIDv4，5min 内重放返回原结果 |
| X-Captcha-Ticket / X-Captcha-Randstr | 风控挑战后重提必填 | 腾讯云验证码票据（对齐 RE 同名头） |
| X-Requested-With | 全部非 GET 必填 | XMLHttpRequest，配合 SameSite Cookie 防 CSRF |

**错误码表（本表为全库唯一权威码表；security.md / testing.md / 前端错误文案映射表均以本表为源）**

| 段 | 码 | 语义 |
|---|---|---|
| 0 | 0 | 成功 |
| 4001xx | 400100 | BAD_REQUEST：请求体不合法（Zod 解析失败、缺必填字段） |
| 4001xx | 400101 | 参数越界/模型不存在（附 field） |
| 4001xx | 400102 | NOT_FOUND：资源不存在或不属于当前空间 |
| 4001xx | 400103 | CANCEL_NOT_ALLOWED：终态任务不可取消 |
| 4001xx | 400104 | SOURCE_TOO_LONG：小说/剧本原文超 5 万字上限（附 field 与 max） |
| 4001xx | 400105 | ASSET_NOT_READY：引用的角色/场景资产未定稿（无 portrait_asset_id 或 status≠2） |
| 4001xx | 400106 | EXPORT_INCOMPLETE：成功镜占比 <80%，拒绝全集导出 |
| 4001xx | 400107 | QUOTE_REQUIRED：批量投递缺批量报价（预算上限来源不可缺失） |
| 4001xx | 400108 | **TEAM_SEAT_EXCEEDED**：团队席位数已满（邀请/绑定成员时；`data.limit` 附当前上限） |
| 4011xx | 401101 | token 无效 |
| 4011xx | 401102 | token 已过期 |
| 4031xx | 403101 | 越权访问资源 |
| 4291xx | 429100 | RATE_LIMITED：触发频控（响应头 Retry-After） |
| 4291xx | 429101 | 触发验证码挑战（响应含 captcha 票据要求） |
| 7457xx | 745701 | 余额不足（Insufficient Balance，对齐竞品同义码） |
| 7457xx | 745702 | QUOTE_MISMATCH：报价与提交时不一致 |
| 7457xx | 745703 | BUDGET_EXCEEDED：预算上限触顶（区别于余额不足，引导"提高预算/分批"而非"充值"） |
| 7458xx | 745801 | 输入审核未过 |
| 7458xx | 745802 | 输出审核未过 |
| 7459xx | 745900 | VENDOR_ERROR：供应商错误（kind 透传 vendor_code） |
| 7459xx | 745901 | VENDOR_TIMEOUT：供应商超时 |
| 7460xx | 746001 | 幂等重放 |
| 7460xx | 746002 | 版本冲突（Ph3 画布） |
| 7460xx | 746003 | NODE_LOCKED：画布节点被他端锁定（Ph3） |
| 7460xx | 746004 | **STREAM_CURSOR_EXPIRED**：SSE 续传游标已失效，客户端须全量重建后重连（会话仍存在，勿按 400102 处理） |
| 7460xx | 746005 | **AGENT_TURN_IN_FLIGHT**：同会话已有在途轮次（仅在客户端显式 `?wait=1` 时返回；默认语义为排队 200） |
| 5xxxxx | 500000 | INTERNAL：服务端内部错误 |

**码表来源与偏离声明**：745701（Insufficient Balance）与 RE 实测码同义；745703/745801/745802/7460xx 为本产品自造码——RE 的版本冲突/节点锁是 CLI 进程退出码 9/10，不是业务码，不得声称"竞品对齐"。745702 仅在 quote 与提交值不一致时使用；746002/746003 仅 Ph3 画布。RE 的 741001（长轮询超时）不使用：我们以 `304 + ETag` 轮询替代长轮询。

**批量接口幂等语义（P0-04）**：幂等分两层——
1. **请求级**：`Idempotency-Key` 对应 `idempotency_records(key, space_id, request_hash, response_body, expire_at)`；5min 内同键同体重放返回原 `response_body`（原封不动，含全部 items）；同键不同体 → 400101；
2. **任务级**：批量投递逐镜派生 `tasks.dedupe_key = shot:{shot_id}:a{attempt_no}`（服务端派生，唯一索引兜底）；同一镜头上一轮成功/在途 → 复用原任务（不重复扣费），失败/取消 → attempt_no+1 新建一轮。请求级记录若在响应写回前丢失（如进程崩溃），凭任务级 dedupe_key 防重复创建。`POST /tasks/{id}/retry` 的幂等键=(origin_task_id, attempt_no)，同为服务端派生，前端不参与。

**分页**：`?page=1&page_size=20` → `data:{list,total,page,page_size}`。
**时间**：ISO8601 UTC。**ID**：字符串化雪花（防 JS 精度丢失）。

## 2. auth（ADR-006、ADR-008）

```
POST /auth/sms-code  {phone, invite_code?}         // Alpha 期 invite_code 必填(P1-06)，Beta 起可选
  → 发码。限频：号 1/60s·5/日；IP 20/时。429101 需先过行为验证码(ticket/randstr)
  → Alpha 期校验 invite_code 有效性(status=1 且未过期)，无效 → 400101(附 field:"invite_code")
POST /auth/login     {phone, code, invite_code?, age_confirmed?}   // Alpha 期 invite_code 必填；age_confirmed 必须为 true(新号)
  → 新号自动注册：建 users(含 age_declared_at=勾选"已满18"时刻)+spaces+space_members(owner)
    +credit_accounts(0)+credit_flows(gift +80)[仅一次]
    +invite_redemptions(核销, 若 invite_code.credits>0 → credit_flows(gift +credits))[同码同空间仅一次]
    // age_confirmed≠true 且为新号 → 400101(field:"age_confirmed")
    // 无有效 invite_code → 不建号，转等待名单(400101/等待名单引导)
  ← {access_token, expires_in:7200, user:{id,nickname,avatar}, space_id}
    + Set-Cookie: refresh_token (HttpOnly; Secure; SameSite=Strict; Path=/v1/auth; Max-Age=14d)
  // 响应体不返回 refresh_token（P0-10：refresh 只经 HttpOnly Cookie 下发）
POST /auth/refresh   （无请求体；凭 Cookie 中 refresh_token）
  ← {access_token, expires_in:7200, user, space_id}
    + Set-Cookie: refresh_token (轮换，旧 refresh 失效)
  // CSRF 双保险：SameSite=Strict + 前端全部请求带自定义头 X-Requested-With: XMLHttpRequest
POST /auth/logout    → Redis 黑名单 access 至过期 + 清 Cookie

POST /waitlist  {phone, source?}                   // 无需登录(P0-05)；限 IP 5/时
  → 入 waitlist_entries(phone_hash, source)
  ← {position: 当前等待人数, remaining: 余量(当周可发码数)}
```

## 3. me / spaces

```
GET /me
  ← {user, space:{id,name}, credits:{balance,frozen}, vip:null(Ph2)}
  // credits 仅 {balance,frozen}(P1-11)：积分 Alpha/Beta 期永不过期，批次制为 Beta 前决策项；
  // 不再有 expire_soon/gift 字段。RE 的 credits balance 有 7 桶(expire_soon/give/recharge/team/vip…)，
  // 属团队+VIP 阶段形态；MVP 简化为可用/冻结两桶，Beta 再按需扩字段（不得静默返回假 0）。
GET /me/settings · PUT /me/settings {nickname, avatar_object_key}
POST /me/delete                 // 账号注销(PRD F1)：身份解绑、账号停用、任务脱敏、30 天物理清理
  ← {ok:true, purge_after}       // 注销后既有 access token 立即失效(401101)
```

## 4. models 与计价

```
GET /models?capability=video&mode=image2video&visible=true
  ← data:[{
      name, display_name, vendor, types[], need_vip, sort, visible,
      description, logo, tags[], promotions[], audio_video_support, // 目录展示字段（对齐 46 模型目录）
      mode_order:{"image2video":1,…},                // 同模式内升序；缺键排在后
      modes:{"image2video":{
        endpoint:"/vendor/…",                        // adapter 路由用，不向前端暴露
        ratios[], durations[], default_duration, default_ratio, default_resolution,
        resolution_options:[{value,label}],          // label 展示 / value 提交，禁止互推
        counts[], default_count, media_limits{image,video,audio,total},
        mouth_drive, off_peak
      }},
      scene_modes:{                                  // 流水线 scene 键（覆盖 mode 级参数）
        script_to_scene_refer:{enabled:true},        // 剧本拆分镜选模
        storyboard_reference_video:{durations[],ratios[],resolution_options[],
          media_limits{},default_duration,default_resolution,mouth_drive,off_peak}
      }
      // 资产生图不是 scene：用 modes.studio_asset_image 选模（RE 中仅 TGI 2.5/天幕写实版/TNB 有）
    }]                            // 按 sort 升序；同模式按 mode_order；前端禁用 visible=false
// 前端/后端均不得假设所有模型共享同一组时长、分辨率、画幅或输入模态（RE 目录实证）

POST /credits/quote              // 单条：与 /generations 同请求体
  ← {credits, strike_credits, discount:1, points_code:"v_t2v_5s_720p",
     balance_after_estimate, sufficient:boolean,
     quote_id, quote_expires_at}   // quote_id 5min 有效，供提交时校验价格未变(745702)
  // credits=实付、strike_credits=划线原价、discount=折扣系数（对齐 RE credit_original/credit_discount）
POST /credits/quote/batch        // 批量/合集报价：PRD F2⑥ 默认预算与续投预填的唯一来源
  {items:[<同上单条请求体>…]}   // ≤50 项
  ← {total_credits, total_strike_credits, balance_after_estimate, sufficient:boolean,
     line_items:[{shot_id?, credits, strike_credits, points_code}]}
```

## 5. generations（ADR-003 核心端点）

```
POST /generations
{
  "mode": "text2video",
  "model": "seedance-2.0-pro",
  "scene": null,                             // 流水线 scene 键：script_to_scene_refer|storyboard_reference_video
                                             // 资产生图不填 scene，用 mode=studio_asset_image
  "input": {
    "prompt": "……",                       // ≤2000 字
    "reference_uris": ["oss://u/…"],      // universal_reference/multi_reference 1~3 个
    "first_frame_uri": null,
    "last_frame_uri": null
  },
  "options": {"ratio":"9:16","resolution":"720p","duration":5,
              "count":1,"enable_audio":true,"mouth_drive":false,"seed":null},
  "quote_id": "q_…"                         // 可选；带上则服务端校验报价未变(745702)
}
← 200 {task_id:"734…", status:1, credits_estimate:8}
← 400101 参数越界(附 field)  745701 余额不足  745702 报价已变  745801 输入审核未过
← 429101 {captcha:"tencent", ticket_required:true}   // 前端弹码后带票据重提
```

**服务端校验顺序**：幂等键 → 身份/空间 → 参数 vs models.modes（含 scene_modes 覆盖）→ 内容安全 → 计费冻结 → 入队。
`mode` 枚举全集**覆盖 RE 的 11 个 generation mode**（text2video/image2video/first_frame/first_last_frame/universal_reference/video_extend/video_edit/text2image/image2image/multi_reference/studio_asset_image）：video `text2video|image2video|first_frame|first_last_frame|universal_reference|video_extend|video_edit`；image `text2image|image2image|multi_reference|studio_asset_image|upscale|outpaint|inpaint|erase`；speech `tts|voice_clone`(Ph2)。upscale/outpaint/inpaint/erase 为 MVP 额外后处理子集（RE 以 canvas mode 提供），不改变"8 个生成端点"的收敛结论；video_upscale 等走独立能力（Ph2）。
**scene 优先**：流水线分镜任务必须带 scene（`script_to_scene_refer`/`storyboard_reference_video`），参数按 `models.scene_modes[scene]` 校验并覆盖同 mode 参数；禁止用 mode 级枚举放行分镜投递。资产生图不填 scene，用 `mode=studio_asset_image`。所有 duration/ratio/resolution 必须在所选模型该 mode/scene 的枚举内，否则 400101（附 field）。

## 6. tasks

```
GET /tasks?ids=a,b,c            ← [{task_id,status,progress,results?,error?}]
GET /tasks?page=&page_size=&status=&capability=
  ← {list:[{task_id,mode,model{display_name},thumbnail,status,credits,created_at,finished_at}],total,…}
GET /tasks/{id}                 ← 详情(input/options 回显、results、task_events 摘要)
POST /tasks/{id}/cancel         ← PENDING/RUNNING→CANCELED+解冻；终态报 400103 CANCEL_NOT_ALLOWED
POST /tasks/{id}/retry          ← 新任务复制原参(attempt_no+1, origin_task_id 指向原任务)；
                                  幂等键=(origin_task_id, attempt_no) 服务端派生，前端不参与(P1-22)；
                                  失败原因带出
GET  /tasks/{id}/results/{n}/download-url   ← {url(预签名24h), filename}
POST /tasks/batch-download      {task_ids:[]} → {download_url}  // 服务端打包 zip(≤50项)
POST /tasks/{id}/share          {expires_in?:86400*7} → {share_url, token, expires_at}
DELETE /tasks/{id}/share        // 撤销分享（token 立即失效）
GET  /share/{token}                 // 公开只读预览：无需登录；仅结果元数据+预签名，不含 prompt/uid/空间
POST /share/{token}/report {reason,detail?,contact?}   // 公开举报(按 token+IP 频控)
```

status 枚举即 database §3；轮询接口响应加 `ETag`，3s 内重复轮询 304（配合 Redis 缓存）。
MVP 不提供任务删除/regenerate/feedback（RE 有 `task delete/regenerate`）；如 v1.1 需要，新增端点并补 tasks 软删字段，不得复用 cancel 语义。

## 7. files（OSS 直传，ADR-005）

```
POST /files/upload-token  {kind:"image|video", content_type, size_bytes}
  ← {object_key:"u/{space_id}/{yyyymm}/{snow}.{ext}",
     sts:{ak,sk,token,bucket,region}, callback:false}
  // 限制：image ≤10MB(jpg/png/webp)；参考视频 ≤200MB(Ph2 video_extend 用)
POST /files/complete       {object_key}    // 触发服务端校验(真实类型嗅探/尺寸)
POST /files/sign-url       {object_key, expire?:3600}  ← {url}
  // 预签名(预览默认 1h，上限 86400=24h)；下载走 tasks/{id}/results/{n}/download-url(24h)
  // GET 携带请求体属非法用法故改 POST(P2-03)；expire 对齐 RE file-sign-url 的 expire 参数
```

## 8. projects（剧本流水线 · MVP 旗舰）

> LLM 步骤为同步端点（服务端内部流式聚合，30s 上限，每次 1~2 积分，失败不扣）；媒体步骤复用 §5/§6 任务系统。

```
POST /projects {title≤50, drama_type:1国内仿真人剧|2海外仿真人剧|3 2D/3D动漫,
                ratio:"9:16"|"16:9", source_type:1novel|2idea|3script, source_text≤5万字, source_file_name?}
  ← {project:{id,status}}                    // source_type=3 → 建项后调 /episodes/split
POST /projects/parse-script {file_name, file_base64}   // 新建项目「上传剧本」：txt/md/csv/docx/xlsx（≤8MB）
  ← {text, format, chars, truncated, warnings[]}       // 只解析不落库、不扣积分；旧版 .doc → 400101
POST /projects/{id}/episodes/split             // 导入剧本→拆集（RE 制片工坊主路径；拆集不扣积分）
  {source_text?}                               // 省略则用建项时 source_text；≤5 万字（超限 400104）
  ← {episodes:[{ep_no,title,script_text}], task_id?}
GET /projects?page= · GET /projects/{id}（outline/characters/episodes 概览）
PATCH /projects/{id} {title} · DELETE /projects/{id}

POST /projects/{id}/outline/generate {}                 // DeepSeek 分集大纲 P95≤20s、硬超时 30s；
  ← {episodes:[{ep_no,title,synopsis}]}                 // 即落库为草稿(自动保存, P1-03)：episodes(status=1)
                                                        // 写入后返回；后续 characters/generate 读已落库数据
PUT  /projects/{id}/outline {episodes[]}                // 确认(全量替换草稿行, episodes.status→2)
POST /projects/{id}/characters/generate                 // 从已落库大纲抽角色卡；上限 10 张(CHARACTER_MAX, P2-23)
  ← {characters:[{id,name,description,prompt}]}
PATCH /projects/{id}/characters/{cid} {name?,description?,prompt?}
POST /projects/{id}/characters/{cid}/portrait           // 定妆图：走任务系统
  {count:1..4, refine_from_asset_id?}                   // 生成 or 以已选图改稿
  ← {task_id}      // mode=studio_asset_image；完成自动绑定 portrait_asset_id(P1-08)并置 status=2(定稿)
POST /projects/{id}/characters/{cid}/portrait/rebind {asset_id}
                                                        // kebab-case 路径(P2-21)；换绑即重新定稿(status=2)
POST /projects/{id}/characters/{cid}/finalize           // 显式定稿(幂等)；未定稿角色不得被分镜引用(400105)

POST /projects/{id}/episodes/{eid}/script-draft/generate → {script_text}   // 同步返回并落库(草稿)
PUT  /projects/{id}/episodes/{eid}/script-draft {script_text}
POST /projects/{id}/episodes/{eid}/storyboards/generate {shot_count:4..30, default:10}
                                                        // shot_count 是产品口径，与模型无关
  ← {storyboards:[{id,shot_no,shot_desc,video_prompt,duration_s,ratio,resolution}]}
  // duration_s 默认 5、输入 1..30；ratio/resolution 可空(继承项目)；合法性在投递时按模型校验
PATCH /projects/{id}/episodes/{eid}/storyboards/{sid}
  {shot_desc?,video_prompt?,duration_s?,ratio?,resolution?,character_ids[]?,
   first_frame_uri?, last_frame_uri?}         // P9：3D 导演台定格图（storage key，≤500；null/"" 清空）
  // 仅存储；投递时按所选模型 scene.storyboard_reference_video 校验并就近取合法低档
  // 返回值 & GET episodes/{eid} 的每镜 DTO 含：
  //   first_frame_uri/last_frame_uri（storage key 原值）
  //   first_frame_url/last_frame_url（API 派生：预签名 1h，null 时为 null，供前端直接显示缩略图）
POST /projects/{id}/episodes/{eid}/storyboards/generate-videos
  {shot_ids[], budget_credits_max, model, mode?, ratio?, resolution?}
  // mode: universal_reference(默认) | first_frame | first_last_frame | text2video；video_edit → 400101
  ← 200 {budget_exceeded:boolean, items:[{shot_id, task_id|null, submitted:boolean,
                                          code?:400101|400105|745703, reason?:string}]}
                   // 预算上限必须来自 POST /credits/quote/batch；缺失/过期→400107(QUOTE_REQUIRED)
                   // 模型必须 visible 且 models.modes 含该 mode，否则 400101「模型 X 不支持 mode Y」
                   // 各模式的任务字段（tasks.mode / tasks.scene / tasks.input）：
                   //   universal_reference: mode=universal_reference, scene=storyboard_reference_video,
                   //                        input.reference_uris=全部绑定资产参考图；绑定资产须全部定稿，否则该镜 400105
                   //   first_frame:         mode=first_frame, scene=null,
                   //                        input.first_frame_uri = shot.first_frame_uri（P9 定格图优先）
                   //                                                ?? 第一个合格绑定资产 ref_image_uri,
                   //                        reference_uris=[]；两者都没有 → 该镜 400105 + reason=asset_not_ready
                   //   first_last_frame:    mode=first_last_frame, scene=null,
                   //                        input.first_frame_uri = shot.first_frame_uri ?? 第一个合格绑定资产,
                   //                        input.last_frame_uri  = shot.last_frame_uri  ?? 第二个合格绑定资产
                   //                        （定格图为 storage key，与资产 ref_image_uri 同口径直接写入，不额外签名），
                   //                        reference_uris=[]；任一帧缺失 → 该镜 400105 + reason=need_two_assets
                   //   text2video:          mode=text2video, scene=null, reference_uris=[]；不要求绑定资产，
                   //                        prompt=video_prompt || shot_desc，为空 → 400101「text2video 需要分镜提示词」
                   //   video_edit:          本期不支持，整体 400101「暂不支持 AI 改视频（需源视频输入）」
                   // duration/ratio/resolution 就近取低：参考生视频按 scene.storyboard_reference_video 枚举，
                   //   其它模式按 models.modes[mode] 枚举；durations 缺失时按原值/价格表就近取低
                   // 预算触顶→该镜 submitted:false + code:745703 + reason:budget_exceeded，接口仍 200(部分成功)
                   // 余额不足→整单 745701(不落任何任务)；参考图超 media_limits→400101(附 field)
                   // 重试或断点续跑只对 submitted:false 的镜再次调用；幂等语义见 §1「批量接口幂等语义」
                   // 幂等/复用仍按 shot 维度（最近一次任务成功/在途即复用），不因 mode 不同而强制重新投递
GET  /projects/{id}/episodes/{eid}                      // 分镜+任务矩阵(断点续跑视图)；
                                                        // 每镜含 current_task_id + attempts[](按 tasks.shot_id 反查)
                                                        // + asset_ready(角色/场景均已定稿) + last_reason(400105/745703)
                                                        // + first_frame_uri/last_frame_uri（P9 定格图 storage key）
                                                        // + first_frame_url/last_frame_url（派生签名 URL，1h）

POST /projects/{id}/episodes/{eid}/export               // 导出异步化(P1-12)：返回 export_id
  ← {export_id, status:1}                               // 前置校验：SUCCEEDED 镜占比 ≥80%，否则 400106
GET  /exports/{id}                                      // 状态查询；轮询或 SSE
  ← {status:1PENDING|2PACKAGING|3SUCCEEDED|4FAILED, download_url?, included_shots[],
     missing_shots[], error?}
                                                        // zip = included_shots + manifest.json(失败/未投镜标注)
                                                        // SUCCEEDED 时 download_url 预签名(7 天有效)
```

## 8.1 works（作品库与二次创作，PRD F9）

> 作品 = 项目（1:1，不新增表）。作品库是「以剧为单位」的成果聚合视图，与任务中心（以次为单位的执行视图）互补。

```
GET /works?status=archived&page=1&page_size=24
  ← {list:[{
       id,title,ratio,source_type,archived_at,is_sample,created_at,
       updated_at,               // 最后写操作时间（ReelFlow 列表卡「最后编辑于 …」用它）
       episode_count,            // 集数
       shot_count,               // 分镜总数
       done_count,               // 已成功出片镜头数
       cover_uri,                // 已签名的封面 URL（优先已转存图片资产，退化角色定妆图）
       timeline_duration_s,      // ReelFlow：项目所有时间线片段时长之和（秒）；0 = 还没剪过
       timeline_episode_count,   // ReelFlow：已保存时间线的集数
       work_state                // draft | producing | ready | archived
     }], total, page, page_size}
```

> `timeline_duration_s` / `timeline_episode_count` 由 `project_timelines.clips`（jsonb 有序数组）
> 聚合而来，供 `/reelflow/list` 卡片显示「成片时长 / 已剪集数」，避免列表页对每张卡片再发一次
> timeline 请求（N+1）。无时间线记录的项目返回 `0`（不是 null），前端无需区分「没剪」与「查询失败」。

**work_state 判定**：`archived_at != null → archived`；`shot_count === 0 → draft`；`done_count >= shot_count → ready`；否则 `producing`。

```
POST /projects/{id}/archive {archived:true|false}       // 归档/恢复（软标记 archived_at）
  ← {id, archived}

POST /projects/{id}/episodes {count:1..10}              // 二次创作：新增空集（复用已定稿角色，不复制分镜）
  ← {created:[{id, ep_no}]}

POST /projects/{id}/duplicate                           // 复制为我的项目（示例模板体验）
  ← {id, episodes, characters}                          // 深拷贝骨架+角色（含定妆图绑定），不复制分镜与任务
```

```
POST /me/onboarded                                      // 标记新手引导已读（幂等，PRD F10）
  ← {onboarded:true}
GET  /me                                                // 新增 onboarded 字段（false 时工作台展示引导条）
```

## 8.2 项目资产（P2：场景/道具/其他 + 分镜资产绑定）

> 角色与场景/道具共用 `project_assets` 表（`kind=character|scene|prop|other`）。角色沿用 §8 的
> `characters/generate` / `portrait` / `finalize`（写入同一张表），本节只覆盖非角色资产的 CRUD 与
> 分镜绑定；`storyboard_assets(storyboard_id, project_asset_id)` 为绑定表。
> 定稿语义：`status=1` 草稿 / `status=2` 已定稿（写入 `finalized_at`，置回 1 清空）。
> 生成视频时服务端从绑定读取 `ref_image_uri`，**要求每个被绑定资产 `status=2` 且 `ref_image_uri` 非空**，
> 否则该镜返回 `400105`（逐镜失败，不整单失败）。

```
GET /projects/{id}/assets?kind=scene|prop|other|character
  // kind 省略时返回该项目全部四类资产；按 created_at 升序（同秒按 id 升序）
  ← {list:[{
       id, kind, name, description, prompt, ref_image_uri,
       portrait_asset_id, portrait_url,   // portrait_url = ref_image_uri 的预签名 URL（1h）
       source_task_id, status,           // 1 草稿 / 2 已定稿
       finalized_at,                     // ISO8601 或 null
       bound_shot_count                  // 被本项目多少分镜引用（storyboard_assets 聚合）
     }]}
  // kind=character 时与 GET /projects/{id} 的 characters 字段同构（仅多 finalized_at / bound_shot_count）

POST /projects/{id}/assets
  {kind:"scene"|"prop"|"other", name:1..50, description?≤500, prompt?≤1000, ref_image_uri?≤500}
  ← ProjectAssetDto（status=1 草稿，finalized_at=null，bound_shot_count=0）
  // kind=character → 400101 + msg 提示走 /projects/{id}/characters/generate

PATCH /projects/{id}/assets/{assetId}
  {name?, description?, prompt?, ref_image_uri?, status?:1|2}   // 至少一个字段
  // status=2 → 写 finalized_at（已定稿重复置 2 保留原值）；status=1 → 清空 finalized_at
  // description/prompt/ref_image_uri 传 "" 或 null 表示清空
  ← ProjectAssetDto

DELETE /projects/{id}/assets/{assetId}
  ← {ok:true}   // 同事务先删 storyboard_assets 绑定，再删资产（重复删除 → 400102）

PUT /projects/{id}/episodes/{eid}/storyboards/{sid}/assets
  {asset_ids: string[]}   // 0..20，含角色与场景/道具（角色也是 project_assets 行）
  ← {asset_ids: string[]} // 落库后的绑定顺序 = 入参顺序（重复 id 按首次出现去重）
  // 整体替换（同事务 delete + insert）；任一 id 不存在或不属于该项目 → 400101，不落库

POST /projects/{id}/assets/extract          // P3 AI 提取资产：剧本/分集 → 场景/道具（可选角色）草稿
  {episode_id?: string, include_characters?: false, overwrite?: false}
  // 内容来源：episode_id → 该集 title/synopsis/script_text（该集不存在 → 400102）；
  //           省略 → 项目 source_text + title（source_text 为空时用 title 兜底）
  ← {created:number, updated:number, skipped:number, items:[ProjectAssetDto], truncated:boolean}
  // 落库：kind=scene|prop（include_characters=true 时含 kind=character），status=1 草稿，写入 description/prompt
  // 去重口径：同 project+kind+name(trim 后完全相同) 已存在 →
  //   overwrite=false → 计入 skipped（二次调用幂等：created=0/skipped>0）
  //   overwrite=true  → 仅当 description/prompt 与已存在行确有差异才更新并计入 updated，否则 skipped；
  //                     更新绝不改 status / finalized_at / ref_image_uri / portrait_asset_id
  // 单次最多落 20 个（按 scenes→props→characters 顺序截断，超出给 truncated=true）；
  // items 只含本次 created/updated 的资产（P2 ProjectAssetDto 同构，含 finalized_at/bound_shot_count）

POST /projects/{id}/assets/{assetId}/generate-image   // P3.5 非角色资产参考图（走任务系统）
  {prompt?: string, count?: 1..4}   // prompt 优先级：body.prompt > asset.prompt > asset.description > asset.name
  ← {task_id, model, project_asset_id}
  // 仅 kind=scene|prop|other；kind=character → 400101（角色走 /characters/{cid}/portrait）
  // mode=studio_asset_image、scene=null、input.reference_uris=[]（纯文生图）
  // 发起新任务后回写 asset：source_task_id=task_id、prompt=实际提示词，并清空旧 ref_image_uri/status（回 1）/finalized_at

GET  /projects/{id}/assets/{assetId}/candidates        // 与角色 portrait 候选同构
  ← {task_id, candidates:[{index, url}]}                // url 为预签名下载地址（1h）
  // 从未发起生图 → 400105（"asset image not generated yet"）；最新任务未成功 → 400105

POST /projects/{id}/assets/{assetId}/select            // 选定候选图并定稿
  {task_id: string, index: 0..3}
  ← ProjectAssetDto   // P2 DTO（含 portrait_url 预签名 / finalized_at / bound_shot_count）
  // 事务内：insert assets(kind=image, source_task_id, name=资产名, tags=[asset.kind],
  //                       meta={project_id, project_asset_id, candidate_index})
  //        + update project_assets(portrait_asset_id, ref_image_uri, status=2, finalized_at)
  // 任务不存在/未成功 → 400105；index 超出结果数组 → 400102
```

**错误码**：`400101` 参数/枚举/长度非法、kind=character 走错端点（含 generate-image）、绑定含非法/跨项目 id；
`400102` 项目/资产/分集不存在或候选下标越界（含跨 space 隔离）；`400105` 投递时绑定资产未定稿、
参考图未生成/生成任务未成功。

**跨 space**：`GET/POST/PATCH/DELETE /projects/{id}/assets/**`（含 `assets/extract`、
`assets/{assetId}/generate-image|candidates|select`）与绑定接口先按
`findProject(space, project)` 校验，项目不属于当前 space → `400102`（不泄露资产是否存在）。

## 8.3 分集时间线与成片合成导出（P7）

> 时间线按分集持久化（`project_timelines`，一个分集一条，PUT 覆盖写）；成片合成为异步任务
> （Redis 队列 `timeline.export` → worker ffmpeg），状态机与旧 zip 导出一致：
> `1 排队 → 2 处理中 → 3 完成 / 4 失败`。数据表见 database.md §6.1。
> 所有端点先按 `findProject(space, project)` + `findEpisode(project, episode)` 隔离，跨 space → `400102`。

```
GET /projects/{id}/episodes/{eid}/timeline
  ← {clips:[{clip_id, shot_id, task_id, name, duration}]}    // 无记录返回 {clips:[]}
  // clips 顺序即时间线顺序；task_id 为 null 表示该片段暂无视频任务

PUT /projects/{id}/episodes/{eid}/timeline     // 整体覆盖（同 episode upsert）
  {clips:[{clip_id?, shot_id, task_id?, name, duration}]}   // ≤100 条；duration 1..30 整数
  // clip_id 可省略：服务端生成并回填（同集内唯一，重复 clip_id 会重新生成）；
  // shot_id 必须属于本分集；task_id 非空时必须属于当前 space 且属于本分集/本集镜头，否则 400101；
  // 校验失败不覆盖已有时间线
  ← {clips:[...]}   // 归一化后（clip_id 必有、task_id 归一 string|null）

DELETE /projects/{id}/episodes/{eid}/timeline
  ← {ok:true}

POST /projects/{id}/episodes/{eid}/timeline/export
  ← {export_id, status:1}      // 时间线为空 → 400101；入队失败不回滚记录（可重试再建）
  // worker：按 clips 顺序逐段归一化（9:16→720x1280 / 16:9→1280x720 / 1:1→720x720，30fps h264 yuv420p 无音轨）
  //         → concat demuxer 拼接 → 右下角叠加「AI 生成」显式水印 → 上传 u/<space>/timelines/<exportId>.mp4
  // mock（ADAPTER_MODE=mock）：源视频是占位字节 → 该段用 lavfi 深色色板 + clip 名称替代（保证 dev 可播）

GET /projects/{id}/episodes/{eid}/timeline/export/{exportId}
  ← {export_id, status:1|2|3|4, download_url, error, skipped}
  // download_url：status=3 时为预签名 URL（1h），否则 null；error：{code,message} 或 null；
  // skipped：无源视频/不可解码且非 mock 时被跳过的片段数（status=3 也可能 >0）
```

**错误码**：`400101` 参数/长度/时长非法、clip 的 shot/task 不属于本分集或时间线为空；
`400102` 项目/分集/导出记录不存在（含跨 space）；导出执行失败不入接口错误码，通过 `status=4 + error` 表达。

## 9. assets

```
GET    /assets?kind=&folder_id=&tag=&page=&page_size=&deleted=true      // deleted=true 查回收站
POST   /assets/upload        {filename, content_type, data_base64}   // 图片 8MB / 视频 32MB
POST   /assets              {object_key, kind, name, tags[]}   // 也可从任务结果转存
POST   /assets/from-task    {task_id, index?}   // 任务结果一键转存(幂等：同 task+uri 复用)
PATCH  /assets/{id}         {name?, tags?, folder_id?}
DELETE /assets/{id}         // 进回收站(软删)
POST   /assets/{id}/restore // 回收站恢复
GET    /asset-folders       // 目录列表
POST   /asset-folders       {name, parent_id?}
GET    /assets/expiring-tasks  // 7 天内到期且未转存的结果任务 → [{task_id, expires_at, days_left}]
```

> 说明：目录/标签/回收站/到期提醒在 v1.0 已落地（实现路径与本节一致）；
> `kind` 过滤暂由 `folder_id`/`tag`/`deleted` 覆盖，UI 侧用目录+标签检索。
>
> **上传白名单与上限（v2.5 起）**：`content_type ∈ {image/jpeg,image/png,image/webp}`（≤8MB）
> 或 `{video/mp4,video/quicktime,video/webm}`（≤32MB）；`kind` 由 content_type 决定
> （视频写 `video`，供视频续写/编辑/参考当源素材）。**偏离说明（技术）**：视频也走
> base64 JSON 是 MVP 临时方案（Fastify bodyLimit 已抬到 48MB），单请求内存会到几十 MB；
> 真实生产应换 OSS 预签名直传，届时本契约的请求体形态会变更（`data_base64` → `object_key`）。

## 9.1 project 素材与矩阵

```
GET  /projects/{id}/matrix                      // 分镜矩阵：每集镜头 status + task_status
POST /projects/{id}/shot-materials {task_id}     // 任务结果加入项目当分镜素材(幂等)
GET  /projects/{id}/shot-materials               // 项目分镜素材列表(含预签名 URL)
POST /projects/{id}/characters/{cid}/to-asset    // 定妆图转通用资产(自动打 #角色 标签)
PATCH /projects/{id}/episodes/{eid} {title?,synopsis?,script_text?}  // 大纲自动保存(防抖)
```

## 9.2 积分流水

```
GET /credits/flows?page=&page_size=&task_id   // {list:[{id,kind,delta,frozen_delta,balance_after,task_id,memo,created_at}], total, page, page_size}
```

## 10. billing（Beta 支付）

### 10.1 端点

```
GET  /billing/skus                        （公开）← [{id,sku,kind,label,price_cents,credits,period,cents_per_credit}]
GET  /billing/channels                    （公开）← {live, channels:[{channel,configured,modes,missing?,reason?}]}
POST /billing/orders                      {sku, channel: wechat|alipay|mock, mode?, openid?}
  ← {order_id, sku, amount_cents, credits, channel, status, status_label, pay_token, pay_params, created_at, expires_at}
GET  /billing/orders/{id}                 ← 同上（前端支付后轮询 ≤3min）
GET  /billing/orders?page=&page_size=     ← 用户订单历史
POST /billing/orders/{id}/close           ← 关闭待支付订单（幂等：非待支付返回 closed:false；真实渠道 best-effort 关单）
POST /billing/orders/{id}/mock-pay        ← mock 渠道确认（PAYMENT_LIVE=true 时 HTTP 403）
```

**渠道与支付形态**

| channel | 可选 mode | 下单接口 | `pay_params` 关键字段 | 前端呈现 |
|---|---|---|---|---|
| `wechat` | `native`（默认）/ `h5` / `jsapi` | `/v3/pay/transactions/{native,h5,jsapi}` | `code_url` / `h5_url` / `prepay_id`+`pay_sign` | 二维码 / 跳转 / JSAPI 调起 |
| `alipay` | `page`（默认）/ `precreate` | `alipay.trade.page.pay` / `alipay.trade.precreate` | `pay_url` / `qr_code` | 收银台跳转 / 二维码 |
| `mock` | — | — | `null` | 一键模拟支付 |

- `mode` 省略时用渠道默认（桌面微信 `native`、支付宝 `page`）；`jsapi` 需显式传 `openid`，`h5` 缺用户 IP 会返回 `400101`。
- `pay_params` 只含可下发给前端的支付参数（二维码/跳转地址/预支付签名），**绝不含私钥/证书**。
- 重复下单（同 space + 同 sku + 同渠道 + 60s 内未支付）复用同一订单并回放 `pay_params`；旧订单缺参数时补下单后再返回。
- 渠道下单失败：订单置为已关闭（不进入可支付状态），返回 `745900 VENDOR_ERROR` / `745901 VENDOR_TIMEOUT` + `details:{channel,channel_code,vendor_code,retryable}`。

### 10.2 渠道回调（服务端到服务端，不在用户契约）

```
POST /billing/notify/wechat    // header: Wechatpay-Timestamp/Nonce/Signature（APIv3）
POST /billing/notify/alipay    // application/x-www-form-urlencoded，参数含 sign/sign_type（RSA2）
POST /billing/notify/mock      // 仅联调，PAYMENT_LIVE=true 时 HTTP 403
```

回调响应体**必须**符合渠道协议，因此这两个端点用 `@Res` 直写并绕过全局信封：

| 渠道 | 成功 | 失败 |
|---|---|---|
| 微信 | HTTP 200 + `{"code":"SUCCESS","message":"成功"}` | HTTP 401/400/404 + `{"code":"FAIL","message":"..."}` |
| 支付宝 | HTTP 200 + 纯文本 `success` | HTTP 401/400 + 纯文本 `failure` |
| 所有回调 | 响应头 `x-request-id`（排障链路） | 同上 |

### 10.3 幂等与安全（实现约束）

| 约束 | 实现 |
|---|---|
| 订单价格快照 | `orders.amount_cents / orders.credits` 下单时冻结，调价不影响已下单订单 |
| 重复下单 | 同 space + 同 sku + 同渠道 + 60s 内未支付 → 复用同一订单（防双击） |
| 重复回调 | 三重保证：`status=1` 才可流转；`SELECT ... FOR UPDATE` 行锁；`(channel, channel_order_id)` 唯一索引 |
| 金额篡改 | 回调金额与订单快照不符 → `400101` 拒绝入账 |
| 微信回调验签 | 对**原始请求体字节**验签 `timestamp\nnonce\nbody\n`（`rawBody: true` 保留 Buffer），时间戳容差 5 分钟；未配置平台公钥一律 401 |
| 微信证书轮换 | 按请求头 `Wechatpay-Serial` 从 `WECHAT_PLATFORM_PUBLIC_KEYS`（serial→PEM）精确选公钥；未知 serial 一律 401；未带 serial 回退 `WECHAT_PLATFORM_PUBLIC_KEY` |
| 支付宝回调验签 | 原始 urlencoded 体用 `node:querystring` 自行解析后做 RSA2 验签（排除 `sign`，兼容 `sign_type` 两种官方拼法）；未配置公钥一律 401 |
| 微信资源解密 | AEAD_AES_256_GCM，`apiV3Key` 必须 32 字符；解密失败 400 |
| 防假支付 | `PAYMENT_LIVE=false` 时非 mock 渠道下单直接拒绝；`PAYMENT_LIVE=true` 时 mock 下单/回调返回 HTTP 403 |
| 退款一致性 | 退款事务内 `SELECT ... FOR UPDATE` + 账户行锁；先校验积分余额再调渠道；渠道失败 → 整事务回滚（订单保持已支付、积分不动） |

**渠道适配层**（`apps/api/src/modules/billing/channels/`）

- `WechatPayV3Adapter`：商户私钥 RSA-SHA256 请求签名（`WECHATPAY2-SHA256-RSA2048`）、Native/H5/JSAPI 下单、按 `out_trade_no` 查单、关单、退款；JSAPI 另生成前端调起 `paySign`。
- `AlipayAdapter`：RSA2 排序拼串签名、`precreate`/`page.pay`/`query`/`close`/`refund`；配置公钥时对网关响应原文验签。
- 重试：网络错误/超时/HTTP 429/5xx 指数退避重试（默认 2 次）；4xx 与渠道业务错误码不重试（支付宝 `20000` 服务不可用按可重试处理）。
- 统一错误 `ChannelError{code,retryable,httpStatus,vendorCode}`：`CHANNEL_NOT_CONFIGURED`（凭据不全→默认拒绝，绝不静默 mock）、`CHANNEL_AUTH_ERROR`、`CHANNEL_BUSINESS_ERROR`、`CHANNEL_RATE_LIMITED`、`CHANNEL_SERVER_ERROR`、`CHANNEL_NETWORK/TIMEOUT`、`CHANNEL_INVALID_RESPONSE`、`CHANNEL_SIGNATURE_INVALID`。
- 凭据从 env 读取（见 §10.4），私钥支持 PEM 内联（`\n` 转义）或文件路径；适配器接受注入的 `fetch` 以便契约测试。

### 10.4 上线所需环境变量

```
PAYMENT_LIVE=true
# 微信 APIv3
WECHAT_APP_ID / WECHAT_MCH_ID / WECHAT_MCH_SERIAL_NO
WECHAT_MCH_PRIVATE_KEY（或 WECHAT_MCH_PRIVATE_KEY_PATH）
WECHAT_API_V3_KEY（32 字符）
WECHAT_PLATFORM_PUBLIC_KEY（或 _PATH，回调验签）
# 证书轮换（推荐）：JSON {serial:PEM}，可同时配置新旧证书
# WECHAT_PLATFORM_PUBLIC_KEYS（或 WECHAT_PLATFORM_PUBLIC_KEYS_PATH）
WECHAT_NOTIFY_URL=https://<域名>/v1/billing/notify/wechat
# 支付宝 RSA2
ALIPAY_APP_ID
ALIPAY_APP_PRIVATE_KEY（或 _PATH，请求签名）
ALIPAY_PUBLIC_KEY（或 _PATH，回调/响应验签）
ALIPAY_NOTIFY_URL=https://<域名>/v1/billing/notify/alipay
ALIPAY_GATEWAY（默认生产网关，沙箱需显式覆盖）
```

凭据不全时对应渠道在 `GET /billing/channels` 标记 `configured:false` 并给出 `missing`，下单返回 `400101`（不会降级成 mock）。

### 10.5 退款（全额，运营审批后执行）

```
GET  /ops/admin/orders?status=&page=&page_size=   // 运营查单（含退款留痕字段）
POST /ops/admin/orders/{id}/refund                // 管理端鉴权（AdminGuard）
     body { reason?: string, amount_cents?: int }  // amount_cents 仅用于声明/校验，必须等于订单金额
  ← {order_id, status:4, status_label:"已退款", refund_no, refund_status, refund_amount_cents, refunded_at, idempotent, channel_refund_id?}
```

- **仅全额退款**：传 `amount_cents` 且不等于订单金额 → `400101 partial refund is not supported`。部分退款（按未消耗余额人工处理，E3 未成年人误充口径）本期走人工工单，不提供 API。
- **仅已支付可退**：`status≠2` → `400101 order not refundable`；`status=4` 重复调用 → 幂等返回 `{idempotent:true}`（不重复扣积分、不重复调渠道）。
- **积分回冲安全**：事务内先 `SELECT ... FOR UPDATE` 锁订单、再锁积分账户并校验 `balance >= credits`；不足 → `400101`（message 内含 `balance=/credits=`，提示人工按已消耗处理），绝不产生负余额、不破坏 `balance == Σdelta`。
- **渠道一致性**：微信/支付宝退款在事务内调用（幂等单号固定 `rf-{orderId}`）；渠道失败 → 事务回滚 → 订单保持已支付、积分不冲正，返回 `745900 VENDOR_ERROR` / `745901 VENDOR_TIMEOUT`，运营可原单重试（渠道按幂等号去重）。
- **落库字段**：`refund_no`（我方幂等号）、`refund_status`（`processing` 渠道异步处理中 / `succeeded`）、`refund_amount_cents`、`refunded_at`、`refund_reason`、`refund_operator`；负向流水 `credit_flows.kind=refund`（`delta=-credits`，`ref_order_id=订单`）。
- 退款成功后 `status=4`；订单详情/历史 DTO 同步返回上述退款字段。

### 10.6 生产启动守卫（fail fast）

`NODE_ENV=production` 时 `buildEnv()` 在启动阶段聚合校验并拒绝启动（错误信息只含变量名，不含值）：

- `JWT_SECRET` / `PHONE_HMAC_PEPPER` / `PHONE_ENC_KEY` 必须显式配置且不等于仓库默认值；
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` 必须显式配置，且密码不能是开发默认值；`COOKIE_SECURE` 必须显式设置；
- `PAYMENT_LIVE=true` 时：至少一个渠道凭据齐全；任何"已配置但缺项"的渠道会列出缺失变量（如微信缺 `WECHAT_APP_ID`）并拒绝启动。

worker 侧：`NODE_ENV=production` 时 `ADAPTER_MODE` 必须为 `real`，且至少配置 `ARK_API_KEY` / `DEEPSEEK_API_KEY` / `HTTP_VIDEO_BASE_URL` 之一，否则拒绝启动。

### 10.7 未实现（依赖外部资质/流程）

- 部分退款 API（人工口径见 §10.5）；
- 微信平台证书自动下载/轮换任务（当前手工更新 `WECHAT_PLATFORM_PUBLIC_KEYS`，见 `docs/05-ops/deployment.md`）；
- 支付宝对账单下载与自动对账：待财务流程确定。


## 11. ops / admin（独立鉴权 admin_users）

```
GET  /ops/config/{key}?module=&lang=      // 公开(公告/横幅/定价页文案)
PUT  /ops/admin/config/{key}              // 管理端
GET  /ops/admin/dashboard                 // 失败率/队列深度/adapter 延迟
GET  /ops/admin/models                    // 模型目录（含 modes / capabilities）
PATCH /ops/admin/models/{id}              // 上下架/排序
GET  /ops/admin/model-prices?model_id=    // 价目列表
POST /ops/admin/model-prices              // **新增价目**（档位必须已存在于模型目录的 modes）
PATCH /ops/admin/model-prices/{id}        // 改金额 / active=false 下架
DELETE /ops/admin/model-prices/{id}       // 删除误配档位（追溯用下架，不用删除）
GET  /ops/admin/task-metrics              // 失败率 + 错误码分布 + adapter avg/p95 延迟
GET  /ops/admin/failed-tasks.csv          // 失败任务清单导出(CSV, ≤1000 行)
GET  /ops/admin/funnel                    // 流水线漏斗：建项→大纲→角色定稿→分镜→批量→成功(含转化率)
GET  /ops/admin/reports · POST /ops/admin/reports/{id}/resolve {action:takedown|dismiss}
GET  /ops/admin/orders?status=&page=&page_size=   // 订单列表（含退款留痕）
POST /ops/admin/orders/{id}/refund {reason?,amount_cents?}   // 全额退款（api-spec §10.5）
```

> 鉴权：/ops/admin/* 需 admin_users 独立 JWT；无凭证 → 401101，携带普通用户 token → **403101**。

> **定价可写是硬要求（2026-10-26）**：`PATCH` 只能改已存在的行；模型目录里加了新模式
> （如文本类 `script_optimization`）之后，如果控制台只能改不能建，运营就只能等发版才能上架定价，
> "价格后台可调、不写死"就是空话。因此补 `POST`/`DELETE`，并做**档位合法性校验**
> （mode 必须在该模型的 `modes` 里、resolution/duration 必须取自该 mode 声明的档位）；
> 金额本身完全由运营决定，代码里不出现任何能力单价常量。

## 12. 版本与废弃策略

- 路径带 `/v1`；不兼容变更 → `/v2` 并行 ≥3 个月；
- 字段只增不改名；废弃字段先标 `Deprecated`（响应头 `Warning: 299`）再下线；
- 契约测试（testing.md §3）保证实现与本文件一致，CI 强制。

## 13. 限流基线（全站默认，可按端点覆写）

| 端点组 | 用户级 | IP 级 |
|---|---|---|
| auth/sms-code | 1/60s + 5/日 | 20/时 |
| generations | 10/分 | — |
| projects/*generate（LLM 步骤） | 6/分 | — |
| storyboards/generate-videos（批量投递） | 3/分 | — |
| credits/quote 与 quote/batch | 20/分 | — |
| projects/{id}/episodes/split | 3/分 | — |
| tasks/{id}/share | 5/分 | — |
| tasks 轮询 | 30/分 | — |
| 其余 GET | 120/分 | 600/分 |

---

## 14. 四新域端点总则（F1 契约 · 2026-10-26）

> 背景：全站 1:1 复刻引入 `canvas` / `agent` / `cam` / `film` 四个新域。
> 本节定**总则与端点族清单**；逐端点的方法/请求体/响应/错误码见两份草案，F2 起按域落实现。

### 14.1 端点规模（覆盖核对基线）

| 域 | 路径数 | 方法×路径 | routes.txt 行号 | 归属说明 |
|---|---:|---:|---|---|
| `canvas` | **73** | 92 | 322–377 等 | 已扣除 `agent-skills` 8 条（裁决 D3：归 ops） |
| `agent` | **12** | 12 | 123–134 | — |
| `cam` | **39** | 40 | 228–266 | 同块含 `campaign` 6 条（属 ops，不计入） |
| `film` | **37** | 48 | 775–811 | — |
| **合计（本体）** | **161** | 192 | — | 另有附属：`canvas-tpls` 2 + `campaign` 6 + `agent-skills` 8 = 16 条归 ops/canvas 子族 |

> ⚠️ 口径陷阱：`-like '/web/v1/cam*'` 会连 `campaign/*` 命中（45 而非 39）；`-like '/web/v1/df/canvas*'` 会连 `canvas-tpls/*` 命中（81 而非 79）。做分母必须说明口径。

### 14.2 全局约定（四域一律沿用，不另立）

| 项 | 约定 |
|---|---|
| 信封 | `{code,msg,data}`（§1） |
| 鉴权 | `Authorization: Bearer <access_jwt>`（§2） |
| 空间 | `X-Space-Id` 必填；**团队成员的所有请求都带团队 space_id**（ADR-010） |
| 幂等 | 创建类必带 `Idempotency-Key`（§1 双层语义） |
| 分页 | `?page&page_size` → `{list,total,page,page_size}` |
| ID | 字符串化雪花 |
| 任务 | 任何生成一律走 `tasks`，**不得新建任务表**（ADR-003） |
| 账本 | 团队积分只走 `credit_flows`，**不得新建账本**（ADR-011） |

### 14.3 权限与闸门（四层）

| 层 | 判定 | 失败 |
|---|---|---|
| L0 功能准入 | `spaces.film_enabled` / `agent_whitelist` | 403101 + `data.reason=feature_disabled` |
| L1 登录 | access token | 401101/401102 |
| L2 空间 | 请求者 ∈ `space_members(space_id)` | 403101 + `data.reason=not_member` |
| L3 角色 | 按 **码集**判定（**禁止** `role_level <= N`） | 403101 + `data.reason=role_insufficient` |
| L4 项目作用域 | film project / team_member_projects | 403101 + `data.reason=project_scope_denied` |

特权码集：`{master, admin, group_admin} ∪ {producer, maker, film_producer, film_maker}`。
`role_level` **仅用于展示与排序**，不作判据（RE 实测 level 11 特权 > level 4）。

### 14.4 `canvas` 端点族（13 子族）

| 子族 | 条数 | 代表端点 | 关键约束 |
|---|---:|---|---|
| 画布根 | 2 | `GET/POST /canvases` | 乐观锁 `version`，冲突 746002 |
| 整画布模板 | 8 | `/canvases/templates`、`/canvas-tpls/:id` | 三族**不合并**（裁决 D1） |
| 节点 | 7 | `GET/PUT/DELETE /canvases/{id}/nodes/{node_id}`、`batch-edit-nodes` | 11 种 node_type 硬约束 |
| 连线 | 4 | `POST/DELETE /canvases/{id}/edges`、`batch-edges` | `UK(canvas_id,src,dst,semantic)` 保证"确保存在"幂等 |
| 节点锁 | 4 | `.../nodes/{node_id}/lock\|unlock\|renew`、`/canvases/{id}/heartbeat` | **Redis TTL 30s，不落库**；冲突 746003 |
| 节点派生任务 | 9 | `.../video-parse`、`storyboard-parse`、`asset-extraction` | 一律落 `tasks`；`sub_mode` 校验（裁决 D2） |
| 画布内对话 | 11 | `.../chat/sessions`、`.../stream` | SSE（§14.6） |
| 评论 | 5 | `.../comment-nodes`、`.../comments`、`.../resolve` | 不复用 `content_reports` |
| 组/固定组 | 13 | `/groups`、`/pin-groups`、`pinned-node` | 每画布 7 槽位，`UK(canvas_id,slot)` |
| 素材 | 6 | `/materials`、`/upload-file`、`node/batch-download` | object_key 走 files 域约定 |
| 图像编辑 | 2 | `/clip`、`/crop` | 走 `tasks` + `sub_mode` |
| 表格节点 | 2 | `.../table/import`、`.../confirm-sheet` | 两步式，不自动选第一个 Sheet（§14.4.4） |
| Agent 技能卡 | ~~8~~ → **0（归 ops）** | `agent-recommend-cards`、`agent-skills/*` | 裁决 D3：内容库属运营 |

#### 14.4.1 `canvas` 已实现端点（2026-10-26，迁移 0014）

> 前缀 `/canvas`（参照为 `/web/v1/df/canvas/*`；按 ADR-009 保留域划分，空间由 `X-Space-Id` 表达）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/canvas/canvases` | 列表（分页）/ 创建 |
| GET/PATCH/DELETE | `/canvas/canvases/{id}` | 详情（含节点/边/分组）/ 改名（带 version）/ 软删 |
| POST | `/canvas/canvases/{id}/commit` | **整图提交**：乐观锁校验 → 整体替换 → version+1 → 写快照 |
| GET | `/canvas/canvases/{id}/snapshots` `/{version}` | 历史版本列表 / 取某版本（恢复用） |
| POST | `/canvas/canvases/{id}/nodes` | 建节点（`node_type` 11 种白名单） |
| POST | `/canvas/canvases/{id}/nodes/batch` | 批量建 |
| PATCH | `/canvas/canvases/{id}/nodes/{node_id}` | 改节点（节点级乐观锁，冲突 746002） |
| POST | `/canvas/canvases/{id}/nodes/batch-edit` | 批量改（逐条校验，逐条返回结果） |
| DELETE | `/canvas/canvases/{id}/nodes/{node_id}` | 软删（**同时清相关连线**，不留悬挂边） |
| POST | `/canvas/canvases/{id}/nodes/batch-delete` | 批量软删 |
| POST | `/canvas/canvases/{id}/nodes-recover` | 恢复软删节点 |
| GET | `/canvas/canvases/{id}/nodes?node_type=` | 按类型取节点 |
| POST | `/canvas/canvases/{id}/edges` | 建连线（**幂等**：重复创建返回同一条，`created:false`） |
| POST | `/canvas/canvases/{id}/edges/batch` | 批量建（逐条返回） |
| DELETE | `/canvas/canvases/{id}/edges/{edge_id}` | 删连线 |
| POST | `/canvas/canvases/{id}/edges/batch-delete` | 批量删 |
| POST | `/canvas/canvases/{id}/nodes/{node_id}/lock\|unlock\|renew` | 节点锁（Redis TTL 30s；被他人持锁 746003） |
| POST | `/canvas/canvases/{id}/heartbeat` | 画布级心跳（TTL 60s）+ 返回当前锁快照 |
| POST | `/canvas/canvases/{id}/groups` | 建分组 |
| DELETE | `/canvas/canvases/{id}/groups/{group_id}` | 删分组（有子组时拒绝） |
| PUT | `/canvas/canvases/{id}/pinned-node` | 钉住节点（单选，`node_id=null` 取消） |

**关键语义说明**：
1. **提交通用整体替换**：画布编辑天然是整图操作（拖拽/批量/撤销），逐条 diff 的边界情况远多于收益；单画布百级节点下代价可接受。提交时若边引用了不存在的节点 → **400101 且事务回滚**（版本不推进）。
2. **两层乐观锁**：画布级（`canvases.version`，提交/改名用）与节点级（`canvas_nodes.version`，单节点 PATCH 用），冲突一律 **746002**，绝不静默覆盖。
3. **锁不落库**：`node_locks` 走 Redis（对齐 §7 既有决策）；`unlock` 只能由持锁者执行，否则 746003。
4. **`commit` 接受本地临时 id 并回传 `id_map`**（2026-10-26 修正）：画布编辑器是"本地编辑 + 整图提交"，新节点 id 由前端临时生成（形如 `local_<ts>_<rand>`）。因此 `commit` 把**非雪花 id 一律视为新节点**（新分配），而不是解析失败。
   - 响应体 `data.id_map`：`{ 本地临时 id → 真实雪花 id }`。前端保存后**必须**用它回写本地 id，否则下次提交会把同一批节点当新节点再建一遍（**节点翻倍**）。
   - 修正前：`BigInt("local_xxx")` 抛 `SyntaxError` → **500**，"先加节点再保存"这条最主流路径 100% 失败。
   - 回归锁定：`test/canvas.spec.ts` 的「整图提交接受本地临时 id」「整图提交是整体替换」两例。

**尚未实现（不暴露空壳）**：`pinned-timelines`（4 条，结构待取证 G-09）、`group-recover`（1 条，需先改成软删）。
**已实现**：画布内对话/SSE（C7 族 11 条）——2026-10-26 随 `agent` 域落地，见 §14.9。
**已实现**：表格节点 Excel 导入（2 条）——2026-10-26，见 §14.4.4。
**已实现**：节点产物批量下载（3 条）——2026-10-26，见 §14.4.5。
**已实现**：视频拆解 `video-parse`（2 条）——2026-10-26，见 §14.4.8（C6 派生族已清零）。

#### 14.4.3 `canvas` 第二批端点（2026-10-26，节点任务/模板/素材/批注/固定组）

> 第一批（§14.4.1）只做了"画布本体"。本批把画布接进生成链路、并补齐协作与复用能力。
> **没有新增任何表**（表在迁移 0014 已建）；**没有新建任务表**（节点任务复用 `tasks`，ADR-003）。
> 验收：`pwsh _acceptance/canvas-acceptance.ps1`（api 46 例 + 浏览器 E2E 56 项）。

**A. 节点派生任务（C6）—— 复用 `tasks`，禁止另造任务表**

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/canvas/canvases/{id}/nodes/{node_id}/generate` | 单节点投递：建 task + 回写 `node.task_id`、`status=2` |
| POST | `/canvas/canvases/{id}/batch-node-tasks` | 批量投递（≤50），**逐条独立**（一条失败不连累其它） |
| GET | `…/nodes/{node_id}/task/{task_id}` | 节点视角任务状态（校验 task 确属该节点，防越权查） |
| POST | `…/nodes/sync-tasks` | 校正节点状态（防错过轮询后永远停在"生成中"） |

三条硬语义：
1. **默认参数取自模型目录**，不硬编码。图像模型分辨率档是 `1K/2K/4K`，视频是 `720p/1080p`——
   写死 `720p` 会让图像节点首次投递 100% 失败（实测）。
2. **必须过 `generationRequestSchema`**：裸传对象会跳过 options 默认值，
   `credits.price()` 读 `options.resolution === undefined` 直接报错（实测第一版即如此）。
3. **canvas mode → tasks.mode 收敛**，后处理子模式落 `options.sub_mode`：
   `crop/panorama/story_grid_*/de_subtitle_*/frame_capture` 在 `tasks.mode` 枚举里不存在，
   新增 mode 需同步补 `model_prices` 价格档（商业决策），故按契约用 `sub_mode` 承载。

**worker 回写（`apps/worker/src/executor.ts`）**：任务终态写回 `canvas_nodes`——
成功 → `status=3` + `params.result_uri/result_preview_uri/result_uris`；
失败/审核拒绝 → `status=1` + `params.last_error={code,message}`（积分已退回）。
**缺这一步画布会永远显示"生成中"**（此前只回写 `storyboards`）。

**B. 整画布模板（C2）—— 6 端点，路径归一为 `/canvas/templates`**

参照站有三组前缀（`canvas-tpls` / `canvas/:id/tpls` / `canvas/templates/*`）指同一实体，
分三组会造三套权限与分页语义，故归一。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/canvas/templates` | 列表（官方 scope=1 全员 / 团队 2 同 space / 个人 3 仅创建者） |
| GET | `/canvas/templates/personal?query=` | 个人模板按名称模糊搜索 |
| GET | `/canvas/templates/{id}` | 详情（可见性校验；已下架等同不存在） |
| GET | `/canvas/templates/{id}/instantiate` | 套用：返回待插入节点描述 |
| POST | `/canvas/canvases/{id}/tpls` | 存为模板 |
| POST | `/canvas/templates/{id}/sync-team` | 个人模板同步到团队 |
| DELETE | `/canvas/templates/personal/{id}` | 删除（`status=3` 软下架） |

关键：**payload 自包含**（存节点描述，不含雪花 id）——引用原画布 id 在目标画布不存在，套用必悬挂；
**套用只改本地**，仍需用户点保存走 `commit` 乐观锁。

**C. 素材（C8）—— 5 端点**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/canvas/canvases/{id}/materials` | 列表（`material_type`/`source`/`node_id` 筛选 + 分页） |
| POST | `…/materials` | 挂载（三来源：上传/节点产出/资产库） |
| POST | `…/materials/batch-delete` | 批量软删 |
| POST | `…/upload-file` | 登记已上传对象（按扩展名猜类型） |
| POST | `…/materials/batch-download` | 批量取 `object_key`（显式回报 `missing[]`） |

**只存 `object_key`，不存 URL**：直链会过期，换存储驱动（local/S3/OSS）要洗库。
`node_id` 必须属于同一画布（否则造出跨画布引用）。

**D. 批注（C9）—— 10 端点**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/canvas/canvases/{id}/comment-nodes` | 列表（带 `comment_count`）/ 新建（**落点 + 首条内容一次完成**） |
| GET/PUT/DELETE | `…/comment-nodes/{cn_id}` | 详情 / 移动锚点 / 删除（仅本人） |
| GET/POST | `…/comment-nodes/{cn_id}/comments` | 消息列表 / 追加 |
| PUT/DELETE | `…/comments/{comment_id}` | 改 / 删（仅本人） |
| POST | `…/comment-nodes/{cn_id}/resolve` | 标记已解决 / 重新打开 |

锚点存**世界坐标**（存屏幕坐标则平移缩放后批注会飘走）。**不复用 `content_reports`**——
后者是公开举报，有独立频控与处置队列。

**E. 固定组（C10）+ 节点组模板（C11）—— 10 端点**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/canvas/canvases/{id}/pin-groups` | 列表（含 `max_slots=7`） |
| PUT | `…/pin-groups/{slot}` | **整体替换**某槽位（返回 `replaced`） |
| DELETE | `…/pin-groups/{slot}` | 删组（同时清成员归属） |
| DELETE | `…/pin-groups/{slot}/members` | 只清成员 |
| PUT | `…/nodes/{node_id}/pin-groups` | 节点侧设置归属 |
| GET | `…/group-templates` | 组模板列表 |
| POST | `…/groups/{group_id}/templates` | 从分组存模板（空分组拒绝） |
| PUT | `…/group-templates/{template_id}` | 改名 |

**双写一致性是本节最关键的不变量**：`canvas_pin_groups.node_ids` 与
`canvas_nodes.group_ids` 是同一事实的两份记录（组视角 / 节点视角），
**必须同事务双写**。只写一边不会报错，只会静默腐化
（固定栏有分组但节点不知道自己属于它，或反之）。
连"整体替换后旧成员 `group_ids` 里不再有该组"都有测试锁住——
**幽灵归属**正是替换场景下最容易漏的那一半。数组增删用 SQL `array_remove`/`array_agg(DISTINCT ...)`，
避免"读-改-写"的并发丢更新。

#### 14.4.2 `canvas` 前端已实现能力（2026-10-26）

> 页面：`/canvas`（列表，裸壳布局）+ `/canvas/{id}`（编辑器）。
> 端到端验收：`pwsh _acceptance/canvas-acceptance.ps1`（api 46 例 + 浏览器 E2E 56 项，UI 与 API 双向核对）。

| 能力 | 实现说明 |
|---|---|
| 画布引擎 | **自绘**（`transform: translate+scale` + pointer events），未引 X6/vue-flow/dagre；单画布百级节点目标 |
| 视口 | 滚轮缩放（以指针为锚点）、空格/中键/抓手模式平移、适配视图、小地图（点击定位）、缩放百分比 |
| 节点 | 11 种类型全覆盖；卡片按类型渲染参数摘要；生成结果缩略（`params.result_url`/`cover_url`）；他人持锁半透明+锁标记 |
| 连线 | 连线模式点两个节点；贝塞尔曲线；点曲线删除（加粗透明命中区）；同 src/dst/semantic 幂等 |
| 选择 | 单击 / Shift 多选 / 框选（世界坐标命中）/ Ctrl+A；方向键微调（Shift ×10） |
| 编辑 | 拖拽（多选整体位移，屏幕位移÷zoom 转世界位移）、复制（Ctrl+D）、删除（Delete）、撤销/重做（快照栈，上限 50） |
| 保存 | 整图 `commit` + `id_map` 回写；`746002` 冲突明确提示"请重新加载"，绝不静默覆盖 |
| 检查器 | 11 种节点参数面板（字段严格对齐 CLI `node.md`）；公共区（名称/XY/宽度/Z序/状态/分组）；多选批量改状态与对齐；连线列表可删 |
| 历史版本 | `GET /snapshots` 列表 → 载入某版本到本地（**仍需点保存**才落库，避免误触覆盖） |
| 协作锁 | 选中即抢锁、20s 续期、15s 心跳刷新"他人编辑中"；锁仅提示，真实保护仍是 commit 乐观锁 |
| 空态引导 | 复刻参照站：`双击画布 / 单击 Tab` + 两行 chip（8 类型）+ 新手引导入口 |
| **生成投递** | 检查器「生成」区：缺 mode/model 有明确指引、失败原因带错误码、结果预览（图/视频）；多选「批量生成」+ Ctrl+Enter；节点卡片生成中骨架屏 |
| **模板库** | 存为模板 / 全部·我的 / 搜索 / 套用 / 删除；缩略图按 payload 真实坐标画（不造假图） |
| **素材库** | 类型筛选 / 多选批量移除 / 复制 object_key / 「把选中节点结果存入」 |
| **批注** | 世界坐标飘点（跟随视口）+ 侧栏对话（回复/标记已解决/删除）+ 点哪落哪 |
| **固定组** | 顶部芯片：点=选中成员并跳转视口；右键=替换/清空/删除；实时显示可归组数量 |

**明确不做（对应端点未实现，只留入口 + 说明，不放假数据）**：图层树。

> 2026-10-26 更新：原先列入"明确不做"的**整画布模板 / 素材库 / 评论批注 / 固定组**已全部实现，
> 见 §14.4.3；**表格 Excel 导入**与**画布内 Agent 对话**也已补齐，见 §14.4.4 与 §14.9。

#### 14.4.4 表格节点 Excel 导入（2026-10-26）

| 方法 | 路径 | 请求 | 响应 | 关键码 |
|---|---|---|---|---|
| POST | `/canvas/canvases/{id}/nodes/{node_id}/table/import` | `{file_name, file_base64}` | `{import_token, sheets[{sheet_id,name,row_count,col_count,truncated}], preview[][], warnings[], limits}` | 0/400101/400102 |
| POST | `/canvas/canvases/{id}/nodes/{node_id}/table/confirm-sheet` | `{import_token, sheet_id}`（**必填，不自动选第一个**） | `{node{node_id,version}, sheet, sheets[], table}` | 0/400101/400102 |

**为什么必须两步**（参照站实测 `node.md:392`「不会自动选第一个 Sheet」）：
多 Sheet 的排期表若自动取第一个，用户会以为导了「镜头表」而实际存的是「角色表」——
错得无声无息。所以第一步只回 Sheet 清单与 5×8 预览，第二步由用户显式确认才写节点。

**实现约定（写清以免被"优化"掉）**：
1. **路径差异**：参照站是 `/nodes/{node_id}/table/import`（不带 canvas）；我方统一挂
   `canvases/{canvas_id}/nodes/{node_id}/...`，与本域所有节点写操作同形状，且一次校验
   "节点属于该画布且属于该 space"。
2. **解析器不复用剧本域的 `parseScriptFile`**：那个产物是扁平的制表符文本（服务"把小说读成
   一段文本"），表格节点要的是按工作表/按行列的结构。两者输出契约不同，硬合并会让一方变形。
   共享的只有 `common/base64.ts`（base64 上传解码）。
3. **容量上限**（`TABLE_LIMITS`）：≤20 Sheet、每表 ≤2000 行 × 60 列、单元格 ≤500 字符、
   全工作簿 ≤60000 单元格。理由：表格节点是"排期/台词清单"，不是数据仓库；不限量会把 JSONB
   参数撑到几十 MB，之后每次整图 commit 都要搬它——拿画布主路径给导入擦屁股。
4. **票据与落库**：解析结果暂存 Redis（`canvas:table:import:{token}`，TTL 30min），
   confirm 时取；票据过期返回 **400102** 并提示重新导入（区别于"节点坏了"）。
5. **写库时 `canvas_nodes.version + 1`**：这是服务端发起的内容变更，客户端若还持有旧 version，
   后续单节点 PATCH 会被 **746002** 拦下而不是静默覆盖。但**不动 `canvases.version`**——
   整图提交才是画布级变更，导入仍属"编辑态数据"。
6. **前端必须用 confirm 的返回值覆盖本地参数**：否则下一次 commit 会用旧参数把导入结果冲掉。
7. `confirm` 会把 `sheet_selection_required` 置 `false`；用户之后切 `active_sheet_id` 时，
   全部 Sheet 的行数据都在 `table.sheets` 里（离线可切换，不需要重新导入）。

#### 14.4.5 节点产物批量下载（2026-10-26，迁移 0016）

| 方法 | 路径 | 请求 | 响应 | 关键码 |
|---|---|---|---|---|
| POST | `/canvas/canvases/{id}/nodes/batch-download` | `{node_ids[]}` ≤50 | `{download_list_id, node_count, file_count, filename, status}` | 0/400101/400102 |
| GET | `/canvas/canvases/{id}/download-lists` | `?page&page_size` | `{list[], total, page, page_size}` | 0/400102 |
| POST | `/canvas/canvases/{id}/download-lists/{list_id}/url` | — | `{url, filename, file_count, expires_in:86400}` | 0/400102 |

**为什么要落"下载单"而不是直接返 URL**：签名链接 24h 过期，用户常常第二天才来下载；
只返一次性链接的实现，过期后同一批文件就再也取不到了。下载单只存 `object_key`，
每次 `…/url` 现签一条新的。

**实现约定**：
1. **路径差异**：参照站是 `/canvas/node/batch-download*`（不带 canvas）；我方挂
   `canvases/{canvas_id}/...`，与本域写操作同形状，并一次校验节点归属。
2. **产物来源两级**：节点 `params.result_uris`/`result_uri` 优先，缺失时回查 `tasks.results`
   （老数据/service 只写了任务结果的场景）。两级都是真实数据，不做猜测。
3. **假协议不入包**：`mock://` 这类非 http(s)、非存储 key 的 URI 直接跳过，
   不塞空文件冒充；单个文件读不到也不阻断整包（`manifest.json` 里会缺该条）。
4. **打包同步做**：用户已付费生成的文件只是收拢，同步做能把"某个文件读不到"当场反映到
   manifest 里，而不是丢个后台任务让用户等一个可能永远不完成的下载单。
5. **`manifest.json` 必带**：记录每个文件来自哪个节点（node_id/node_type/name），
   否则用户拿到一堆 `image-108…-1.png` 无法回溯。
6. **`.zip` 必须声明 `application/zip`**：`files/local` 的 content-type 表原先没有 zip，
   会退化成 `application/octet-stream`，部分浏览器直接内联展示乱码。

#### 14.4.6 文本类派生（剧本优化 / 拆解分镜 / 拆分资产，2026-10-26）

| 方法 | 路径 | 请求 | 响应 | 关键码 |
|---|---|---|---|---|
| POST | `/canvas/canvases/{id}/nodes/{node_id}/script-optimization` | `{source_text?, prompt?, model?}` | `{task_id, status, credits_estimate, node}` | 0/400101/400104/745701/745801 |
| POST | `/canvas/canvases/{id}/nodes/{node_id}/storyboard-parse` | 同上 | 同上 | 同上 |
| POST | `/canvas/canvases/{id}/nodes/{node_id}/asset-extraction` | 同上 + `{active_tab?: character\|scene\|prop}` | 同上 | 同上 |


> `asset-extraction` 的 `active_tab` 与参照站一致：用户停在哪个 tab 就优先出哪一类资产，
> 避免一次给三屏 JSON 让人分不清"现在看的是哪一类"。产出必须是**可解析 JSON**
> （`{characters[],scenes[],props[]}`），前端据此一键建 asset 节点（`assetKind/prompt` 一并带过去）。

**能力模型（为什么能落地而不写死价格）**：
- 新增两个 `tasks.mode`（`TextMode`：`script_optimization` / `storyboard_parse`），
  模型目录里 `deepseek-v4-pro.modes` 声明它们，`resolution_options` 用 **`per_call`**
  表示"按次计价"（不是分辨率）；
- 价目在 `model_prices`：`resolution='per_call'`、`duration_s=NULL`、`credits` 由运营在
  `/ops/admin/model-prices` **新增/修改**；代码只发 mode 与计价单位，**不出现金额常量**；
- 执行：模型 `adapter_code=deepseek:chat` 是**同步**适配器，worker 收到 `sync_results`
  直接置成功；mock 模式同样返回文本（按 mode 给不同结构），不会返回 `.mp4` 的假结果；
- 结果回写：worker → `canvas_nodes.params.result_text`；前端轮询到成功即显示，
  与图片/视频节点的回写路径一致（不搞第二套）。

**四条实现约定**：
1. **原文来源**：`params.sourceText`（剧本节点检查器里的字段）优先；不传 `source_text` 就用节点原文——
   前端不要把正文再搬一遍，否则会出现"节点改了、请求里还是旧的"。
2. **`prompt` 是"额外要求"不是原文**：混用会导致用户写一句"镜头少一点"，系统把这句话当剧本送去优化。
3. **超 5 万字 → 400104**（契约既定码）。zod 只挡明显异常的巨型请求（20 万字符），
   同一条规则不能有两个错误码。
4. **只允许 script/text/director 节点**：其他节点没有"原文"这个概念，400101。

#### 14.4.7 分镜 × 资产匹配（2026-10-26）

| 方法 | 路径 | 请求 | 响应 | 关键码 |
|---|---|---|---|---|
| POST | `/canvas/canvases/{id}/nodes/{node_id}/storyboard-asset-match` | `{storyboard_node_id?, scene_node_ids?[], character_node_ids?[], model?}` | `{task_id, status, credits_estimate, node}` | 0/400101/**400105**/745701 |
| POST | `…/storyboard-asset-match/cancel` | `{task_id}` | `{ok:true, task_id}` | 0/400102/**400103** |
| POST | `…/storyboard-asset-rematch` | `{task_id?, 同 match}` | `{task_id}` | 0/400105/745701 |

**语义**：把「拆分资产」抽出的角色/场景/道具，按镜头对到分镜上（仍是**一条 `tasks`**，
同脊柱、同按次计价、可取消、可重跑）。

**四条约定**：
1. **候选资产来源**：显式 `character_node_ids`/`scene_node_ids` 优先；不传则用本画布全部 `asset` 节点。
2. **400105 = 引用资产未定稿**：资产节点没有 `prompt` 就等于"没定稿"，拿空名字去匹配只会得到错配，
   比直接报错更糟（与契约 §3.4 的 `ASSET_NOT_READY` 语义一致）。
3. **分镜文本**：显式 `storyboard_node_id` 优先，否则用当前节点的 `result_text`，再退 `sourceText`；
   都没有 → 400101 并提示先跑 `storyboard-parse`。
4. **取消/重跑**：取消**复用 `tasks.cancel`**（终态不可取消 → 400103，解冻与事件只该有一份实现）；
   重跑**建新任务、不覆盖旧任务**（用户要能对比两次匹配）。
**已知边界**：整图提交在千级节点会变慢（需换增量 diff）；`/canvas` 首帧空白属 `ssr:false` 预期行为（见 `_acceptance/_gap/canvas-frontend-baseline.md`）。

#### 14.4.8 视频拆解（`video-parse`，2026-10-26）

> **参照证据**：`rea-reelmate/routes.txt:370-371`（两条路径存在）；`rea-reelmate/capture-canvas.json`
> 内联 bundle 的请求配置（POST `requestBodyType=json`、`queryNames=[]`；GET `requestBodyType=query`、
> `paramNames=[canvas_id,node_id,task_id]`）；`VideoNode` 组件 emits `video-parse`，任务
> `task_type=video_parse`，结果落节点 `result.videoParse`，成功后画布上生成资产表/文本节点。
> **未取证**：请求体字段名（bundle 的 `requestDataJsonSchema` 为空）、响应内层结构、按秒计费策略
> → 按 ADR-013「对齐行为、不对齐字段名」协议自研；金额由价目表决定，不做代码常量。

| 方法 | 路径 | 请求 | 响应 | 关键码 |
|---|---|---|---|---|
| POST | `/canvas/canvases/{id}/nodes/{node_id}/video-parse` | `{object_key?, prompt?, model?}` | `{task_id, status, credits_estimate, node}` | 0/400101/745701 |
| GET | `…/nodes/{node_id}/video-parse/{task_id}` | — | `{task:{task_id,status,progress,results,error}}` | 0/400102 |

**语义**：把视频节点上的视频「拉片」成可复用的**角色 / 场景 / 道具**（与「拆分资产」同形），
仍是一条 `tasks`（`mode=video_parse`、按次计价、可取消、可重跑），结果由 worker 写回
`canvas_nodes.params.result_text`，前端复用同一套候选列表与「一键建资产节点」。

**四条约定**：
1. **视频源**：显式 `object_key` 优先；否则取节点自身产物（`params.result_uri` →
   `result_uris[0]` → `object_key`/`video_uri`/`fileId`）。都没有 → **400101**：
   没有视频就去拆解，只会得到"看起来成功、其实全是编的"结果，比直接报错糟得多。
2. **只接受 `video` 节点**：其他类型 → 400101（文本节点没有视频）。
3. **产出只含三类资产**（`characters/scenes/props`，每项 `name/description/prompt`）：
   镜头表在参照站是 `storyboard-parse` 的另行产物，未取证的部分不臆造。
4. **计价**：`model_prices` 里 `mode='video_parse'`、`resolution='per_call'`、`duration_s=NULL`；
   运营可在 `/ops/admin/model-prices` 调整（参照站按视频秒数计费属其定价策略，我方做成可配置项）。

**未真实联调（X5 标注）**：真实供应商下"视频被模型看到"需要抽帧/音轨链路，本轮只落
mock 形状一致的产出（产出 JSON 与真实路径同形）；接真实能力时补 ffmpeg 抽帧 + 多模态调用，
本契约不变。

### 14.5 `cam` 与 `film` 端点族要点

| 域 | 要点 |
|---|---|
| `cam` | 团队=`spaces(type=2)`；`team_id`→`space_id`、`wsid`→`user_id`。积分分配/回收**成对写 `credit_flows`**（`team_allocate_out/in`、`team_recover_out/in`）并填 `ref_space_id/ref_user_id/op_user_id/group_id` 四列——否则 `points-flow` 的 8 个筛选参数无处可查 |
| `film` | 仿多维表格：table→fields→rows→cells；行级 CAS 冲突用 746002；**审核流无独立写端点属已知缺口（A3）**，F2 需决定补端点或接受只读；导入 A11 亦无状态查询端点。字段 9 种：`text/asset_ref/link/user/date/canvas_ref/task_status/review_ref/points_ro`；`is_unique_type` 语义是"每 type 每表至多一个" |

#### 14.5.1 `cam` 已实现端点（2026-10-26，迁移 0013）

> 与参照 `/web/v1/cam/*` 的**命名对齐但协议自研**（ADR-009）。v2.6 起已实现 **25 个**（其余按需补齐）：

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/cam/team` | 登录 | **创建团队**（建 `spaces(type=2)` + 积分账户 + owner/master 成员 + 内置 11 角色），对齐参照"去开通" |
| GET | `/cam/teams/mine` | 登录 | 我所属的全部空间（个人+团队），前端空间切换用 |
| GET | `/cam/team/info` | 成员 | 团队信息（席位/已用/积分池=`credit_accounts.balance`） |
| PATCH | `/cam/team/info` | 特权 | **改团队设置**：`{name?, max_seats?, film_enabled?, agent_whitelist?}`；仅团队空间可改（个人空间→400101）、席位不得低于现有成员数 |
| GET | `/cam/permission/user` | 成员 | 当前用户角色与特权（`privileged` 按码集算） |
| GET | `/cam/role/list` | 成员 | 角色列表（首次访问按内置 11 级幂等初始化） |
| GET | `/cam/team/groups` | 成员 | 分组列表 |
| POST | `/cam/team/group` | 特权 | 建分组（禁跨 space 的 parent→400101） |
| PATCH | `/cam/team/group/{id}` | 特权 | 改分组 |
| DELETE | `/cam/team/group/{id}` | 特权 | 删分组（有子组/成员时拒绝） |
| GET | `/cam/team/group/{id}/stats` | 成员 | **分组统计**：`{member_count, task_count, points_used, points_allocated}`；消耗只算本团队空间内该组成员的任务 |
| GET | `/cam/team/members` | 成员 | 成员列表（支持 group/role/status 过滤 + 分页） |
| GET | `/cam/team/member/{user_id}` | 成员 | **单成员详情**（与列表同 DTO，避免两处字段漂移） |
| PATCH | `/cam/team/member/{user_id}` | 特权 | 改成员（角色/分组/状态；禁止停用 owner） |
| PATCH | `/cam/team/member/{user_id}/name` | 本人/特权 | **改成员昵称**（团队内展示名）；本人改自己、管理员改他人 |
| DELETE | `/cam/team/member/{user_id}` | 特权 | 移除成员（禁止移除 owner） |
| POST | `/cam/team/points-allocation` | 特权 | **团队→成员**分配（成对记账 + `credits_quota` 增长） |
| POST | `/cam/team/points-recovery` | 特权 | **成员→团队**回收（成对记账 + 配额回落） |
| POST | `/cam/team/batch-points-allocation` | 特权 | **批量分配**（≤50，**逐条独立**：一条余额不足不连累其它，返回 `items[{user_id,ok,code?,...}]`） |
| GET | `/cam/team/points-flow/list` | 成员 | 团队积分流水（kind/target/group/op 四维筛选） |
| GET | `/cam/team/points-flow/export` | 成员 | **流水导出**（CSV，现签链接 1h，单次 ≤5000 行；筛选参数同 list） |
| GET | `/cam/team/account-points-ranking` | 成员 | 成员已分配额排行 |
| GET | `/cam/project/{project_id}/members` | 成员 | 成员↔项目作用域 |
| POST | `/cam/project/{project_id}/members/bind` | 特权 | 绑定（含 `participation_type`） |
| POST | `/cam/project/{project_id}/members/delete` | 特权 | 解绑 |

**偏离说明**：
1. 参照用 `/cam/team/{team_id}/info` 把 team_id 放路径；我方**省略**，因为 `X-Space-Id` 已表达当前空间（ADR-010），路径带 ID 会产生"路径 ID 与头不一致"的二义性。
2. 席位上限错误码为新码 **400108**（参照侧未见同义码，属我方自造，已在码表登记）。
3. 仍**未实现**（不暴露空壳）：`project-points-flow/*`（项目维度流水，需先定"项目"与 `credit_flows` 的映射口径）、`project-points-ranking`、`team/temp-info`（模型开关矩阵，待取证）、`linked-users`、`user/third/key/*`（BYOK，待取证）。
   **不适用**：`member/:id/password`、`member/batch/change-password`、`member/:id/credential`——我方账号是手机号+短信验证码，没有密码/一次性登录凭证这套语义；为对齐而造一个"假密码"只会多一条无人使用的攻击面。

#### 14.5.2 `X-Space-Id` 切空间已落地（2026-10-26）

`AuthGuard` 现在支持请求头 `X-Space-Id`：

| 情况 | 行为 |
|---|---|
| 未带该头 | 用 token 里的 `sid`（登录时的个人空间），行为与之前完全一致 |
| 带了且等于 `sid` | 同上 |
| 带了且 ≠ `sid` | **校验 `space_members` 成员关系**（status=1）与 `spaces.status≠停用`，通过后以该 space 为请求上下文 |
| 带了但不是成员 | **403101** + `data.reason=not_member`（不能只信客户端头） |
| 带了非法 ID | **400101**（field=`X-Space-Id`） |

> 这使团队场景成立：同一个 access token，前端通过 `X-Space-Id` 在"个人空间/多个团队"之间切换，服务端每次校验成员身份。前端持久化在 localStorage（`active_space_id`），由 `useApi` 自动附加。

### 14.6 SSE 协议（`agent` 与画布内对话共用）

| 项 | 约定 |
|---|---|
| 传输 | `GET .../stream`；**不是原生 EventSource**，客户端用 fetch + 手写 SSE 解析（与参照一致） |
| 鉴权 | `Authorization: Bearer`；**另需短时效 stream-token**（见下） |
| 帧结构 | `{id, type, payload}`；`payload.type` 会被提升为消息 type |
| 已知事件字面量（**仅 6 个，不保证全集**） | `ping`、`heartbeat`、`user_message`、`hitl_required`、`model_step.*`、`skill_status.*` |
| 心跳 | `ping`/`heartbeat` 客户端忽略 |
| 续传 | `?last_stream_id=<id>` 增量重放；游标过期 → **746004**，客户端全量重建 |
| 退避 | 指数退避 `maxAttempts=5 / base=1s / max=30s` |
| 与轮询关系 | **SSE 是通知加速器，不是状态存储**；结果以 `tasks.results` 为准；无条件回退 5s 轮询（ADR-012） |
| 落库 | `agent_events` **必须持久化**（否则续传不可实现），默认保留 7 天 |
| 首连不重放 | 无 `last_stream_id` 时只推"从现在起"的新事件：消息已由 `GET …/messages` 拉全量，重放会造成重复 |
| 服务端收尾 | 任务流进终态（3/4/5/7）后服务端 `end()`，避免前端挂一条永不断的连接 |

> **`POST /agent/stream-token` 实装形态（2026-10-26）**：`{token, expires_at, ttl_s}`，TTL **120s**，
> 只用查询参数 `?stream_token=` 或普通 Bearer 二选一（`AuthGuard` 统一校验，audience=`agent-stream`）。
> **偏离原设计的点**：原写"一次性 ≤60s"。一次性会让**每一次断线重连都必然 401**，而 ADR-012 明确要求
> 断线可回落、可重连；故改为短 TTL 可复用 + 可选绑定 `session_id`（签令牌前校验会话归属，
> 防止拿 A 会话的令牌去连 B）。令牌与 access token 的 audience 不同，两套互不可用。

### 14.7 限流（四域新增基线）

| 端点组 | 用户级 | 备注 |
|---|---|---|
| `POST /canvases/{id}/nodes`、`batch-*` | 120/分 | 画布高频写入 |
| `POST .../nodes/{id}/lock\|renew` | 60/分 | 心跳 15s 一次，留余量 |
| `GET .../stream` | 5 并发 | 每会话 |
| `POST /agent/task/chat` | 10/分 | 同 generations |
| `cam/team/member/batch` | 5/分 | 批量邀请/改密 |
| `film/.../cells`（批量写） | 120/分 | 表格编辑 |
| 四域其余 GET | 120/分 | 同 §13 |

### 14.8 待取证清单（**不得当事实使用**）

> 2026-10-26 登录态采集（`_acceptance/ref-authed/`，22 页）已关闭部分缺口，逐页结论见
> `_acceptance/_gap/authed-evidence-2026-10-26.md`。下表区分「已取证/仍待取证」。

| 域 | 项 | 处置 |
|---|---|---|
| canvas | ~~`/mcp` 是否独立页~~ | ✅ **已取证**：登录态渲染首页（首页案例标记 7 处 vs MCP 3 处）→ **不是独立页**，按"首页内入口"处理，不为它设计路由 |
| canvas | ~~`/workflow-canvas` 是否重定向~~ | ✅ **已取证**：独立页但空态极简（正文 103 字；DOM 50KB vs `/task` 115KB），非重定向 |
| canvas | ~~节点工具栏构成~~ | ✅ **已取证**：`文本/表格/图像/视频/音频/视频合成/剧本拆资产/剧本拆分镜` + `Skill` |
| canvas | SSE 完整事件类型表（仅 6 个已见字面量） | 仍待取证 |
| canvas | 模板 `payload` 结构、`comment-nodes`/`pin-groups` 产品语义 | 仍待取证 |
| canvas | `GET /df/canvas/canvas-scaffold`（运行时实发但 routes/bundle 均无） | **不设计契约**，仅登记（裁决 D4） |
| agent | ~~Skill 卡结构~~ | ✅ **已取证**：6 张卡（武侠短片全流程/萌宠旅行Vlog/赛博CG动画/第一人称/废土风格/柔焦胶片），tabs `Skills/收藏/我的` |
| agent | `agent/home/resource/*` | 仍待取证 |
| cam | ~~团队表格列定义~~ | ✅ **已取证**：`成员/账号/角色/成员组/参与项目形式/当前积分/状态/备注`（8 列）→ 已补 `team_member_projects.participation_type` |
| cam | `user/third/key/*`（BYOK 雏形）、席位档位 `max_seats` | 仍待取证 |
| cam | 团队积分分配/回收的界面流程 | 仍待取证（需已开通团队且有成员的账号） |
| film | `config_json` schema、唯一性执行层、审核流写端点（A3）、导入状态查询（A11） | 标假设；A3/A11 为已知功能缺口，F2 决策 |
| film | 影视版任务表格**整体形态** | 仍待取证（需影视版内测账号；当前 `/film` 只有空壳） |
| billing | ~~兑换码位置~~ | ✅ **已取证**：兑换码是 `/pricing` 的一个 tab（`订阅会员/积分加购/兑换码`），**不是独立页面** |
| 全局 | `/setting` 渲染为资产页、`/creator-center` 加载失败 | 仍待取证（前者需交互探测，后者需创作者资质账号） |

### 14.9 `agent` 端点族（对话式创作，2026-10-26，迁移 0015）

> 归属按裁决 D3：`agent-skills` 8 条属 `ops` 内容运营，**不计入本域**。
> 本节记录**已实现**的 20 条：`agent` 本体 9 条 + 画布内对话（C7）11 条。
> 与参照站 `routes.txt:123–134`（12 条）的差值见 §14.9.3「未实现与理由」。

#### 14.9.1 `agent` 本体（`/v1/agent`，9 条已实现）

| 方法 | 路径 | 权限 | 请求 | 响应 | 关键码 |
|---|---|---|---|---|---|
| POST | `/agent/task/create-check` | U,S | 同 `generations` 请求体 | `{ok, credits_estimate, blockers[], normalized_options}` | 0/400101/745701 |
| POST | `/agent/task/create` | U,S | 同 `generations` + `session_id?`；需 `Idempotency-Key` | `{task_id, status, credits_estimate, session_id?}` | 0/400100/400101/745701/745702/745703/745801 |
| GET | `/agent/task/{task_id}` | U,S | — | `{…task, input, options, task_events[]}` | 0/400102 |
| PUT | `/agent/task/{task_id}` | U,S | `{title?, feedback?{reaction,comment}}` | `{…task, title, feedback}` | 0/400102/400101 |
| POST | `/agent/task/chat` | U,S | `{session_id?, content, content_type?, wait?}` | `{message_id, stream_id, queued}` | 0/400100/400102/746005 |
| POST | `/agent/task/chat-end` | U,S | `{session_id}` | `{ok, session{status:2}}` | 0/400102 |
| GET | `/agent/task/stream` | U,S | `?task_id=` | **`text/event-stream`**（§14.6） | 0/400102/400101 |
| POST | `/agent/task/batch-download` | U,S | `{task_ids[] ≤50}` | 同 `/tasks/batch-download` | 0/400101 |
| POST | `/agent/stream-token` | U,S | `{session_id?}` | `{token, expires_at, ttl_s}` | 0/400102 |

#### 14.9.2 画布内对话（C7，11 条已实现）

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/canvas/canvases/{id}/chat/sessions` | `?page&page_size` | `{list[{session_id,title,status,scope,message_count,last_message_preview,…}],total,page,page_size}` |
| POST | `/canvas/canvases/{id}/chat/sessions` | `{title?}` | `{session}` |
| PATCH | `/canvas/canvases/{id}/chat/sessions/{sid}` | `{title?, status?}` | `{session}` |
| DELETE | `/canvas/canvases/{id}/chat/sessions/{sid}` | — | `{ok:true}`（软删） |
| GET | `/canvas/canvases/{id}/chat/sessions/{sid}/messages` | `?after_event_id&page_size` | `{list[], next_event_id, has_more}` |
| POST | `/canvas/canvases/{id}/chat/sessions/{sid}/messages` | `{content?, content_type?, reference_node_ids?, decision?, wait?}` | `{message_id, stream_id, queued}` |
| GET | `/canvas/canvases/{id}/chat/writing-outputs` | `?page&page_size` | 历史产出（助手给过可落地节点的消息） |
| POST | `/canvas/chat/sessions/{sid}/read` | `{last_read_seq}` | `{unread_count}` |
| GET | `/canvas/chat/sessions/{sid}/stream` | `?last_stream_id` | **`text/event-stream`** |
| POST | `/canvas/chat/sessions/{sid}/messages/{mid}/reaction` | `{reaction:like\|dislike\|none}` | `{ok:true}` |
| POST | `/canvas/chat/sessions/{sid}/messages/{mid}/node-binding` | `{node_ids[], binding_kind?}` | `{bound}` |

**四条实现约定（写清以免被"优化"掉）**：

1. **`after_event_id` 是不透明游标**：值就是"上一批最后一条消息的 `seq`"。
   参照站的参数名指向事件 id，但消息与事件并非 1:1；把游标定义成消息 seq 既保持了参数名对齐，
   又不必为分页引入映射表。SSE 续传走的是真实的 `last_stream_id`，两者互不干扰。
2. **消息与事件是两次写入**（非同一事务）：ADR-012 规定 REST 是权威、SSE 只是加速器，
   漏一帧可由 `GET …/messages` 补齐；把两张表塞进一个事务会让事件表承担消息表的锁竞争。
3. **seq 用 `pg_advisory_xact_lock` 串行分配**：`MAX(seq)+1` 并发下会撞唯一键并抛 500——
   那是把并发问题丢给用户。消息序与事件序是两条独立的单调轴。
4. **决策（HITL）允许空正文**：`{content:"", decision:{…}}` 合法。点"同意"不该凭空造一句
   用户台词写进会话记录；落库时记为 `[approve]`/`[reject]` 前缀 + 可选补充说明。

#### 14.9.3 未实现与理由（**不暴露空壳**）

| 端点 | 处置 | 理由 |
|---|---|---|
| `GET /agent/home/resource/{info,recommend,sse}`（3） | **不实现** | 属首页内容流（假设项 A-05），依赖内容运营表，RE 只有端点名无响应体；为"可能不存在的内容模型"设计表 = 凭空造数据 |
| `GET /agent/stt-token`（1） | **不实现** | 需要 STT 供应商凭据与适配器；当前无 STT 能力，返回假 token 会让前端"看起来能用" |
| `GET /agent/task/share/{share_id}/sse`（1） | **待接** | 公开分享流可复用 `tasks.publicShare` + 同一 SSE 通道，但需先定"分享者订阅他人任务进度"的权限语义（当前无证据），故未仓促放开 |
| `GET /agent/task/stream` 的 POST+raw 形态 | **改为 GET `?task_id=`** | 参照站 bundle 声明为 POST+raw，但 body 内容未取证（A-05/G-12）；SSE 用 GET 才有原生 `Last-Event-ID` 语义。差异已登记，若后续取证到必要的 body 再改 |

**实现落点**：`apps/api/src/modules/agent/`（7 service + 2 controller，模块依赖方向见该目录 `agent.module.ts` 头注释）；
LLM 复用 `script` 域的 `LlmService`（`LLM_MODE=mock|real` 单一开关，mock 为**规则式路由**而非假 AI）；
任务一律经 `generations`/`tasks` 服务，**不碰 billing、不另造任务表**。






---

### 14.10 `kds` 端点族（团队数据看板，2026-10-27）

> 对照参照产品 `/web/v1/kds/da/*` **13 条**（`routes.txt` 的 kds 段）+ 页面 `/team/dashboard`（`rt:91`）。
> **纯读聚合，不新建表**：数据源全是既有表（`credit_flows` / `credit_accounts` / `tasks` / `space_members` / `spaces`）。
> 实现落点：`apps/api/src/modules/kds/`（module + controller + service）；页面 `apps/web/pages/team/dashboard.vue`。

#### 14.10.1 端点（13 条）

| # | 方法 | 路径 | 语义 | 权限 |
|---:|---|---|---|---|
| 1 | GET | `/kds/da/canvas/total-point-consume` | 画布总消耗（只算无 `episode_id` 的任务，即非流水线） | 成员 |
| 2 | GET | `/kds/da/team/{team_id}/basic-info` | 团队信息 + 成员数 + 池余额/冻结 | 成员 |
| 3 | GET | `/kds/da/team/{team_id}/point-consume-rank` | 按成员消耗排名（降序，rank 从 1） | 成员 |
| 4 | GET | `/kds/da/team/{team_id}/member-participate-detail` | 成员参与明细（任务数/成功/失败/消耗/最后活跃） | 成员 |
| 5 | GET | `/kds/da/team/{team_id}/point-manage-flow` | 积分分配/回收流水（`kind=adjust`） | 成员 |
| 6 | GET | `/kds/da/team/{team_id}/project-data/basic-info` | 按剧集聚合的任务与消耗 | 成员 |
| 7 | GET | `/kds/da/team/{team_id}/project-data/query` | 同 6（保留独立路径以便覆盖核对） | 成员 |
| 8 | GET | `/kds/da/team/{team_id}/project-data/export` | 导出 CSV（剧集维度） | 成员 |
| 9 | GET | `/kds/da/team/{team_id}/project-member-point-detail?episode_id=` | 某剧集内各成员消耗 | 成员 |
| 10 | GET | `/kds/da/team/{team_id}/query` | **看板首屏聚合**（basic + kpi + rank + canvas + projects，一次取完） | 成员 |
| 11 | GET | `/kds/da/team/{team_id}/query/export` | 导出 CSV（成员维度） | 成员 |
| 12 | GET | `/kds/da/team/member/{op_user_id}/point-consume-detail` | 某成员消耗流水明细 | 成员 |
| 13 | GET | `/kds/da/team/member/{op_user_id}/point-quota-detail` | 某成员配额（quota / 已分配 / 已消耗 / 剩余） | 成员 |

#### 14.10.2 四条口径（写清以免被"优化"掉）

1. **「消耗」只认 `kind='settle'`**：`freeze` 只是占用（失败会解冻），把它算进消耗会让看板数字虚高且与 `GET /credits/flows?tab=consume` 对不上。
2. **消耗人必须 join `tasks`**：`credit_flows` **没有** `user_id` 列，只有 `op_user_id`（分配操作者）与 `ref_user_id`（分配目标）。按人聚合一律 `innerJoin(tasks, credit_flows.ref_task_id = tasks.id)` 后按 `tasks.user_id` 分组——用 `leftJoin` 会把无主流水错归到别人头上。
3. **成功率分母是「已终态」**：`status in (3,4,5,6)`，不含 PENDING(1)/RUNNING(2)。否则跑批中途看板永远偏低，运营会误判。
4. **`team_id` 必须等于 token 空间**：路径参数与 `X-Space-Id` 双向校验，不一致一律 `403101`（且不泄露该 space 是否存在）。只信 token 会让路径参数变成摆设，只信路径则越权。

#### 14.10.3 与参照站的差异（偏离说明）

| 差异 | 参照站 | 我方 | 理由 |
|---|---|---|---|
| 聚合端点 | 无（首屏由前端连打多个） | 新增 `GET .../query` | 首屏 6 个请求会放大冷启动延迟；这是**新增**不是替换，13 条对齐端点全部保留 |
| CSV 导出响应 | 未取证（`project-data/export` 无响应体样本） | `text/csv` + BOM，不包信封 | 与既有 `admin/failed-tasks.csv` 一致；二进制/文本流包信封会破坏客户端解析 |
| `project-data/query` | 应有筛选参数（未取证） | 暂时与 `basic-info` 同实现 | 筛选语义待取证（§14.8），先保证端点存在且行为可解释，不臆造参数 |
---

## 15. 第 1 轮新增端点总则（2026-10-27 · 六个批次 + 三个横切件）

> 本轮一次推进 6 个批次（第 1/2/3/4/5/7 批）+ 3 个横切件（数据层收尾、幂等账本、订阅制）。
> 端点总数 236 → **414**，页面 29 → **48**，表 49 → **96**，迁移 0000–0022。
> 本节只写**契约与偏离**；逐条竞品证据在 `_acceptance/_team/report-*.md`（含 `文件:行`）。

### 15.0 三条全局约定（本轮所有新端点共用）

1. **路径前缀按域切分**（ADR-009）：竞品 `df/novel/*` → 我方 `/v1/novel/*`；竞品 film 域 → `/v1/film/*`；resource/subject 域 → `/v1/subjects/*`、`/v1/extraction/*`，项目级动作留在 `/v1/projects/:id/...`。
2. **信封不手写**：业务数据裸返回，`EnvelopeInterceptor` 包 `{code:0,data}`；业务错误抛 `AppError` → HTTP 200 + `code≠0`。
3. **写操作幂等**：登录态写操作支持 `Idempotency-Key` 头（见 §15.9）；工具/批量类写操作另有各自的确定性去重键（见各节）。

### 15.1 小说改编链（第 2 批 · 64 路由 · `/v1/novel/*`）

| 子链 | 路由（相对 `/v1/novel`） | 语义要点 |
|---|---|---|
| 本子 | `POST /`、`GET /list`、`GET /:nt`、`PATCH /:nt`、`DELETE /:nt` | 删除=**归档**（软删）；`status=16` 为已定稿，定稿后写正文类接口一律 400100 |
| 分章 | `POST /:nt/split`、`GET /:nt/chapters`、`GET /:nt/chapters/:chapter_no` | 重新分章**幂等**：chapter id 稳定（同内容不重建行） |
| 内容分析 | `POST /:nt/content-analysis`、`GET .../detail`、`GET/PUT .../worldview`、`POST .../novel_character_cards/generate`、`/confirm`、`POST .../novel_character_cards`、`PATCH/DELETE .../:ncc_id` | 重跑不产生重复卡；`confirm(overwrite=false)` 已确认卡跳过 |
| 章节大纲 | `POST /:nt/chapter_outline/generate`、`GET .../list`、`POST /:nt/chapter_outline`、`PATCH .../:nco_id` | 整体替换会删多余行（与竞品"提交全量"一致） |
| 分集大纲 | `POST /:nt/episode_outline/generate`、`GET .../list`、`POST /:nt/episode_outline`、`PATCH .../:neo_id` | — |
| 核心角色 | `POST /:nt/core_character/generate`、`GET .../list`、`POST /:nt/core_character`、`PATCH .../:ncc_id` | `is_core` 由生成链自动标记 |
| 剧本 | `POST /:nt/script-generate`、`GET /:nt/episode/list`、`GET/PATCH /:nt/episode/:ne_id`、`POST .../:ne_id/confirm` | 指定集号生成时 `missing[]` 显式回显未生成集；单集 PATCH 产生新版本 |
| 汇总/定稿 | `GET /:nt/summary`、`POST /:nt/finalize`、`GET /:nt/version/list` | `finalize` 幂等；定稿后 `status=16` 才能被拆集引用 |
| **编辑 Agent** | `POST .../script_edit_agent/enter|exit|heartbeat`；`GET/POST /sessions`；`POST /sessions/switch`；`GET /sessions/:sid`；`POST /sessions/:sid/chat|abort`；`GET/POST /sessions/:sid/episodes/:ne_id/pending|apply|reject`；`POST /sessions/:sid/apply_all|reject_all`；`POST /sessions/:sid/version/:vid/finalize`；`DELETE /sessions/:sid/version/:vid/delete` | **逐集 diff**（original/proposed/change_summary）；`chat` 不改正文，`apply` 才写 + 落 `novel_script_versions`；`reject` 正文零改动；同会话并发 chat → `746005`；`abort` 无在途轮次返回 `aborted:false`（不假装成功） |
| 创意裂变 | `POST /:nt/fission_script`、`GET/POST .../idea*`、`.../characters`、`.../summary_outline`、`.../episodes_outline`、`.../episodes` | 未选定方案就生成总纲 → 400101（顺序闸门） |
| 海外改编 | `POST /:nt/overseas`、`GET /:nt/overseas` | 幂等键 = 源本 + lang + region |
| 制片衔接 | `NovelService.assertSplittable(spaceId, ntId)` | 未定稿 → 400100 `details.reason=not_finalized`；跨 space → 403101；不存在 → 400102 |

**偏离与待取证**：`meta` 承接 `source_text`/`fission.*`/`overseas.*`（数据层无对应列）；`reject` 的 reason 落 `session.context.decisions[]`（`novel_edit_pendings` 无 reason 列）；竞品 `content-analysis` 字段名、`heartbeat`/`switch` 的 body 未取证；`original_script/*` 14 端点与 `point/permission/group/adjust/import` 8 端点**未实现**（不在本批必做子链）；撤回定稿（reopen）未实现。

### 15.2 影视版 film（第 5 批 · 49 操作 · `/v1/film/*` + `/v1/func-whitelist`）

| 子域 | 操作数 | 路由要点 |
|---|---:|---|
| 任务表 | 8 | `task-tables` CRUD + `apply-template` + `ensure-presets` + `import` + `reorder` |
| 字段 | 6 | `fields` CRUD + `reorder` + `batch-restore`；**11 种 field_type**，`task_status`/`review_ref`/`points_ro` 拒写 |
| 视图偏好 | 2 | `pref` GET/PUT（每人每表一行） |
| 行 | 12 | `tasks` CRUD + `cells`（稀疏 `{field_id:value}`）+ `children` + `status` + `notify-assignees` + `query` + `reorder` + `title-matches` + `unbound-query` + `batch-delete` + `batch-restore`；行版本 CAS → `746002` |
| 审核 | 4 | `review` GET + `comments` + `read` + `tasks/:id/review`（提交，我方新增入口） |
| 行↔画布 | 4 | `tasks/:task_id/canvas-bindings` GET/POST/PUT/DELETE |
| 画布侧 | 5 | `canvases/visible`、`task-panel`、`task-bindings`、`submit-result`（唯一自动化衔接点）、`DELETE canvases/:id`（=解绑不删画布） |
| 模板/导出/最近/统计 | 8 | `task-templates` 3、`exports` 2、`recent-open` 2、`tasks/stats` 1 |
| 准入 | 1 | `GET /func-whitelist?scene=ai_film` → `{check:bool}`（`spaces.film_enabled`，商务开通制） |
| 我方扩展 | 1 | `GET /film/projects`（项目=任务表容器；竞品无 film 项目端点证据） |

**三个机制的实现口径**：① 版本链在事务 + 行锁下分配 `V01/V02`，已决策版本不可改判，驳回再提交得 `V02`；评论挂 `version_id`、已读按 `(version_id,user_id)`。② `submit-result`：校验画布归属 → 校验 asset 同 space → 无绑定自动补绑 → 登记版本 → 行 status 推 3 → 通知。③ 广播总线 + `client_id` 回声抑制（同 client 丢弃、同人异端保留）。

**偏离**：导出为 **CSV/ZIP 而非 xlsx**（不引新依赖，响应显式带 `delivered_format` + `note`）；通知只到广播面（`task_events.task_id` FK 指向 `tasks`，film 行 id 写不进去）故未新造队列；**实时协同只有进程内总线**（仓库无 `@WebSocketGateway`，帧协议未取证，已留 broadcast/subscribe 接口）；无 `film_projects` 表（项目 id 不透明，跨租户 400102）；`points_ro` 返回 null（未结算，不返回假 0）。

### 15.3 主体库 / 抽取 / 资产匹配（第 1 批 · 18 端点）

| 组 | 端点 | 语义 |
|---|---|---|
| 主体库（7） | `POST /subjects`、`GET /subjects`、`GET /subjects/:id`、`POST /subjects/from-asset`、`POST /subjects/status`、`PATCH /subjects/:id`、`DELETE /subjects/:id` | 审核三态 `reviewing/approved/rejected`；**只有 approved 可用于生成**（未过审投递 400105，驳回 `retryable=false`）；`from-asset` 绑原资产、不建资产、幂等 |
| 抽取（6） | `POST /extraction/tasks`、`GET /extraction/tasks/:id`、`POST /extraction/tasks/redo`、`GET /extraction/drafts`、`POST /extraction/drafts/import`、`POST /extraction/drafts/promote` | `task_type` 1..5；四态 1 进行中/2 成功/3 失败/4 失效（源资产被删→失效，不可重试）；`redo` 仅 3/4 态；草稿 `eed_id` 批次 + `parent_state_id` 主子形态 |
| 匹配（5） | `POST /projects/:id/episodes/:eid/match-resources`、`GET .../match-result`、`POST .../match-reset`、`POST .../save-resource-matches`、`POST .../supplement-missing` | `save-resource-matches` 是**完整快照**（漏传类别 400101 且零写入）；`match-reset` 支持 dry-run 预演；`supplement-missing` 7 条件 + 三选项（默认「保持现状」） |

**一致性三闸门**（`script/asset-gates.service.ts`）：定稿（status=2 + 参考图）→ 匹配（match-result 1/2/3）→ 生成（`images[]` 注入 + `[[@imgN]]` 映射）；既有 `reason` 字符串保持不变，只追加 `gate/blocked/retryable` 字段。

**偏离**：竞品「集级 resources 数组」无对应表 → 用「分镜绑定 ∪ 名称提及」投影 + 按类整类替换实现快照（无法保存"无镜提及且未绑定"的资产）；`prompt_blocked` 无列可存 → 恒 false（需迁移）；`images[]` 注入不改原 prompt（另给 `prompt_with_images`）。

### 15.4 创作 Agent 收口（第 4 批 · 12 端点）

| 组 | 端点 |
|---|---|
| Skill 卡市场（9） | `GET /agent-skills`（category/q/page）、`/plaza`、`/mine`、`/favorites`、`POST /agent-skills/:id/favorite`（幂等，body 省略=取反）、`GET /agent-skills/:id`、`GET /agent-skills/details`、`POST /agent-skills`、`DELETE /agent-skills/:id`（软删，仅创建人；平台卡 403、跨空间 404） |
| STT（2） | `GET /agent/stt-token`（无 Key → 200 + `{available:false,reason,fallback:"browser"}`，**绝不 500**）、`POST /agent/stt/transcribe`（`@Public` + 自验 `aud=agent-stt` 票据中继，厂商 Key 不下发浏览器） |
| 推荐卡（1） | `GET /agent-recommend-cards`（最近 30 天项目/资产/会话 → 3~6 张；空态给 4 张兜底卡） |

**33 张平台卡**在 `agent-skills.catalog.ts`（未进 `db/seed.ts`），首次读广场时事务级 advisory lock 按 `config.slug` 幂等 upsert（已存在不覆盖）。

**偏离**：卡片逐卡文案竞品未取证（仅 3 个指令名 + 5 个 tag 有证据），其余自拟；STT 令牌是自有中继票而非厂商凭据（有意偏离）；`volc`/`minimax` 真实 ASR 未接（无文档无凭据）；`/agent/sessions/*` 8 条为我方增补（竞品 `/agent` 无会话 CRUD 路由）。

### 15.5 工具箱 19 卡 + 后处理族（第 3 批 · 1 只读端点 + mode 扩面）

- 新增 `GET /generations/tools`：19 卡 + 15 工具 mode + 参数面板声明，是 `/tools` 与工具工作台的**唯一数据源**（前端不硬编码卡清单）。
- **不新增生成端点**（ADR-003）：`POST /generations` 的 `options` 扩成公共 options 超集（新增 `voice/speed/format/effect/region/strategy/target_fps/timbre/...`，全部 optional 且保留 `.default({})`）。
- 新增 mode（只扩枚举 + 分派 + 报价）：`de_subtitle_auto`、`de_subtitle_region`、`video_slicing`、`fps_duration_unify`、`video_audio_separation`、`audio_timbre_modify`、`video_effects`、`text_repaint`、`auto_bgm`；既有 `lip_sync`/`video_upscale`/`tts`/`text2music`/`text2sfx` 接目录与页面。
- 画布 `CANVAS_MODE_MAP` 补 `video_upscale`（产物=视频；1080p/2K/4K 档位）。
- **`per_call` 计价约定**：14 个工具 mode 用 `model_prices.resolution='per_call'` + `duration_s=NULL`；视频超清是唯一按档位（1080p/2K/4K = 15/30/60）。将来若转按秒，应新增独立哨兵（`per_1k_chars`/`per_minute`）而不是复用 `per_call`。
- **音频上传白名单**（必要跨范围改动）：`POST /assets/upload` 新增 `audio/mpeg`(→.mp3)/`audio/wav`(→.wav)/`audio/mp4`(→.m4a)，落库 `kind=audio`，上限与视频同档 32MB；图片仍 8MB。

**模型目录口径**：`models` 单表同时承载「竞品对齐目录 46 条」与「15 行内部能力行（`toolbox-*`，`visible=false`）」。规则：**列表看 `visible`（`GET /models` 缺省 46 条），按名查找不看 `visible`**（内部编排按名解析始终可拿；用户拿不到不可见模型名故无法自选）。

### 15.6 CLI 与 workflow detect（第 7 批）

- 服务端新增 `GET /v1/workflow/detect?scope=studio|canvas&project_id=&canvas_id=`：只读零写，返回 `{stage, completed[], pending[], missing:[{key,goto_stage}], next_command}`；阶段序 `project → script → asset → storyboard → render`；**studio 只认工坊侧**（`canvas_id` 为空或 `"0"`）。
- `app/apps/cli`：196 条命令 / 37 组（118 可用 + 78 骨架，骨架执行返回 `kind=unsupported` 并说明缺什么）；`{ok,data,links}` envelope、stdout 只出业务数据、退出码 0..10 显式映射（**权限拒绝=1 不是 3**，`error-codes.md:21`）、`--dry-run` 零请求、`--idempotency-key` 透传 + 本地三态账本。
- **MCP 0 行实现**：竞品只有宣传、无工具清单（`SKILL.md`/`manual/` 无 MCP 页），按 ADR-013 不臆造，已在 `--help` 与 README 登记「待取证」。

### 15.7 订阅制与动态价格（第 23 项计费补齐 · 5 端点）

| 端点 | 鉴权 | 语义 |
|---|---|---|
| `GET /billing/plans` | 公开 | 13 档订阅（`skus.kind='vip'`），含活动价 |
| `GET /billing/sku-price?sku=` | 公开 | 牌价 / 活动价 / 折扣来源（对照竞品 `sku-price`） |
| `GET /billing/upgrade-quote?sku=` | 登录 | **升级补差价报价**（只读，不动钱）。口径自定并登记进度文档 §5.4 #1：`折抵 = 当前档有效价 × 剩余天数 / 当前档周期天数`（天数向上取整，对用户有利），`应付 = max(0, 目标价 − 折抵)`。**无生效订阅 / 同档 / 降价** 三种情况一律 `is_upgrade:false` 且 `credit_cents:0`，分别防「没买过也能抵」「反复调用抵到 0」「降级退钱」。下单仍走原价，折抵接入动钱路径待口径确认 |
| `GET /billing/subscription` | 登录 | 当前生效订阅；**无订阅返回 null 而不是 404** |
| `POST /billing/subscribe` | 登录 | 仅接受 VIP sku（充值包 → 400101）；复用普通下单链路 |
| `POST /billing/subscription/cancel` | 登录 | 只关自动续费，到期前权益仍在 |

**语义要点**：支付成功（`markPaid` 事务内）才激活订阅，与积分入账同生共死；续期起点取 `max(现在, 原到期日)`（过期后不从过去补）；`uq_subscriptions_active_space` 是**部分唯一索引**（同一 space 同时只有一条 `status=1`）。

**偏离**：13 档结构对齐竞品（四线 × 月季半年年），**具体价格自建、不抄竞品数字**；升级档位按"改写 sku 字段"处理（竞品按比例补差价规则未取证，不臆造）。

### 15.8 任务系统三件（第 26 项补齐 · 3 端点）

| 端点 | 语义 |
|---|---|
| `POST /task/result` | 批量结果**快照**（≤100 id）；缺的 id 进 `missing[]` 而不是整批 404；不做 304 |
| `POST /tasks/:id/regenerate` | 同参再来一次（成功态也允许）；`attempt_no=1`、`origin_task_id` 指向原任务；`idempotency_key` 可选，重复只产生一个任务 |
| `POST /tasks/:id/feedback` | 1..5 星 + 标签 + 备注；**双写** `tasks.feedback`（agent 读侧）与 `task_events`（审计），重复提交覆盖且不冲掉 agent 写的 `reaction` |

### 15.9 幂等账本（第 0.6 批 · 横切件）

- 请求头 `Idempotency-Key`（登录态 POST/PUT/PATCH/DELETE 生效；**未登录/回调不参与**，否则会破坏渠道重试语义）。
- 服务端 `idempotency_records` 三态：`1 处理中` / `2 已完成` / `3 状态不明`。
  - 同 key 同体重复 → 原样重放（成功返回缓存 data；确定性业务失败重放同一错误）；
  - 同 key 异体 → `400101`（不能把 A 的结果返给 B）；
  - `1` → `746001`「仍在处理中」（不重复执行）；
  - `3` → `746001` + 提示 `x-force-replay: 1`（人工确认后重放）；
  - 过期（>5 分钟）→ 视为新请求。
- 失败落账规则：**确定性失败（AppError）记已完成并缓存错误**；未捕获异常/超时记 `状态不明`（因为它可能已部分生效）。

### 15.10 数据层（迁移 0019–0022）

| 迁移 | 内容 |
|---|---|
| 0018 | 小说链 11 表 + 影视版 8 表 |
| 0019 | 主体库 2、抽取 2、Agent Skill 2、知识库 3、创作者 3、活动 2、集市 3、运营增长 5（共 22 张） |
| 0020 | film 二等表 4（`film_table_prefs`/`film_task_templates`/`film_exports`/`film_recent_opens`）+ `film_review_versions` 三列（`asset_ids`/`thumb_file_id`/`decision_comment`） |
| 0021 | `subscriptions`、`sku_promotions` |
| 0022 | `idempotency_records` 三态列（`status`/`error_body`/`updated_at`）+ 状态索引 |

**表数**：49 → **96**；`schema.spec.ts` 锁表名与关键列（26 条 P1 契约不变量 + 第 0 批续 22 张 + 本轮新增）。

---

## 16. 第 2 轮新增端点总则（2026-10-27 · 生态/收尾/外延批次）

> 本轮推进第 6 批（创作者生态 + 集市 + 知识库）、主线补全（小说原创链 / 剧集子链 / 项目聚合 / ReelFlow 发布）、
> 首发补全（3D 导演台 / 账号 SSO / 团队权限）、收尾小项与多语言。端点 414 → **651**，页面 48 → **52**，
> 表 96 → **110**（迁移 0024–0030）。逐条竞品证据见 `_acceptance/_team/report-*.md`。

### 16.0 三条全局口径补充（第 2 轮定，适用于全部模块）

1. **业务错误不下发结构化 `details`**：信封只有 `{code,msg,data}`，`AppError.details` 仅进日志。
   需要让前端分支时，把原因写进 `msg`（如 `微信登录未配置（provider_not_configured）`），
   或提供专门的查询端点（如 `GET /auth/oauth/providers` 的 `configured` 字段）。**不要**把 details 塞进 `data`
   —— 那会让"成功 data / 失败 data"两种语义混用，前端判空逻辑必错。
2. **双 token**（`auth` 域）：`access`（默认 2h）是业务唯一凭证；`master`（默认 30d）**只能**用于 `POST /auth/renew`
   —— 用 master 打任何业务端点返回 `401101 wrong token type`（有用例钉住，防后续放宽）。`refresh_token` 仍只走 httpOnly Cookie 且轮换。
3. **幂等沿用 §15.9**：登录态写操作支持 `Idempotency-Key`；批量类写另有确定性去重键（集市购买按 `(work_id,buyer)`、领奖按 `(user,reward_date)` 等，见各节）。

### 16.1 小说链补完（`/v1/novel/*`，64 → 90 路由）

| 子链 | 路由 | 语义 |
|---|---|---|
| 原创链 `original_script/*`（20） | `POST .../idea/generate`、`GET .../idea/list`、`POST .../idea/select`、`.../materials/{generate,list,select,patch}`、`.../summary_outline/{generate,get,patch}`、`.../chapters_outline/{generate,list,patch}`、`.../episodes_outline/{generate,list}`、`.../episodes/{generate,patch,confirm}`、`.../finalize`、`.../state` | **不依赖源小说**（`source_type=2`，入口是灵感）；方案/素材/总纲落 `novels.meta.original`，章纲/集纲/剧本复用既有表与版本不变式 |
| 撤回定稿（1） | `POST /novel/:nt/reopen` | 16 → 1；未定稿 400100；**被拆集引用 → 400105 + `reason=referenced_by_split`**，状态一字节不动 |
| 裂变薄路径（5） | `.../fission_script/{chapters_outline, idea/:ni_id, characters/:nc_id, episodes_outline/:neo_id(GET/PATCH)}` | 路径级 1:1（上一轮用同语义端点覆盖） |
| 会话锁 | —（内部） | 进程内 Set → Redis `SET NX` + TTL 60s + Lua 比较删除；`746005` 语义不变（多副本安全） |

**两级引用判据**：`reopen` 先查 `script_projects.source_novel_id = nt`（精确，含已归档项目，`matched_by:"source_novel_id"`），
零命中才回落正文快照比对（`matched_by:"text_snapshot"`，兼容 0026 之前的历史项目）。
`source_novel_id` 由 `POST /projects/:id/episodes/split` 在 novel 分支写入且**已存在不覆盖**（同项目被两个本子先后拆过时保留最初来源）；
该列 `ON DELETE SET NULL`（删本子不被历史项目卡死，判据自动回落快照）。

### 16.2 剧集子链 / 项目聚合 / ReelFlow 发布（`modules/script`）

| 端点 | 语义 |
|---|---|
| `POST /projects/:id/episodes/:eid/quality-check` | **只读**质量检查：`{score, issues[{code,severity,shot_no?,message}], stats}`；五维加权（分镜完整 30 / 提示词 25 / 资产引用 25 / 时长 10 / 时间线 10）——**竞品只有路由、无字段证据，口径自建**（待取证） |
| `POST /projects/:id/episodes/:eid/film-synthesis-export` | 分集合成导出：**同步**判成功镜比例 <80% → `400106`；通过后下发 zip 四态 job（复用 `exports`）+ 成片 mp4 水印 job（复用 `timeline_exports`）。zip 通道产不出 mp4，故双通道 |
| `POST /projects/:id/episodes/parse` / `parse-reset` / `parse-retry` | 分镜表解析子链：**先备份再覆盖**（备份落 storage `u/<space>/parse-backups/<ep>/<ts>.json` + `latest.json`），reset 还原原始 id 与绑定；retry 仅失败/空态可用 |
| `GET /works`（扩展） | `tab=workshop\|canvas\|all` + `kind/status/state/keyword/from/to` + `has_more` + `tabs{}`；画布侧**跨域只读投影**（node_count/running/failed），不跨域写 |
| `POST .../timeline/publish`、`GET .../timeline/publications`、`DELETE .../publications/:pubId` | 切片发布（`timeline_publications`，1→2→3/4，shareToken 唯一键兜底）+ 下架（→5）；前置须有成片，否则 400105 |
| `POST .../timeline/clips/:clipId/assets` | 片段资产绑定（快照语义）；`PUT timeline` 按 `clip_id` 保留绑定；`clips[].assets` 为**可选字段**（有绑定才出现，保既有 `timeline.spec` 键集合零回归） |

**偏离**：切片"转码"当前是复制已合成产物 + 状态机，**真按 `start_ms/end_ms` ffmpeg 裁剪需 worker 新增 handler**（复用 timeline.export 队列，API 契约不变）；发布分享播放页未做（现有 `/share/[token]` 是任务分享 token 空间，不可混用）。

### 16.3 3D 导演台（`/v1/director/*`，9 路由 · 模块 #19）

| 端点 | 语义 |
|---|---|
| `POST /director/scenes`、`GET /director/scenes/:id`、`GET /director/scenes?project_id=`、`PUT /director/scenes/:id`、`DELETE`、`POST .../duplicate` | 场景快照：`payload` **不透明 JSON 对象**（服务端只校验"对象 + ≤512KB"，不解析语义，形状以 `Director3D.vue` 既有状态为准）；列表最近编辑优先 + 签名缩略图；`PUT` 带 `version` 乐观锁，冲突 `746002` 且 `msg` 带 `current=N`；删除为软删（删后 GET/PUT/duplicate 全 404） |
| `POST/GET /director/pose-presets` | 姿态预设（`scope=1` 个人 / `2` 团队共享；别人的个人预设不可见） |
| `POST /director/heartbeat` | 编辑心跳：Redis **每场景一个 HASH** + TTL 61s，读时按 60s 时间戳过滤，返回协作者昵称与 `last_seen_ms`；**不落库** |

**两个实现坑（写进代码注释）**：心跳不能 `SCAN`（keyspace 万级时首轮 COUNT 命中不到，协作者恒 0）；"未保存修改"标志必须 `flush:"sync"` 深 watch（否则一打开即误判 dirty 并触发多余 PUT 把版本顶到 v2）。

### 16.4 账号 SSO + 双 token + 团队权限（`/v1/auth/*`、`/v1/cam/*`）

| 端点 | 语义 |
|---|---|
| `GET /auth/oauth/providers` | 4 渠道（wechat/qq/apple/douyin）各自 `configured`；前端据此置灰，不解析错误体 |
| `POST /auth/oauth/:provider/url` | 返回 `authorize_url` + `state`（Redis 300s **一次性**，重放 → `400101 state_invalid`）；未配置 → `400101` 且消息带 `provider_not_configured` |
| `POST /auth/oauth/:provider/callback` | code → token → 用户信息 → 绑定/创建 `identities`；下发 `access` + `master`；`OAUTH_MOCK=1`（仅非生产）短路且响应带 `mock:true`，不假装渠道已通 |
| `POST /auth/renew` | 只续 `access`；master 唯一合法入口 |
| `GET /cam/permissions` | 权限码目录 **70 条 / 11 组**：竞品实测 53 细码 + 10 粗码 + 5 film 扩展 + 2 团队管理扩展（`team.role`/`team.permission`，否则"谁能改权限"无法表达） |
| `GET/PUT /cam/roles/:role_id/permissions` | 写 `team_roles.power_list=[{module,action,permission_code}]`（竞品真实形状）；同集合重复写 `changed=false` 且字节一致；未知码 400101 且**不落部分权限**；master 角色只读；跨 space 400102 |
| `GET /cam/temp-info` | 团队模型开关矩阵：可推导给真值（`film_enabled`/`agent_whitelist`/模型族支持位），**3 个折扣白名单字段无取证 → `null` + `unverified`**（不用假 false 冒充"不支持"） |

**边界（本批不做）**：权限只做**目录 + 存储**，不做接口级拦截（会打穿既有 13 个 e2e 的成员角色假设）；UI 上有横幅声明。做拦截前须先定"存量角色默认权限"。

#### 16.4.1 Apple `id_token` 验签（`apps/api/src/modules/auth/apple-id-token.ts`）

**为什么改**：旧实现只 `id_token.split(".")[1]` → base64 解码取 `sub`，理由是"token 由 TLS 直连的 token 端点换回、来源可信"。这把**唯一的安全边界放在网络路径上**：企业网关 / 排障抓包 / TLS 终止任一处被代理，`sub` 就与"随手 base64 的一段 JSON"同强度（可冒充任意 Apple 用户登录）。JWKS 验签是 OIDC 基本要求，成本仅一次 HTTP + 5 分钟缓存。

| 校验项 | 规则 | 拒绝时 `details.reason` |
|---|---|---|
| `alg` | 仅 `RS256` / `ES256`；`none`、`HS256` 一律拒（防"用公钥当 HMAC 密钥"的经典攻击） | `bad_alg` |
| `kid` | JWKS 定位公钥；未命中时**强制刷新一次**（否则 Apple 轮换密钥后最长 5 分钟全员登录失败） | `missing_kid` / `unknown_kid` |
| 签名 | 用定位到的公钥验签 | `bad_signature` |
| `iss` | 必须 `https://appleid.apple.com` | `bad_issuer` |
| `aud` | 必须含 `APPLE_CLIENT_ID`（`aud` 允许字符串或数组） | `bad_audience` |
| `exp` / `iat` | 过期即拒；`iat` 超前后 60s 容忍（时钟漂移） | `expired` / `issued_in_future` |
| `nonce` | token 带 `nonce` 时必须与本次 OAuth 的 `state` 派生值一致 | `bad_nonce` |
| JWKS 不可用 | 拉不到 JWKS 视为**不可验证**，拒绝登录（不降级放行） | `jwks_unavailable` |

失败一律 `400101`，`details.oauth_error=id_token_invalid` + `details.reason`，**不回显 token 任何片段**。验签是纯函数且可注入 `{ jwks, now }`，故 19 例单测用本地生成的 RSA/EC 密钥对与 stub JWKS，**零网络**。

**注意（曾经的错误结论）**：本文件在此前把「Apple `form_post` 回调会 415」列为缺口，**前提不成立**——Nest 的 `FastifyAdapter` 自 v10 起默认注册了 `application/x-www-form-urlencoded` 解析器。已用一条 e2e 验证（表单 POST + 真实 state → 登录成功；伪造 state → `400101 state_invalid`），故**未引入任何额外解析器**。

### 16.5 创作者中心 + 运营增长 + 活动（`/v1/crc/*`、`/v1/op/*`、`/v1/campaigns/*` · 模块 #10）

| 组 | 要点 |
|---|---|
| `crc`（创作者中心） | 资料 GET/PUT、作品 list/get/create/edit/delete/submit、**审核态 1 草稿→2 待审→3 通过→4 驳回→5 下架（只有 3 进公开列表）**、点赞/取消（唯一键幂等）、关注/取关/粉丝/关注列表、我的资产、banner/pop_up 读取（读 `promo_slots`）、作品举报（`asset_reports`，一人一作品一次） |
| `op`（运营增长） | 邀请码（`invite_codes.owner_user_id` 归属；注意与 `created_by`（admin_users）不是一张表）、单层分销（`commission_bps`，默认 0）、兑换码 CRUD + 兑换（`redeem_code_redemptions` 唯一键兜底）、每日奖励（`op_daily_rewards` 唯一键 `(user,reward_date)`，**抢到唯一键才 creditIn**，再回填 `flow_ref`）、问卷（`op_questionnaires`/`op_questionnaire_responses`）、定向发分、AB 实验（一人一变体，`ab_hits` 唯一键）、运营位后台 CRUD |
| `campaigns` | 列表/详情/报名/取消/入围/获奖 + `GET/POST campaign/signup/draft`（`campaign_signup_drafts` 一人一活动一份，覆盖写）；`campaign_key` slug 支持 `/campaigns/:idOrKey` 双主键 |

**安全修复（值得单列）**：问卷定义与答卷是**平台级**（`qkey` 全局唯一、答卷无 space 列），因此运营后台的问卷列表/审核加了 `join space_members` 收窄到本 space —— 否则任何团队管理员可翻别家团队留资（**跨租户泄露**）。
**激励红线**：所有发分走 `creditIn` 记账（不许直接改 balance），`credit_flows.memo` 写清来源。

### 16.6 剧本集市 + 集市 Admin + 团队知识库（`/v1/market/*`、`/v1/ops/market/*`、`/v1/knowledge/*`）

| 组 | 端点 | 要点 |
|---|---|---|
| 集市 | 36（竞品 29 全覆盖 + 买断/账户提现/提现列表/撤销等 7） | 上架/编辑/下架、预售定金、列表/搜索/分类/标签、**购买走 `creditOut(kind="consume")` 事务内**（余额不足 745701 整事务回滚，余额/协议/销量/收益零副作用）、协议三类（购买/预售/授权）、收益只累计（`== Σ(生效协议价 − 抽成)`，取消预售同额减回）、提现状态机 **1 待审→2 通过→3 打款 / 4 驳回 / 5 撤销（跳步 400101）**、`pg_advisory_xact_lock` 串行化"查+插"保证同用户仅 1 笔待审、内容树购买后才可读（否则 403101） |
| 集市 Admin | 22（竞品 12 全覆盖 + 提现审核 3 + 待审/详情/看板） | 独立服务域物理隔离；审核留痕 `market_review_logs`（提交/通过/驳回/下架） |
| 知识库 | 34（竞品 29 条全对 + 我方 5 条实体，第 59 批） | 目录树（深度 ≤5，删除级联软删）+ 标签 + 资产 CRUD/搜索/批量移动 + **与资产库双向导入**（`import-from-asset` / `to-asset`，校验同 space）+ **知识库实体**（`knowledge_bases` 迁移 0037，一 space 一活库；详见 §17.18）；`asset_count` 由建树时写入（不是事后补） |

**偏离**：抽成常量 `MARKET_COMMISSION_BPS=2000`（20%，**运营未拍板、仅初值**，由 `/market/scripts/config` 下发给前端，前端不写死）；提现不接资金通道（资质/合规），`payout` 只回填线下打款凭证 + 推进终态；买断后二次改编/再发布未做（许可范围未拍板）；作品解析只做**结构解析**（章节/字数/角色/摘要建议值），竞品 `parse` 产出未取证，不臆造。

### 16.7 收尾小项（首页 / 运营位 / 内容安全 / 分享批量 / 画布恢复）

| 端点 | 语义 |
|---|---|
| `GET /home/config` | 读 `home_configs` 最新 version（sections 显隐/排序 + ab_slots） |
| `GET /home/unread?since=` | 长轮询：最多挂 `env.HOME_UNREAD_TIMEOUT_MS`（默认 25s，**低于常见反代 30s 读超时**），**可中断**；事件源 `task_events` + `task_shares` 增量；不用 WebSocket（理由：单实例、无双向需求、省一条连接通道） |
| `GET /home/ab?key=` | 按 `ab_experiments` 权重哈希 userId 决定变体并落 `ab_hits`（一人一变体） |
| `GET/POST/PUT/DELETE /ops/admin/promo-slots` | 运营位 banner/pop_up/activity/creator 四类；`created_by` FK 指向 **`admin_users`**（运营身份，与 `content_reports.handled_by` 同口径） |
| `POST /moderation/captcha/{ticket,verify}` | 行为验证码：**无第三方 Key → `available:false` + 本地算术题模式 + 一次性 HMAC ticket**（不写"已接入腾讯云"）；高频登录/发码要求 ticket（429101 语义） |
| `POST /moderation/text-detect` | 文本敏感检测 `{risky, hits[{word,index}], action}` |
| `GET /moderation/status?task_id=` | 模型侧审核态只读（`reviewing`/`review_rejected`） |
| `POST /share/:token/batch-download` | **公开只读**（只认 token，未撤销未过期），只打包该 share 关联任务的产物（越权读取=事故） |
| `POST /canvas/canvases/:id/nodes-recover` | 从最近 `canvas_snapshots` 恢复**缺失**节点/边，不覆盖现存；无快照 400102 |

### 16.8 多语言（模块 #16）

- 自建轻量 i18n（**不引 `@nuxtjs/i18n`**）：`i18n/index.ts` 内核 + `i18n/locales/{zh-CN,en,ja,pt-BR,es}.json`（312 key）+ `composables/useI18n.ts`（`useState` 隔离 SSR）+ `plugins/i18n.ts`（协商 + `htmlAttrs.lang`）+ `components/i18n/LangSwitcher.vue`。
- 协商顺序：`?lang=` → cookie `of_lang` → `Accept-Language` → `zh-CN`；切换不刷新页面。
- `useApi` 只加一行 `X-Lang`；**服务端不翻译**：后端返回的是数据（工具目录、SKU label、space 名），翻译它需要多语言数据字段，属另一件事；`X-Lang` 用于日志/审核归档/将来运营位按语言返回。
- 已迁 6 页（index/login/pricing/tools/tasks/settings）+ 壳层导航（`sidebar.*`）；`_acceptance/i18n-check.cjs` 校验 5 包 key 一致 / 无空值 / 无中文残留（**ja 用"简体专用字表"判残留**：日语正常书写含 CJK 汉字，硬套会把正确日语 100% 判错）。
- **未做**：路径前缀 `/en /ja /br /es` + hreflang + sitemap、韩语、语言偏好持久到账号、页面内文案全覆盖（home/works/assets/admin/share/create/集市/创作者/novel/reelflow/team/projects 仍未迁）。

### 16.9 数据层（迁移 0024–0030）

| 迁移 | 内容 |
|---|---|
| 0024 | `promo_slots` / `home_configs` / `creator_likes` / `director_scenes` / `director_pose_presets` / `timeline_publications` |
| 0025 | `campaigns.campaign_key` + `creator_assets.{category,reviewed_by,reviewed_at}` + `op_daily_rewards` / `op_questionnaires` / `op_questionnaire_responses` |
| 0026 | `script_projects.source_novel_id`（FK novels，带索引） |
| 0027 | `campaign_signup_drafts` / `asset_reports` / `invite_codes.owner_user_id` |
| 0028 | `promo_slots.created_by` FK 由 `users` 改为 **`admin_users`**（运营身份；迁移内先清空非法值） |
| 0029 | `script_projects.source_novel_id` 改 `ON DELETE SET NULL` |
| 0030 | `market_categories` / `market_tags` / `market_review_logs` / `market_works.{category_id,tag_ids}` / `market_withdrawals.work_id`；`creditOut.kind` 放宽为 `"refund" \| "consume"`（购买记 `consume`，否则财务对账"退款金额"虚高） |

**表数**：96 → **110**；`schema.spec.ts` 锁 P1 不变量 + 第 0 批/续 + 本轮新列。

---

## 17. 第 3 轮新增端点与口径（2026-10-27 · 广告剧/视频转绘/发布播放/资产快照）

> 本轮端点 648 → **683**，页面 55 → **60**，表 110 → **111**（迁移 0031/0032）。
> 逐条证据见 [`_acceptance/_team/report-round3-lead.md`](../../_acceptance/_team/report-round3-lead.md)。

### 17.1 广告剧（`/v1/ad-drama/*`，12 端点 · 模块 #13）

竞品 `df/script_project/drama_ad/*`（`rea-reelmate/routes.txt:680-691`）→ 我方按域收敛为 `/ad-drama/*`（ADR-009），
状态挂 `script_projects(project_mode=2)`，模式私有数据全部进 `mode_meta` jsonb（**服务端不解析语义**，只校验对象与大小上限）。

| 竞品（rt 行） | 我方 |
|---|---|
| `asset/extract` (680) | `POST /ad-drama/projects/:id/asset/extract`（`need_voice` 1/2，参数名沿用竞品 CLI `commands/ad.md:133`） |
| `asset/image-tips` (681) | `POST /ad-drama/projects/:id/asset/image-tips` |
| `brief/generate` (682) | `POST /ad-drama/projects/:id/brief/generate` |
| `brief/select` (683) | `POST /ad-drama/projects/:id/brief/select`（`brief_id`） |
| `project/info` (684) | `GET /ad-drama/projects/:id`（五段进度 `stages[]` + `current_stage`） |
| `project/point` (685) | `POST /ad-drama/projects/:id/point`（只试算不冻结） |
| `project/save` (686) | `POST /ad-drama/projects`（`project_id` 有值=更新） |
| `script/edit` (687) | `POST /ad-drama/projects/:id/script/edit`（`script_text`，走内容安全检查） |
| `script/generate` (688) | `POST /ad-drama/projects/:id/script/generate` |
| `script/reset` (689) | `POST /ad-drama/projects/:id/script/reset`（保留素材与卖点，只清剧本） |
| `selling-point/generate` (690) | `POST /ad-drama/projects/:id/selling-point/generate` |
| `storyboard/generate` (691) | `POST /ad-drama/projects/:id/storyboard/generate`（`template_type` 1 急速 / 2 至尊） |

**口径**：每个生成动作都回 `charge{credits,task_id}`（走 `tasks` 记账，不白送）；`stage`/`status` 的**值域竞品未取证**，
我方定义 1..5 / 1 进行中 2 完成，并在 `ad.constants.ts` 注释标注「待取证」。

### 17.2 视频转绘（`/v1/video-redraw/*`，9 端点 · 模块 #14）

竞品 `df/script_project/video_redraw/*`（`routes.txt:703-710`）+ 我方补充 1 条列表：

| 竞品（rt 行） | 我方 |
|---|---|
| `project/create` (706) | `POST /video-redraw/projects`（`mode_meta={source_uri,source_kind,style,redraw_strength,source_duration_s,episode_ranges,shot_duration_s}`） |
| `project/info` (707) | `GET /video-redraw/projects/:id`（`video_redraw_stage` / `video_redraw_stage_status` / `progress{}`） |
| `project/point` (708) | `POST /video-redraw/projects/:id/point` |
| `episode/create` (705) | `POST /video-redraw/projects/:id/episodes` |
| `episode/batch_create` (704) | `POST /video-redraw/projects/:id/episodes/batch`（等分 N 集） |
| `storyboard/plan` (710) | `POST /video-redraw/projects/:id/storyboard/plan`（**覆盖式**，幂等） |
| `resources/generate` (709) | `POST /video-redraw/projects/:id/resources/generate`（报价 + 任务记账） |
| `asset/bind` (703) | `POST /video-redraw/projects/:id/asset/bind`（快照语义，与 `PUT timeline` 同口径） |
| （我方补充） | `GET /video-redraw/projects`（列表；竞品 8 端点无列表，但工作台必须有入口） |

**口径**：`episode_ranges` 记录每集 `[start_s,end_s]`，分镜计划据此取默认区间；`redraw_strength` 在 mock 模式下无可见差异（已标注）。

### 17.3 发布播放（`/v1/watch/:token`，2 端点 · 模块 #20）

| 端点 | 语义 |
|---|---|
| `GET /watch/:token` | **公开只读**（`@Public`，只认 32 位 hex token）。可播放返回 `{title,episode_no,status,file_url(现签 1h),duration_ms,published_at,view_count}`；**键集合严格收紧**（spec 用全等断言，不含 space/user/project/episode/publication/token/slice）。四种非正常态：`not_found`(400102) / `off_shelf`(400102) / `transcoding`(400105) / `transcode_failed`(400105) |
| `POST /watch/:token/view` | 播放计数：同 token + 同 IP **5 分钟去重**（Redis `SETNX`，IP 只存 sha256 前 24 位）；去重通过后 `timeline_publications.view_count` **原子自增**（迁移 0032），响应 `{ok,counted,view_count}` |

**为什么计数落列**：Redis 重启/淘汰会丢"这部片子被看了多少次"，而这是创作者与运营要看的历史指标；
Redis 只承担去重闸（见 `publish.service.ts` 注释）。

### 17.4 资产/主体补完（模块 #17，无新端点为主）

| 变更 | 说明 |
|---|---|
| 新表 `episode_resources` | 每集每类（角色/场景/道具）的**完整快照**；唯一键 `(episode_id,kind,name)`；`save-resource-matches` 按类清空重写（空类别显式 `[]`，漏传 400101 且零写入）；`match-result` 三态统计基于该表 |
| `project_assets.prompt_status` | 0 未处理 / 1 生成中 / 2 已完备 / 3 被拦截；被拦截与生成中的资产不参与"智能补充" |
| `subjects.is_starred` / `template_key` | 星标置顶 + IP 模板归类筛选（模板渲染语义未取证，只做归类） |
| `prompt_inject_mode=append｜replace` | 默认 `append`（保持既有行为）；`replace` 直接把 `prompt_with_images` 作为 `video_prompt`，**需产品确认后才建议启用** |
| extraction 补面 | `GET /extraction/tasks`（分页/状态筛）、`POST /extraction/tasks/:id/cancel`、`GET /extraction/stats` |

### 17.5 多语言路由口径（模块 #16）

- 前缀 `/en /ja /br /es` 由**全局中间件**解析（不复制页面树）：`/en/pricing` → 设 `en` + 内部渲染 `/pricing`；中文无前缀。
- `hreflang` 5 条 + `x-default`（指向中文无前缀）；`/sitemap.xml` 只列公开页 × 5 语言；`/robots.txt` 指向 sitemap。
- 切换语言时**替换**前缀（先 `stripLocalePrefix` 再加），避免 `/ja/en/pricing`。

### 17.6 数据层（迁移 0031–0032）

| 迁移 | 内容 |
|---|---|
| 0031 | `episode_resources` 新表；`script_projects.project_mode`（1 普通/2 广告剧/3 视频转绘）+ `mode_meta` jsonb；`project_assets.prompt_status`；`subjects.is_starred` / `template_key` |
| 0032 | `timeline_publications.view_count`（播放量权威计数） |

**表数**：110 → **111**。

### 17.7 创作者中心 5 条路由（模块 #10，2026-10-27 第 4 轮）

竞品 `rea-reelmate/routes.txt:43-47` 有 5 条 `creator-center` 路由，第 4 轮前我方只有 `/creator-center`。本轮补 4 页（**全部复用既有端点，未新增 API**）：

| 竞品路由（rt 行） | 我方页面 | 数据来源 |
|---|---|---|
| `/creator-center` (43) | `pages/creator-center/index.vue`（已有） | `crc/*` 资产、`market/creator/*` |
| `/creator-center/:id` (44) | `pages/creator-center/[id].vue` | `GET /market/creator/works/:id`（含 `readiness{has_novel,novel_finalized,price_set,can_submit}`）、`POST /market/creator/works`（更新必须用 **`work_id`** 而非 `id`）、`.../:id/submit`、`.../:id/offline` |
| `/creator-center/earnings` (45) | `pages/creator-center/earnings.vue` | `GET /market/creator/revenues/overview`、`GET .../revenues`、`GET .../withdrawals`、`POST .../withdraw`、`POST .../withdrawals/:id/cancel` |
| `/creator-center/preview/:id` (46) | `pages/creator-center/preview/[id].vue` | `GET /market/creator/works/:id` + `.../content-tree`；视频/图片/文本三态渲染 + 复制站内预览链接 |
| `/creator-center/publish` (47) | `pages/creator-center/publish.vue` | `POST /market/creator/works/save`（强制草稿）、`POST /market/creator/works`（`submit=true` 提审）、`POST .../works/parse`（本子→建议值） |

**三条口径（写进页面注释）**：
1. **收益不是积分余额**（竞品 `d-commerce-account.md:415-417` 按作品分账）：`earnings` 页所有金额来自后端 `available_credits/locked_credits/min_withdraw_credits`，前端**不复算**可提额度；提现只提交申请，不改任何余额。
2. **提审前置条件由后端一次给全**（`readiness.can_submit`）：前端按字段展示"售价 > 0 / 关联本子已定稿"，不重复实现规则（避免两处漂移）。
3. **作品更新用 `work_id`**：`creatorSaveWork` 以 `work_id` 判更新，传 `id` 会被当成新建（本轮实测踩到，已在 `[id].vue` 注释标注）。

**同时修**：`script.projects` 的 `projectDto` 透出 `project_mode`（1 普通/2 广告剧/3 视频转绘）——否则前端无法区分"我的广告剧/转绘项目"与普通项目（`source_type` 两者都是 2）。

**真实链路证据**：`_acceptance/smoke-creator.ps1` —— 存草稿(1) → 编辑(标题/价格生效) → 提审(2 待审核) → 收益总览 → 提现越界被拒(400101 `amount exceeds available balance`) → 提现列表/收益明细 → 内容树。

### 17.8 影视版导出改真 xlsx（模块 #8，2026-10-27 第 4 轮）

**变更**：`POST /film/projects/:project_id/exports` 的 `format="xlsx"` 由"给 CSV/ZIP 并在 `delivered_format` 标注"改为**真 .xlsx**（多表=多 worksheet）。

- 实现：`modules/film/xlsx-writer.ts`（~130 行，用已有 `jszip` 拼 OOXML，**不引第三方 xlsx 库**）。
  支持多 sheet / inlineStr 文本 / 数字 / 布尔 / 空单元格 / 表头加粗；**不支持**公式、合并单元格、图片、样式扩展。
- 一致性：CSV 与 XLSX 共用 `tableToMatrix()`（列序、单元格值、公式注入防护完全一致）——
  两条路径各读一次会导致"同一次导出两种格式内容不一致"。
- `format="csv"` 路径**保持不变**（单表 csv / 多表 zip），避免影响已对接前端。
- `delivered_format === "xlsx"`、`file_uri` 以 `tables.xlsx` 结尾、`content_type` 为
  `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`。

**安全**：与 CSV 同口径的公式注入防护（`= + - @` 开头文本前置单引号）——导出文件会被别人用 Excel 打开。

**验证**：
- `test/film-xlsx.spec.ts` 9 例（zip magic、6 个必需部件、多 sheet 名、inlineStr/数字/布尔、公式防护、XML 转义与控制字符剥离、表名清洗/重名、列号进位、空表拒绝）
- `_acceptance/verify-film-xlsx.cjs` **15/15** 真实 HTTP：登录 → 开 film_enabled → 建两张表 → 导出 xlsx（2988B）→ 下载 → jszip 解出 7 个部件且 workbook 含两个 sheet 名

### 17.9 影视版离线通知 webhook（模块 #8，2026-10-27 第 4 轮）

`POST /film/projects/:project_id/task-tables/:table_id/tasks/:task_id/notify-assignees` 原有行为：广播面（进程内 WS 事件）+ 返回被通知人清单。本轮补**离线投递通道**：

| 项 | 口径 |
|---|---|
| 通道 | 可配置 webhook（`FILM_NOTIFY_WEBHOOK_URL`），对接企业微信/飞书机器人或客户网关；**不接推送厂商 SDK** |
| 签名 | `x-of-signature: sha256=<hex>`，HMAC-SHA256 over 原始 body，密钥 `FILM_NOTIFY_SECRET`；未配密钥则**不发签名头**（避免空密钥签出可伪造签名） |
| 事件体 | `{id, type, space_id, project_id, table_id, created_at, payload}` |
| 重试 | 3 次指数退避（80/240/720ms），每次 2s 超时 |
| 未配置 | `delivery:"stored"`（广播/落库已发生，不假装推送） |
| 失败 | `delivery:"failed"` + `attempts`，**不阻塞**通知主流程 |
| 响应新增 | `delivery` / `delivery_attempts` |

**测试**：`test/film-notify.spec.ts` 5 例（真实本地 HTTP 接收端验证签名可复算、500 重试 3 次、先失败后成功、未配置零请求）。

### 17.10 任务详情补签产物 URL + mock 产物为真媒体（模块 #6，2026-10-27 第 5 轮）

| 变更 | 口径 |
|---|---|
| `GET /tasks/:id` 的 `results[]` | 新增 `url`：**仅当任务已完成（status=3）** 时为 storage key 现签 1h 地址（最多 8 张）；`uri` 原样保留。理由：轮询期结果为空、不产生签名开销；而结果页必须能直接 `<img src>` 渲染——把 storage key 直接当 src 会 404（浏览器按当前域解析相对路径）。 |
| mock 产物（worker） | 图片类 mock 产物写**真 PNG**（64×64，纯 Node 构造 IHDR/IDAT/IEND，颜色由 taskId 派生）；音视频 mock 仍是文本占位，但结果 `meta.mock_placeholder=true`，前端据此显示"mock 占位（未接真实供应商）"而不是裂图/静默不播。 |
| 前端 | `ImageGenWorkspace` 的产物渲染与历史缩略图优先用 `url`，回退 `uri`/`preview_uri`。 |

**验证**：`_acceptance/smoke-image-chain.ps1`（真实提交→worker→产物→现签→下载 PNG 1174B/64×64/可解码）；
`apps/worker/src/executor.spec.ts` 新增 2 例断言 PNG magic 与 placeholder 标记。

### 17.11 主体 IP/风格模板（模块 #17，2026-10-27 第 5 轮）

> **竞品证据不足**：`_parts/d-model-task.md:152` 只列出能力名，主体库侧模板的字段与生效方式**未取证**。
> 本条是**自建口径**，契约与文案都按此标注，不声称已对齐竞品。

| 端点 | 语义 |
|---|---|
| `GET /subjects/templates` | 返回 4 个预置模板 `{key,name,description,prompt_prefix,negative_prompt}` + `semantics` 说明。**必须声明在 `@Get(":id")` 之前**，否则 `templates` 会被当成 id。 |
| `POST /subjects/:id/apply-template` `{template_key}` | 只落 `subjects.template_key`，**不改写 `subjects.desc`**；返回 `{template_key, desc, prompt_template, negative_prompt, semantics}`。未知模板 → `400101`（`details.supported` 只进日志，信封不下发）。 |

**生成侧**：`GET /subjects` 的 `template_key` 过滤已存在；生成注入走
`asset-gates.injectImagesWithTemplates(spaceId, prompt, assets)` —— 对已定稿资产的关联主体取模板前缀，
追加到 `prompt_with_images` 末尾（主体描述 → `[[@imgN]]` → 风格前缀），同一前缀不重复追加。

**未做**：前端主体卡片上的"应用模板"下拉（API 已可用；本轮页面未接，登记在 §5 缺口）。

### 17.12 创作者效果标签（`effect`）与主体模板 UI（2026-10-27 第 6 轮）

**`creator_assets.effect`（迁移 0033）**：对照 `crc/resource/list` 的 `effect` 筛选与 `crc/effect/tree` 目录。
此前表无此列，接口只能"透传但不过滤"（`effect_applied:false`）——用户选了筛选项却看不到结果变化，比没有筛选项更糟。

| 项 | 口径 |
|---|---|
| 取值 | `crc/effect/tree` 叶子扁平化：`anime`/`realistic`/`ink`（风格）、`push`/`pan`/`handheld`（运镜）；**可空**（老数据与未设置效果的作品不参与效果筛选） |
| 写入 | `POST /crc/assets/create`、`POST /crc/assets/update` 接受 `effect`（白名单枚举；`update` 传 `null` 可清空，但**只有草稿/已驳回可编辑**——已通过需先下架） |
| 读取 | `POST /crc/resource/list` 的 `effect` 是**真过滤**（走 `idx_creator_assets_effect(status, effect, published_at desc)`），响应 `filters.effect_applied=true`；未知值 `400101` 且附合法集合（不进信封） |
| DTO | 作品 DTO 回显 `effect`。 |

**前端**：`SubjectLibrary` 的"应用模板"下拉来自 `GET /subjects/templates`，调 `POST /subjects/:id/apply-template`；
提示文案明确"已追加风格前缀，原描述不变"（与自由填写的模板键 `template_key` 是两个不同动作）。

### 17.13 权限拦截扩面 + 验证码入口闸门（2026-10-27 第 7 轮）

**权限入口拦截（`ENFORCED_PERMISSIONS`，3 → 6 码）**

| 码 | 端点 | 语义 |
|---|---|---|
| `team.edit` | `PATCH /cam/team/info` | 改团队设置 |
| `team.permission` | `PUT /cam/roles/:role_id/permissions` | 改角色权限矩阵 |
| `member.create` | `POST /cam/team/member/batch` | 邀请/批量添加成员 |
| `member.remove` | `DELETE /cam/team/member/:user_id` | 移除成员 |
| `member.edit` | `PATCH /cam/team/member/:user_id` | 改成员资料/角色 |
| `member.points` | `POST /cam/team/points-allocation`（批量同码） | 分配积分 |

口径：**默认放行**（成员无显式 `power_list` 视为全权；`role_code=master` 短路）——保证存量 e2e 零回归；
显式收紧后越权返回 `403101` 且 `msg` 带缺失码。`GET /cam/permissions` 的 `enforced` 字段与 `enforced_count` 是唯一事实源。

**验证码入口闸门（`CAPTCHA_ENFORCE`）**

| 项 | 口径 |
|---|---|
| 适用入口 | `POST /auth/sms-code`、`POST /auth/login` |
| 入参 | `captcha_ticket`（来自 `POST /moderation/captcha/ticket`）+ `captcha_answer` |
| 开关 | `CAPTCHA_ENFORCE=1` 强制；默认 `0` 关闭（零回归）。服务**调用时**读 `process.env` 便于测试切态 |
| 拒绝 | 缺票 → `400101 captcha_required`；答错 → `400101 captcha failed(wrong_answer)`；**答错也消耗票据**（防 10×10 枚举） |
| 放行 | 答对且票据未被使用 → 正常发码/登录 |

### 17.14 平台运营创作者审核（2026-10-27 第 7 轮）

**为什么需要**：创作者作品此前只有空间管理员能审，平台运营域看不到队列（`creator.md` 侧只有 `crc/assets/audit`）。
竞品把创作者内容视作平台内容池的一部分，运营必须能直接处置。

| 端点 | 说明 |
|---|---|
| `GET /ops/admin/creator-audits` | 查询参数 `status`(1..5，默认 2 待审)、`q`(标题模糊)、`page`/`page_size`(≤100)。排序 **FIFO**（最早待审在前，审核队列的常识顺序）。返回 `{list,total,page,page_size,status}`。 |
| `POST /ops/admin/creator-audits/:id/review` | `{action:"approve"|"reject"|"offline", note?}`。通过 → status 3 + `published_at`；驳回 → 4 + `review_note`；下架 → 5。**跳步一律 400101**（待审态不可下架、已通过态不可再审）。 |

**留痕（迁移 0034）**：`reviewed_by_admin`（→ `admin_users`）+ `reviewed_by_kind`（1 空间管理员 / 2 平台运营），
与用户域的 `reviewed_by`（→ `users`）分开——两个身份域混用一列会让另一条路径无法记录"谁审的"。

**前端**：运营后台 `?tab=creatorAudits` 页签（搜索 + 通过/驳回/下架）。

### 17.15 前端 i18n 页面覆盖（2026-10-27 第 8 批）

> 这一节记录**前端**多语言覆盖口径（无端点变更）：语言由 `X-Lang` / cookie / `?lang=` / 路径前缀解析，
> 文案来自 `apps/web/i18n/locales/*.json`（5 语言，namespace 划分见下）。

| namespace | 覆盖页面/组件 | key 数 |
|---|---|---:|
| `common` / `nav` / `lang` / `sidebar` / `errors` | 壳层（布局、导航、错误页） | ~120 |
| `auth` / `landing` / `pricing` / `settings` / `billing` | 登录、落地页、定价与订阅、设置 | ~150 |
| `tools` / `tasks` / `works` / `share` | 工具箱、任务、全部项目、分享页 | ~120 |
| `film` / `market` / `credits` / `assets` / `novel` / `invite` / `home` / `onboarding`（第 9–12 批） | 影视版、剧本集市、积分流水、资产库、剧本工厂、邀请与兑换、**首页（工具矩阵/轮播/新手引导条）** | 266 |

**已迁移 43 页 + 17 组件**（第 8–56 批）。口径按「可译用户面」计：

| 口径 | 分母 | 已迁 |
|---|---:|---:|
| 用户面可译页（64 − admin 2 − `/create/*` 19 − 法务 2） | 41 | **41（100%）** |
| 法务文本页 privacy / terms（原则性不机翻） | 2 | 0（豁免，待法务） |
| 运营后台（内部系统） | 2 | 2 |
| `/create/*` 工具落地页 | 19 | 19 |
| 全部 | 64 | 62（97%） |
| 语言包 | — | **3,153 key × 5 语言**（50 个命名空间） |

命名空间（按批）：`common/nav/lang/sidebar/errors`（壳层）、`auth/landing/pricing/settings/billing`、
`tools/tasks/works/share`、`film/market/credits/assets/novel/invite/home/onboarding`、
`filmDetail/marketDetail/novelStudio/reelflow/canvas/canvasUi/creatorCenter/report/publish/preview`、
`adDrama/redraw/filmDetail/earnings/workDetail/marketManage/editor/teamPage/projectDetail/knowledge`、
`adminUi/watchPage/toolUpscale`、`shell`（第 55 批：三布局 + 19 张 create 页头）。

**第 55–56 批（壳层 + create 收尾）**：
1. `shell` 命名空间 35 key 覆盖 `layouts/app.vue`（侧栏 12 项、顶栏订阅/积分 pill、语言切换）与
   `layouts/tool.vue` 页头；`toolTitle` 由中文标题改为 **i18n key**（19 张 create 页统一改传 `shell.toolTitles.*`）。
2. `/create/*` 19 张里 18 张是薄壳（页头由布局翻译即完成），`video-upscale` 是唯一自包含实现，
   正文 34 处中文本批迁完（`toolUpscale` 41 key，含 7 个任务状态文案——状态表从 setup 常量改 `computed`，
   否则切语言不生效）。
3. 首页工具卡 `data-kind` 由中文类名改语义键（`soon`/`member`），避免切语言后角标配色丢失。
4. `ad-drama/create` 的 `style` 提交值由中文标签改稳定 ASCII key（`live/anime/cartoon3d/cyber/guofeng`），
   并保留旧中文值→译文映射；**不改后端**（`style` 是自由字符串，后端不校验枚举）——这是把「业务值存中文」
   这类缺陷在纯前端闭环的唯一一条（其余见进度文档 §5）。

**剩余 3 处中文均非页面文案**：`novel/[id]` 1 行（解析服务端「第N集」）、`projects/[id]` 1 行（切服务端标题前缀）、
`ad-drama/create` 5 行（旧中文值兼容映射）。**页面级完成度以 `_acceptance/i18n-residual.py` 残留 0 为准，不看页头。**

**校验口径**：`_acceptance/i18n-check.cjs`（静态：key 一致 / 无空值 / 外语包无中文残留 / 占位符一致 / 页面 key 齐全）
+ `_acceptance/e2e-i18n-pages.cjs`（浏览器：中英对照、无 key 残留、控制台清洁，**158 例**）
+ `_acceptance/i18n-residual.py`（逐文件数「含中文且非注释」的行数 → 页面级完成度的**唯一判据**；
  注释行/行尾注释自动排除，豁免文件单列并说明理由）。

### 17.16 切片转码执行位置：`PUBLISH_TRANSCODE_MODE` 与 `publish.transcode` 队列（第 57 批）

> **无端点变更**。对外契约不变（`POST .../timeline/publish` 仍返回 `status=1` 的记录，前端仍轮询
> `GET .../timeline/publications`），改的只是**转码在哪个进程执行**。

**问题**：原先 `apps/api/src/modules/script/publish.service.ts` 用 `void this.transcode(...)` 在 API 进程内
fire-and-forget。任务只活在一个进程的调用栈里：API 在转码完成前重启（发版、OOM、单机 dev 重启），
记录就停在 `status=1/2`，15 分钟后被看门狗 `reviveStuckPublications` 判失败且**不重跑** —— 转码永久失败。

**执行位置由配置决定**（`apps/api/src/config/env.ts`）：

| `PUBLISH_TRANSCODE_MODE` | 行为 | 适用 |
|---|---|---|
| `inline`（**默认**） | API 进程内直接跑 `runPublishTranscode` | dev / 测试：无需常驻 worker，行为与改造前逐字一致 |
| `worker` | 只入队 `publish.transcode`，由 `apps/worker` 消费 | 生产：任务在 Redis，worker 重启自动重投 |

**入队失败回落内联**：Redis 短暂不可用不该把记录永远留在 `status=1`，所以 `enqueue` 抛错时
`catch` 后直接走 `transcodeInline`（同一份状态机，不产生第二条路径）。

**状态机只有一份**：`packages/shared/src/publish-transcode.ts`

```ts
runPublishTranscode(deps: PublishTranscodeDeps, input: {
  publicationId: string; spaceId: string; sourceKey: string;
}): Promise<{ result: "ready" | "failed" | "skipped"; transcodeMode?: string; reason?: string }>

publicationObjectKey(spaceId, publicationId) // => u/<spaceId>/publications/<publicationId>.mp4
```

常量 `PUB_STATUS_QUEUED=1 / TRANSCODING=2 / READY=3 / FAILED=4 / REMOVED=5`、
`PUB_TERMINAL_STATUSES=[3,4,5]`。三条不变量：

| 不变量 | 行为 |
|---|---|
| **终态不覆盖** | 命中 `status ∈ {3,4,5}` → `skipped`，文件/`shareToken`/`publishedAt` 一律不动 |
| **降级留痕** | 裁剪不可用 → 降级复制，但落 `transcode_mode` + `transcode_reason`（不"悄悄复制却说裁过"） |
| **失败不抛** | 落 `status=4` + `error{code: 745900 VENDOR_ERROR}`，函数正常返回 outcome |

**worker 侧防竞态**：`apps/worker/src/publish-transcode.ts` 的 `markReady` / `markFailed` 都带条件更新

```ts
inArray(timelinePublications.status, [PUB_STATUS_QUEUED, PUB_STATUS_TRANSCODING])
```

多实例消费同一 job（重投叠加）时谁先写谁生效，后到的不覆盖；`runPublishTranscodeJob` **不抛异常**，
返回 outcome 并打日志 `msg="publish transcode finished"` + `result` + `publication_id`。

**队列定义**（`apps/api/src/queue/queue.service.ts`）：`QUEUES.PUBLISH_TRANSCODE = "publish.transcode"`，
`enqueuePublishTranscode({publicationId, spaceId, sourceKey})` 以 `jobId = publish-transcode-<id>` 入队
（同发布记录天然去重），`onModuleDestroy` 里 `close()`。

**测试**：`packages/shared/src/publish-transcode.spec.ts` 7 例（纯状态机）+
`apps/worker/test/publish-transcode.spec.ts` 11 例（真库 + 真 `LocalStorage`：源缺失落 `status=4` 且不抛 /
已 READY 重投 skipped 且字段全不变 / 记录不存在 skipped / 正常路径产物落 `u/<space>/publications/<id>.mp4`
且 `storage.read` 可读回 / **并发两 job 抢占** / **孤儿记录接管** / **源 key 反查 4 例**）；api 侧
`test/ffmpeg-trim.spec.ts` + `test/reelflow-publish.spec.ts` **18 例**证明默认 `inline` 模式行为与改造前完全一致。

### 17.17 转码看门狗与队列的协同、`markTranscoding` 抢占语义（第 58 批）

无端点变更。本节只讲**状态推进的正确性**——第 57 批下沉之后暴露的两处竞态。

**缺陷一：看门狗把「队列里还排着的任务」判成失败。** 第 57 批把转码下沉到 `publish.transcode` 后，
`reviveStuckPublications` 仍是「超时即失败」口径，形成一条把下沉收益全额抵消的链路：

```
worker 停机 20min（任务都在 Redis 正常排队）
  → 重启 schedule("publications-watchdog", …, runOnStart=true) 让看门狗先跑
  → status=1 且 updated_at 超 15min 的记录被逐条置 status=4（error.code="transcode_stalled"）
  → BullMQ 随后投出 job，runPublishTranscode 撞 PUB_TERMINAL_STATUSES=[3,4,5] → skipped
```

判定改为**三分类**（`apps/worker/src/maintenance.ts`）：

| 情况 | 判定 | 理由 |
|---|---|---|
| 仍在队列（`wait`/`waiting`/`delayed`/`active`/`paused`） | 跳过 | 排队久 ≠ 坏了，worker 停机积压是队列正常状态 |
| 不在队列、源还在 | **重新入队** | 才是真重投；源 key 顺 `slice.source_export_id` → `timeline_exports.file_uri` 反查 |
| 不在队列、也投不了 | 置 `status=4` | 源成片已被清理时才真救不了 |

```ts
export interface RevivePublicationHooks {
  pendingInQueue?: () => Promise<ReadonlySet<string>>;  // 一次取整批，不逐条查
  requeue?: (row: { publicationId: string; spaceId: string }) => Promise<boolean>;
}
```

两条硬要求：① **探针一次取集合**（逐条查是「200 条超时 × 数百 job」，会把 2min 维护任务拖成分钟级）；
② **探针抛错时整轮放弃**（`return 0`）——Redis 抖动时把正在跑的转码判失败，用户会看到「重发」而原任务仍在跑。
重投 jobId 必须带时间戳 `publish-transcode-retry-<id>-<ts>`：BullMQ 对同名 jobId 去重，固定 id 重投会**静默 no-op**。

**缺陷二：`markTranscoding` 无条件写。** api（`publish.service.ts` `transcodeDeps()`）与 worker
（`apps/worker/src/publish-transcode.ts`）两侧原先都是 `.set({status:2}).where(eq(id))`，不看当前状态，
两个执行者并发转同一片源时后写者覆盖中间态（含 shareToken）。改为抢占式：

```ts
or(eq(status, PUB_STATUS_QUEUED),
   and(eq(status, PUB_STATUS_TRANSCODING), lt(updatedAt, cutoff)))   // 接管已死的执行者
```

`.returning({id})` 判断是否抢到，抢不到即 `skipped`（reason `publication already claimed by another transcoder`），
不读源、不写产物。**不能只认 `status=1`**：worker 崩溃后 BullMQ 重投的 job 面对的是停在 `status=2` 的孤儿记录，
只认 1 就等于永远放弃它——故引入 `PUB_TRANSCODE_STALE_MINUTES = 15`（与看门狗 `stuckMinutes` 同源）作为接管窗口。
状态机契约由此由三条不变量增为**四条**：终态不覆盖 / 降级留痕 / 失败不抛 / **单执行者**。

**其余对齐**：`markReady` / `markFailed` 的 `inArray(status, [QUEUED, TRANSCODING])` 守卫此前只有 worker 侧有，
内联路径缺，已逐字对齐。`hooks` 不传时行为退化为第 57 批原口径（超时即失败），保证无队列的部署形态语义不变。

**测试**：shared **7 例**（+1「没抢到转码权 → skipped，不读源不写产物」）、
`apps/worker/src/maintenance-publications.spec.ts` **8 例**（+4：仍在队列 → `revived=0` 且 status 保持 2 /
不在队列且 requeue 成功 → status **保持 2** 且 `updated_at` 推到当前 / requeue false → status=4 且 error 含「无法自动重试」/
探针抛错 → 整轮放弃）、`apps/worker/test/publish-transcode.spec.ts` **11 例**（+7：并发两 job → 结果集恰为
`["ready","skipped"]` 且 reason 含 `claimed`、源只读一次 / `status=2` 且 `updated_at` 1 小时前 → 救回 /
`status=2` 但 `updated_at` 很新 → skipped / 反查正常 / 三种 null 分支不抛）。

---

### 17.18 知识库实体：`knowledge_bases`（迁移 0037）与 5 条 `/knowledge/base*` 端点（第 59 批）

**端点变更**：`knowledge` 模块 **29 → 34** 条。新增 5 条，**均为新增不改动既有端点形状**；唯一被改的是
`GET /knowledge/info` 的响应体（加 `base` 块、删 `note` 字段）。

#### 18.1 为什么现在才做：一条被写错多轮的"结论"

旧文档（本文件 §16.6、主台账 §3.5 D 类、`knowledge.service.ts` 文件头）一致写着：

> 竞品 4 条"知识库实体 CRUD"（`create`:739 / `delete`:740 / `update`:765 / `info/update`:758）我方不做，
> 因为我们是「一 space 一库」。

第 59 批复核 `user_knowledge` 全 29 条路由（`rea-reelmate/routes.txt:737-765`）发现：**这 4 条都没有路径 id 参数**，
而同一批里 `dir/{ukd_id}/move`、`asset/{uk_id}`、`dir/{ukd_id}/asset/{uk_id}/delete` 全都带 id。
**只有一个库，动作才不需要目标 id** —— 路由形状是"一 team 一库"的**正面证据**，而不是"所以不做"的理由。
真实缺口是：`knowledge_dirs` / `knowledge_assets` / `knowledge_tags` 三张表承载了内容，但没有承载
name/description 的实体层。故本批补表 + 补端点，**口径仍是"一 space 一活库"**。

#### 18.2 表

```
knowledge_bases
  id            bigint PK
  space_id      bigint NOT NULL  → spaces.id
  name          text   DEFAULT '团队知识库' NOT NULL
  description   text   DEFAULT ''           NOT NULL
  cover_uri     text   DEFAULT ''           NOT NULL
  note          text   DEFAULT ''           NOT NULL
  created_by    bigint          → users.id  (nullable)
  deleted_at    timestamptz
  created_at    timestamptz DEFAULT now() NOT NULL
  updated_at    timestamptz DEFAULT now() NOT NULL

CREATE UNIQUE INDEX uq_knowledge_bases_space
  ON knowledge_bases (space_id) WHERE deleted_at IS NULL;   -- 偏唯一
```

**偏唯一而不是硬唯一**：一空间只能有一个活库，但"删掉再建"必须能走通；硬唯一索引会让软删后的重建直接撞键。

> ⚠️ **实现禁忌**：一旦索引是偏的，`onConflictDoNothing({ target: knowledgeBases.spaceId })` **必抛**
> `42P10 there is no unique or exclusion constraint matching the ON CONFLICT specification`
> （PG 不能用偏索仲裁 `ON CONFLICT (col)`；psql 直接跑同样报错）。必须用**不带 target** 的
> `.onConflictDoNothing()`，它走"任意冲突"语义，可命中偏索引。首版 4 例全 500 即此原因。

#### 18.3 端点

| # | 方法 | 路径 | 对齐 | 语义 |
|---:|---|---|---|---|
| 30 | GET | `/v1/knowledge/base` | **我方自加** | 只取库实体。`info` 会跑 4 条 count 聚合，页头只要名字不该为它付这个代价 |
| 31 | POST | `/v1/knowledge/base` | `create`:739 | 幂等：已存在返回 `{base, created:false}` 且**不覆盖**现有名称 |
| 32 | POST | `/v1/knowledge/base/update` | `update`:765 | **只改名**。`name` 必填 1–60，空名 → 400101 |
| 33 | POST | `/v1/knowledge/base/info/update` | `info/update`:758 | 简介/封面/提示，**"传了才改"** |
| 34 | POST | `/v1/knowledge/base/delete` | `delete`:740 | 默认只软删库行；`{"purge":true}` 才级联 |

`GET /knowledge/info` 响应新增 `base`（`KnowledgeBaseDto`）并**删除**原 `note: string`（原文案「我方为
『一 space 一知识库』…」在实体落地后已过时）。

**响应示例**（`GET /v1/knowledge/base`）：

```json
{ "code": 0, "msg": "ok", "data": { "base": {
  "id": "108707544764891200", "space_id": "108707544764891137",
  "name": "团队知识库", "description": "", "cover_uri": "", "note": "",
  "created_by": "108707544764891136",
  "created_at": "2026-10-28T07:20:11.000Z", "updated_at": "2026-10-28T07:20:11.000Z"
} } }
```

**删库两种档位**：

| 请求 body | 效果 | 恢复方式 |
|---|---|---|
| `{}` 或省略 | 软删库行；目录/资产/标签**原地保留**，`info` 的 `dir_count`/`asset_count`/`tag_count` 不变，库名回落默认 | 再 `GET /base` 会新建一行，内容还在 |
| `{"purge": true}` | 软删全部目录与资产 + **物理删**标签 | 不可恢复 |

- `purge` 必须显式写进 body：级联不可逆，不能由"没传参数"默认触发。
- 标签走**物理删**：`uq_knowledge_tags(space_id, name)` 是硬唯一索引，软删会让"删库 → 重建 → 建同名标签"
  撞键并回 500；目录/资产无此约束，保留软删以便追溯。
- 找不到（或已软删）时删库 → `400102`。

**为什么改名与改简介分成两条端点**：页头就地改名是高频小动作，若与简介共用一条 patch，
"只想改 1 个字 → 请求体没带 description → 服务端当成清空"是迟早的事故，且不会报错、只会静默丢数据。

#### 18.4 `ensureBase` 与懒初始化

`GET /base`、`GET /info` 都走 `ensureBase()`：先查活库行，没有则 `insert … onConflictDoNothing().returning()`，
无返回再回读一次；两次都拿不到才抛 `500000`。

理由：**读也要能写**。老空间（本批上线前就存在、已有目录/资产）没有库行，若 GET 直接返回 400102，页面会白屏；
懒初始化把它们平滑接上，且并发下靠偏唯一索引 + `onConflictDoNothing` 收敛成一行。

#### 18.5 测试

`apps/api/test/knowledge.spec.ts` **14 → 18 例**，新增 4 例：懒初始化与幂等 / 改名与改概览互不清空 /
删库默认保留内容 vs `purge` 级联 / 跨 space 隔离（冒用 `X-Space-Id` 改库名 → 403101 且原名未变）。

#### 18.6 诚实边界

**字段名是自建口径，待取证**。竞品侧只有路由清单：`capture.json` 中 29 处 `user_knowledge` 命中全是 URL 与
导航组件串（`route:"TeamKnowledgeBase"`、`titleKey:"menu.knowledgeBase"`），**无任何响应体**。
故 `name` / `description` / `cover_uri` / `note` 不能写成"已对齐竞品 schema"。该项在进度表中标「待取证」，
对应 #18 得分 **99%**（非 100%），剩余 0.03 权重等竞品响应体。

> ⚠️ **第 60 批更新**：上面这句「无任何响应体」是当时的取证结论，已被推翻 —— 竞品把 Vite 产物留在了本机
> `rea-reelmate/scripts*/files/origins/<hash>/assets/` 下，从中可取到端点配置对象与知识库枚举/字段规则。
> 详见 **§17.19**。`knowledge_bases` 的字段名（`name`/`description`/`cover_uri`/`note`）**仍是我方口径**，
> 竞品那四条实体端点的请求体形状（`requestDataJsonSchema` 为空对象）依然没有字段级证据。

### 17.19 知识库「模板场景（scene）」维度：迁移 0038 与读接口的 `scene` 参数（第 60 批）

#### 19.1 为什么现在才发现（取证方法更正）

第 40 批起，知识库/画布/Agent 几处都记的是「竞品只给路由清单、无响应体证据」。第 60 批复核后确认
**是取证方法不到位**：竞品的 Vite 产物完整留在本机两个目录里（同 origin hash
`2bdb9ddf0f70fcf8b6132b5151e837cc859b269e34db5a79cba8d0134474e75e`）：

- `rea-reelmate/scripts/files/origins/<hash>/assets/` —— 133 个 js
- `rea-reelmate/scripts-canvas/files/origins/<hash>/assets/` —— 473 个 js（更全）

其中两份对本批决定性：

| 文件 | 大小 | 内容 |
|---|---:|---|
| `core-lib-CKH7gQsw.js` | 1.1 MB | 全部端点的配置对象：`{path, method, paramNames, queryNames, requestDataOptional, requestBodyType, responseBodyType}`。`requestDataJsonSchema` / `responseDataJsonSchema` 均为空对象 → **只有形状，没有字段级 schema** |
| `0zWWdXb_.js` | 6 KB | 知识库枚举（`scene` / `status` / `origin`）、每类场景的字段规则、10 条 tab 定义（含真实表头列名） |

#### 19.2 端点形状（本批直接依据）

| 竞品端点 | method | `queryNames` |
|---|---|---|
| `/web/v1/df/user_knowledge/dir/list` | GET | `["scene","parent_ukd_id"]` |
| `/web/v1/df/user_knowledge/tag/list` | GET | `["scene","query"]` |
| `/web/v1/df/user_knowledge/asset/search` | GET | `["scene","query","scopes","ukd_id","page","page_size","order"]` |

`scene` 是三个读接口的**第一个参数** → 竞品知识库按场景分树、分标签。我方三表原先都无 `scene` 列。

其余 25 条端点的 `paramNames` 也一并确认（例如 `PUT dir/:ukd_id/name`、`POST dir/:ukd_id/asset/import`、
`PUT dir/:ukd_id/asset/:uk_id/name`、`POST tag/{tag_id}/delete`）。结论：**竞品不用 `PATCH`/`DELETE` 动词**
（改名一律 `PUT`、删除与批量一律 `POST`），我方用 `PATCH`/`DELETE`，属"方法口径不同"，
是可选补的兼容入口，**不构成缺口**（语义一一对应，本批不动端点）。

#### 19.3 枚举原文（照抄，值不连续）

```js
// 0zWWdXb_.js —— scene 枚举（缺 8/10/12/13/19，不是笔误）
Style=1, Genre=2, Composition=3, VideoEffect=4, AIStoryboard=5, StoryboardT2i=6, SeeDance2=7,
ScreenplayNovel=9, StoryboardRef=11, Voice=14, ScenePrompt=15, Camera=16, Palette=17,
Expression=18, AudioLibrary=20
// status
Enabled=1, Disabled=2
// origin
Official=1, Team=2
// scene → 业务串（**枚举名与串不同名，四处**：Genre→theme、Voice→tone、
//                                     ScreenplayNovel→novel_to_script、Composition→storyboard）
{1:"style",2:"theme",3:"storyboard",4:"video_effect",5:"ai_storyboard",6:"storyboard_t2i",
 7:"seedance2",9:"novel_to_script",11:"storyboard_ref",14:"tone",15:"storyboard_prompt",
 16:"camera",17:"palette",18:"expression",20:"audio_library"}
```

**我方选择：值照抄不连续编号。** 重排成 1..15 更整齐，但会让同一个 scene 在两边是不同数字，
将来对日志/埋点/竞品接口都多一层翻译。

#### 19.4 每类场景的字段规则（`KNOWLEDGE_SCENE_RULES`）

| scene | 名称上限 | prompt 必填 | prompt 上限 | 封面必填 | 有 prompt 列 | 首期 |
|---:|---:|:---:|---:|:---:|:---:|:---:|
| 0 未分类（我方兼容值） | 200 | — | — | — | ✓ | — |
| 1 风格 | 10 | ✓ | 2000 | — | ✓ | ✓ |
| 2 题材 | 10 | — | — | — | — | ✓ |
| 3 分镜构图 | 10 | ✓ | 200 | ✓ | ✓ | ✓ |
| 4 视频特效 | 10 | ✓ | 200 | ✓ | ✓ | ✓ |
| 5 AI 拆分镜 | 50 | ✓ | 20000 | — | ✓ | ✓ |
| 6 剧本拆分镜（图生视频） | 20 | ✓ | 5000 | — | ✓ | — |
| 7 SeeDance2 | 50 | — | — | — | ✓ | — |
| 9 编剧知识库 | 50 | — | 5000 | — | ✓ | ✓ |
| 11 剧本拆分镜（参考生视频） | 20 | ✓ | 5000 | — | ✓ | — |
| 14 音色模版 | 10 | ✓ | 50 | — | ✓ | ✓ |
| 15 分镜提示词 | 50 | ✓ | 500 | — | ✓ | ✓ |
| 16 / 17 / 18 运镜 / 色调 / 表情 | 50 | — | — | — | ✓ | — |
| 20 音频模版 | 50 | — | — | — | **—** | ✓ |

竞品 tab 的表头列（`columns`）：默认 `["name","prompt","status","updater","updated_at","actions"]`，
**音色/音频类没有 `prompt` 列**（`["name","status","updater","updated_at","actions"]`）—— 这一点也照抄。

#### 19.5 端点变更（无新增端点，只加参数与字段）

所有改动都是**向后兼容的可选参数**，旧调用方（不带 `scene`）行为不变：

| 端点 | 变更 |
|---|---|
| `GET /v1/knowledge/dirs` | 新 query `scene?`；返回节点多 `scene` |
| `GET /v1/knowledge/tags` | 新 query `scene?`；返回项多 `scene` |
| `GET /v1/knowledge/assets` | 新 query `scene?` |
| `GET /v1/knowledge/assets/search` | 新 query `scene?` |
| `GET /v1/knowledge/list` | 新 query `scene?` |
| `GET /v1/knowledge/info` | 新字段 `asset_by_scene: Record<string, number>`（key 为 scene 值字符串） |
| `POST /v1/knowledge/dirs` | body 新 `scene?`（有 `parent_id` 时**以父目录场景为准**） |
| `POST /v1/knowledge/tags` | body 新 `scene?` |
| `POST /v1/knowledge/assets` | body 新 `scene?`（按场景校验名称/prompt） |
| `PATCH /v1/knowledge/assets/:id` | body 新 `scene?` |
| 资产 DTO | 新增 `scene` / `scene_slug` / `scene_name_max_length` / `scene_prompt_required` / `scene_prompt_max_length` / `scene_prompt_column` |

**规则只维护在 `@app/shared` 一份**，随条目下发，前端不抄第二份规则表。

#### 19.6 校验与错误码

| 情况 | 返回 |
|---|---|
| `scene` 不在枚举里（如 `8`） | `400101` + `{field:"scene"}`，msg `unknown knowledge scene`（**不是静默查空**） |
| 同父同场景同名目录 / 同场景同名标签 | **`747007`** + `knowledge name already exists`（竞品同款码，见 `B9INZ4se.js`：`Number(r.code)===747007` + 文案兜底） |
| 条目的 `scene` 与其 `dir_id` 所属场景不同 | `400101`，msg `dir belongs to a different scene` |
| 名称/prompt 超出该场景规则 | `400101` + `{field, scene}`，msg 由规则生成（如 `name must be at most 10 characters for this scene`） |

> 为什么改错误码：竞品前端**靠 `747007` 判重名**（不是靠文案）。我方原来抛 `400101`，
> 会让"与竞品对齐"这件事在错误分支上露馅。

#### 19.7 测试

`apps/api/test/knowledge.spec.ts` **18 → 21 例**，新增 3 例：
① 场景隔离（同名目录/同名标签在不同场景各存一份、tree/tags 按 scene 过滤、子目录跟随父场景、非法场景值 400101）；
② 每类字段规则（风格 name ≤10 且 content 必填、音色 content ≤50、音频模版不要 content、`scene=8` 400101）；
③ 条目跨场景挂目录被拒 + `assets`/`assets/search`/`list` 三处过滤 + `info.asset_by_scene` 计数。

#### 19.8 诚实边界

- `scene` 数值、业务串、每类规则、tab 表头列名：**竞品原文，可对齐**。
- `SeeDance2` / `Camera` / `Palette` / `Expression` 四类**竞品没有文案**（只有 8 个 `phase1` tab 有 i18nKey），
  我方中文译名是自拟的，标「待考证」。
- 条目级字段 `cover_file`（竞品是**逗号分隔多值**，取首图为封面）、`image_files`、`origin_cover_file`
  （竞品还有拼错的历史别名 `orgin_cover_file` 并存）、`status`、`sp_type`、`res_type`、`meta_data`、
  `user_knowledge_info_items`（对应 `list` 的 `show_user_knowledge_info_list` 参数）——**证据已有但本批未落库**，
  属扩展能力，故 #18 只到 **99.5%**。

### 17.20 CLI 的 Agent 分发通道：`skill path` 与随包 Skill 包（第 61 批）

> 本节**没有 HTTP 端点变更**。它记录的是「CLI 怎么把 197 条命令的契约交付给宿主 Agent」——
> 这块此前完全缺失，且不属于 API 语义，但与 API 契约的落地强相关（Agent 照文档调接口）。

#### 20.1 竞品契约原文

竞品把 CLI 接进各类 Agent 的**唯一**方式是随 npm 包分发 Skill，再让宿主整目录拷走。
`_acceptance/reelmate_cli_skill/`（从 `rea-reelmate/reelmate_cli_skill.zip` 解出，63 个文件）里的三处：

```
INSTALL.md:17   reelmate skill-path            → 打印「已安装 npm 包内」的 Skill 目录
INSTALL.md:44   Skill 留在 npm 包内。要给某个 Agent 用时，把 skill-path 的目录整份拷到该宿主的 Skill 目录
INSTALL.md:44   若已有同名 reelmate-cli-skill 先「整目录删除」再拷入（禁止与旧文件合并）
SKILL.md:41     升级时用它整目录替换当前宿主 Skill，不要只跑 npm，不要落地 zip 解压出的 Skill
SKILL.md:8      发布态只依赖当前二进制帮助、本 Skill 和随包命令文档
```

关键在**「整目录替换、禁止合并」**：合并会留下上一版的残留 `.md`，于是 Agent 同时看到新旧两套命令语法——
比完全没有文档更糟。

#### 20.2 本仓实现

| 项 | 值 |
|---|---|
| 命令 | `oneframe skill path [--json]`（挂在一级命令，与竞品同层级） |
| 源码 | `apps/cli/src/skill.ts`（`renderAllFiles()` 纯函数，无 I/O）+ `apps/cli/src/builtins.ts` 的 `case "skill-path"` |
| 生成时机 | `apps/cli/scripts/gen-skill.cjs` 挂在 `build` 尾部；**内容没变就不写盘**（否则每次 build 都弄脏 git） |
| 产物 | `apps/cli/skills/oneframe-cli-skill/`，**43 个文件** |
| 发版 | `package.json` 的 `files: ["dist", "skills"]` —— 缺这项则产物里根本没 Skill |

`--json` 响应（纯本地，`calls` 为空）：

```json
{
  "skill": "oneframe-cli-skill",
  "path": "…/apps/cli/skills/oneframe-cli-skill",
  "installed": true,
  "version": "0.1.0",
  "groups": 38,
  "commands": 197,
  "files": 43,
  "note": "把整个目录整份拷入宿主 Skill 目录；已有同名目录请先删除再拷（禁止合并）"
}
```

`installed` 以包内**是否真有 `SKILL.md`** 判定。目录不完整时（例如只跑了 `tsc` 没跑 `gen:skill`）
`note` 明确提示先 `pnpm --filter @app/cli build` ——否则宿主会拷走一个空目录且毫无察觉。

43 个文件的构成，以及**哪些是手写、哪些是生成**：

| 文件 | 数量 | 手写 / 生成 | 内容 |
|---|---:|---|---|
| `SKILL.md` | 1 | **手写** | frontmatter + `<HARD-GATE>` 8 条 + 10 行路由表 + 命令组总览表 + stdout/stderr 契约 + 升级段 |
| `INSTALL.md` | 1 | **手写** | 9 步 Agent 安装流程 + 手工安装 + 「重复执行即升级」 |
| `VERSION` | 1 | 生成 | 取 `CLI_VERSION` |
| `manual/user-guide.md` | 1 | 生成 | 入门与命令分类 |
| `manual/error-codes.md` | 1 | 生成 | 退出码 0..10 全表 + `error.kind`→退出码 + `BUSINESS_CODE_MAP` 全表 |
| `commands/<group>.md` | 38 | 生成 | 每篇由 `registry.ts` 里该组的 `summary / syntax / evidence / ready` 拼出 |

**为什么命令文档一律生成**：手写 197 条命令文档必然与代码漂移，而漂移的文档比没有文档更糟——
Agent 会照着已改的语法调用，且失败的形态是「参数不认」而不是「命令不存在」，更难定位。

`SKILL.md` 里手写的只有**永远不会从代码推出来的东西**：路由表（什么意图读哪份场景文档）与
`<HARD-GATE>` 行为约束（进度分母来自写死的步骤表、完成总结的输出格式、积分消耗只在流水全匹配时输出、
禁止向用户贴内部 id 常量等）。

#### 20.3 顺带修的退出码缺陷：`747007`

第 60 批给知识库加了「名称重复」专用码 `747007`（依据竞品前端 `Number(r.code)===747007`）。
`apps/cli/src/exit-codes.ts` 的 `BUSINESS_CODE_MAP` 当时没跟：

```ts
// 第 61 批：知识库重名。第 60 批只加了后端码，CLI 侧缺映射会落进 internal/1 让脚本重试。
747007: { kind: "usage", exit: EXIT.USAGE },
```

未映射的业务码一律落进 `internal` → **进程退出码 1**，调用方的重试逻辑于是把
「改个名字就能过」当成服务故障反复重试。这不是文档问题，是真缺陷。

#### 20.4 测试

`apps/cli/test/skill.spec.ts` 新增 **6 例**（cli 91 → 97）：

| # | 断言 | 钉住什么 |
|---:|---|---|
| 1 | 磁盘产物与 `renderAllFiles()` **双向逐字节**一致 | 少一个=忘了生成、多一个=旧版残留，**两个方向都红** |
| 2 | `SKILL.md` frontmatter + `VERSION` == `CLI_VERSION` | 版本号不会与包版本脱钩 |
| 3 | 每条 registry 命令都出现在某个 `commands/<group>.md` 的 ``## `<id>` `` | 新加命令不写文档 = 红 |
| 4 | `error-codes.md` 覆盖退出码全集 + `747007` + 「退出码是 1 不是 3」 | 退出码语义 |
| 5 | `skill path --json`：`installed:true`、**`calls` 为空** | 纯本地命令不许碰网络 |
| 6 | `commandSyntax` 恰为 `oneframe skill path [--json]`；`--help` 走纯文本分支 | 语法与 `--json` 契约 |

#### 20.5 MCP 端：据实改为「无形状可对齐」，不实现

此前多轮把 #9 的缺口写成「**MCP 0 行**（竞品未公开工具清单 → 待取证后再做）」。第 61 批把竞品两个
bundle 目录的 **606 个 js** 全量扫 `mcp`，只有 **3 处命中**：

| 文件 | 命中内容 | 含义 |
|---|---|---|
| `C_zfNpOW.js` | `O("MCP_CLI")`、`menu.mcpCli` | 侧栏一个 **flag 门控入口** |
| `D7aUDXP7.js` | `integration_type ∈ {plugin, mcp}` | 埋点归因参数 |
| `D7aUDXP7.js` | `client_source ∈ {cli, web}` | 埋点归因参数 |

**竞品不存在 MCP server、没有工具清单、没有 scope 定义、没有一个 `tools/list`。**
「等竞品给工具清单」这个假设本身不成立——继续挂着它，等于把一个**不存在的依赖**写成"待取证"。
故本仓 MCP 端**不实现**（无形状可对齐，自造一套 MCP server 反而是伪对齐）；
#9 剩余 0.32 全部来自 **57 条骨架命令**（各自卡在对应后端端点未落地）。

#### 20.6 边界

- **宿主 Skill 目录探测不做**：竞品 `INSTALL.md:18` 明确「不要扫描其他工具的配置目录」——
  猜错会往无关目录里拷文件。路径由用户或宿主规则给出。
- **`skill path` 只报路径、不替用户拷**：与竞品契约一致（它也只打印路径）。
- **骨架命令的文档照写**：`commands/*.md` 里明确标 `ready: false` 与原因，
  让 Agent 知道"这条还没实现"而不是"我调错了"。

### 17.21 画布封面与「全部项目」元信息：迁移 0039 与 `POST /canvas/canvases/:canvas_id/cover`（第 62 批）

#### 21.1 为什么现在才做：竞品有封面，我方恒为 `null`

竞品证据（Vite 产物 `_acceptance/competitor_endpoints.tsv`、`DDLTpMu7.js`、`Cp3a6_yk.js`）：

```
GET /web/v1/df/script_project/list
    queryNames = page, page_size, name, group_id, process_status, sp_source,
                 sp_type, project_category, project_subcategory, project_categories
    列表项    = sp_id, name, cover, covers[], updated_at, created_at, creator_nick,
                 group_id, group_name, sp_source, sp_type, project_category, project_subcategory
Cp3a6_yk.js  function N(e){ return { cover: e.cover||"", covers: Array.isArray(e.covers)? e.covers.filter(a=>!!a) : [] } }
Cp3a6_yk.js  function U(e){ const {cover,covers}=N(e); return covers.length>0 ? covers : (cover? [cover] : []) }
Cp3a6_yk.js  function q(e){ const a=e.cover||""; return a || U(e)[0] || "" }
Cp3a6_yk.js  设封面  = POST /df/script_project/edit { cover: <file_id>, sp_id }
Cp3a6_yk.js  改名    = POST /df/script_project/edit { name, sp_id, only_name: true }
Cp3a6_yk.js  换分组  = POST /df/script_project/:sp_id/group/edit
```

两条关键事实：① 封面是 **file_id**（不是 URL）；② 展示口径是 `cover || covers[0] || ""`，即"单封面 + 多图列表"并存。

我方 `/works` 的画布行此前 `cover_uri` **恒为 `null`**（`works.service.ts` 的 `queryCanvas` 只统计 `node_count/running_nodes/failed_nodes`），前端画布卡片只渲染空占位——用户面上就是"画布项目永远没有封面"，而竞品有。

#### 21.2 数据层：迁移 0039

```sql
ALTER TABLE "canvases" ADD COLUMN "cover_asset_id" bigint;
ALTER TABLE "canvases" ADD CONSTRAINT "canvases_cover_asset_id_assets_id_fk"
  FOREIGN KEY ("cover_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null;
```

| 决定 | 理由 |
|---|---|
| 存 `cover_asset_id`，不存 URL | URL 带签名与对象 key，素材删除或存储换域名后就是死链；外键 `on delete set null` 让"人工封面没了"自动退回自动兜底，而不是留一个 404 的 `img` |
| `null` = 未人工指定 | 与"显式清空"语义一致：清空写 `null` 后回落自动兜底，而不是显示空白 |

迁移总数 39 → **40**（`0039_quiet_carlie_cooper.sql`），表数仍 112。

#### 21.3 端点数：+1（不塞进 `PATCH /canvas/canvases/:id`）

| 方法 | 路径 | Body | 语义 |
|---|---|---|---|
| POST | `/v1/canvas/canvases/:canvas_id/cover` | `{ node_id?: string \| null, asset_id?: string \| null }` | 设/清封面。`node_id` 优先 → 解析该节点产物；否则用 `asset_id`；**都不传 = 清除**（回落自动兜底）。响应 `{ cover_asset_id, cover_uri, covers }` |

为什么独立端点：`PATCH /canvas/canvases/:id` 的改名要带乐观锁 `version`（并发编辑冲突检测），封面与画布内容无关，塞进去会让"只想换个封面"也必须提交版本号、误触发冲突条。

三档取值与错误码：

| 输入 | 行为 | 失败 |
|---|---|---|
| `node_id` | 查 `canvas_nodes.task_id` → `assets where source_task_id = taskId and kind='image' and deleted_at is null order by id desc limit 1` | 节点无产物 → **400102** `node has no produced image asset yet` |
| `asset_id` | 正则 `/^\d{1,20}$/` 校验后查 `assets`（限同 space、未删） | 非数字 → **400101**；查不到/跨 space → **400102** `asset not found` |
| 都不传 | 写 `cover_asset_id = null`，读路径回落自动兜底 | — |

自动兜底（`autoCoverAssetId`）的 join 方向只有一条：`canvas_nodes.task_id` → `assets.source_task_id` —— 产物是**任务**写的，不是节点写的。

#### 21.4 `/works` 的响应字段扩展（无新端点）

画布行（`kind=canvas`）新增/补齐：

| 字段 | 来源 | 说明 |
|---|---|---|
| `cover_uri` | 人工封面优先，否则自动兜底；`storage.signDownload(uri, 3600)` | 原来恒为 `null` |
| `covers[]` | `cover_uri ? [cover_uri] : []` | 对齐竞品 `covers[]` 形状；我方是单封面，**不伪造多图** |
| `creator_nick` | `users.nickname`（`canvases.owner_user_id`） | 竞品同名 |
| `last_edited_at` | `canvases.last_edited_at` | 竞品 `updated_at`；前端优先用它排序/显示 |

工坊行（`kind=workshop`）同样补 `covers[]`、`creator_nick`、`last_edited_at`，但后两者恒为 `null`：

> `script_projects` 没有"创建人"字段。回填空间 owner 等于把"空间所有者"伪装成"项目创建人"，是伪造数据，不做。

#### 21.5 查询参数：接两个竞品别名，明确拒绝六个

| 竞品参数 | 我方 | 行为 |
|---|---|---|
| `name` | `keyword` | **别名接住**；两个都给时 `name` 优先 |
| `process_status=-1` | `status=all` | **别名接住**（竞品 `-1` = 全部） |
| `process_status` 其它值 | — | **400101**：语义竞品前端未暴露枚举，不外推 |
| `group_id` / `sp_source` / `sp_type` / `project_category` / `project_subcategory` / `project_categories` | 无对应维度 | **zod 拒绝**，并在 `07-plan` 登记为口径差异 |

拒绝而不是忽略的理由：静默忽略会让调用方以为筛过了，拿到的是没筛的全集——比报错更危险。

#### 21.6 测试

`apps/api/test/works-aggregate.spec.ts` 6 → **9 例**：

1. 无人工封面时自动取"画布内最近一次图片节点产物"，`/works` 返回签名后的 `cover_uri` 且 `covers` 恰为 `[cover_uri]`；
2. `POST .../cover` 人工指定 → 优先；`node_id` → 解析到该节点产物；`{}` 清除 → 回落自动；跨 space → 400102；`"not-a-number"` → 400101；`"9999999999"` → 400102；
3. 参数别名：`name=` 命中目标项目、`process_status=-1` 含归档、`process_status=1` → 400101。

#### 21.7 诚实边界

- 项目分组（`group_id`/`group_name` + `POST /df/script_project/:sp_id/group/edit`）与五档分类（`project_category` = SHORT_FILM/DRAMA/FILM，`project_subcategory` = ALL/AI_SHORT_FILM/AI_AD_DRAMA/AI_DRAMA/VIDEO_REDRAW，证据已取到）**本批未做**——所以 #5 只从 90% → 94%，并把这两项据实从"卡竞品证据"改记为 A 类"待排期 0.18"（见 `07-plan` §3.5）。
- 竞品"封面可多图（`covers[]`）"只做了形状兼容，没有多封面选择 UI；我方语义是单封面 + 自动兜底。

---

### 17.22 项目归属组与竞品两级分类投影：迁移 0040 与 `POST /script/projects/:project_id/group`（第 63 批）

#### 22.1 为什么现在才做：先纠正一个语义

第 62 批把「项目分组 + 五档分类」记成"证据已拿到、待排期"，但当时只拿到了**参数名**（`group_id` / `project_category` / `project_subcategory`），没拿到**语义**。本批先把语义钉死：

```
// Cp3a6_yk.js —— 换组动作
g.open("project-change-group", { sp_id, old_group_id: t.group_id ?? "0", old_group_name })

// DDLTpMu7.js —— 文案 key（关键判据）
project.groupOwnership.changeModal.title
project.groupOwnership.tooltip.noPermission
data-testid="home-film-project-change-group"    // 按钮，由 canChangeGroup 控制 disabled

// D7aUDXP7.js —— 端点 → 权限码（分组 CRUD 在团队域，不在 script_project 域）
POST /web/v1/cam/team/:team_id/group                  → group.create
POST /web/v1/cam/team/:team_id/group/:group_id/edit   → group.edit
POST /web/v1/cam/team/:team_id/group/:group_id/delete → group.delete
GET  /web/v1/cam/team/:team_id/groups                 → group.view
POST /web/v1/cam/team/member/change-group             → group.member_change
```

结论：竞品的「分组」是**项目归属团队分组**（`groupOwnership`），不是「项目文件夹」；分组本身的 CRUD 在团队域。`script_project` 域自己只有两个 group 相关端点：`list` 的 `group_id` 查询参数、`POST /script_project/:sp_id/group/edit`。

#### 22.2 数据层：迁移 0040

```sql
ALTER TABLE "script_projects" ADD COLUMN "group_id" bigint;
ALTER TABLE "script_projects" ADD CONSTRAINT "script_projects_group_id_team_groups_id_fk"
  FOREIGN KEY ("group_id") REFERENCES "public"."team_groups"("id") ON DELETE set null;
CREATE INDEX "idx_script_projects_group" ON "script_projects" USING btree ("space_id","group_id");
```

三个刻意决定：

| 决定 | 内容 | 为什么 |
|---|---|---|
| 复用 `team_groups` | 不新建「项目分组」表 | 竞品分组 CRUD 在团队域；两套分组会造成两套权限、两套计数，且用户在两处看到互不相通的"分组" |
| `on delete set null` | 组删除 → 项目退回未分组 | 悬空外键会让列表投影出错，级联删除更糟（删一个组连带删项目） |
| 取消分组写 `null` | 接 `null` / `"0"` / `""`，内部统一 `null` | 写 `0` 会留下悬空外键（`team_groups` 没有 id=0） |

#### 22.3 端点：`POST /v1/script/projects/:project_id/group`

对齐竞品 `POST /df/script_project/:sp_id/group/edit` 的语义（换组 / 取消分组），但走我方 REST 形状：

请求：

```json
{ "group_id": "123" }
```

| 入参 | 类型 | 语义 |
|---|---|---|
| `group_id` | `string \| null`（可选） | 数字 id = 归到该组；`null` / `"0"` / `""` / 不传 = 取消分组 |

响应 `data`：

```json
{ "id": "456", "group_id": "123", "group_name": "第一组" }
```

取消分组时回 `{ "id": "456", "group_id": "0", "group_name": null }`（`"0"` 只是**对外**的"未分组"表示，对齐竞品 mapper 的缺省值；库里存 `null`）。

错误码：

| 场景 | code | msg |
|---|---|---|
| `group_id` 不是数字（非 `"0"`/空） | 400101 | `group_id must be a numeric id or 0` |
| 组不属于本 space | 400102 | `group not found in this space` |
| 组存在但已停用（`status !== 1`） | 400101 | `group is disabled` |
| 项目不存在 / 不属于本 space | 400102 | （沿用项目自身校验） |

#### 22.4 `/works` 新增字段与查询参数

响应行新增（工坊与画布**两种形态都下发**，保证前端不用按形态分支）：

| 字段 | 工坊（workshop） | 画布（canvas） |
|---|---|---|
| `group_id` | 归属组 id；未分组为 `"0"` | 恒 `"0"` |
| `group_name` | 组名（子查询 `team_groups.name`） | 恒 `null` |
| `project_mode` | `1` / `2`（广告剧）/ `3`（转绘）；未知按 `1` | 恒 `null` |
| `project_category` | 由 `workCategoryOf()` 反算：mode1→2、mode2→1、mode3→2 | 恒 `1` |
| `project_subcategory` | mode1→3、mode2→2、mode3→4 | 恒 `1` |

新增/接通的查询参数：

| 参数 | 语义 |
|---|---|
| `group_id` | 归到该组；`"0"` 或空 = 只回未分组 |
| `project_category` + `project_subcategory` | 竞品五档分类 → 翻成 `kind`/`project_mode`（见 22.5） |
| `project_categories` | 逗号多选（如 `1,2`），逐个翻译 |

`sp_source` / `sp_type` 继续**拒收**（我方无对应维度，不由 zod 接受）。`name` ≡ `keyword`、`process_status=-1` ≡ `status=all` 是第 62 批已接的别名。

#### 22.5 两级分类的映射与拒收规则

实现集中在新文件 `packages/shared/src/project-category.ts`（唯一真相，前后端共用）：

| 竞品 tab | `project_category` | `project_subcategory` | 我方 `kind` | `project_mode` |
|---|---:|---:|---|---:|
| AI 剧（DRAMA_WORKFLOW） | 2 | 3（AI_DRAMA） | `workshop` | 1 |
| 画布（CANVAS） | 1 | 1（AI_SHORT_FILM） | `canvas` | — |
| 广告剧（AD_DRAMA） | 1 | 2（AI_AD_DRAMA） | `workshop` | 2 |
| 视频转绘（VIDEO_REDRAW） | 2 | 4（VIDEO_REDRAW） | `workshop` | 3 |
| 影视版（FILM） | 3 | 0（ALL） | **无对应** | — |

拒收规则（均为 `400101`，`field` 指向出错的参数）：

1. `project_category=3`（FILM）：我方由独立影视模块承接，未合流到 `/works`。msg 说明由影视模块提供，**不假装支持**。
2. `project_category=1` 单给（不带 `project_subcategory`）：**二义**（画布 vs 广告剧），要求补 subcategory。
3. `project_subcategory` 非法值（如 `9`）。
4. `project_categories` 逗号多选中**任一项**不支持 → 整体拒绝，不做"能筛多少筛多少"。

> 为什么"静默忽略"不可接受：调用方按竞品参数筛完拿到未筛选的全集，会以为筛选生效了——这比报错危险得多。这也是本文件第 62 批起对所有"未接参数"的统一口径。

#### 22.6 一个只有跑测试才暴露的 bug

`tab=all` 时工坊与画布两路各自过滤后内存归并，而画布那路的 `canvasFilterable` 只看 `kind`/`keyword`/时间段，**不吃 `group_id`/`projectMode`** → 「按组筛选」的结果里混进了**所有画布**。修法：设了 `projectMode` 直接排除画布；`groupId` 非空且非 `"0"` 时也排除（画布没有分组概念）。

测试夹具坑：该测试空间的登录会自动带一条示例作品（`is_sample=1`，标题「示例：雨夜来信」），凡是"只回我造的项目"的断言都要按 `stamp` 过滤。

#### 22.7 测试与诚实边界

`apps/api/test/works-aggregate.spec.ts` **9 → 11 例**：

1. 赋组 → `/works` 带出 `group_id`/`group_name` → 按组过滤只回该项目 → `"0"`/`null`/`group_id=0` 三种取消写法都能清空 → 跨空间组 400102、`"abc"` 400101、不存在组 400102；
2. 竞品两级分类投影（画布 1/1、剧本 2/3）与四类拒收（FILM、二义、非法 subcategory、多选含不支持）。

**边界（都写进文档、不当成已对齐）**：

- 五档 tab 的**列表 UI** 未做：我方 tab 仍是形态维度（工坊/画布/全部），分类只做到**参数层**；
- FILM 档不假装支持；
- 画布没有分组概念（恒 `"0"`），这是竞品也没有的能力，不是我方缺口；
- 因此 #5 只从 94% → **97%**（+0.09），剩 0.09 记在 `07-plan` §5 第 5 行。

---

### 17.23 Agent Skill 市场：竞品 9 条形状、`name_en` 提列与 `PUT /agent-skills`（第 64 批）

#### 23.1 为什么现在才做：不是"补一个端点"，是"清单一直在"

`07-plan/implement-progress-vs-reelmate.md` 的 #4 缺口栏从第 4 批起写着「平台 Skill 档位与竞品对齐需竞品清单」。第 64 批先去确认这份清单存不存在——`_acceptance/competitor_endpoints.tsv`（从 `core-lib-CKH7gQsw.js` 的 934 个端点配置对象去重导出，**904 条唯一端点**）里 `canvas/agent-skills` 共 **9 条**，每条都带 `queryNames`：

| # | 方法 | 路径 | 参数（竞品 `paramNames` / `queryNames`） |
|---|---|---|---|
| 1 | GET | `/web/v1/df/canvas/agent-skills/plaza` | query: `category`, `name`, `page`, `page_size`, `is_home_recommend` |
| 2 | GET | `/web/v1/df/canvas/agent-skills/favorites` | query: `page`, `page_size` |
| 3 | GET | `/web/v1/df/canvas/agent-skills/mine` | query: `status`, `page`, `page_size` |
| 4 | GET | `/web/v1/df/canvas/agent-skills/details` | query: `skill_id`, `owner_type` |
| 5 | POST | `/web/v1/df/canvas/agent-skills` | — |
| 6 | PUT | `/web/v1/df/canvas/agent-skills` | **params/query 全空 ⇒ 目标卡只能从 body 带** |
| 7 | DELETE | `/web/v1/df/canvas/agent-skills/:skill_id` | params: `skill_id` |
| 8 | POST | `/web/v1/df/canvas/agent-skills/:skill_id/favorite` | params: `skill_id` |
| 9 | DELETE | `/web/v1/df/canvas/agent-skills/:skill_id/favorite` | params: `skill_id` |

注意第 6 条：竞品的**更新没有路径 id**，目标卡从 body 的 `skill_id` 取。这与第 59 批知识库实体的判据同一手法——**路由形状本身就是证据**。

bundle 侧的字段用法（`_acceptance/out_probe64.txt`）：

```
we.name_en?.trim()===t.trim()                       // 按英文名精确查重
lookupPlazaSkillByNameEn(...)                        // 同名反查
Vr.addSkillRef({skill_id, name, name_en, owner_type})// 引用时三个字段一起带
d.owner_type===1||d.owner_type===2                   // 只接受 1/2
owner_type:1                                         // 平台卡引用固定写 1
```

权限模块 `canvas_agent_skill`；埋点 `canvas_agent_skill_recommendation_expose` / `_click`、`agent_skill_favorite`、`agent_skill_create`。

#### 23.2 三块真缺口

| 缺口 | 竞品证据 | 我方原状态 | 后果 |
|---|---|---|---|
| 无更新端点 | `PUT /canvas/agent-skills` | 只有 `POST`（新建）与 `DELETE` | 改名只能删了重建，`favoriteCount`/`useCount` 归零 |
| 四个筛选参数未接 | `plaza`: `name`/`is_home_recommend`；`mine`: `status`；`details`: `owner_type` | `listQuerySchema = {page, page_size, category, q}` | 按名字查、按推荐位筛、看下架卡全做不到 |
| DTO 缺三字段 | `name_en` / `owner_type` / `is_home_recommend` | 只有 `slug`（藏在 `config` 里） | 前端要靠猜平台卡与团队卡、英文名只能从 `config` 里挖 |

#### 23.3 迁移 0041：`name_en` 为什么必须提列

```sql
ALTER TABLE "agent_skills" ADD COLUMN "name_en" text DEFAULT '' NOT NULL;
ALTER TABLE "agent_skills" ADD COLUMN "is_home_recommend" boolean DEFAULT false NOT NULL;
CREATE INDEX "idx_agent_skills_home" ON "agent_skills" USING btree ("is_home_recommend","use_count" DESC NULLS LAST);
-- ↓ 手工追加（前 3 条由 drizzle-kit generate 生成）
UPDATE "agent_skills" SET "name_en" = COALESCE("config"->>'slug', '') WHERE "name_en" = '';
```

我方原先把英文名放在 `config.slug`（jsonb）。这带来三个硬伤：

1. **不能建索引**——按英文名查要全表 `config->>'slug'`；
2. **不能在 SQL 层查重**——两张卡的斜杠指令名撞车时，只能靠**前端第一次匹配到谁**，谁先谁生效；
3. **不能稳定排序/筛选**。

第 4 条 `UPDATE` 是刻意的：只加列不回填，等于把已有的斜杠指令名留在 JSON 里继续飘。实测回填后 33 张平台卡 `with_name_en = 33`（全部有值）。迁移 41 → **42**。

#### 23.4 `PUT /v1/agent-skills` 的请求与错误码

```jsonc
// 请求（skill_id 必填，其余「传了才改」）
{
  "skill_id": "1234567890123456789",
  "name": "新名字",
  "name_en": "new-slug",
  "summary": "一句话简介",
  "category": "general",
  "prompt_template": "……",
  "config": { "any": "json" },
  "visibility": 2,
  "cover_uri": "u/1/assets/abc.png"
}
```

| 场景 | HTTP | code | msg / field |
|---|---:|---:|---|
| 成功 | 200 | 0 | 返回更新后的 `AgentSkillDto` |
| `skill_id` 缺失 / 非数字 | 200 | 400101 | zod 消息 / `field: skill_id` |
| 卡片不存在 | 200 | 400102 | — |
| 别的空间 | 200 | 400102 | — |
| 平台卡（`space_id is null`）| 200 | 403101 | `platform skill cannot be edited`，reason `platform_skill` |
| 本空间非创建人 | 200 | 403101 | `only the creator can edit this skill` |
| `name_en` 同空间重复 | 200 | 400101 | `name_en already exists in this space`，`field: name_en` |
| `name_en` 不合 `[a-z0-9-]` | 200 | 400101 | zod 正则消息 |

**改 `name_en` 时列与三个派生态同步**：`agent_skills.name_en`（列，供 SQL 查重/筛选）、`config.name_en`、`config.slug`、`config.slash`。老前端还在读 `config`，只改列会让新旧两处指令名分裂。

#### 23.5 四个参数的语义（都有坑）

| 参数 | 语义 | 不显然处 |
|---|---|---|
| `plaza?name` | `or(ilike(name), ilike(nameEn))` | **与 `q` 刻意分开**：`q` 是全文（含 `prompt_template`），按名字查的用户会看到 prompt 里偶然提到该词的卡，以为筛错了 |
| `plaza?is_home_recommend` | 三元：不传=不过滤、`1`=只推荐位、`0`=**排除**推荐位 | 把 `0` 当"全部"是这参数最常见的误读；`1/0/true/false` 四种写法都认 |
| `mine?status` | `eq(status, query.status ?? 1)` | **不能沿用写死 `status=1` 的 `alive()`**：运营下架的卡要能在「我的」里被看见并恢复，写死就永远捞不回来 |
| `details?owner_type` | 1 → `isNull(spaceId)`（平台卡）、2 → `isNotNull(spaceId)`（团队卡），不符 400102 | **只做收敛、不做探测**：不收敛的话调用方可拿它反查某个 id 属于谁；非法值（如 3）→ 400101 |

`owner_type` 同时下发在 DTO 里：`owner_type = row.spaceId === null ? 1 : 2`（竞品原文 `d.owner_type===1||d.owner_type===2`，平台卡引用固定写 `1`）。

#### 23.6 测试

`apps/api/test/agent-skills.spec.ts` **9 → 11 例**：

1. **更新卡片：仅创建人可改、`name_en` 查重、平台卡 403、他人不可见** —— 建卡（`name_en: "e2e-edit-me"`）→ 断言 `owner_type === 2` → PUT 改 name/summary/name_en/visibility/prompt_template → 断言 **`config.slug`/`config.name_en`/`config.slash` 三处同步**；同空间建同名 `name_en` → 400101 且 msg 含 `name_en`；平台卡 PUT → 403101；别人的空间 PUT → 400102；`{}`、非数字 `skill_id`、`Bad Slug!` → 400101；`9999999999` → 400102。
2. **竞品形状：`name` / `is_home_recommend` / `mine?status` / `details?owner_type` 都能筛** —— plaza 首卡 `owner_type === 1`、`is_home_recommend === false`；`?name=<显示名>` 与 `?name=<name_en>` 均命中；`is_home_recommend=1` 默认 0 张 → db 置 `true` 后恰 1 张，且 `?is_home_recommend=0` **不含**它（`finally` 复位）；`details?owner_type=1` 命中、`=2` → 400102、`=3` → 400101；建卡后 db 置 `status: 2` → `mine` 默认不含、`mine?status=2` 含且全为 2、`mine?status=3` → 400101。

#### 23.7 诚实边界

- **竞品只给了接口形状 + 字段名**，没有**广场卡内容**与**首页推荐位编排**的数据证据：`is_home_recommend` 在 bundle 里只作为筛选参数出现，没有任何"哪些卡该上推荐位"的规则或默认值。故 `is_home_recommend` 默认全 `false`、推荐位策略仍按自建口径（运营后台勾选），**不写成"已对齐"**。
- 因此 #4 只从 95% → **96%**（+0.20），剩 **0.80** = 真实 ASR 凭据约 **0.60** + 运营位内容约 **0.20**；两个数是**判断不是实测**，已在该行写明各自估算。
- 端点总数 **701 → 702**，迁移 **41 → 42**（`0041_lyrical_darkhawk.sql`），用例 **1,246 → 1,248**（api 875 → 877）。

### 17.24 CLI 命令路径与后端路由的契约（第 65 批）

> 本节记录一条**不是新端点、但会让端点全部白做**的约定：`apps/cli` 的命令 `path` 必须等于后端真实路由（去掉 `/v1` 前缀）。

#### 24.1 规则

| 项 | 规则 |
|---|---|
| 来源 | 后端路由由 `@Controller("base")` + `@Get/@Post/...("sub")` 决定，最终是 `/v1/<base>/<sub>` |
| CLI 写法 | `registry.ts` 里 `path` 写 **`<base>/<sub>`**（不带前导斜杠、不带 `/v1`），由 `src/http.ts` 拼成 `API_BASE + "/" + path` |
| 占位符 | registry 用 `{param}`，后端用 `:param`；两者在比对时必须都归一成 `{}` |
| 常见错误 | **漏模块前缀**：同一资源在多个 controller 下时（canvas 家族 8 个 controller 全挂 `@Controller("canvas")`），最容易写成 `canvases/...` 而漏掉 `canvas/` |

#### 24.2 第 65 批修掉的 36 条

全部在 canvas 家族，`registry` 侧的 `path` 缺 `canvas/`：

| 组 | 命令 | 修前 path | 修后 path |
|---|---|---|---|
| canvas | `create`/`list` | `canvases` | `canvas/canvases` |
| canvas | `get`/`edit`/`delete` | `canvases/{canvas_id}` | `canvas/canvases/{canvas_id}` |
| canvas | `template-publish` | `canvases/{canvas_id}/tpls` | `canvas/canvases/{canvas_id}/tpls` |
| canvas | `template-list`/`template-get`/`template-apply` | `templates…` | `canvas/templates…` |
| canvas | `snapshots` | `canvases/{canvas_id}/snapshots` | `canvas/canvases/{canvas_id}/snapshots` |
| node | `create`/`batch-create`/`list`/`get` | `canvases/{canvas_id}/nodes…` | `canvas/canvases/{canvas_id}/nodes…` |
| node | `edit`/`delete`/`generate`/`table-import`/`table-confirm`/`edge` | 同上 | 同上 |
| group | `create`/`delete`/`template-save`/`template-list` | `canvases/{canvas_id}/groups…`、`…/group-templates` | 加 `canvas/` |
| pin-group | `create`/`delete`/`list` | `canvases/{canvas_id}/pin-groups…` | 加 `canvas/` |
| material | `add`/`list`/`delete` | `canvases/{canvas_id}/materials…` | 加 `canvas/` |
| script | `storyboard`/`asset-extract`/`asset-match`/`rematch`/`cancel`/`optimize` | `canvases/{canvas_id}/nodes/{node_id}/…` | 加 `canvas/` |

运行时证据（api 起在 3002）：

```
GET /v1/canvases         → 404 {"code":400102,"msg":"Cannot GET /v1/canvases"}
GET /v1/canvas/canvases  → 200 {"code":401101,"msg":"missing bearer token"}
GET /v1/templates        → 404
GET /v1/canvas/templates → 200 {"code":401101,...}
```

#### 24.3 守卫测试

`apps/cli/test/registry-routes.spec.ts`（2 例，新增于第 65 批）：

1. **跨包一致性**：只读地读 `apps/api/src/**/*.controller.ts`，用同一套归一化规则建路由集，断言所有 `ready` 且走 HTTP 的命令 `(method, path)` 都在集合里；
   找不到 api 源码时 skip（发布态的独立包不需要这条）；并用 `routes.size > 600` 防"解析失败 → 空集合 → 假绿"。
2. **canvas 家族必须带 `canvas/` 前缀**（第 65 批那 36 条的具体形状）。

已做**反向验证**：把一条 path 改成坏值 → 两例立刻红；改回 → 绿。

#### 24.4 诚实边界

- 守卫只保证**路径形状**一致；query 参数名（如 `group_id`/`owner_type`）、body 字段、权限语义仍需逐批对照竞品 bundle 与集成测试；
- 这批是**可用性修复**不是新能力：CLI 仍有 57 条 `skeleton` 命令卡在后端未落地的端点，因此 #9 只从 96% → **97%**（+0.08）；
- 同类风险点：任何"人工写死 URL 字符串 + 人工判断 ready"的地方（例如 `apps/web` 的手写 `$fetch` 路径）都可能出现同样的漂移，本批未做全站扫描。

### 17.25 前端 API 路径与后端路由的契约（第 66 批）

#### 25.1 为什么前端也需要一条"路由契约"测试

`/works` 页的分组下拉从来没出现过。原因不是 UI：`apps/web/pages/works.vue` 调的是 `GET /team/groups`，而后端的分组接口挂在 `TeamController`（`@Controller("cam")`）下，真实路径是 `/cam/team/groups`。404 被 `loadGroups()` 的 `catch` 吞成 `groups.value = []`，页面表现成"没有分组"，于是类型检查、lint、构建、总闸 12 项、页面 smoke 全部通过。

这与 §17.24 的 CLI 死链是同一类缺陷：**调用方的路径字符串没有和路由定义发生过一次机械比对**。

#### 25.2 审计方法与结果

| 项 | 做法 | 结果 |
| --- | --- | --- |
| 后端路由表 | 递归读 `apps/api/src/**/*.controller.ts`，**按 `@Controller` 出现位置切段**逐段收集方法装饰器 | 701 条 |
| 前端调用 | 扫 `apps/web/**/*.{ts,vue}` 的 `api.<verb>(<首参>)`，首参只接受以 `/` 开头的字符串/模板字面量 | 408 条可解析 |
| 比对 | 两侧 `:id` / `{id}` / `${...}` 归一成 `{}` 并互为通配（web 的 `${kind}` 常是 `"buy" \| "preorder"` 这种字面量联合） | **1 条不匹配** |
| 未覆盖 | 首参是变量或拼接前缀（如 `canvasBase()`） | 133 处，故意不扫 |

唯一的不匹配就是 25.1 的 `works.vue`。修复：路径改 `/cam/team/groups`，并在注释里写清"`catch` 会把 404 静默吞成没有分组"这一机制，避免下一个人再复制这种写法。

#### 25.3 审计脚本自身的两个错误（差点制造假缺陷）

1. **一个 controller 文件可以有多个 `@Controller` 类**。`admin` / `agent-stt` / `novel-variant` / `op` / `task-share` 五个文件如此。只解析第一个会把后续控制器的方法错挂到第一个的 base 上 —— `RedeemCodeController`（`@Controller("redeem-code")`，位于 `op.controller.ts` 下半部分）因此被算成 `/op/redeem-code/redeem`，导致 `apps/web/pages/invite.vue` 里正确的 `/redeem-code/redeem` 被误报。
2. **首参正则必须锚定在动词之后**。搜索式正则在 `api.post(path, {...})`（首参是变量）时会向后跳过，把下一条调用的字面量错配给上一条动词，实测把 `api.get("/crc/assets/me?status=3")` 报成 `POST /crc/assets/me`。

两处修正后结果才可信：`408 → 1 条真缺陷`。

#### 25.4 守卫：`apps/api/test/web-api-contract.spec.ts`

| 用例 | 断言 | 防的是 |
| --- | --- | --- |
| 后端路由量 | `> 600` | 解析失败 → 空集合 → 全量匹配假绿 |
| web 调用量 | `> 300` | 正则失效 → 0 处可比 → 假绿 |
| 全量匹配 | 408 条全部命中后端路由（占位符互为通配） | 本类缺陷复发 |
| 回归锚点 | `GET /cam/team/groups` 存在、`GET /team/groups` 不存在 | 有人把路径改回去 |

反向验证：把 `works.vue` 改回缺陷值 → 立刻红并打印 `GET /team/groups ← pages\works.vue:105 raw=/team/groups`；改回即绿。

#### 25.5 覆盖边界

- 只覆盖静态可解析的 408 处；133 处变量拼接前缀不覆盖（`useCanvasApi.ts` 占 48 处，`NovelOriginalChain.vue` 28 处，`pages/novel/[id].vue` 23 处）。
- 只校验"路径形状存在"，不校验 query 名、body 字段、HTTP 语义。
- 与 §17.24（CLI↔后端）互补：**同一个后端路由表，两个调用方各有一条守卫**；两边共用"按 `@Controller` 切段 + 占位符归一 + 通配匹配"这套规则，改规则时两边都要改。

### 25.6 第 67 批：把 helper / 变量前缀也纳入这道契约（408 → 544 条，未解析 0）

**问题**：25.4 的守卫只解析「首参就是字面量」的调用。`apps/web/composables/useCanvasApi.ts`
这类 composable 的写法是

```ts
const base = (canvasId: string) => `/canvas/canvases/${encodeURIComponent(canvasId)}`;
await api.get(base(canvasId));                    // 首参是 helper 调用
await api.post(`${base(canvasId)}/commit`, body); // 首参以 ${helper(...)} 开头
```

第 66 批把这类整片跳过（当时统计为 133 处），而**模块前缀写错**恰恰最容易发生在这一层。
第 67 批把解析补满，新增断言「调用数 > 500」「未解析 = 0 且必须落在白名单」。

**四类解析与实现位置**（`apps/api/test/web-api-contract.spec.ts`）：

| 首参形态 | 处理函数 | 说明 |
|---|---|---|
| `base(canvasId)` | `IDENT_CALL_RE` + `helperTemplate()` | helper 声明处的模板字面量 / 普通字符串前缀 + `)` 之后的尾巴 |
| `` `${base(id)}/commit` `` | `expandHelperPrefix()` | 展开 `${helper(...)}` 后接剩余部分 |
| `path`（局部变量） | `literalCandidates()`（同一语句内） | 覆盖 `cond ? "/a" : "/b"`、`x ?? "/c"` |
| 表达式 | `literalCandidates()`（片段内） | 兜底，如 `x?.p ?? "/agent/stt/transcribe"` |

**两个必须记住的坑**：

1. 局部变量切片**必须在 `;` 处截断**。取固定长度会把下一条调用的字面量算进来，
   把 `api.post(path, …)` 错配成 `POST /crc/assets/me` ——这个误报会让人去改正确代码。
2. helper 返回值可能是**普通字符串**（`const base = () => "/agent/sessions"`），
   只认模板字面量会让 `useAgentChat.ts` 的 8 条调用继续落在盲区。

**断言**：路由数 > 600（防解析失败）；静态调用数 > 500（防正则失效）；未解析数 ≤ `UNRESOLVED_MAX`(0)
且必须命中 `UNRESOLVED_ALLOWLIST`（当前为空）；所有可解析路径都能在路由表命中；三条回归锚点
（`GET /cam/team/groups` 在、`POST /redeem-code/redeem` 在、`GET /team/groups` 不在）；
`/canvas/canvases/{}` 开头的调用 > 20 条且 `useCanvasApi.ts` 在案（证明 helper 前缀真的被解析了）。

**反向验证**：把 `useCanvasApi.ts` 的 `/canvas/canvases` 改成 `canvasBROKEN` → 6 例中 2 例立刻红，
逐条打印错配调用（`GET /canvas/canvasBROKEN/{} ← composables\useCanvasApi.ts:34` 等），改回即绿。

**口径变化**：web 可静态解析调用 408 → **544**；未解析 133 + 4 → **0**；api 用例 881 → **883**。
后端路由、端点数、迁移数、模块得分均未变（本批是门禁强化，不改应用代码）。

**边界**：只校验路径形状，不校验 query / body 语义，也不校验方法语义（`POST /x` 与 `GET /x` 各算各的）。

## 17.26 分镜手动增删改：`storyboards` 四个端点与两段式改号（第 68 批）

### 26.1 缺口来源与竞品证据

`apps/cli` 的 `storyboard` 组原有 4 条骨架命令（`add` / `delete` / `batch-delete` / `num-update`），
reason 直指「我方无该端点」。竞品三处形状（`_acceptance/competitor_endpoints.tsv`）：

| 竞品 | params | body |
|---|---|---|
| `POST /web/v1/df/episode/:ep_id/storyboard-add` | `ep_id` | 无字段级证据 |
| `POST /web/v1/df//episode/:ep_id/storyboard/delete` | `ep_id` | 无字段级证据（**竞品路径自身双斜杠笔误**） |
| `POST /web/v1/df/episode/:ep_id/storyboard/num-update` | `ep_id` | 无字段级证据 |

三者 `requestDataJsonSchema` 均为 `{}`（`core-lib` 的端点配置对象原样为空），故**入参字段名我方自定**，
在 `packages/shared/src/schemas/pipeline.ts` 的注释里逐条登记「待取证」。

### 26.2 数据层：本批不需要迁移

`storyboards` 已有 `uq_storyboards_episode_shot (episode_id, shot_no)`（`packages/db/src/schema.ts`）——
它是本批真正的约束来源，不是需要新增的东西。`storyboards` 无软删列，`storyboard_assets` 是唯一指向
`storyboards.id` 的外键（`ON DELETE` 由应用层按顺序处理）。

### 26.3 端点

| # | 方法与路径 | body | 说明 | 主要错误 |
|---|---|---|---|---|
| 69 | `POST /v1/projects/:id/episodes/:eid/storyboards` | `shot_no?` / `shot_desc?` / `video_prompt?` / `duration_s?` / `ratio?` / `resolution?` / `insert_after?` | 新增；省略定位参数 = 追加末尾 | 400101（撞号、两参互斥）、400102（`insert_after` 不在该集） |
| 70 | `DELETE /v1/projects/:id/episodes/:eid/storyboards/:sid` | — | 删一条 | 400102（剧集/项目不存在） |
| 71 | `POST /v1/projects/:id/episodes/:eid/storyboards/batch-delete` | `shot_ids: string[1..200]` | 批量删（跨集 id 只计 0） | 400101（非数字 id、空数组） |
| 72 | `POST /v1/projects/:id/episodes/:eid/storyboards/num-update` | `shot_ids?: string[1..500]` / `step?: 1..100 = 1` | 重排；省略 `shot_ids` = 按现号压实 | 400101（漏项、重复、跨集、`step` 越界） |

编号 69–72 时点：第 68 批（此前 script 域 61 条 → 65 条）。

### 26.4 两段式改号（`applyShotOrder`）

`uq_storyboards_episode_shot` 让「插队/重排」无法逐条写目标号：把 1 号改成 2 号时 2 号仍被占用。
`applyShotOrder` 因此先整集写负数（`-(index+1)`，负号段同样唯一），再写终值 `step*(index+1)`。
代价 `2N` 次 UPDATE（N ≤ 500）；只在显式插队/重排时走，「追加到末尾」用 `max(shot_no)+1` 一次 insert。

### 26.5 语义边界

- **跨集 id**：批量删用 `where episode_id = :eid and id in (…)` 收敛，别的集 id 只让 `deleted` 变小、不报错。
- **重排必须覆盖全集**：只传一部分 → 400101（否则未点到的那条会被挤到末尾，等于静默改数据）。
- **任务不回收**：`image_task_id`/`video_task_id` 指向的 tasks 有独立生命周期，删分镜不连锁杀任务。
- **`video_prompt` 回落**：未给时用 `shot_desc` 兜底，`duration_s` 默认 5、`ratio` 回落项目比例（与 `parse.service` 解析口径一致）。

### 26.6 测试

`apps/api/test/storyboard-edit.spec.ts` **8 例**：追加序列 / 插队顺延 / 撞号 400101 / 两参互斥 400101 /
`insert_after` 指向别的集 400102 / 跨集批量删 `deleted:0` / 重排按给定顺序与 `step=10` / 漏项·重复·跨集均 400101。
api 全量 77 文件 **891 例**。

### 26.7 CLI 侧

`apps/cli/src/registry.ts` 4 条 `todo(...)` → `http(...)`；`pnpm --filter @app/cli build` 触发
`gen-skill` 重写 3 个文件；**ready 140 → 144、骨架 57 → 53**；
`apps/cli/test/registry-routes.spec.ts`（读 api controller 源码建路由表逐条比对）复跑 `missing: 0`。


## 17.27 路径参数里的坏 id：统一 400101（第 69 批）

### 27.1 发现方法与数据

| 步骤 | 做法 | 结果 |
|---|---|---|
| 抽路由 | `_acceptance/_r69_routes.py`：52 个 controller 的 `@Get(*)` 拼上 `@Controller` 前缀，`:param` → `abc` | **248** 条唯一 GET 路径 |
| 打一遍 | `_acceptance/_r69_probe.js`：`sms-code` → `login` 取 token，带 `authorization`+`x-space-id` 逐条 GET | 修前 `internal(500): 18` |
| 修完复跑 | 同一脚本 | `internal(500): 0` |

修前的 18 条响应一律是 `HTTP 500` + `{"code":500000,"msg":"Internal Server Error"}`。

### 27.2 契约：`toBigId(raw, field)`（`apps/api/src/common/bigid.ts`）

| 输入 | 行为 |
|---|---|
| `"12"` / `"  42  "` / `42`（number） | 去空格后转 `bigint` |
| `"0"` / `"-1"` / `""` / `" "` / `"abc"` / `"12abc"` / `"1.5"` / `"1e3"` / `"0x10"` / 全角数字 / 含换行 | `AppError(400101, "invalid <field>", {field})` |
| 超过 20 位的数字串 | 同上（主键是雪花 id；`BigInt` 吃得下也不代表合法） |

业务错误一律 **HTTP 200 + 非零 code**（§1 信封规则），字段名进 `msg`（`fail()` 不带 `details`）。

### 27.3 为什么不做全局 `APP_PIPE`

判定「这个参数是不是 id」只能靠名字；实际参数名里 `chapterNo`/`n`/`provider`/`slot`/`token`/`version` 都不是 id。
误判的后果是把合法请求打成 400101 —— 比现状的 500 更难排查。路径参数也不经 zod（`@Param` 直接是字符串），
所以只能在服务入口逐个替换。

### 27.4 改动清单（8 个 service）

| 文件 | 位置 | 覆盖端点 |
|---|---|---|
| `canvas-group.service.ts` | `private mustGetCanvas` | `/canvas/canvases/:id/pin-groups`、`/group-templates` ×2 |
| `canvas-material.service.ts` | `mustGetCanvas` + 6 处 `cnId` + `q.node_id`/`q.uid` | `/materials`、`/comment-nodes` ×3 |
| `canvas-node-tasks.service.ts` | `mustGetCanvasAndNode` | `/running-nodes`、`/nodes/:n/task/:t`、`/nodes/:n/video-parse/:t` |
| `canvas-download.service.ts` | `list` | `/canvas/canvases/:id/download-lists` |
| `canvas-template.service.ts` | `getVisible` | `/canvas/templates/:id`、`/instantiate` |
| `kds.service.ts` | `memberPointConsumeDetail`、`memberPointQuotaDetail`（4 处） | `/kds/da/team/member/:u/point-*-detail` ×2 |
| `team.service.ts` | `groupStats`、`getRolePermissions`、`memberDetail` | `/cam/team/group/:g/stats`、`/cam/roles/:r/permissions`、`/cam/team/member/:u` |
| `billing.service.ts` | `getOrder` | `/billing/orders/:id` |

### 27.5 测试（`apps/api/test/bigid-path-params.spec.ts`，6 例）

18 条路径逐条断言 400101 且 `msg` 字段名匹配；造真画布后测 `cn_id`/`node_id` 这一层；
22 条 URL 的「不再 500000」锚点；`toBigId` 的合法/非法/超长三组。
注意「`abc` 同时充当所有 param 时先炸的是 `canvas_id`」，以及 `listComments(spaceId, cnId)` 不校验 canvas 归属。

### 27.6 诚实边界

写接口 body 里的 `BigInt(input.x)` 同类风险约 **80 处**未在本批处理（`team`/`market`/`knowledge`/`subject` 等），
传非数字仍是 500。定位命令：`grep 'BigInt\((q|input|body|params)\.' apps/api/src`。本批只收口路径参数层。

## 17.28 ad/redraw 的 CLI 契约与 `--set` 大整数保真（第 70 批）

> 这一节记的不是服务端新端点（`ad-drama` 与 `video-redraw` 早在第 13/14 批就上线了），而是**客户端一侧的契约**：
> 哪些命令对应哪条 URL、`--set` 怎么判类型、以及为什么「说明文字过期」也算缺陷。

### 28.1 为什么客户端契约要写进 API 文档

`apps/cli/test/registry-routes.spec.ts`（第 65 批）保证「**ready 命令的 path 必须能在后端路由表里找到**」。
但 `todo(...)` 形态的骨架命令没有 `path`，于是那句 `reason` 就成了**唯一对外说明**——它写「对方模块本轮由队友落地、
当前无端点，CLI 接线放下一轮」，agent 读到就会认为「这个能力不存在」，**比真的缺能力更有害**（缺能力至少不会误导选型）。

第 70 批逐条对账后发现：`registry.ts:834-838` 的 5 条骨架里，`ad` 的 3 条与 `redraw` 的 2 条的 reason 全是过期记录。
因此这一节先给「命令 ↔ URL」的正式映射，再给 `--set` 的类型规则。

### 28.2 命令 ↔ 端点映射（10 条）

| CLI | method + path | 备注 |
|---|---|---|
| `oneframe ad info` | `GET /v1/ad-drama/projects/{project_id}` | `--workspace` 提供 `{project_id}` |
| `oneframe ad save` | `POST /v1/ad-drama/projects` | write；`sp_id`/`ep_id` 传值即更新，不传即创建 |
| `oneframe ad selling-point` | `POST /v1/ad-drama/projects/{project_id}/selling-point/generate` | write · paid |
| `oneframe ad plot` | `POST /v1/ad-drama/projects/{project_id}/brief/generate` | write · paid |
| `oneframe ad script` | `POST /v1/ad-drama/projects/{project_id}/script/generate` | write · paid；必填 `brief_id` |
| `oneframe ad asset` | `POST /v1/ad-drama/projects/{project_id}/asset/extract` | write · paid |
| `oneframe ad plan` | `POST /v1/ad-drama/projects/{project_id}/storyboard/generate` | write · paid；`template_type` 必填 |
| `oneframe ad reset` | `POST /v1/ad-drama/projects/{project_id}/script/reset` | write；不计费 |
| `oneframe redraw info` | `GET /v1/video-redraw/projects/{project_id}` | — |
| `oneframe redraw create` | `POST /v1/video-redraw/projects` | write；必填 `title`/`source_uri` |

`paid` 标记的依据不是猜：`ad-drama.service.ts` 的 `:225`/`:272`/`:340`/`:442`/`:515`/`:569` 六处分别调用 `credits.price()`，
五个生成类动作各命中一处；`reset` 不调价目表，所以不标 paid（标了会让 CLI 在 `--dry-run` 时误报花费）。

`ad` 补到 8 个动词是对齐竞品 `commands/ad.md:22-31` 的同款清单；`redraw` 只接 `info` 与 `create`，因为竞品
`commands/redraw.md` 自己写明 `create`/`episode`/`bind`/`asset`/`plan` 是「流程待接入」，其中仅 `create` 有真实入参证据
（`redraw.controller.ts:21-30` 的 `createBody`：`title`、`source_uri`、`redraw_strength 0..100`、`style ∈ REDRAW_STYLES`，
后者来自 `redraw.service.ts:53`）。其余四条**不凭空造**。

### 28.3 `--set` 的类型推断规则（改在 `apps/cli/src/args.ts`）

`--set` 的入参是「一段像 JSON 的文本」，`coerceScalar` 负责把它变成 JS 值。修前是裸 `JSON.parse`，
于是 **18 位雪花 id 一律被当成 number**，再被 IEEE-754 截到 53 位有效位——最后几位被改掉。

```ts
const BIG_INT_RUN = /(?<![\w."-])(\d{16,})(?![\d."])/g;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const guarded = text.replace(BIG_INT_RUN, (run) => (BigInt(run) > MAX_SAFE ? `"${run}"` : run));
return JSON.parse(guarded) as unknown;
```

| 输入 | 推断结果 | 规则 |
|---|---|---|
| `count=2` | number | 短数字不变 |
| `n=9007199254740991` | number | `<= MAX_SAFE_INTEGER` 可精确表示，不必改类型 |
| `brief_id=108760275629637632` | string | 超过安全整数 → 加引号 |
| `shot_ids=[108760275629637632,108760275629637633]` | string[] | 数组内裸 id 同样保护 |
| `brief_id="108760275629637632"` | string | 已带引号不二次加引号（前后瞻排除 `"`） |

**为什么不让所有 id 都走字符串**：`--set count=2`、`--set step=2` 这类数量参数若变字符串，服务端 zod
（`z.number()`）会直接 400101，等于用一个真缺陷换另一个真缺陷；而「只在会被 JS 精度损失时改类型」是唯一不需要知道
字段语义的判据。

### 28.4 `ad-drama` 与 `video-redraw` 端点全表（服务端事实，供 CLI/前端对照）

| 模块 | 端点 |
|---|---|
| `ad-drama`（`@Controller("ad-drama")`，12 条） | `POST projects`、`GET projects/:id`、`POST projects/:id/selling-point/generate`、`POST projects/:id/brief/generate`、`POST projects/:id/brief/select`、`POST projects/:id/script/generate`、`POST projects/:id/script/edit`、`POST projects/:id/script/reset`、`POST projects/:id/storyboard/generate`、`POST projects/:id/asset/extract`、`POST projects/:id/asset/image-tips`、`POST projects/:id/point` |
| `video-redraw`（`@Controller("video-redraw")`，9 条） | `POST projects`、`GET projects`、`GET projects/:id`、`POST projects/:id/point`、`POST projects/:id/episodes`、`POST projects/:id/episodes/batch`、`POST projects/:id/storyboard/plan`、`POST projects/:id/resources/generate`、`POST projects/:id/asset/bind` |

注意 CLI **没有**把 `brief/select`、`script/edit`、`asset/image-tips`、`point` 四个动作做成命令：前两个是「在已有候选上挑选/改稿」
的交互动作（竞品 CLI 也没有），后两个是计费确认与运营口径接口。命令数应跟竞品对得上，不该比它多造动作。

### 28.5 测试与验证

| 层 | 内容 |
|---|---|
| `apps/cli/test/ad-redraw-parity.spec.ts`（新增，4 例） | ① ad 组恰好 8 个动词且无骨架；② 10 条命令的 `method + path` 逐条钉死；③ 5 条生成命令必须 `paid && write`，而 `info`/`save`/`reset`/redraw 两条不得标 paid；④ 扫 `apps/api/src` 确认 `@Controller("ad-drama")`、`@Controller("video-redraw")` 仍存在（防后端改名后 CLI 静默失效） |
| `apps/cli/test/args.spec.ts`（+1 例） | 覆盖 28.3 表里的四种边界 |
| 真链路 | 起 api 于 3002，用真 `oneframe` 二进制跑 ad 全链与 redraw 两条（见 README v6.24 §五） |

### 28.6 诚实边界

- 本批**不加分**：`#9` 的 0.24 缺口对应 48 条仍卡后端端点的骨架命令，本批没有让任何一条从「缺端点」变成「有端点」。
- 两组命令的**响应字段**仍是「我方 DTO 形状」——竞品 CLI 文档只给输出键名（`SP_ID`/`STAGE`/`video_redraw_stage` 等），
  没有字段级 JSON schema；语义对得上 ≠ 逐字段取证。
- `--set` 的启发式只保证「超过安全整数的裸整数不被改值」，**不保证**「用户想传字符串时一定传成字符串」：
  若某字段服务端要求 string 而值小于安全整数（如 `episode_id=12`），仍会以 number 发出。当前 zod 层对此类字段用
  `z.union([z.string(), z.number()])` 兜住；这条边界登记在此，待有字段真的踩到时再改（改成「按 schema 判类型」需要 CLI 知道服务端 schema，
  属于更大的改造）。

---

## 17.29 剧集删除与批量建集：8 张 RESTRICT 外键 + 「不重排」「不回收空洞」（第 71 批）

### 29.1 为什么现在才做

`apps/cli/src/registry.ts` 里 `episode delete` 与 `episode batch-create` 一直是 `todo(...)`，`reason` 原文是
「我方无 DELETE episodes；不要的集用 `PATCH /projects/:id/episodes/:eid` 清空内容」与「我方只支持按数量新增
`--set count=N`」。

骨架命令**没有 `path` 字段**，所以第 65/66/67 批那套「CLI 命令路径 ↔ 后端路由」门禁（`registry-routes.spec.ts`、
`web-api-contract.spec.ts`）覆盖不到它们 —— 唯一对外信息就是这句 `reason`。竞品对这两件事都有端点：

| 竞品端点 | 我方实现 | 证据 |
|---|---|---|
| `POST /web/v1/df/episode/delete`（`ApiDfEpisodeDeletePOST`；path 里没有 `:ep_id` → id 在 body） | `DELETE /v1/projects/:project_id/episodes/:episode_id` | 竞品 CLI `commands/episode.md:21` `reelmate episode delete EPISODE_ID` |
| `POST /web/v1/df/episode/batch-create`（`ApiDfEpisodeBatchCreatePOST`） | `POST /v1/projects/:project_id/episodes/batch` | 竞品 CLI `commands/episode.md:142` `batch-create --set @episodes.json` |

两个竞品端点的 `requestDataJsonSchema` 都是空对象 → **字段名只有路由形状、没有字段级证据**，所以入参是我方自定的
（`packages/shared/src/schemas/pipeline.ts` 的注释里登记「待取证」）。竞品把 id 放 body，我方按 REST 口径放路径 ——
这样 `episode delete <EPISODE_ID>` 能一对一映射，不需要在 CLI 侧造一层 body。

### 29.2 `DELETE /v1/projects/:project_id/episodes/:episode_id`

指向 `episodes.id` 的外键共 **8 张表，全部 RESTRICT**：不先清子表，删除会被数据库挡下（表现为 500）。
且 `storyboard_assets` 引用的是 `storyboards.id`（不是 episode），层级多一层。

| 顺序 | 表 | 引用目标 |
|---:|---|---|
| 1 | `storyboard_assets` | `storyboards.id`（先按本集分镜 id 删） |
| 2 | `storyboards` | `episodes.id` |
| 3 | `episode_resources` | `episodes.id` |
| 4 | `export_jobs` | `episodes.id` |
| 5 | `project_timelines` | `episodes.id`（另有 `uq_project_timelines_episode`） |
| 6 | `timeline_exports` | `episodes.id` |
| 7 | `extraction_tasks` | `episodes.id` |
| 8 | `director_scenes` | `episodes.id` |
| 9 | `timeline_publications` | `episodes.id` |
| 10 | `episodes` | —（本体） |

整个序列在一个 `db.transaction` 内，最后 touch `script_projects.updated_at`。

响应：

```json
{ "deleted": true, "episode_id": "108763409815617536", "ep_no": 1, "cleared": { "storyboards": 2 } }
```

`cleared` 是本批新增的诊断字段：调用方据此确认「删的是不是我以为的那一集」（尤其 CLI 里一次只传一个 id 时）。

错误码：

| 场景 | code | msg |
|---|---|---|
| `:episode_id` 不是数字 | 400101 | `invalid episode id`（field `eid`） |
| 项目不在本空间 / 不存在 | 400102 | `project not found` |
| 该集不存在、不属于该项目、或已被删 | 400102 | `episode not found` |

### 29.3 `POST /v1/projects/:project_id/episodes/batch`

请求（`items` **1..10** 条，上限与按数量建集的 `Math.min(10, …)` 同一口径）：

```json
{ "items": [ { "name": "第 3 集", "sort": 3, "synopsis": "可选" } ] }
```

规则：

| 规则 | 行为 | 理由 |
|---|---|---|
| 给了 `sort` | 用它当 `ep_no`；**撞号 → 400101** `ep_no N already used in this project`（field `sort`） | 静默改号 = 用户以为建在第 5 集、实际第 6 集 |
| 没给 `sort` | 排到当前**最大集号之后**，中间空洞**不回收** | 与「删集不重排」同一套口径，否则「删了第 2 集 → 下次建集默默占 2 号」，外部引用会指向另一集 |
| 没给 `name` | 标题回落 `第N集` | 与按数量建集的默认标题一致 |
| `sort` 不在 1..999 | 400101（zod） | |
| `items` 空 / 超 10 条 | 400101（zod） | |

响应：`{ "created": [ { "id": "…", "ep_no": 3, "title": "第 3 集" } ] }`。

**与竞品的两处语义差（明确不假装对齐）**：

1. 竞品 item 里的 `s_script_id`（「拆解结果 ID」）我方**不接收** —— 我方拆集结果直接落 `episodes`，没有「拆解结果」这个实体；
   为了对齐字段名而造一张空表是假实现。
2. 竞品返回 `succeeded`/`failed`/`unconfirmed` 三态（异步时 `unconfirmed[]` 里的项不算完成）。我方是**同步**实现：
   整批落库或整体抛错，没有「未确认」中间态，故只返回 `created`。

### 29.4 不重排集号

删掉第 2 集后，剩下的仍是 1、3、4…（留空洞）。竞品文档只写「删除该集」，**没有重排证据**；而重排会让外部已引用的
「第 N 集」漂移 —— 是破坏性副作用。空洞由 `sort` 显式指定（或排到末尾）来绕，不靠自动重排。

### 29.5 测试与验证

`apps/api/test/episode-edit.spec.ts`（6 例）：

| # | 钉住什么 |
|---|---|
| 1 | `outline/generate` 建出的集号是 1..N 紧密序列（基线） |
| 2 | 批量建集：给 `sort` 用它、不给排到末尾（不回收空洞）、无 `name` 回落 `第N集` |
| 3 | 撞号 / 空数组 / 超 10 条 / 空白标题 → 400101，且**失败不落库** |
| 4 | 删集连带清 `storyboards` / `storyboard_assets` / `episode_resources`；别集不受影响；被删的集再查 400102 |
| 5 | 重复删 / `abc` / 不存在的 id / 跨空间 → 400101 或 400102（不出 500） |
| 6 | 删集留空洞、其余集号原样；再批量建集仍从最大号往后排 |

规模：端点 706 → **708**；api 测试 79 文件 897 例 → **80 文件 903 例**；全库用例 1,275 → **1,281**；
CLI 命令 202 不变、ready 154 → **156**、骨架 48 → **46**；`verify-round.ps1` **12/12 全绿**。

### 29.6 诚实边界

- 本批**不加分**（全站仍 202.45/206 = 98.3%，剩余 3.55）：这两条能力此前只记在 #9 的「48 条骨架」里，而 #9 的台账是
  1% 整数粒度（0.24 = 8×3%），48→46 表达不出来；#3 剧集分镜的 0.15 缺口是 `quality-check` 评分口径，本批能力不在其中。
- **降级（集号重排）没有实现**：竞品是否有「删集后重排」的开关无从取证，故只做「不重排」这一种确定行为。
- **批量建集不校验项目状态**（例如归档项目也能建集）：竞品文档没写这条约束，我方沿用 `addEpisodes` 的现状（同样不校验），
  这条差异登记在此，等有明确产品口径再收紧。
- 删集**不回收**分镜产出的 `tasks` 记录：`tasks.episode_id` 在 schema 里没有外键（历史设计），任务记录按 90 天过期清理；
  本批不去猜「是否该级联删任务」，避免误删仍在跑的生成任务。

## 17.30 任务软删与 `credits log` 的客户端口径（第 72 批）

### 30.1 为什么现在才做

`apps/cli/src/registry.ts` 的两条骨架命令（`task delete`、`credits log`）的 reason 原文都写着「我方没有」，
而竞品 CLI 文档 `commands/task.md:195` 与 `commands/credits.md:68` 都给了明确用法与后端路径。
其中 `credits.md:68` 还逐字写了关键约束：**`credits log`（旧，无符号 `val` + `event_type`）与
`credits flows`（新，带符号 `points` + `section` + task id）语义不同、不能混用**。

### 30.2 迁移 0042（软删）

```sql
ALTER TABLE "tasks" ADD COLUMN "deleted_at" timestamp with time zone;
```

三个决定：

| 决定 | 理由 |
|---|---|
| 软删而非物理删 | `canvas_nodes.task_id`、`assets.source_task_id` 是外键；`credit_flows.ref_task_id` 是对账依据，物理删会被拒或剪断对账链 |
| 不加 partial index | 现有 `idx_tasks_space_status` 已按 `space_id` 领先，软删条件的过滤走这条索引足够；等真的有慢查询再加 |
| 只影响读、不改 90 天过期 | `expire_at` 是保留期清理，与用户主动删除是两条生命周期，不能互相代替 |

### 30.3 `DELETE /tasks/:id`

- 方法与路径：`DELETE /v1/tasks/:id`（竞品是单数 `task`，我方沿用复数风格，与 `tasks/:id/cancel|retry|regenerate` 一致）
- 成功响应：`{ deleted: true, task_id: "<id>", status: <删除前的状态> }`
- 错误码：

| code | 场景 | msg 关键片段 |
|---:|---|---|
| 400101 | 任务仍在跑（PENDING/RUNNING/REVIEWING） | `task is still running` |
| 400101 | `credits_frozen > 0` | `still holds frozen credits` |
| 400101 | 路径 id 不是数字 | `invalid task id` |
| 400102 | 不存在 / 已删 / 跨空间 | `task not found` |

删除后**同时**失效的读路径（都加了 `isNull(tasks.deleted_at)`）：
列表 `GET /tasks`、`GET /tasks?ids=`、详情 `GET /tasks/:id`、`POST /task/result`（进 `missing[]`）、
`POST /tasks/batch-download`（400102）、`GET /share/:token` 与 `POST /share/:token/batch-download`（分享自毁）。

### 30.4 `credits log`：派生而不是第二份真相

CLI 的 `credits log` 打到 `GET /v1/credits/flows`（我方唯一真相：带符号 `delta`），再由
`apps/cli/src/transforms.ts` 的 `creditsLog` 派生竞品旧接口字段：

| 旧接口字段 | 派生规则 |
|---|---|
| `event_type` | `delta >= 0 ? 1 : 2`（1 获取 / 2 消耗；`delta === 0` 的冻结/解冻行归 1） |
| `val` | `Math.abs(delta)` |
| `kind` / `task_id` / `memo` / `created_at` | 原样透出 |

**不为旧接口造第二个后端端点**：两份真相同步必然漂移；而新接口的 `section`/`tab` 语义派生不出来，也不假装有。

### 30.5 测试与验证

- `apps/api/test/task-delete.spec.ts`（5 例）：软删后行/结果/`credits_settled` 仍在但五条读路径失效；分享自毁；
  运行中三态与冻结积分两条 400101；坏 id/不存在/重复删/跨空间不 500。
- `apps/cli/test/transforms.spec.ts` +1 例：`+80 / −12 / 0` → `[[1,80],[2,12],[1,0]]`。
- 结果：api 81 文件 908 例、cli 15 文件 105 例、`verify-round.ps1` 12/12 全绿；端点 709、迁移 43、总用例 1,287。

### 30.6 诚实边界

- **不加分**：这两条能力此前只记在 #9「骨架命令」缺口里，1% 整数粒度（0.24 = 8×3%）表达不出 48→46。
- `task delete` 未实现竞品的 `--dry-run` / `--idempotency-key`：我方写接口没有幂等键体系，只给单个端点造假幂等键会与其余写接口不一致。
- `credits log` 派生只覆盖旧口径三字段；`section` 与 `income/consume/transfer` tab 属新接口语义，未派生。

---

## 17.31 项目资产的详情 / 批量详情 / 批量定稿：批量接口的「读宽松、写严格」（第 73 批）

### 31.1 为什么现在才做

`apps/cli/src/registry.ts` 里 `resource get` 与 `resource batch-confirm` 一直是骨架命令，reason 原文分别写着
「我方无单资源详情端点」「我方无批量确认端点」。但竞品两条端点都在册，而且竞品 CLI 给了三个动词：

| 竞品端点 | 竞品 CLI | 我方 CLI（改前） |
|---|---|---|
| `GET /web/v1/df/resources/:sp_id/:resource_id/info` | `resource get`（`commands/resource.md:92`） | 骨架，reason「我方无单资源详情端点」 |
| `POST /web/v1/df/resources/batch-info` | `resource batch-info`（`:96`） | **命令不存在** |
| `POST /web/v1/df/resources/batch-confirm` | `resource batch-confirm`（`:100`） | 骨架，reason「我方无批量确认端点」 |

注意骨架命令没有 `path`，所以第 65/66/67 批那两道「CLI 路径 ↔ 后端路由」的门禁**看不见它们**——
这类「宣称没有」的账只能靠人对着竞品文档读出来。

### 31.2 三个端点

| 方法 | 路径 | 入参 | 成功返回 | 错误 |
|---|---|---|---|---|
| GET | `/v1/projects/:id/assets/:assetId` | — | 单个资产 DTO（含 `finalized_at`、`bound_shot_count`、`ref_image_url`） | 400101 `invalid asset id`（非数字）；400102 `asset not found`（不存在 / 不属于本项目 / 跨空间 / 项目不存在） |
| POST | `/v1/projects/:id/assets/batch-info` | `{asset_ids: ["<id>", …]}`，1..100 | `{list: [DTO…], missing: ["<id>", …]}` | 400101（空数组 / 超 100 / 非数字 id）；400102（项目不存在或跨空间） |
| POST | `/v1/projects/:id/assets/batch-confirm` | 同上 | `{confirmed: <n>, asset_ids: ["<id>", …]}` | 400101（同上）；**400102 `asset not found in this project: <ids>`**（任一 id 不属于本项目 → 整批失败） |

**与竞品的契约差异（登记，不改）**：竞品是 `resources/{sp_id}/{resource_id}/info`，把项目 id 也放路径里；
我方沿用既有集合风格 `projects/:id/assets/:assetId`（与 `PATCH`/`DELETE` 同形）。

### 31.3 读宽松、写严格

同样一组 `asset_ids`，两个批量端点对「混入不存在的 id」必须相反：

| | `batch-info`（读） | `batch-confirm`（写） |
|---|---|---|
| 行为 | 不报错；命中进 `list`，差集进 `missing` | 整批 400102，**一条都不落库** |
| 理由 | 用途是「一次渲染一屏」：一个失效 id 不该让整屏变错误页，用户要看的是「这些还在、那个没了」 | 部分成功会让调用方无法从一次响应判断改了哪些，且拿不到失败原因；写操作要么全成要么全不成 |
| 实现 | 查命中行 → DTO 列表；`入参 − 命中` = `missing` | 先查命中数，`命中数 ≠ 入参长度` 直接抛；校验发生在 UPDATE 之前 |

后续再加批量接口（竞品还有 `batch-delete`/`batch-unconfirm`/`batch-update`）时**沿用这条判据**：读操作容忍缺失，
写操作不容忍部分成功。

### 31.4 定稿幂等与 `finalized_at`

`batch-confirm` 只写 `status = 2`（定稿）与 `finalized_at = coalesce(finalized_at, now())`：

- **重复定稿不刷新时间戳**——与既有 `PATCH /projects/:id/assets/:assetId {status: 2}` 完全同一规则
  （`script.service.ts` 的 `patchProjectAsset` 里写的是 `asset.finalizedAt ?? new Date()`）。
- 如果每次都刷成 `now()`，`finalized_at` 就变成「最后一次点按钮的时刻」，任何按定稿时间做的对账/统计都会漂。
- 不做「批量取消定稿」：竞品的 `batch-unconfirm` 我方没有证据说明它是否同时清 `finalized_at`，不凭形状造语义。

### 31.5 测试

`apps/api/test/project-asset-batch.spec.ts`，5 例：

| # | 覆盖 |
|---|---|
| 1 | 准备项目 + 三类资产（scene/prop/other），新建即 `status=1`、`finalized_at=null` |
| 2 | 详情：本项目内可读、`bound_shot_count=0`；`abc` → 400101、不存在 → 400102、跨空间 → 400102、项目不存在 → 400102 |
| 3 | 批量详情：三条全命中 / 缺一条进 `missing` / 空数组、非数字、101 条 → 400101（且 message 带 `asset_ids`）/ 跨空间 → 400102 |
| 4 | 批量定稿：`confirmed=2` 且 `finalized_at` 落值、重复定稿时间戳不变、混入不存在 id → 整批 400102 且合法的那个**仍是草稿**（无部分成功） |
| 5 | 跨项目串号：拿别的项目的资产 id 做批量读 → `list=[]`+`missing`；做批量确认 → 400102；外项目资产本身未被改 |

### 31.6 诚实边界

- **不加分**：这一批减少 2 条骨架（44→42），但 #9 的扣分是 1% 整数粒度（0.24 = 8×3%），表达不出来。
- 竞品还有 `resources/batch-delete` / `batch-unconfirm` / `batch-update` / `batch-download`，本批未做（见 31.4 末条与 §5）。
- `bound_shot_count` 是自建口径（数 `storyboard_assets` 绑定行），与竞品语义是否一致**未取证**。
- 本批顺带把第 72 批文档里写错的骨架数（「48→46」，实际 46→44）校准为 46→44→42。

## 17.32 知识库模板条目的「条目级字段」：8 加入库与封面回落（第 75 批）

### 32.1 为什么现在才做

`knowledge_assets`（#18 团队知识库的条目表）从第 60 批起就有 `scene` 维度，但**条目自身**的字段一直只有「我方想得到」的那几个（`title`/`content`/`tags`/`sourceType`）。
第 74 批核账把它判成 **I 类（内部可做、只是没排期）0.015**，缺口栏原文是：

> 条目级字段未落库：`cover_file`/`image_files`/`status`/`sp_type`/`res_type`/`meta_data`（**证据已有**）

本批把「证据已有」变成「字段已落库」。取证位置仍是竞品 Vite 产物（`rea-reelmate/scripts*/files/origins/<hash>/assets/`），但取的是 **payload builder**（组装请求的函数），不是 schema 猜测：

```js
// ArT8U6Tg.js（3,668 B）逐字
const L = (e) => ({ uk_id: e.uk_id||"", scene: O(i)?i:o.Style,
  status: N(e.status)?e.status:h.Enabled, use_type: e.use_type===g.Team?g.Team:g.Official,
  sp_type: e.sp_type||0, prompt_template: e.prompt_template||"",
  cover_file: k||y[0]||"", image_files:y, origin_image_files:I, orgin_cover_file:b,
  meta_data:F, sort: e.sort||0, ... })
```

```js
// 0zWWdXb_.js（6,097 B）逐字
status  = { Enabled: 1, Disabled: 2 }
use_type = { Official: 1, Team: 2 }
```

→ 顺带**纠正台账笔误**：第 74 批把 `Official/Team` 记成了 `status` 的取值，实际是 `use_type` 的（两个字段在同一 payload 里同时出现，新建分支默认 `use_type: u.Team`）。

### 32.2 迁移：0043 七列 + 0044 补 `res_type`

```sql
-- 0043_salty_pepper_potts.sql
ALTER TABLE "knowledge_assets" ADD COLUMN "cover_asset_id" bigint;
ALTER TABLE "knowledge_assets" ADD COLUMN "image_asset_ids" bigint[] DEFAULT '{}'::bigint[] NOT NULL;
ALTER TABLE "knowledge_assets" ADD COLUMN "use_type" smallint DEFAULT 2 NOT NULL;
ALTER TABLE "knowledge_assets" ADD COLUMN "status" smallint DEFAULT 1 NOT NULL;
ALTER TABLE "knowledge_assets" ADD COLUMN "sp_type" smallint DEFAULT 0 NOT NULL;
ALTER TABLE "knowledge_assets" ADD COLUMN "meta_data" jsonb;
ALTER TABLE "knowledge_assets" ADD COLUMN "sort" integer DEFAULT 0 NOT NULL;
ALTER TABLE "knowledge_assets" ADD CONSTRAINT "knowledge_assets_cover_asset_id_assets_id_fk"
  FOREIGN KEY ("cover_asset_id") REFERENCES "assets"("id") ON DELETE set null;
CREATE INDEX "idx_knowledge_assets_status"
  ON "knowledge_assets" USING btree ("space_id","scene","status","sort");

-- 0044_cuddly_speed.sql（补账时才发现漏的；证据：竞品列表请求带 res_type、条目映射 res_type: Number(je.res_type ?? 0)）
ALTER TABLE "knowledge_assets" ADD COLUMN "res_type" smallint DEFAULT 0 NOT NULL;
```

**四个取舍**：

| 取舍 | 决定 | 理由 |
|---|---|---|
| 封面存 URL 还是 asset id | **id**（外键 `ON DELETE set null`） | 签名 URL 会过期；set null 还能自动退回「首图兜底」 |
| 配图存关联表还是 `bigint[]` | **数组** | 竞品 `image_files` 就是有序 id 列表、图片没有条目级属性；代价是元素无外键（删资产会留死 id，读时退占位图） |
| `meta_data` 存字符串还是 jsonb | **jsonb** | 竞品发 JSON 字符串只是前端图省事；库里 jsonb 才能查/索引，出参给对象 |
| 新列默认值 | `use_type=2`(Team) / `status=1`(Enabled) / `sp_type=0` / `res_type=0` / `sort=0` | 取竞品 payload 的默认分支（`e.use_type===Team?Team:Official` 在团队库里恒 Team；`status` 缺省 Enabled） |

### 32.3 封面回落规则（`knowledgeCoverAssetId`）

竞品原规则：`cover_file = trim(cover_file) || image_files[0] || ""`。我方在 `@app/shared` 复刻：

```ts
export function knowledgeCoverAssetId(row: {
  coverAssetId?: bigint | null;
  imageAssetIds?: readonly bigint[] | null;
}): bigint | null {
  if (row.coverAssetId) return row.coverAssetId;         // 人工指定优先
  const first = row.imageAssetIds?.[0];                   // 否则首图
  return first ?? null;
}
```

DTO 多给一个 `cover_is_fallback: boolean`（= 没人工封面但兜底出了一张）——前端将来做「更换封面」时，不会把兜底图误当成用户设过的封面。

签名流程：`resolveCovers(rows)` **批量**取 `coverAssetId` 对应的 `assets.uri`，逐条 `storage.signDownload(uri, 3600)`；**签不出来就不放 `cover_uri`**（前端退占位图），不让存储异常把整页打成 500。

### 32.4 读宽写严：四个筛选参数与两类错误

`GET /knowledge/assets`、`GET /knowledge/assets/search` 共用 `entryFilters()`，新增四个筛选：

| 参数 | 类型 | 语义 | 非法值 |
|---|---|---|---|
| `status` | 1 \| 2 | `ENABLED` / `DISABLED` | 400101（msg 列出合法值） |
| `use_type` | 1 \| 2 | 官方 / 团队 | 400101 |
| `sp_type` | 多值（`?sp_type=1,2` 或 `?sp_type=1&sp_type=2`） | 业务分区 id，**只透传不解释** | 400101（逐个校验 `-1..32767`） |
| `res_type` | 单值 | 资源类型 id，**只透传不解释** | 400101（`0..32767`） |

写入侧（`POST`/`PATCH /knowledge/assets`）的校验：

| 情况 | 返回 | 为什么不 |
|---|---|---|
| `cover_asset_id` / `image_asset_ids` 指向**别的 space** 的资产 | **400102** `assets not found in this space: …` | 用 400101 会泄露「这个 id 存在，只是不属于你」，等于给跨空间探测开了枚举面 |
| id 不是数字 / 超过 20 位 | 400101（`msg` 带字段名） | 复用 `toBigId()`（第 69 批的收口） |
| `image_asset_ids` 超过 20 张 | 400101 `image_asset_ids must contain at most 20 ids` | zod 默认文案是「Array must contain at most 20 element(s)」，CLI/agent 看不出是哪个参数 |
| scene 3/4 且三种封面来源全空 | 400101 `cover is required for this scene (set cover_asset_id or image_asset_ids)` | 竞品规则表里这两个场景 `cover_file` 必填；「配图第一张」也算有封面 |
| `PATCH` 只改标题、条目本来就没有封面 | **不报错**（若该 scene 本来允许无封面） | 校验必须拿「合并后的值」，否则每次改标题都要重传封面 |

### 32.5 测试（`apps/api/test/knowledge.spec.ts` 21 → 24 例）

1. **全链路**：scene=4（封面必填）建条目带 cover + 2 张配图 + `use_type:1` + `sp_type:7` + `res_type:12` + `meta_data:{model:"seedance",steps:12}` + `sort:5` → 8 字段逐一断言 + `cover_uri` 有真值 + `cover_is_fallback:false` + `scene_cover_required:true`；默认条目是 `use_type 2 / status 1 / sort 0`；四个筛选（含多值 `sp_type=7,0`、`res_type=12`）与非法值。
2. **封面回落与必填边界**：scene=3 无封面 → 400101；只给一张配图 → 成功、`cover_asset_id:null`、`cover_uri` 来自配图；scene=1 无封面 → 成功；只 `PATCH {title}` 不报缺封面；`PATCH {image_asset_ids:[]}` 在 scene=3 上又变 400101。
3. **引用必须属于本 space 且未删**：跨空间 cover / 配图 → 400102；`"abc"` → 400101 带字段名；21 张 → 400101 带 `image_asset_ids`。

### 32.6 诚实边界

- `sp_type` / `res_type` **只透传不解释**：语义只到「业务分区 id / 资源类型 id」这一层，竞品没给值域，我方不自造含义。
- `image_asset_ids` 的元素**没有外键**：删资产后会留死 id（读时签名失败 → 退占位图）。要彻底干净得建关联表，代价是每次增删都要维护顺序；本批按竞品原始形状（有序 id 数组）走。
- `?sp_type=1,2` 是**我方方言**（竞品用数组参数），两种写法都支持，但「多值语义」本身是我方推断。
- 本批只清掉 I 类 0.085 里的 0.015；剩余 0.07（#19 双浏览器 E2E / #3 真 ffmpeg 切片 / #9 agent REPL 与 SSE）仍未排期。

## 17.33 多用户协同的客户端契约：活动空间、心跳与「覆盖服务端」（第 76 批）

本节记录**两个真人同时编辑同一个导演台场景**所依赖的契约。这些规则此前只存在于代码里，
第 76 批用真浏览器跑通整链后才写进契约文档 —— 因为它们是"第二个人能不能进来"的全部前提。

### 33.1 「我是谁、我在哪个空间」

| 端点 | 用途 | 备注 |
|---|---|---|
| `GET /v1/me` | 取当前 `user` / `space` / `credits` | **没有 `auth/` 前缀**（`AuthController` 为 `@Controller()`）；无 token 时返回 `null` 而非 401 |
| `POST /v1/auth/refresh` | 用 httpOnly cookie 换新的 `access_token` | 登录后取 token 的推荐方式（脚本/客户端均适用） |

`access_token` 里烤着登录时的空间 id；要访问**别人的空间的资源**，必须让请求带
`X-Space-Id: <space_id>` 头。

### 33.2 `X-Space-Id` 的校验规则（`common/auth.guard.ts:63-94`）

| 条件 | 结果 |
|---|---|
| 头缺省 | 用 token 里的空间 |
| 头存在且该用户是成员（`space_members.status=1`）且空间未停用 | 通过，后续查询以该 space 为作用域 |
| 头存在但用户不是成员 | **403 `not_member`** |
| 头存在但空间已停用 | **403 `space_disabled`** |

前端侧对应 `apps/web/composables/useActiveSpace.ts`：活动空间同时存在 `useState("active-space-id")`
与 `localStorage["active_space_id"]`，`setActiveSpaceId()` 两处同写；`apps/web/plugins/active-space.client.ts`
在客户端启动时把 localStorage 同步回 state（SSR 下不会重跑 initializer，所以必须有这个 plugin）。
**E2E 复现"第二个人切到别人空间"就是写 localStorage 后 reload**，不需要额外接口。

### 33.3 心跳：一个场景一个 HASH

```
key   director:hb:<scene_id>          # 一个场景一个 HASH
field user_id                          # 谁
value { at: <epoch_ms> }               # 最后一次心跳
ttl   60s（HEARTBEAT_TTL_S） + 1      # 整 hash 一起过期
```

`POST /director/heartbeat { scene_id }`：hset 自己 → hgetall → **返回除自己以外**的在线者：

```json
{ "collaborators": [ { "user_id": "…", "nickname": "用户0282", "last_seen_ms": 1834 } ] }
```

- `last_seen_ms` 是**距今毫秒**而不是绝对时间戳 —— 客户端不必处理时钟偏差。
- 读取时按 `at` 过滤超 TTL 的残留 field 并顺手 `hdel`。
- 不用 `SCAN` 的理由写在 `director.service.ts` 注释里：keyspace 到万级时首轮 `COUNT=100` 可能全空。

**时序坑（第 76 批实测）**：`Director3D.vue` 的 `syncFromServer()` 是
`loadPresets() → loadLatest() → heartbeat()`，而 `heartbeat()` 开头 `if (!sceneId.value) return;`。
所以**第一次打开（场景还不存在）不会发心跳**；要看到协作者，需要场景已存在后再触发一次
（关闭重开、或等 30s 定时器 `SYNC_INTERVAL_MS`）。

### 33.4 乐观锁与「覆盖服务端」

| 动作 | 服务端行为 |
|---|---|
| `PUT /director/scenes/:id` 且 `version` 与库里一致 | 保存成功，`version + 1` |
| `version` 不一致 | **746002**，msg `scene version conflict: current=<N>`，`details` 带 `field/expected/current` |
| 同版本并发（update 影响 0 行） | 同样 746002，msg `scene version conflict: concurrent update` |
| 前端点「覆盖服务端」 | `overwriteConflict()` 先 `GET` 取服务端当前 version → 把本地 version 置为该值 → 保存 → **服务端变 v+1** |

最后一行是 E2E 的判据：A 在 v1 的页面上撞了 B 的 v2，点「覆盖服务端」之后服务端是 **v3**，不是 v2。
`SceneDto` 的 `payload` 形状（`camPos` 等）在第 76 批断言里做了存在性核对，但**字段完整清单**仍以
`director.service.ts` 为准，本节不重复抄写。

### 33.5 验证与边界

- `_acceptance/e2e-director-collab.cjs`：23 项断言，覆盖成员加入 → 切空间 → 双向心跳 → 冲突 → 覆盖。
- 本轮**不改任何服务端/前端代码**；本节是把既存行为写成契约，不是新增契约。
- 未覆盖：第三人及以上的并发、断线重连后的心跳补发、跨设备（不同 UA）的渲染差异、
  以及"两个人在不同节拍上同时保存"的高并发时序。
