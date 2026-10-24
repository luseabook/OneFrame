# API 规范 v1

> v1.2 · 基础域名 `https://api.<domain>/v1` · 与 database.md / PRD 同步演进
> 本文件是契约的唯一事实来源；实现用 OpenAPI 生成（drizzle/nest 自动 + 本文件人工对账）
> v1.1 · 2026-10-24 · 按启动前审查报告修订（P0-04/05/10、P1-03/05/08/10/11/12/22/24、P2-03/08/21/23）
> v1.2 · 2026-10-24 · 按《逆向一致性审查》修订：模型目录字段对齐 46 模型目录（mode_order/endpoint/default_*/resolution label）、批量报价与折扣字段、mode/scene 键补 `studio_asset_image` 等、预算触顶改逐镜 200 部分成功、新增 share/split/导出部分成功规则、错误码来源标注与 400104/400105/400106、任务与资产定稿门槛（RE-01~RE-20）

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
| 5xxxxx | 500000 | INTERNAL：服务端内部错误 |

**码表来源与偏离声明**：745701（Insufficient Balance）与 RE 实测码同义；745703/745801/745802/7460xx 为本产品自造码——RE 的版本冲突/节点锁是 CLI 进程退出码 9/10，不是业务码，不得声称"竞品对齐"。745702 仅在 quote 与提交值不一致时使用；746002/746003 仅 Ph3 画布。RE 的 741001（长轮询超时）不使用：我们以 `304 + ETag` 轮询替代长轮询。

**批量接口幂等语义（P0-04）**：幂等分两层——
1. **请求级**：`Idempotency-Key` 对应 `idempotency_records(key, space_id, request_hash, response_body, expire_at)`；5min 内同键同体重放返回原 `response_body`（原封不动，含全部 items）；同键不同体 → 400101；
2. **任务级**：批量投递逐镜派生 `tasks.dedupe_key = f(request_key, shot_id)`（服务端派生，唯一索引兜底）；请求级记录若在响应写回前丢失（如进程崩溃），凭任务级 dedupe_key 防重复创建。`POST /tasks/{id}/retry` 的幂等键=(origin_task_id, attempt_no)，同为服务端派生，前端不参与。

**分页**：`?page=1&page_size=20` → `data:{list,total,page,page_size}`。
**时间**：ISO8601 UTC。**ID**：字符串化雪花（防 JS 精度丢失）。

## 2. auth（ADR-006、ADR-008）

```
POST /auth/sms-code  {phone, invite_code?}         // Alpha 期 invite_code 必填(P1-06)，Beta 起可选
  → 发码。限频：号 1/60s·5/日；IP 20/时。429101 需先过行为验证码(ticket/randstr)
  → Alpha 期校验 invite_code 有效性(status=1 且未过期)，无效 → 400101(附 field:"invite_code")
POST /auth/login     {phone, code, invite_code?}   // Alpha 期 invite_code 必填
  → 新号自动注册：建 users(含 age_declared_at=勾选"已满18"时刻)+spaces+space_members(owner)
    +credit_accounts(0)+credit_flows(gift +80)[仅一次]
    +invite_redemptions(核销, 若 invite_code.credits>0 → credit_flows(gift +credits))[同码同空间仅一次]
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
```

## 4. models 与计价

```
GET /models?capability=video&mode=image2video&visible=true
  ← data:[{
      name, display_name, vendor, types[], need_vip, sort, visible,
      description, logo, tags[], promotions[],       // 目录展示字段（对齐 46 模型目录）
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
GET  /s/{token}                 // 公开只读预览：无需登录；仅结果元数据+预签名，不含 prompt/uid/空间
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
POST /projects {title, drama_type:1|2, ratio, source_type:1novel|2idea|3script, source_text}
  ← {project:{id,status}}                    // source_type=3 → 建项后调 /episodes/split
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
  {shot_desc?,video_prompt?,duration_s?,ratio?,resolution?,character_ids[]?}
  // 仅存储；投递时按所选模型 scene.storyboard_reference_video 校验并就近取合法低档
POST /projects/{id}/episodes/{eid}/storyboards/generate-videos
  {shot_ids[], budget_credits_max, model, ratio?, resolution?}
  ← 200 {budget_exceeded:boolean, items:[{shot_id, task_id|null, submitted:boolean,
                                          code?:400101|400105|745703, reason?:string}]}
                   // 预算上限必须来自 POST /credits/quote/batch；缺失/过期→400107(QUOTE_REQUIRED)
                   // 逐镜任务 mode=universal_reference + scene=storyboard_reference_video；
                   // duration/ratio/resolution 按所选模型 scene 枚举就近取低档后回写 storyboards
                   // references=已定稿角色资产(服务端强制注入, ADR-角色一致性)；未定稿→该镜 400105，不整单失败
                   // 预算触顶→该镜 submitted:false + code:745703 + reason:budget_exceeded，接口仍 200(部分成功)
                   // 余额不足→整单 745701(不落任何任务)；参考图超 media_limits→400101(附 field)
                   // 重试或断点续跑只对 submitted:false 的镜再次调用；幂等语义见 §1「批量接口幂等语义」
GET  /projects/{id}/episodes/{eid}                      // 分镜+任务矩阵(断点续跑视图)；
                                                        // 每镜含 current_task_id + attempts[](按 tasks.shot_id 反查)
                                                        // + asset_ready(角色/场景均已定稿) + last_reason(400105/745703)

POST /projects/{id}/episodes/{eid}/export               // 导出异步化(P1-12)：返回 export_id
  ← {export_id, status:1}                               // 前置校验：SUCCEEDED 镜占比 ≥80%，否则 400106
GET  /exports/{id}                                      // 状态查询；轮询或 SSE
  ← {status:1PENDING|2PACKAGING|3SUCCEEDED|4FAILED, download_url?, included_shots[],
     missing_shots[], error?}
                                                        // zip = included_shots + manifest.json(失败/未投镜标注)
                                                        // SUCCEEDED 时 download_url 预签名(7 天有效)
```

## 9. assets

```
GET    /assets?kind=&folder_id=&tag=&page=
POST   /assets              {object_key, kind, name, tags[]}   // 也可从任务结果转存
PATCH  /assets/{id}         {name?, tags?, folder_id?}
DELETE /assets/{id}         // 进回收站; ?purge=true 直接删
POST   /assets/restore/{id}
GET    /assets/folders · POST /assets/folders {name,parent_id} · DELETE …
```

## 10. billing（Beta 支付）

```
GET  /billing/skus           ← [{sku,kind,price_cents,credits,period,label}]
POST /billing/orders         {sku_id, channel}
  ← {order_id, pay_params:{code_url}}     // 微信 Native
GET  /billing/orders/{id}    ← {status,…}  // 前端支付后轮询 ≤3min
GET  /billing/flows?page=    ← 积分流水
POST /billing/refund         {order_id, reason}  // 仅未消耗部分(Ph3)；写操作不得用 GET
// 支付回调: POST /billing/notify/wechat (服务端回调, 不在本契约)
```

## 11. ops / admin（独立鉴权 admin_users）

```
GET  /ops/config/{key}?module=&lang=      // 公开(公告/横幅/定价页文案)
PUT  /ops/admin/config/{key}              // 管理端
GET  /ops/admin/dashboard                 // 失败率/队列深度/adapter 延迟
PUT  /ops/admin/models/{id}               // 上下架/排序
PUT  /ops/admin/model-prices/{id}
```

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
