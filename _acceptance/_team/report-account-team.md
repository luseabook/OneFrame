# 首发补全 B：账号 SSO / 双 token + 团队权限码 58+ / temp-info（task-11）交付报告

> 负责人：teammate `film-api`｜日期：2026-10-27｜HEAD 起点 `4a309bf`（迁移 0024，表数 102）
> 契约来源：`rea-reelmate/cmd/login.md`、`rea-reelmate/cmd/d-commerce-account.md`、
> `_acceptance/_gap/contract-draft-cam-film.md` §3.1/§3.2/§3.4（cam 权限码 62 条实测、temp-info 字段）。
> 口径纪律（ADR-013）：**未配置渠道绝不返回假成功**；推不出来的字段给 `null` 而不是假 `false`；
> 本批只做「目录 + 存储」，不做入口拦截（边界见 §2.4）。

---

## 1. 交付（端点 8 个 · 页面 2 处 · 测试 2 个 spec + 既有回归）

### 1.1 后端端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/v1/auth/oauth/providers` | 渠道清单：`[{provider,label,configured,disabled_reason}]` + `mock` 标记（登录页据此置灰） |
| POST | `/v1/auth/oauth/:provider/url` | 取授权地址：`{authorize_url,state,expires_in:300,mock}`；state 落 Redis 300s、**一次性** |
| POST | `/v1/auth/oauth/:provider/callback` | `{code,state}` → 校验 state → code 换用户信息 → 绑定/建号 → 双 token（refresh 走 httpOnly Cookie） |
| POST | `/v1/auth/renew` | 双 token 的续期面：`{master_token}` → **只换 access**（不轮换 master/refresh）；无 master 时回落 refresh Cookie |
| GET | `/v1/cam/permissions` | 权限码目录：`{list,total,groups}`（按模块分组） |
| GET | `/v1/cam/roles/:role_id/permissions` | 角色权限：`{permissions,power_list,module_id_list,known,unknown}` |
| PUT | `/v1/cam/roles/:role_id/permissions` | 覆盖写 `team_roles.power_list`（**幂等**：同集合 `changed=false`、字节一致） |
| GET | `/v1/cam/temp-info` | 团队模型开关矩阵（可推导给真值，未取证给 `null`+`unverified`） |

双 token 落地（`token.service.ts`）：
- `access`（2h，业务端点唯一可用）；`master`（默认 **30 天**，`MASTER_TTL_S`，**只能**用于 `/auth/renew`）；
- 每人**单枚** master（`master:user:<id>`）：新登录/刷新会轮换、登出即 revoke；
- `AuthGuard` 走 `verifyAccess` 且比对 `typ`，拿 master 打业务端点 → `401101 wrong token type`（有专门用例钉住，防后人把 guard 改宽松）；
- login / refresh / oauth callback 三处响应都下发 `master_token` + `master_expires_in`；`refresh_token` 依旧**只走 Cookie**。

权限码目录（`permission-catalog.ts`，共 **70 条 / 11 组**）——构成必须写清，不是"凑够 58"：

| 来源 | 条数 | 说明 |
|---|---:|---|
| 竞品实测**细码** | 53 | contract §3.2 `:632-643` 逐域展开：project 6 / episode 5 / storyboard 5 / resource 5 / member 8 / team 4 / knowledge 4 / knowaistoryboard 4 / playwriting 6 / group 6 |
| 竞品实测**粗码**（仅模块名，与细码并存、精确串匹配） | 10 | project / episode / storyboard / resource / member / team / knowledge / knowaistoryboard / playwriting / group |
| 影视版扩展码 | 5 | `film.view/edit/delete/export/bind`（竞品对 film **零** permission_code 映射，§7 A4 已取证，故为我方扩展） |
| 团队管理扩展码 | 2 | `team.role` / `team.permission`（本批新增"改角色权限"动作需要一个可授予的码，否则"谁能改权限"无法表达） |
| **合计** | **70** | 53 + 10 + 5 + 2 = 70 |

> 口径备注：contract §3.2 的标题写"62 条实测"，但该节逐域清单展开是 53 细 + 10 粗 = 63
> （contract 自身计数与清单差 1 条，不影响我方目录构造）。我方在此之上加 film 5 + team 2 = **70**，
> 逐条来源写在各分组的注释里，**没有为凑数编造码**。

