# API 规范 v1

> v1.2 · 基础域名 `https://api.<domain>/v1` · 与 database.md / PRD 同步演进
> 本文件是契约的唯一事实来源；实现用 OpenAPI 生成（drizzle/nest 自动 + 本文件人工对账）
> v1.1 · 2026-10-24 · 按启动前审查报告修订（P0-04/05/10、P1-03/05/08/10/11/12/22/24、P2-03/08/21/23）
> v1.2 · 2026-10-24 · 按《逆向一致性审查》修订：模型目录字段对齐 46 模型目录（mode_order/endpoint/default_*/resolution label）、批量报价与折扣字段、mode/scene 键补 `studio_asset_image` 等、预算触顶改逐镜 200 部分成功、新增 share/split/导出部分成功规则、错误码来源标注与 400104/400105/400106、任务与资产定稿门槛（RE-01~RE-20）
> v1.3 · 2026-10-24 · 与实现同步：`/models` 增 `audio_video_support`；错误码 400104~400107 已落 `packages/shared`；P1 数据层 16 表见 database v1.3

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

## 8.1 works（作品库与二次创作，PRD F9）

> 作品 = 项目（1:1，不新增表）。作品库是「以剧为单位」的成果聚合视图，与任务中心（以次为单位的执行视图）互补。

```
GET /works?status=archived&page=1&page_size=24
  ← {list:[{
       id,title,ratio,source_type,archived_at,is_sample,created_at,
       episode_count,            // 集数
       shot_count,               // 分镜总数
       done_count,               // 已成功出片镜头数
       cover_uri,                // 已签名的封面 URL（优先已转存图片资产，退化角色定妆图）
       work_state                // draft | producing | ready | archived
     }], total, page, page_size}
```

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

## 9. assets

```
GET    /assets?kind=&folder_id=&tag=&page=&page_size=&deleted=true      // deleted=true 查回收站
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
PUT  /ops/admin/models/{id}               // 上下架/排序
PUT  /ops/admin/model-prices/{id}
GET  /ops/admin/task-metrics              // 失败率 + 错误码分布 + adapter avg/p95 延迟
GET  /ops/admin/failed-tasks.csv          // 失败任务清单导出(CSV, ≤1000 行)
GET  /ops/admin/funnel                    // 流水线漏斗：建项→大纲→角色定稿→分镜→批量→成功(含转化率)
GET  /ops/admin/reports · POST /ops/admin/reports/{id}/resolve {action:takedown|dismiss}
GET  /ops/admin/orders?status=&page=&page_size=   // 订单列表（含退款留痕）
POST /ops/admin/orders/{id}/refund {reason?,amount_cents?}   // 全额退款（api-spec §10.5）
```

> 鉴权：/ops/admin/* 需 admin_users 独立 JWT；无凭证 → 401101，携带普通用户 token → **403101**。

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
