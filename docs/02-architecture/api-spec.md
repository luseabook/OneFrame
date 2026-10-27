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
| 知识库 | 29（竞品 25 条 1:1，4 条"知识库实体 CRUD"明确不做） | 目录树（深度 ≤5，删除级联软删）+ 标签 + 资产 CRUD/搜索/批量移动 + **与资产库双向导入**（`import-from-asset` / `to-asset`，校验同 space）；`asset_count` 由建树时写入（不是事后补） |

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
| `film` / `market` / `credits` / `assets`（第 9 批新增） | 影视版列表、剧本集市、积分流水、资产库（三视图 + 回收站） | 102 |

**已迁移页面 14 / 64**（第 8 批：film/index、novel-market/index、credits；第 9 批：assets）。
**未迁移**：novel / creator-center / admin / team / agent / create(19 卡) / canvas / reelflow / 合集详情等（记在进度文档 §5）。

**校验口径**：`_acceptance/i18n-check.cjs`（静态：key 一致 / 无空值 / 外语包无中文残留 / 占位符一致 / 页面 key 齐全）
+ `_acceptance/e2e-i18n-pages.cjs`（浏览器：中英对照、无 key 残留、控制台清洁）。