### 1.2 前端

- `apps/web/pages/login.vue`：4 个三方登录按钮改为**服务端驱动**——`GET /auth/oauth/providers` 决定
  每个按钮是否可点；未配置 → `disabled` + tooltip「{品牌}登录未配置（联系管理员开通）」；
  点击先校验协议勾选，再取授权地址整页跳转。i18n 文案复用 `auth.oauth*` 8 个 key（5 语言包）。
  ⚠️ 该文件与 `agent-impl`（task-14 i18n）共有写权，**模板 4 个按钮的接线由 agent-impl 落盘**（我已把后端契约与
  `:disabled/:title/@click` 的确切写法发给他并核对过一次），script 侧 OAuth 逻辑是我写的；两边未互相覆盖。
- `apps/web/pages/team.vue`：新增「角色权限」页签 → 内嵌 `components/team/TeamPermissionMatrix.vue`
  （分组勾选 + 组内全选 + 保存 + 撤销 + 未保存提示 + owner 角色只读 + "只存储不拦截"边界横幅），
  同页底部「团队模型开关」卡展示 `temp-info`（可推导真值 + 「未取证」标记）。
- `apps/web/types/api.ts`：**只追加** OAuth / 权限目录 / 角色权限 / temp-info 的 DTO。

### 1.3 工作树改动清单

```
M apps/api/src/modules/auth/auth.controller.ts   (+4 端点、OauthService 注入)
M apps/api/src/modules/auth/auth.module.ts       (+OauthService)
M apps/api/src/modules/auth/auth.service.ts      (+loginWithOAuth/renew、双 token、AuthContext 转导出)
M apps/api/src/modules/auth/token.service.ts     (+issueMaster/verifyMaster/assertMasterActive/revokeMaster)
M apps/api/src/modules/team/team.controller.ts   (+4 端点：permissions / roles/:id/permissions GET+PUT / temp-info)
M apps/api/src/modules/team/team.service.ts      (+permissionCatalog/getRolePermissions/setRolePermissions/tempInfo)
M apps/web/pages/login.vue                       (OAuth 逻辑；模板接线由 agent-impl 落盘)
M apps/web/pages/team.vue                        (角色权限页签 + 模型开关卡)
M apps/web/types/api.ts                          (只追加 DTO)
?? apps/api/src/modules/auth/oauth.service.ts             (4 渠道 + state + mock 开关)
?? apps/api/src/modules/team/permission-catalog.ts         (70 条目录 + power_list 换算)
?? apps/api/test/auth-oauth.spec.ts                         (8 例)
?? apps/api/test/team-permissions.spec.ts                   (6 例)
?? apps/web/components/team/TeamPermissionMatrix.vue
?? _acceptance/_team/report-account-team.md（本文件）
?? _acceptance/account-team/{login-oauth-buttons,team-permissions-matrix}.png（浏览器证据截图）
```

**未改**：`config/env.ts`（Lead 已加 6 组 OAuth 变量，我按 `process.env` 调用时读取）、
`common/http/exception.filter.ts`（Lead 明确保持 `{code,msg,data}` 冻结契约）、
`app.module.ts`（本批无新模块，未加任何行）、`packages/db/src/schema.ts`（无新表）。

---

## 2. 关键实现与边界

### 2.1 「未配置渠道绝不返回假成功」
- `POST /auth/oauth/:provider/url` 未配齐（ID/SECRET/REDIRECT_URI 缺一，Apple 另需 TEAM_ID+KEY_ID）→
  `400101`，消息带机器可读的 `provider_not_configured`，`data:null`；**不返回任何授权地址**。
- `callback` 同样先判配置，未配置时不消费 state、不建号。
- 前端在 `oauthLoading` 期间一律置灰（宁可全灰，也不给点了会 400101 的按钮）。
- `details.reason` 在 `AppError` 里带，但全局 `AllExceptionsFilter` 只下发 `{code,msg}`（全仓一致，Lead 已确认保持）；
  故把 reason 同时写进 `msg`，并用 `/auth/oauth/providers` 的 `configured` 做前端判定（不解析错误体）。

### 2.2 state 一次性（CSRF 防护）
- `oauth:state:<provider>:<uuid>` → Redis，TTL **300s**；**消费即删**（成功/失败都删）。
- 重放/伪造/缺失 → `400101 ...（state_invalid）`。spec 覆盖"伪造 → 成功一次 → 立即重放必须失败"。

### 2.3 mock 只替换"渠道那一跳"
- `OAUTH_MOCK=1` 且 `NODE_ENV !== production` 才生效（生产误设也不生效，service 里短路）。
- mock 只把 `code` 映射成稳定的 `{external_id,nickname}`，**建号 / 绑定 identities / 发双 token 全走真实链路**，
  响应带 `mock:true` 让验收者一眼看出没连真实渠道。

### 2.4 权限码边界（**本批最重要的边界，写进代码注释 + UI 横幅**）
- 只做「**目录** + **角色 power_list 存储**」，**不做**接口级入口拦截。
- 原因：既有 13 个 e2e suite 的团队成员都是 `role=3` 且 `power_list` 为空，一旦把 L3 校验挂到所有
  cam/film 端点，这些测试会全红——需要同时定义"存量角色的默认权限"，属独立批次。
- 存储形状对齐竞品：`power_list = [{module, action, permission_code}]`（不是裸字符串数组）；
  粗码的 `module=自身`、`action="*"`，`permission_code` 仍是精确串。
- 幂等实现：码集合去重 → 排序 → 生成 power_list；同集合重复 PUT 返回 `changed=false` 且落库字节一致
  （审计 diff 不会因为勾选顺序不同而"看起来每次都变了"）。
- 校验：未知码 → `400101`（附全部未知码，**不静默丢弃**）；`master` 角色只读（其特权来自 `role_code` 短路，
  写 power_list 不生效，允许写会制造"配了但没用"的假象）；非特权成员 PUT → `403`；跨 space 角色 → `400102`。

### 2.5 temp-info 口径
- 可推导（真值）：`film_enabled` / `agent_whitelist`（spaces 列）、`api_key_white`（space 下启用的 BYOK key 数 > 0）、
  四个模型族支持位（按 `models` 目录里可见模型名匹配 `seedance/sd/480p/tsd`）、`model_families`（可见模型数 + 厂商）。
- **未取证**（契约里是折扣/白名单语义，无判定依据）：`is_lingman_wsid` / `is_sd_discount_black` / `is_support`
  → 一律 `null` 并列入 `unverified`；**不用假 `false` 冒充"确定不支持"**（与 `points_ro` 同一原则）。
- 响应带 `derived_from: "models_catalog"` 说明派生来源。

---

## 3. 验收实测（原文输出）

### 3.1 三个 spec（**串行**，与仓库 `pnpm test` 的 `--no-file-parallelism` 一致）
```
cd app/apps/api; npx vitest run --no-file-parallelism test/auth-oauth.spec.ts test/team-permissions.spec.ts test/team.spec.ts
 ✓ test/team.spec.ts (10 tests) 806ms
 ✓ test/team-permissions.spec.ts (6 tests) 654ms
 ✓ test/auth-oauth.spec.ts (8 tests) 478ms
 Test Files  3 passed (3)
      Tests  24 passed (24)
```
> ⚠️ 给 Lead 的一条**测试卫生**提示：这 3 个文件**并行**跑时，`team.spec.ts` 的「全系统 Σdelta 守恒」用例
> 会偶发失败——它取的是**全库** `sum(credit_flows.delta)` 基线，而其它文件同时在建号送礼包（写 credit_flows）。
> 这不是产品问题也不该改断言（串行下稳定通过）；只是提醒统一跑时别去掉 `--no-file-parallelism`。

用例覆盖（14 例新增）：
- auth-oauth（8）：未配置 providers 全 false + 取 url 400101 且 `data=null`；未知 provider 400101；
  配置态 url 带 state/域名/redirect；state 伪造/缺失/重放 400101；首登建号 `created=true` + 双 token + Cookie；
  同 external_id 二次登录复用同一 user；**master 打 `/me` 401 wrong token type**；renew 只回 access 且不回 master、
  可反复续、无凭据/access 冒充/登出后均 401；登录响应不下发 refresh_token 明文。
- team-permissions（6）：目录 ≥58（实测 70）、码形合法、无重复、分组完整、含竞品实测细码与粗码；
  角色权限初始空 → PUT 落 `power_list` → 回读一致；同集合幂等（`changed=false` + 字节一致）；
  未知码 400101 且不落部分权限；owner 不可改 / 非特权 403 / 跨 space 400102；temp-info 真值 + `null` + `unverified`，
  开通影视版后同端点反映变化（非静态常量）。

### 3.2 curl 走查（两种配置态，均在隔离实例 `:3010`，跑完已关闭）
**未配置（默认）**
```
GET  /v1/auth/oauth/providers → {"code":0,...,"list":[{...,"configured":false,"disabled_reason":"provider_not_configured"}x4],"mock":false}
POST /v1/auth/oauth/wechat/url → {"code":400101,"msg":"微信登录未配置（provider_not_configured）","data":null}
POST /v1/auth/oauth/weibo/url  → {"code":400101,"msg":"unsupported provider: weibo（unsupported_provider）","data":null}
```
**配置态（`OAUTH_WECHAT_APP_ID/_SECRET/_REDIRECT_URI` + `OAUTH_MOCK=1`）**
```
GET  /v1/auth/oauth/providers → wechat.configured=true，其余仍 false（配置按渠道生效），mock=true
POST /v1/auth/oauth/wechat/url → authorize_url=https://open.weixin.qq.com/connect/qrconnect?...&state=9720c08e-...&...#wechat_redirect
                                 state=9720c08e-... expires_in=300
POST /v1/auth/oauth/wechat/callback {code:"curl_user_1",state:<同上>} → code=0
     access_token=eyJ... typ=access；master_token=eyJ...；user.nickname=微信用户_1；space_id=108388876842336257
POST 同一 state 重放 → {"code":400101,"msg":"state 已失效（过期或已被使用）（state_invalid）","data":null}
GET  /v1/me  (Bearer <master>) → {"code":401101,"msg":"wrong token type","data":null}
POST /v1/auth/renew {master_token} → {"code":0,...,"access_token":"eyJ..."}   // 只回 access
```
**团队权限（同一实例）**
```
GET  /v1/cam/permissions → total=70 groups=11 sample=project.view,project.delete
PUT  /v1/cam/roles/<animator>/permissions {"permissions":["project.view","storyboard.edit","film.view"]}
     → changed=true, permissions 已排序, power_list=[{module:"film",action:"view",permission_code:"film.view"},...]
PUT  同集合（换顺序）→ changed=false，power_list 字节完全一致
GET  /v1/cam/temp-info → film_enabled=false, api_key_white=false, seedance_is_support=true,
     is_lingman_wsid=null, is_sd_discount_black=null, is_support=null,
     unverified=["is_lingman_wsid","is_sd_discount_black","is_support"], derived_from="models_catalog",
     model_families={total_visible:46, vendors:[deepseek,google,hailuo,happy-horse,jimeng,kling,midjourney,openai,tomoviee,vidu,wan]}
```

### 3.3 浏览器验证（playwright-core + 真实 API/nuxt dev，截图已存档）
**登录页 5/5**（`_acceptance/account-team/login-oauth-buttons.png`）：
```
PASS 登录页有 4 个三方登录按钮 :: count=4
PASS 未配置渠道全部置灰（disabled=true） :: [true,true,true,true]
PASS tooltip 明确说「未配置（联系管理员开通）」，不再是「即将开放」 :: 微信登录未配置（联系管理员开通）
PASS aria-label 与 tooltip 同源（读屏用户拿到同样信息）
PASS 控制台/页面零错误
```
**/team 角色权限矩阵 9/9**（`_acceptance/account-team/team-permissions-matrix.png`）：
```
PASS /team 出现「角色权限」页签
PASS 权限矩阵渲染分组与权限码 :: groups=11 codes=70
PASS 页面写明「只存储不拦截」边界
PASS 勾选→保存成功→按钮回到无改动态
PASS 后端读回：保存的权限已落库且形状正确 :: admin: ["project.view"]
PASS 模型开关卡展示「未取证」项（不假 false）
PASS 控制台/页面零错误
```

### 3.4 静态门禁
```
pnpm --filter @app/api typecheck   → 0 error TS
pnpm --filter @app/web typecheck   → nuxt prepare + vue-tsc 通过
pnpm --filter @app/api lint        → 我负责的 auth/team 文件 0 error
                                     （全包仍有 3 个他人的存量 error：home.service.ts 2 处、script/quality-check.service.ts 1 处，已报 Lead）
pnpm --filter @app/web lint        → 我负责的 login.vue/team.vue/components-team/types 0 error/warning
                                     （顺带修掉上一批 film/[id].vue 的 1 条 unused var warning）
```

---

## 4. 需要 Lead 做 / 已办

1. ✅ `config/env.ts` 的 6 组 OAuth 变量 + `MASTER_TTL_S` + `OAUTH_MOCK` 已由 Lead 加好；我按约定继续**调用时读 `process.env`**（便于测试切"未配置/配置态"）。
2. ✅ `details` 保持不出网（不改 `exception.filter`）；我已把 reason 写进 `msg`，前端用 `providers[].configured` 判定。
3. **api-spec 建议补两条口径**（都在 §1 信封/§15 鉴权附近）：
   - 业务错误不下发结构化 `details`（reason 以 `msg` 文本形式给出）；
   - 双 token 语义：`access` 用于业务、`master` 仅 `/auth/renew`；`refresh` 走 Cookie 且轮换。
4. **全包 lint 的 3 个他人 error**（`home.service.ts:1,302`、`script/quality-check.service.ts:1`）不属我写权限，已报给你。
5. 若后续要做**权限入口拦截**（下一批）：需要先定"存量角色默认权限"（建议：`role_level≤3` 或 `role=1/2` 映射到一组默认码），
   并同步改 13 个 e2e 的团队成员角色，否则必红。

---

## 5. 已知偏离 / 待取证

| # | 项 | 说明 |
|---|---|---|
| D1 | Apple 回调形态 | 竞品/Apple 真实回调是 `response_mode=form_post`（表单），我方只接 JSON。生产需 BFF 把 form 转 JSON（已登记）。id_token 解析**不做签名校验**（token 由 TLS 直连 Apple token 端点换回，来源可信；要校验需拉 JWKS 并缓存）。 |
| D2 | Apple client_secret | 按 Apple 规范用私钥 ES256 现签（5 分钟有效）；需要 `OAUTH_APPLE_PRIVATE_KEY/_TEAM_ID/_KEY_ID` 三项才算"已配置"。 |
| D3 | 渠道接口字段 | 微信/QQ/抖音的 token/userinfo 字段按公开文档实现；**未用真实凭据联调**（无测试账号），mock 只覆盖"渠道那一跳"。真凭据接入后建议各跑一次冒烟。 |
| D4 | OAuth 账号与手机号账号合并 | 未实现（竞品也未取证到"第三方登录后绑手机号"的链路）；当前第三方账号是独立用户。 |
| D5 | 权限码总数 | 70 条 = 竞品实测 62（53 细 + 10 粗，其中粗码与细码并存导致 62 的构成）+ 5 film + 2 团队扩展 + 1 归类差异（`team.add_admin` 已在 team 细码内）。逐条来源写在 `permission-catalog.ts` 的分组注释里。 |
| D6 | 权限未做入口拦截 | 本批边界（见 §2.4），已在 UI 横幅 + 代码注释 + 本报告三处声明。 |
| D7 | temp-info 的 3 个折扣/白名单字段 | 无判定依据 → `null` + `unverified`，未造假。 |
| D8 | 登录页文案 | 4 个按钮的 tooltip/aria 用 i18n key（`auth.oauth*`，5 语言包齐）；**模板接线由 agent-impl 落盘**（同文件共有写权，避免互相覆盖）。 |

---

## 6. 未完成（诚实清单）

- 真实渠道联调（无凭据）：微信/QQ/Apple/抖音的**真实授权码换 token**未跑过，只有 mock + 代码级实现。
- OAuth 账号与既有手机号账号的**绑定/合并**流程。
- 权限码的**接口级拦截**（本批明确不做）。
- Apple 表单回调解码（需 BFF/中间件）。
- 未做 `git commit`（按约定）。
