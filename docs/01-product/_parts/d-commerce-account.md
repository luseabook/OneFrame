# D5 · 商业化 / 账号 / 团队 / 运营 / 创作者经济域

> 竞品：万兴剧厂 ReelMate（www.reelmate.cn）。本文只做竞品侧抽取，不含 OneFrame 规划。
> 证据口径：`routes.txt:N` 指 `rea-reelmate\routes.txt` 第 N 行；`报告 §N` 指 `rea-reelmate\REELMATE-逆向分析报告.md` 章节；`net1.json#request-NNN` 指 `rea-reelmate\net1.json` 内该 transaction 的抓包体；`chunk 名:偏移` 指 `rea-reelmate\scripts\files\origins\<origin>\assets\<chunk>.js` 内的字符位置。
> **所有价格/积分/档位数字实测于 2026-10-24，可能已变。** 标「推断」的条目为工程判断，非接口或文档直述。

---

## 1. 域定位
这一域不是"边缘功能"，而是 ReelMate 的**结算层**：产品把每一次 AI 生成都转成"积分扣减"这一条统一记账科目，再用 VIP 订阅把"折扣率"卖给用户，用团队积分池把"预充值"卖给工作室，用剧本集市把"内容供给"接进生产流水线。

- 路由体量（`routes.txt`，共 927 条非空）：计费/账户/团队/运营/创作者五族合计 **184 条**，其中剧本集市 41 条（C 端 29 + admin 12）、团队权限 39 条、运营 31 条、创作者内容 30 条、数据看板 13 条。
- 「积分」是全平台唯一的付费闸门：生成端点、资产提取、资产匹配、拆分镜、画布节点、剧本编辑 Agent 全部走 `point-calculate` 家族计价（`routes.txt:161`、`:221`、`:566`、`:685`、`:708`）。
- 「团队」是商业化的客单价放大器：同一套 VIP SKU 在团队版被改写成"人数 × 并发"的阶梯（见 §4.4），把年费从 ¥200 一路拉到 ¥50,000。

一句话：**ReelMate 用"积分"统一了成本口径，用"订阅"统一了折扣口径，用"团队"统一了预算口径**——三者叠加，才使"一个 AI 生成平台"具备可对账的企业级付费结构。

---

## 2. 账号与身份
### 2.1 登录方式矩阵
| 方式 | 实现形态 | 证据 | 备注 |
|---|---|---|---|
| 万兴统一账号 SSO | 登录弹窗内嵌 iframe：`accounts.wondershare.cn/v3/user/oauth-client/authorize?register_mode=4&product_id=20438&scope=user+normal&response_type=code&forced_region=CN&redirect_uri=…/web/v1/callback/login` | `login-modal-dom.txt`（iframe src）、`报告 §12.1` | **所有登录方式都由万兴账号中心承载**，ReelMate 端只做 code 换 token |
| 微信扫码 | SSO 面板内 tab（未在本端 DOM 展开） | 报告 §6、`login-modal2.png`（截图证据，本次未做图像解析） | 推断：由 SSO 面板渲染，本端无独立实现 |
| 手机验证码（默认） | 同上 | 报告 §6、`报告 §12.1` | 报告标"默认"档 |
| 密码登录 | 同上 | 报告 §6 | 与验证码同属 SSO |
| QQ / Apple / 抖音 | 同上 | 报告 §6 | 抖音入口另有官网外链（`v.douyin.com`，chunk `CAcgWOYw.js`） |
| 邀请码（可选） | 登录表单附加字段 | 报告 §6、`routes.txt:840`、`:847`、`:848` | 服务端有 `/op/invite-code/check` 与 `/op/invite-code/verify` 两个校验口 |
| 未注册自动建号 | SSO 侧 `register_mode=4` | `login-modal-dom.txt` | 推断：register_mode=4 表示"未注册则创建" |

> 纪律说明：`login-modal-dom.txt` 里**没有**明文「微信/QQ/Apple/抖音/手机号/验证码/邀请码」字样（已逐词检索，均 0 命中），因为这些 UI 全部在 iframe 内部渲染。故本表的登录方式列以 `报告 §6` 为准，DOM 证据只支撑"SSO iframe + register_mode=4"这一条。

### 2.2 双 token 续期模型
| 项 | 值 | 证据 |
|---|---|---|
| 端点 | `GET /web/v1/renew` | `routes.txt:861` |
| 返回字段 | `sign_in`、`uid`、`access_token`、`expires_in`、`is_new_user`、`need_verify_email`、`verify_email`、`space_id`、`master_access_token`、`master_expires_in`、`drive_pid` | `net1.json#request-301`（实测体） |
| 有效期 | `expires_in=3469`（≈58 min）；报告另测到 `1985s`（≈33 min） | `net1.json#request-301`、`报告 §12.1` |
| 双 token 用途 | `access_token` = 个人身份；`master_access_token` = **团队主控身份**。前端在 `roleLevel>1` 时把驱动类请求（`driveToken`）切到 master token | chunk `core-lib:486567` 的 `driveToken` getter |
| 续期触发 | 前端 `isTokenNearExpiry`：`expires_at - 300s` 即判临期；`autoRefreshTokenThreshold=300` | chunk `core-lib:486567` |
| 设备/产品标识 | `drive_pid=20438` | `net1.json#request-301` |
| 多标签登出同步 | `BroadcastChannel("reelmate:auth")` 广播 `{type:"logout", uid, at, sourceTabId, reason}` | chunk `core-lib:486567` 附近 `_broadcastLogout` |

> 实测中 `access_token` 与 `master_access_token` 取值相同（单人无团队账号）。**推断**：有团队且 `roleLevel>1` 时才产生真正不同的主控 token。

### 2.3 user-info 字段与空间/工作区
`GET /web/v1/user-info`（`routes.txt:889`）实测体（`net1.json#request-324`）：

| 字段 | 实测值 | 语义 |
|---|---|---|
| `uid` | 267379182 | 用户主键 |
| `email` / `mobile` | 均为 `""` | 手机/邮箱可为空（SSO 侧持有） |
| `nickname` | `创作者267379182` | 默认昵称由 uid 派生 |
| `vip_info` | `{feature_code:"", credit_total:0, expire:0, team_credit_total:0}` | **VIP 身份 + 积分总量 + 到期时间**三合一 |
| `invite_passed` | `true` | 邀请码是否已通过 |
| `is_cn_user` / `region` / `data_center` | `true` / `CN` / `sz` | 数据中心决定结果拉取域名（`报告 §12.9`） |
| `space_id` | `1960443501771751438` | **空间 ID**，随每个业务请求以 `X-Space-Id` 头上行 |
| `watermark_cfg` | `0` | 水印配置（0/1/2 三态，见 `isWatermarkCfgSetted`） |
| `legal_notice` | `0` | 合规提示开关 |

三层容器概念（易混，必须区分）：

| 层级 | 标识 | 产生方式 | 作用域 | 证据 |
|---|---|---|---|---|
| **空间 space** | `space_id` | 登录态自带 | 账号级；以 `X-Space-Id` 头生效 | `net1.json#request-324`；chunk `core-lib:232139` 的 `requireSpaceIdList=["/ai/","/task/","/asset/","/film/","/df/"]` |
| **工作区 workspace** | `workspace_id`（= `SP_ID`） | `workspace create` 创建 | 项目级；承载剧集/画布/资产 | `commands/workspace.md:3`、`:39-42` |
| **团队空间 team_wsid** | `team_wsid` / `wsid` | 团队建立时 | 团队级；与 workspace 不同实体 | `commands/account.md:35`（`team_wsid` 字段）、`commands/team.md:27` |

- 空间 ID 会被前端**延迟补齐**：若 `spaceId` 为空/`"0"` 且请求命中 `requireSpaceIdList`，前端触发 `refreshSpaceId` 事件并最多等 10 s（`SPACE_ID_WAIT_MS=1e4`）再发请求（chunk `core-lib:232139`）。**这意味着"空间"是比 token 更晚就绪的一层上下文。**
- 统一请求头：`X-Prod-Id`(20438)、`X-Prod-Ver`(`1.2.20`)、`X-Model-Ver`(`v2.0`)、`X-Lang`、`X-Client-Sn`、`X-Space-Id`，生成类另有 `X-Op-User-Id`（chunk `core-lib:231697`、`:776354`）。

---

## 3. 积分体系
### 3.1 账户结构与两套余额读数
| 接口 | 用途 | 返回字段 | 证据 |
|---|---|---|---|
| `GET /web/v1/user/credits` | 顶栏/弹窗余额（轻量） | `total_val`、`vip_val`、`recharge_val`、`give_val`、`expire_soon_val`、`team_credit_total`、`team_assigned_val` | `routes.txt:892`；`net1.json#request-433`；`cli-out/credits-balance.json` |
| `GET /web/v1/user/credits-dashboard` | 积分详情弹窗（角色化） | `{credit_data:{my_available, my_running, team_assigned, group_available, remaining_assignable}, account_role}` | `routes.txt:893`；chunk `Dxkw5LLn.js:0-3600` |
| `GET .../credits-dashboard/flows` | 增/耗/流转流水 | query `tab=income\|consume\|transfer`，带符号 `points`、`section`、`rm_task_id`、`volc_task_id` | `routes.txt:895`；`commands/credits.md:68-88` |
| `GET .../credits-dashboard/debt-list` | 欠费/负债列表 | `task_info_id`、`task_type`、`project_name`、`debt_amount`、`status` | `routes.txt:894`；chunk `Dxkw5LLn.js:3600-6700` 的 `D()` 映射 |
| `POST .../credits-dashboard/volc-query` | 火山后结算查询 | 无 query，body 传参 | `routes.txt:896`；chunk `core-lib:905707` |
| `GET /web/v1/user/credits-log` | **旧版**流水 | `event_type`(1 获取/2 消耗) + **无符号** `val` | `routes.txt:897`；`commands/credits.md:70-74` |

余额 7 字段语义（命名 + 前端 store 交叉判定，标「推断」者为推断）：`total_val`=可用总额（`net1.json#request-433`）；`vip_val`=订阅赠分余额，随 VIP 到期清零（推断：与 `vip_info.expire` 配套）；`recharge_val`=充值余额（推断：与 `buy/credits` 1:10 对价配套）；`give_val`=赠送分（推断：与 `op/daily-reward` 的 `invite_reward`/`first_reward` 配套）；`expire_soon_val`=即将过期（字段名直读）；`team_credit_total`=团队积分池总额；`team_assigned_val`=已分配到本人的团队积分（与 `cam/team/points-allocation` 配套）。

前端 `credit` store 只持久化 6 项（`totalVal/vipVal/rechargeVal/giveVal/expireSoonVal/teamCreditTotal`），**`team_assigned_val` 只在接口层出现**（chunk `Dxkw5LLn.js:0-400`）。推断：该项主要由团队页消费。

### 3.2 获取途径
| 途径 | 入口/接口 | 证据 | 备注 |
|---|---|---|---|
| 直接充值 | `GET /web/v1/buy/credits` → 4 档预付包 | `routes.txt:223`、`net1.json#request-400` | ¥50/100/300/600 → 500/1000/3000/6000 分，**恒定 1 分 = 0.1 元，无阶梯折扣** |
| 订阅赠分 | `GET /web/v1/buy/df-vip` 各档 `credits` + `giveaway_credits` | `routes.txt:224`、`net1.json#request-399` | 见 §4.2；大额档带额外赠送分 |
| 团队分配 | `POST /cam/team/points-allocation`、`batch-points-allocation` | `routes.txt:253`、`:249` | 主账号 → 成员/分组；不新增总额，只做内部转移 |
| 每日 / 邀请奖励 | `POST /web/v1/op/daily-reward` 一次返回 `reward_num`/`reward_success`/`invite_reward`/`first_reward`；`POST /op/referral-link` | `routes.txt:835`、`:856` | 前端按三类奖励是否有值决定弹窗（chunk `core-lib:494815`、`BsVZCoiV.js` 的 `checkShouldShow`） |
| 兑换码 | `POST /op/redeem-code/info`（查）→ `POST /redeem-code/redeem`（兑） | `routes.txt:855`、`:860` | 两段式，前端独立弹窗 `redeem-code` |
| 派发 / 活动升级 | `POST /op/points-giveaway`、`POST /subscribe/activity-upgrade/upgrade` | `routes.txt:851`、`:870` | 均为推断：运营定向发分 / 活动期补差价升级 |
| 新人权益 | `GET /op/abtest/hit` 返回 5 个 `BENEFIT_*` 布尔 | `routes.txt:829` | 见 §7.4 |

### 3.3 消耗途径（按计价端点归类）
| 计价端点 | 覆盖动作 | 证据 |
|---|---|---|
| `POST /web/v1/ai/point-calculate` | 图像/视频等模型生成（统一询价） | `routes.txt:161`、`net1.json#request-（point-calculate）` |
| `POST /web/v1/asset/workflows/node-point-calc` | 资产工作流节点 | `routes.txt:221` |
| `GET/PUT /df/novel/{nt_id}/buy/*`（6 端点） | 小说章/角色"购买"（集市前置） | `routes.txt:580-586` |
| `GET /df/novel/:nt_id/point`、`/df/script_project/drama_ad/project/point`、`/df/script_project/video_redraw/project/point` | 小说 / 广告剧 / 视频转绘的项目级计价 | `routes.txt:566`、`:685`、`:708` |

实测计价响应（文生视频 5s/720p，模型 `tomoviee_2.0`）：

```json
{"use_type":2,"points_code":"tm_text2video_5s_720p","cost":8,"total":0,"credit":0,
 "label":2,"min":0,"max":0,"credit_original":8,"credit_discount":1,
 "strike_credits":0,"strike_min":0,"strike_max":0,"strike_start":"","strike_end":""}
```
证据：`net1.json#request-（point-calculate 响应）`、`报告 §12.2`。

要点：
- **`points_code` 是可读的计价因子**（`tm_text2video_5s_720p` = 自营线 `tm_` 前缀 + 能力 + 时长 + 分辨率），这意味着计价是"规则表查表"，不是黑盒模型算价。
- `credit_original` / `credit_discount` / `strike_*` 分离出**原价、折扣系数、划线价区间与生效时段**——即界面可以先按原价展示再打折扣，折扣由服务端下发。
- `total:0`、`credit:0` 说明 `point-calculate` 是**纯试算**，不写账户；真实扣减发生在提交生成时。

### 3.4 流水与看板
| 能力 | 接口 | 关键点 | 证据 |
|---|---|---|---|
| 三 tab 流水 | `credits-dashboard/flows?tab=income\|consume\|transfer` | `tab` 由前端映射：`gain→income`、`consume→consume`、`transfer→transfer` | chunk `Dxkw5LLn.js:3200-3600` |
| 逐条溯源 | 上条返回 `rm_task_id`、`volc_task_id`、`section`、`prompt`、`status` | `volc_task_id` 仅火山/Seedance 任务非空 | `commands/credits.md:74` |
| 对账口径（官方口径） | 拿本轮全部生成 `task_id` 匹配 `rm_task_id`，对 `points` 绝对值求和 | 明令**禁止**按时间段/`feature_name`/邻近行估算 | `commands/credits.md:84-88`、`manual/workflow/_hard-gate.md:60-71` |
| 负债列表 | `credits-dashboard/debt-list` | 字段 `debt_amount`、`status`（`pending/unpaid/unsettled` → 未结；`paid/repaid/settled` → 已结）；`task_type` 里有 `script_agent` 专用文案 | chunk `Dxkw5LLn.js:3600-6700` 的 `T`/`C`/`Y` 常量 |
| 火山后结算查询 | `credits-dashboard/volc-query` | 逐条流水带 `query_enabled`/`can_query_volc`、`query_disabled_reason`、`query_expire_at` | 同 chunk 的 `E()` 映射 |
| 团队看板 | `/web/v1/kds/da/*` 13 个端点 | 见 §5.6 | `routes.txt:813-825` |

> **负债 + 火山后结算 = 先出片后补扣**。`debt-list` 的存在说明平台允许"余额不足仍提交"（或生成中途余额耗尽），随后以负债形式挂账，用户充值后自动"补扣"（`T` 集合里的 `待充值补扣`、`C` 里的 `已充值补扣` 直接印证）。这是**降低付费摩擦的关键设计**，不是风控漏洞。证据：chunk `Dxkw5LLn.js` 的 `T=new Set(["pending","unpaid","unsettled","0","1","待充值","待充值补扣"])`。
> 但 `volc-query` 的 `query_expire_at` 表明查询窗口有限；**推断**：火山侧账单延迟到达，过期即不可再溯源。

---

## 4. 定价与订阅
> 全部数字**实测于 2026-10-24，可能已变**（来源：`net1.json#request-399` / `#request-400`，与 `报告 §12.2` 一致）。

### 4.1 积分充值包（`GET /web/v1/buy/credits`）
| sku | 价格(元) | 积分 | 元/分 | 赠送 |
|---|---|---|---|---|
| 26229005 | 50 | 500 | 0.10 | 0 |
| 26229004 | 100 | 1000 | 0.10 | 0 |
| 26229003 | 300 | 3000 | 0.10 | 0 |
| 26229002 | 600 | 6000 | 0.10 | 0 |

**四个档位单价完全相同**——充值包只解决"一次充多少"，不做量价阶梯；真正的折扣全部挪到订阅里。付款走 `store.wondershare.com` checkout（`sku_id` + `verify` 签名 URL），自有站不碰支付。证据：`net1.json#request-400` 的 `buy_url`。

### 4.2 订阅 SKU（`GET /web/v1/buy/df-vip`，13 档实测）
| sku | sku_tag | 周期 | 售价(元) | 原价 | 续费价 | 积分 | 额外赠送 | 元/分(含赠) |
|---|---|---|---:|---:|---:|---:|---:|---:|
| 26240001 | reelmate-premium | 年 | 200 | 200 | 200 | 2000 | 0 | 0.100 |
| 26006016 | reelmate-premium | 年 | 1000 | 1000 | 1000 | 10000 | 0 | 0.100 |
| 26226003 | reelmate-premium | 年 | 5000 | 5000 | **1000** | 51000 | 4555 | 0.090 |
| 26226004 | reelmate-premium | 年 | 10000 | 10000 | 10000 | 103000 | 13500 | 0.086 |
| 26229001 | reelmate-premium | 年 | 50000 | 50000 | 50000 | 525000 | 63500 | 0.085 |
| 26219154 | reelmate-pro | 年 | 5699 | 5699 | 5699 | 5500 | 0 | 1.036 |
| 26219166 | reelmate-std | 年 | 3799 | 3799 | 3799 | 3500 | 0 | 1.085 |
| 26224001 | reelmate-basic | 年 | 1179 | 1179 | 1179 | 1000 | 0 | 1.179 |
| 26226002 | reelmate-ultra | 年 | 20299 | 20299 | 20299 | 20000 | 0 | 1.015 |
| 26219169 | reelmate-pro | 月 | 399 | 495 | 495 | 5500 | 0 | 0.073 |
| 26219168 | reelmate-std | 月 | 289 | 328 | 328 | 3500 | 0 | 0.083 |
| 26219167 | reelmate-basic | 月 | 99 | 99 | 99 | 1000 | 0 | 0.099 |
| 26226001 | reelmate-ultra | 月 | 1319 | 1749 | 1749 | 20000 | 0 | 0.066 |

**这张表里藏着四个反直觉的产品设计：**

1. **`reelmate-premium` 与个人档完全不在一个价格量级**：premium 是"团队"档（前端 i18n key 为 `pricing_v3.user_level_team`，chunk `CMK-dXM3.js:2455`），¥200/¥1000 两档给出与个人档同量级的积分但单价 0.1 元，而个人 `ultra` 年卡单价 1.015 元——**相差 10 倍**。说明"订阅"卖的不是积分，而是"给团队用的资格 + 折扣率"。
2. **月付是折扣、年付是原价**：月付档 `is_renew=1` 且 `price < original_price`（如 ultra 1319 vs 1749），`renew_price` 回到原价。即"首月/首期折扣、续费回原价"，是**留存钩子而非年付折扣**。
3. **最大年付档 `renew_price=1000` 而售价 5000**（sku 26226003）：续费价被压到 1/5，属于极端续费补贴；同类第 4 档（10000）续费仍 10000。**推断**：该档是"活动引流档"，配置遗留的促销锚点。
4. **`original_price` 在充值包侧全为 0**，在订阅侧全部等于 `price`（除月付）——划线价只对订阅生效。

### 4.3 VIP 等级体系（6 级 + 3 套别名）
| feature_code | 中文档位 | 排序权重 | i18n key | 证据 |
|---|---|---:|---|---|
| （空） | Free | — | `pricing_v3.v3_free` | chunk `CMK-dXM3.js:2008` |
| `reelmate-basic` | 体验版 Basic | 1 | `user_level_basic` | 同上；`chunk eFtVKThN.js:655` |
| `reelmate-advance` | （同 Basic 展示） | — | `user_level_basic` | 同上（别名档） |
| `reelmate-std` | 进阶版 Standard | 2 | `user_level_standard` | 同上 |
| `reelmate-pro` | 专业版 Pro | 3 | `user_level_professional` | 同上 |
| `reelmate-ultra` | 超创版 Ultra | 4 | `user_level_ultra` | 同上 |
| `reelmate-edu` | 教育版 Education | — | `user_level_education` | 同上（`/channel/education` 对应，`routes.txt:21-23`） |
| `reelmate-premium` | 团队版 Team | 1（**独立序号空间**） | `user_level_team` | 同上 |

权重表原值：`{"reelmate-basic":1,"reelmate-std":2,"reelmate-pro":3,"reelmate-ultra":4,"reelmate-premium":1}`；别名折叠表：`{"reelmate-basic1":"reelmate-basic","reelmate-ultra2":"reelmate-ultra","reelmate-ultra3":"reelmate-ultra"}`。证据：chunk `eFtVKThN.js:632-702`。

- 升级判定（`ue`/`me` 函数）：同 `period_unit` 下比较权重 → 大者 `upgrade`、小者 `lower`、相等且同 sku → `subscribed`；**年付档直接判 `subscribe`**，不参与升级比较（chunk `eFtVKThN.js:1200-1400`）。
- `feature_code` 是全站能力开关：`isPremium/isAdvance/isBasic/isFree/isMembership` 全部由它派生（chunk `core-lib:486567`）。
- 水印：`watermark_cfg` 0/1/2 三态，`isWatermarkCfgSetted` 与 `isWatermarkCfgSetNo` 两个 getter 分别处理"已设置"与"明确关闭"（chunk `core-lib:486567`）。**推断**：去水印是付费权益之一。

### 4.4 团队档的真实价值阶梯：人数 × 并发
前端把 5 个 premium 年付档与人数/并发硬绑定（chunk `eFtVKThN.js:2777` 起的 `ve`/`q`/`Te` 三数组）：

| 档位名（运营配置） | 价格(元/年) | 席位 members | 并发 concurrency |
|---|---:|---:|---:|
| 团队体验版 | 200 | 10 | 10 |
| 团队基础版 | 1000 | 10 | 10 |
| 团队进阶版 | 5000 | 10 | 10 |
| 团队豪华版 | 10000 | **20** | **30** |
| 团队尊享版 | 50000 | **50** | **50** |

证据：`sku_name` 来自 `pricing_skus_activity` 配置（`net1.json#request-377`），三档对齐关系来自 chunk `eFtVKThN.js` 的 `ve=[26240001,26006016,26226003,26226004,26229001]` == `q=[200,1000,5000,10000,50000]` 与 `Te`。

**结论：团队档买的是"并发"和"席位"，不是积分。** 前三档 10 人/10 并发完全一样而价格差 25 倍，说明中段档位靠**功能权限**（`pricing_v3_cn.sec_team_func` 的 7 项、`sec_exclusive` 的 12 项）区分而非资源量区分。这两组功能清单的 key 已可从 chunk `eFtVKThN.js:4200-8400` 的 `Pi`/`Ei` 配置数组读出（`func_canvas`/`func_isolation`/`func_role`/`func_credit_alloc`/`func_board`/`func_prompt`/`func_assets`；`ex_storyboard`/`ex_asset_agent`/`ex_script_agent`/`ex_seedance`/`ex_canvas_agent`/`ex_3d`/`ex_720`/`ex_ad`/`ex_restyle`/`ex_upscale`/`ex_gen_model`/`ex_free_assets`），但**具体文案未包含在这些 chunk 里**（见 §9 未知项）。

### 4.5 按秒计价与动态价格
| 机制 | 说明 | 证据 |
|---|---|---|
| 按秒计价 | 定价页头图 "1080P 低至 0.2 元/秒"（`header_buy_right_text`） | `net1.json#request-377` |
| 分档秒价（个人） | 每档 SKU 单独一组 4 个秒价：`[Seedance2.5-720P, Seedance2.5-1080P优惠版, Seedance2.0-720P, Seedance2.0-1080P优惠版]`，如 `reelmate-basic` = `["2.27","1.25","1.5","0.93"]`、`reelmate-pro` = `["1.51","0.85","1.0","0.63"]`、`reelmate-ultra` = `["1.37","0.77","0.9","0.57"]` | chunk `eFtVKThN.js:4200` 的 `Pe`；`net1.json#request-377` 的 `sku_card_activity[].promotion.items[].details[].text` 提供文案版 |
| 分档秒价（团队） | `mi` 矩阵按 5 档 × 4 列硬编码，与 `Pe` 完全同值 | chunk `eFtVKThN.js:4200` |
| mini 秒价 | `Re`/`xe`：basic 0.3 / std 0.25 / pro 0.22 / ultra 0.2（月），年付 0.29/0.27/0.26/0.26 | chunk `eFtVKThN.js:4200` |
| Wan3.0 秒价 | `Ee`/`Ne`：basic 0.48 / std 0.40 / pro 0.35 / ultra 0.32（月）；年付 basic 0.47 / 其余 0.41 | chunk `eFtVKThN.js:4200` |
| 动态价格 | `POST /web/v1/buy/sku-price`（**唯一带硬编码 `Authorization` 空头的购买接口**） | `routes.txt:225`、chunk `core-lib` 的 `apiBuySkuPricePostRequestConfig` |
| 限时价 | `dn` 侧 `time_limited_price` 字段（模型目录） | `commands/model.md:58`、`:62` |
| 会员价 | `member_price` > `time_limited_price` > `original_price` 三级回退 | `commands/model.md:62` |

> 秒价是**披露口径，不是结算口径**。真实结算走积分（`point-calculate` 返回 `cost:8`）。秒价只出现在定价页营销文案（`promotion.items[].details[].text`）与 SKU 卡片上，属于"把积分换算成人能懂的单价"的转译层。**推断**：`sku-price` 负责在用户切换档位时实时重算这一转译。

### 4.6 模型侧价格披露（交叉验证）
`cli-out/model-all.json`（46 模型）统计：仅 **11 个模型**带 `price`，共 **37 条 `price_variants`**；每条含 `member_price` / `original_price` / `time_limited_price` / `resolution` / `duration` / `model_label` / `model_value`。

| 模型 | need_vip | 默认规格 | member_price | original_price | time_limited_price |
|---|---|---:|---:|---:|---:|
| 可灵3.0 | true | 1080P 5S(带音频) | 5.4 | 6 | — |
| 可灵2.6 | true | 1080P 5S(带音频) | 3.7 | 5 | — |
| Wan 2.6 | true | 1080P 5S | 3 | 5 | 2.5 |
| Wan 2.5 | true | 1080P 5S | 3 | 5 | 2.5 |
| Hailuo 2.3 | true | 1080P 6S | 2.4 | 4 | — |
| 可灵 2.5 Turbo | true | 1080P 5S | 2 | 2.5 | — |
| Hailuo 2.3 - Fast | true | 1080P 6S | 1.4 | 2.31 | — |
| 可灵 2.5 Turbo-Std | true | 720P 5S | 1 | 1.5 | — |
| TNB Pro | false | 2K | 1.0 | — | — |
| 即梦4.0 | false | 2K | 0.2 | 0.2 | — |
| Vidu Q2 | false | 1080P 5S | 2.154 | 3.59 | 1.7 |

证据：`cli-out/model-all.json`（逐模型 `price_variants`）、`commands/model.md:52-62`。

三条关键结论：
1. **`need_vip` 与价格无关**：46 个模型中 20 个标 `need_vip=true`（Seedance 2.5/2.0 VIP/2.0 mini、Wan 3.0/2.6/2.5、可灵 O3/3.0/2.6/2.5/O1/3.1、Hailuo 2.3/2.3-Fast、即梦3.5 Pro、MiniMax H3、TS 2.0、TV 3.1 等），11 个有价模型中另有 3 个 `need_vip=false`（TNB Pro、即梦4.0、Vidu Q2）——即"有价"与"需会员"是两个独立标记。
2. **`member_price` 相对 `original_price` 为 6 折~10 折**（可灵3.0 5.4/6=0.90；可灵2.6 3.7/5=0.74；可灵2.5Turbo 2/2.5=0.80；Turbo-Std 1/1.5=0.67；Hailuo2.3 2.4/4=0.60；Hailuo Fast 1.4/2.31=0.61；Wan2.6 3/5=0.60；Vidu Q2 2.154/3.59=0.60；即梦4.0 0.2/0.2=1.00）。**即"成为会员"的直接收益就是模型单价打折**，而非"送积分"。
3. **同一模型的价格单位是"积分"还是"元"未在字段中声明**（`price: 5.4` 无 unit 字段），仅 `commands/model.md:62` 说明"定价配置使用独立的计费 SKU 命名"。推断：为**积分**，与 `point-calculate` 的 `cost` 同量级（文生视频 5s/720p=8 分）。

---

## 5. 团队 / 企业
### 5.1 角色层级（两套枚举并存，需注意）
`chunk Dso67aSD.js:0-2600`（当前 team store，11 级）：

| level | role_code | 展示 key |
|---:|---|---|
| 1 | `master` | `team.roleMaster` |
| 2 | `admin` | `team.roleAdmin` |
| 3 | `group_admin` | `team.roleGroupAdmin` |
| 4 / 5 | `project_manager_download` / `project_manager` | `team.roleDirectorDownload` / `team.roleDirector` |
| 6 / 7 | `project_executor_download`(= `t_executor_download`) / `project_executor` | `team.roleAnimatorDownload` / `team.roleAnimator` |
| 8 | `project_screenwriter` | `team.roleScreenwriter` |
| 9 | `project_video_editor` | `team.roleVideoEditor` |
| 10 | `producer`(= `film_producer`) | `team.roleFilmProducer` |
| 11 | `maker`(= `film_maker`) | `team.roleFilmMaker` |

`chunk BINuMtH7.js:0-200`（成员筛选专用，6 级）：`OWNER:1, ADMIN:2, GROUP_ADMIN:3, DIRECTOR:4, ANIMATOR:5, SCREENWRITER:6`。

> 两处枚举不一致（11 级 vs 6 级）。**推断**：6 级为早期/筛选专用枚举，11 级为当前权限模型，属版本遗留。选型以 11 级为准（有 i18n key 与 `role_level` 双向映射 `c()` 函数，且 `role_level>=6` 兜底到 `PROJECT_SCREENWRITER`）。`c()` 的中文兜底分支为：`组管理员`→3、`导演`→4/5、`动画师`→6/7、`编剧`→8、`剪辑师`→9、`制片`→10、`制作`→11——**证明中文角色名参与权限判定**，而非仅展示。

### 5.2 权限码体系（58 个点号权限 + 11 个分组）
| 分组 | 权限码 |
|---|---|
| `project` | `project.view` / `.create` / `.edit` / `.delete` / `.export` / `.member` |
| `episode` | `episode.view` / `.create` / `.edit` / `.delete` / `.download` |
| `storyboard` | `storyboard.view` / `.create` / `.edit` / `.delete` / `.confirm` |
| `resource` | `resource.view` / `.upload` / `.edit` / `.delete` / `.download` |
| `member` | `member.view` / `.create` / `.edit` / `.remove` / `.edit_admin` / `.disable_admin` / `.points` / `.download` |
| `team` | `team.view` / `.edit` / `.download` / `.add_admin` |
| `group` | `group.view` / `.create` / `.edit` / `.delete` / `.download` / `.member_change` |
| `playwriting` | `playwriting.view` / `.edit` / `.upload` / `.download` / `.delete` / `.member` / `.group` |
| `knowledge` | `knowledge.view` / `.create` / `.edit` / `.delete` |
| `knowaistoryboard` | `knowaistoryboard.view` / `.create` / `.edit` / `.delete` |
| `star` | `star.view` / `star.projectlink` |
| `filmproject` | `filmproject.view` / `filmproject.task` |

证据：`chunk BINuMtH7.js:0-3200` 的 `e` 常量表（58 个点号码，已去重统计）。

两个高价值细节：
- **权限码与接口一一绑定**：存在 `I` 映射表把具体"方法 + 路径"映射到权限码，如 `POST /web/v1/cam/team/points-allocation` → `member.points`、`POST /web/v1/cam/team/batch-points-allocation` → `member.edit`（注意：与上一条不同，批量分配归 `member.edit` 而非 `member.points`）。证据：chunk `BINuMtH7.js:1200-2200`。
- **降级策略表 `T`**：`menu.team`/`menu.toolbox`/`project.create`/`project.settings`/`project.member-manage` 等 → `hide`；`resource.download`/`resource.delete`/`playwriting.upload` → `disable`。即**同一权限缺失，有的入口直接隐藏、有的置灰**，是产品级细粒度设计。证据：chunk `BINuMtH7.js:2400-2600`。

CLI 侧权限预检清单（与上表同源）：`project.create`（建项）、`resource.edit`（资产提示词回填）、`episode.edit` + `storyboard.edit`（拆分镜）、`storyboard.edit`（分镜视频回填）、`project.edit`（画布生图/生视频）。证据：`commands/team.md:52`。

### 5.3 团队模式开关矩阵（`cam/team/temp-info`）
实测响应（`net1.json#request-436`，无团队账号）：

```json
{"api_key_white":false,"is_lingman_wsid":false,"is_sd_discount_black":false,
 "is_support":false,"name":"other","sd_480p_is_support":false,
 "sd_is_support":false,"seedance_is_support":true,"tsd_is_support":false}
```

| 字段 | 语义（推断） | 前端消费点 |
|---|---|---|
| `seedance_is_support` | 团队可用 Seedance 线 | `isSeedanceModelSupport`（默认 true） |
| `sd_is_support` | 团队可用 SD 线 | `isSdModelSupport` |
| `sd_480p_is_support` | 团队可用 SD 480p | `isSd480pSupport` |
| `tsd_is_support` | 团队可用 TSD 线 | `isTsdModelSupport` |
| `is_sd_discount_black` | 团队**被排除**在 SD 折扣外（黑名单） | `isSeedanceDiscountBlack`（store 默认 true） |
| `api_key_white` | 是否 API Key 白名单用户 | `apiKeyWhite` |
| `is_lingman_wsid` | 是否"灵曼"工作区（渠道/合作方） | `isLingmanWsidSupport` |
| `is_support` | 是否享受团队级支持 | chunk `core-lib:486567` 的 `isModelSupport` |
| `name` | 团队套餐代号（实测 `other`） | — |

关键点：**这是"团队级模型开关"**——同一个人在不同团队里能用的模型线不同（`isSeedanceSupport` getter = `isModelSupport || isSdModelSupport || isSeedanceModelSupport`，chunk `core-lib:486567`）。这意味着模型可见性由**团队签约档位**决定，不是由个人 VIP 决定。

### 5.4 分组与成员批量操作
| 能力 | 接口（前缀 `/web/v1/cam`） | 证据 |
|---|---|---|
| 团队信息/编辑 | `GET /team/:team_id/info`、`POST /team/:team_id/edit` | `routes.txt:239`、`:234` |
| 分组 CRUD + 统计 | `POST /team/:team_id/group`、`group/:group_id/edit`、`group/:group_id/delete`、`GET /team/:team_id/groups?view=`、`GET /team/{team_id}/group/{group_id}/stats` | `routes.txt:235-238`、`:261` |
| 成员查询 | `GET /team/:team_id/members`（12 个筛选：`role_ids`/`nick`/`sp_ids`/`account`/`remark`/`status`/`page`/`page_size`/`group_id`/`has_group`/`include_descendants`）、`GET .../member/:member_id` | `routes.txt:247`、`:240` |
| 成员批量 | `POST /team/:team_id/member/batch`、`POST /team/member/batch/status`、`batch/change-password`、`change-group` | `routes.txt:245`、`:251`、`:250`、`:252` |
| 成员单笔 + 导出 | `PUT .../member/:member_id/name`、`.../password`、`POST .../delete`、`GET .../member/export`、`GET .../member/:member_id/credential` | `routes.txt:243`、`:244`、`:242`、`:246`、`:241` |
| 角色 / 项目成员 / 关联用户 | `GET /role/list?team_id=`、`GET\|POST /project/:project_id/members(/bind\|/delete)`、`GET /linked-users?sp_id=` | `routes.txt:233`、`:230-232`、`:228` |
| 第三方 Key | `POST\|GET\|PUT\|DELETE /user/third/key/*`（`add`/`list`/`:id/info`/`:id/update`/`:id/delete`） | `routes.txt:262-266` |

> **批量动作的权限降级是刻意设计**：`points-allocation`（单笔）走 `member.points`，而 `batch-points-allocation` 走 `member.edit`——批量分配的门槛更高。推断：批量影响面大，需管理员级权限。证据：chunk `BINuMtH7.js:1200-2200`。

### 5.5 积分分配与回收
| 动作 | 接口 | 语义 | 证据 |
|---|---|---|---|
| 单笔分配 | `POST /web/v1/cam/team/points-allocation` | 主账号 → 成员 | `routes.txt:253` |
| 批量分配 | `POST /web/v1/cam/team/batch-points-allocation` | 一次性多人 | `routes.txt:249` |
| 回收 | `POST /web/v1/cam/team/points-recovery` | 成员 → 主账号 | `routes.txt:256` |
| 操作类型枚举 | `ALLOCATE:1` / `RECYCLE:2` / `EXPIRE_RECYCLE:4` | 分配 / 回收 / **过期回收** | chunk `BINuMtH7.js:2600-3200` |
| 流转流水 + 导出 | `GET .../points-flow/list`（8 筛选：`op_type`/`op_user_name`/`op_user_account`/`target_user_name`/`target_user_account`/`group_id`/起止时间）、`/points-flow/export` | 谁转给谁 | `routes.txt:255`、`:254` |
| 项目维度流水 | `GET .../project-points-flow/list`、`/export` | 按项目聚合 | `routes.txt:258`、`:257` |
| 排名 | `POST .../account-points-ranking`、`POST .../project-points-ranking` | 账号/项目两维 | `routes.txt:248`、`:259` |

**`EXPIRE_RECYCLE=4` 是最值得注意的一条**：分配给成员的积分会**自动过期回收**回团队池，而非永久归属成员。这使团队积分池成为"可回收预算"而非"已发生成本"，直接改变企业采购的财务口径（预充值可部分回流使用池）。推断：过期周期由团队套餐或配置决定（可见证据中无时长常量）。

### 5.6 团队数据看板（`/web/v1/kds/da/*`，13 端点）
| 端点（前缀 `/web/v1/kds/da`） | 维度 / 关键参数 | 证据 |
|---|---|---|
| `POST canvas/total-point-consume` | 画布总消耗 | `routes.txt:813` |
| `GET team/:team_id/basic-info` | 团队基础指标（`start_time_at`/`end_time_at`/`group_id`） | `routes.txt:814` |
| `POST team/:team_id/member-participate-detail` | 成员参与明细 | `routes.txt:815` |
| `GET team/:team_id/point-consume-rank` | 消耗排行（`rank_type`/时间/`group_id`） | `routes.txt:816` |
| `POST team/:team_id/point-manage-flow` | 积分管理流水 | `routes.txt:817` |
| `GET/POST team/:team_id/project-data/*` | 项目数据（`basic-info`/`export`/`query`） | `routes.txt:818-820` |
| `POST team/:team_id/project-member-point-detail` | 项目 × 成员积分 | `routes.txt:821` |
| `POST team/:team_id/query(/export)` | 综合查询与导出 | `routes.txt:822-823` |
| `GET team/member/:op_user_id/point-consume-detail` | 单成员消耗明细 | `routes.txt:824` |
| `GET team/member/:op_user_id/point-quota-detail` | 单成员配额明细 | `routes.txt:825` |

> 看板是**独立服务**（`kds` 前缀，推断为 KPI Data Service），与 `cam`（团队管理）分离。`cam` 只管"谁有多少分"，`kds` 只管"分花到哪去了"——两服务各自演进，是成熟 B 端产品的典型切分。

### 5.7 团队知识库
- 页面：`/team`（`routes.txt:90`）、`/team/dashboard`（`:91`）、`/team/knowledge-base`（`:92`）。
- 资产层实体挂在 `df/user_knowledge/*`（27 端点，`routes.txt:737-765`）：`dir` 目录树、`asset` 资产、`tag` 标签、`scriptwriter/list` 编剧列表；含 `batch-add-tags`/`batch-move`/`batch-delete`/`batch-remove-tags` 四个批量动作（`:751-754`）。
- 权限码：`knowledge.view/create/edit/delete`、`knowaistoryboard.view/create/edit/delete`（§5.2）。
- 与项目资产互通：知识库资产可 `import` 进项目（`routes.txt:744-748`）。推断：这是团队级"素材复用池"，避免每项目重复上传角色/场景图。

---

## 6. 创作者经济
两个**互不相同**的创作者体系，容易混淆：

| 体系 | 前缀 | 产出物 | 变现方式 | 证据 |
|---|---|---|---|---|
| **创作者中心（内容社区）** | `/web/v1/crc/*` + `/creator-center/*` | 图片/视频作品（asset/resource） | 点赞、关注、粉丝、激励金 | `routes.txt:275-304`、`:43-47` |
| **剧本集市（内容交易）** | `/web/v1/df/novel_market/*` + `/novel-market/:id` | 小说/剧本（文字 IP） | 上架售卖、预购、收益提现 | `routes.txt:601-629`、`:62` |

### 6.1 创作者中心（crc 域，30 端点）
| 能力 | 端点（前缀 `/web/v1/crc`） | 证据 |
|---|---|---|
| 信息流 / 分类 / 效果树 | `GET /home/list`、`GET /category/tree`、`GET /effect/tree` | `routes.txt:294`、`:291`、`:292` |
| 我的作品 | `GET /assets/me`、`POST /resource/list`、`GET /resource/info`、`POST /resource/action/status` | `routes.txt:286`、`:298`、`:297`、`:296` |
| **投稿审核流** | `POST /assets/auditing/list`、`POST /assets/auditing/info`、`POST /assets/audit-fail/del` | `routes.txt:281`、`:280`、`:279` |
| 作品处置 | `POST /assets/delete`、`GET /assets/download?id=&slug=`、`POST /assets/share` | `routes.txt:282`、`:283`、`:289` |
| 互动 | `POST /assets/likes`、`POST /assets/likes/action`、`POST /user/follows`、`/follows/action`、`POST /user/fans` | `routes.txt:284`、`:285`、`:300`、`:301`、`:299` |
| 举报 | `POST /assets/report`、`GET /assets/report/config` | `routes.txt:287`、`:288` |
| **激励 / 资料** | `POST /user/incentive`、`GET /user/info`、`POST /user/update` | `routes.txt:302`、`:303`、`:304` |
| 运营位 | `GET /banner_list?type=&scene=`、`GET /pop_up?type=` | `routes.txt:290`、`:295` |
| 活动位 | `POST /activity/list`、`/activity/public`、`GET /activity/info`、`POST /activity/resource/list` | `routes.txt:276`、`:277`、`:275`、`:278` |
| 文件预览 | `GET /file_preview` | `routes.txt:293` |

- 页面：`/creator-center`（`routes.txt:43`）、`/creator-center/:id`（`:44`）、`/creator-center/earnings`（`:45`）、`/creator-center/preview/:id`（`:46`）、`/creator-center/publish`（`:47`）。
- **审核是独立状态机**：`auditing/list`（审核中）→ `auditing/info`（详情）→ `audit-fail/del`（失败后善后），构成"投稿→审核→通过/失败→清理"闭环（`routes.txt:279-281`）。
- 举报原因走服务端配置（`assets/report/config`），非前端硬编码；激励条款走 CMS 外链 `incentive-rules.html`（chunk `core-lib` 的 `FRIENDLY_LINKS.INCENTIVE_RULES`）。

### 6.2 剧本集市 C 端（29 端点）
| 阶段 | 端点（前缀 `/web/v1/df/novel_market`） | 证据 |
|---|---|---|
| 浏览 | `GET /scripts?tag_ids=&category_id=&keyword=&page=&page_size=` | `routes.txt:614` |
| 详情 | `GET /scripts/{nm_id}/detail`、`/content-tree`、`/characters`、`/episodes`（`start_episode_no`/`end_episode_no`）、`GET /scripts/:nm_id/timestamp` | `routes.txt:625`、`:624`、`:623`、`:627`、`:629` |
| 作者/商务 | `GET /scripts/:nm_id/author`、`/business`、`/creator` | `routes.txt:617`、`:618`、`:619` |
| **协议** | `GET /scripts/:nm_id/agreement`、`/agreement-file` | `routes.txt:615`、`:616` |
| **交易** | `POST /scripts/{nm_id}/preorder`、`POST /scripts/{nm_id}/cancelorder`、`GET /scripts/{nm_id}/download` | `routes.txt:628`、`:622`、`:626` |
| 集市配置 | `GET /scripts/config`、`GET /scripts/promotions` | `routes.txt:620`、`:621` |
| 创作者侧：作品 | `GET\|POST /creator/works`、`/creator/works/:nm_id`、`POST /creator/works/save`、`/creator/works/parse`、`GET /creator/works/stats` | `routes.txt:604`、`:605`、`:612`、`:611`、`:613` |
| 创作者侧：上/下架 + 协议 | `POST /creator/works/:nm_id/submit`、`/offline`、`GET /creator/works/:nm_id/agreement` | `routes.txt:609`、`:608`、`:606` |
| **创作者侧：收益/提现** | `GET /creator/revenues`（`status`/分页）、`GET /creator/revenues/overview`、`POST /creator/works/:nm_id/withdraw`、`GET /creator/profile` | `routes.txt:602`、`:603`、`:610`、`:601` |

### 6.3 剧本集市 Admin 侧（`/v1/rmadminsrv/*`，12 端点）
| 能力 | 端点 | 证据 |
|---|---|---|
| 分类 / 标签 / 促销 | `categories(/​{category_id})`、`tags(/​{tag_id})`、`promotions(/​{promotion_id})` | `routes.txt:100-104`、`:110`、`:111` |
| **审核流（双段式）** | `POST .../scripts/{nm_id}/submit-review` → `POST .../scripts/{nm_id}/review-result` | `routes.txt:109`、`:107` |
| 文稿 / 列表 / 看板 | `POST .../scripts/save-draft`、`GET .../scripts/list`、`GET .../dashboard/scripts` | `routes.txt:106`、`:105`、`:102` |
| 原始剧本溯源 | `GET .../scripts/{nm_id}/source-original-script` | `routes.txt:108` |

> **admin 是独立服务域（`rmadminsrv`），不在 `web/v1` 下**——集市审核是运营后台，与 C 端物理隔离。`source-original-script` 证明平台持有上游原始剧本，即集市商品有"二次改编权"溯源链（推断：对应 §6.4 协议体系）。

### 6.4 协议与结算链
`agreement` 出现 4 次（`routes.txt:606`、`:615`、`:616`，另有 `:618` 的 `business`），构成集市核心合规件：买方看 `scripts/:nm_id/agreement` + `agreement-file`；创作者看 `creator/works/:nm_id/agreement`；`business` 单给商务条款。**提现按作品维度**（`works/:nm_id/withdraw`）而非账户余额，说明收益是**分作品分账**。

> 推断：按作品提现意味着"一作品一合同一结算"，多作品创作者需走多笔提现。体验成本高，但法律关系清晰、便于按 IP 分账与审计。

### 6.5 激励活动（campaign，6 端点）
| 端点 | 用途 | 证据 |
|---|---|---|
| `GET /web/v1/campaign/list` | 活动列表 | `routes.txt:269` |
| `GET /web/v1/campaign/detail?campaign_id=&campaign_key=` | 活动详情 | `routes.txt:268` |
| `GET /web/v1/campaign/awards?campaign_id=&campaign_key=` | 奖项设置 | `routes.txt:267` |
| `GET /web/v1/campaign/shortlist?campaign_id=&campaign_key=&page=&page_size=` | 入围名单 | `routes.txt:270` |
| `GET\|POST /web/v1/campaign/signup/draft?campaign_id=&campaign_key=&channel=` | 报名草稿（可续填） | `routes.txt:271` |
| `POST /web/v1/campaign/signup/submit` | 报名提交 | `routes.txt:272` |

页面：`/activities`、`/activities/:activityKey`、`/activities/wanju-vc/submission`、`/activity/jushuoyuelu/*`（`routes.txt:4-10`）。

- **`campaign_key` 与 `campaign_id` 双主键**：URL 用可读 slug，内部用 id——支持"同一活动多渠道入口"。
- **`signup/draft` 的 GET + POST 组合**：报名可分次填写保存草稿，`channel` 记录来源渠道，是长表单留资的标准做法。
- 具体奖金池数字（如报告 §1 提到的"投稿激励 最高 8 万元/部"）**未在任何接口或打包产物中找到可验证字段**，见 §9-U7。

---

## 7. 增长与运营（`/web/v1/op/*`，31 端点）
### 7.1 邀请与分销
| 能力 | 端点 | 证据 |
|---|---|---|
| 邀请码（生成/查询） | `GET/POST /web/v1/op/invite-code` | `routes.txt:840` |
| 邀请码校验 | `GET /op/invite-code/check`、`POST /op/invite-code/verify` | `routes.txt:847`、`:848` |
| 邀请码问卷 | `POST /op/invite-code-questionnaire`、`POST /check`、`GET /filled?activity_id=&wsid=`、`GET /invite-activity-check`、`POST /verify`、`GET /:activity_id` | `routes.txt:841-846` |
| 推荐链接 | `POST /op/referral-link` | `routes.txt:856` |
| **被邀请人订单** | `POST /op/invitee/order-records` | `routes.txt:849` |
| **分销总览** | `POST /op/distributor/overview` | `routes.txt:838` |
| 分销明细 | `POST /op/distributor/detail?invitee_type=` | `routes.txt:836` |
| 分销收入 | `POST /op/distributor/income-detail` | `routes.txt:837` |
| 分销提现 | `POST /op/distributor/withdrawal-list` | `routes.txt:839` |

**分销的三段式结构**（总览 → 明细 → 收入/提现）说明这是**真金分佣**而非"送积分"：有独立的收入账本与提现列表。`invitee/order-records` 让分销员能看到被邀请人的**实际订单**——即**按成交分佣**，不是按注册分佣。

页面：`/partner-center`（`routes.txt:67`）、`/partner/invite`（`:68`）、`/channel/education/invite`（`:23`）。

### 7.2 每日奖励与新人权益
`POST /web/v1/op/daily-reward`（`routes.txt:835`）→ `{reward_num, reward_success, invite_reward, first_reward}`。

| 机制 | 实现（chunk `core-lib:494815` 的 `_checkDialyReward`） |
|---|---|
| 触发条件 | **仅 `tokenInfo.is_new_user === true` 才调用** |
| 并发保护 | `isDialyRewardRequestLocked` 一次性锁 |
| 得奖后动作 | 任一 `reward_success\|invite_reward\|first_reward` 为真 → `refreshCreditsInfo(3)` |
| 弹窗条件 | `dailyReward.{invite_reward, first_reward, first_reward_num}` 有值即弹（chunk `BsVZCoiV.js` 的 `checkShouldShow`） |
| 幂等 | `sessionStorage["submissionModalShow_<uid>"]` 防重复弹 | 

> **新用户留存钩子的标准实现**：只在 `is_new_user` 时拉一次，一次返回"今日奖励 + 邀请奖励 + 首充奖励"三类，前端合并成一个弹窗。推断：`reward_num` 对应每日登录送分，`first_reward` 对应首次完成任务送分。

### 7.3 兑换码
刻意分成两个服务路径：`POST /web/v1/op/redeem-code/info`（查，`routes.txt:855`，**不兑换**）→ `POST /web/v1/redeem-code/redeem`（兑，`routes.txt:860`）。

> 拆分原因（推断）：`op/*` 是运营服务，`redeem-code/*` 是独立核销服务（可能对接卡券/渠道系统）。先 `info` 后 `redeem` 让前端在兑换前展示"这是什么码、给多少分"。

### 7.4 AB 实验与问卷
| 能力 | 端点 | 实测/说明 | 证据 |
|---|---|---|---|
| AB 命中 | `GET /op/abtest/hit?wsid=&op_user_id=` | `{hit:true, benefits:{BENEFIT_CREATE_EPISODE:1, BENEFIT_EXTRACT_ASSET_LIST:1, BENEFIT_GEN_ASSET_PROMPT:1, BENEFIT_MATCH_SUBJECT:1, BENEFIT_SPLIT_SHOT:1}}` | `routes.txt:829`、`net1.json#request-（abtest 响应）` |
| 消耗记录 | `POST /v1/rmopsrv/abtest/consume` | 独立服务前缀 | `routes.txt:118` |
| 注册问卷 | `GET /op/register-questionnaire/check?qid=1099` | `{is_complete:1}` | `routes.txt:858` |
| 通用问卷 + 管理 | `GET\|POST /op/questionnaire`、`GET /op/questionnaire/mgr/list?limit=&page=&uid=`、`POST /op/questionnaire/mgr/review/:id` | **有审核环节** | `routes.txt:852-854` |
| 内测问卷 / 状态 | `POST /op/beta-questionnaire(-abroad)`、`GET /check`、`POST /mobile-verify`、`GET /op/beta-status` | 国内/海外两套 | `routes.txt:830-834` |
| 奖励通知 / 短信码 | `POST /op/rewards-notification`、`POST /op/mobile-captcha` | — | `routes.txt:859`、`:850` |

**5 个 `BENEFIT_*` 是"首次免费权益"开关**（chunk `core-lib` 的 `BENEFIT_CODE` 常量 + `isBenefitAvailable` getter），恰好覆盖流水线的 5 个付费动作：

| 权益码 | 产品动作 | 效果 |
|---|---|---|
| `BENEFIT_CREATE_EPISODE` | 建剧集 | 首次建集免积分 |
| `BENEFIT_EXTRACT_ASSET_LIST` | 资产清单提取 | 首次提取免积分（对应 `credits estimate` 的"含首次提取权益"） |
| `BENEFIT_GEN_ASSET_PROMPT` | 资产生成提示词 | 首次免积分 |
| `BENEFIT_MATCH_SUBJECT` | 主体匹配 | 首次免积分（对应"含首次匹配权益"） |
| `BENEFIT_SPLIT_SHOT` | 拆分镜 | 首次免积分 |

证据：`net1.json#request-（abtest）`、`commands/credits.md:112-116`（`web_formula` 明确"含首次提取权益""含首次匹配权益"）、chunk `core-lib` 的 `BENEFIT_CODE`。

> **这是整条流水线的"首集免费"设计**：从建集到拆分镜 5 个付费动作各有一次免费额度，让新用户零成本跑通完整一集。这是把付费漏斗前移到"体验完整度"的关键手段，也解释了 `credits estimate` 为何要区分 `web_formula`（含权益）与 `point_calculate`（不含）。

### 7.5 其他运营位
| 能力 | 端点 | 证据 |
|---|---|---|
| 配置中心 | `GET /web/v1/config?key=&module_name=&lang=` | `routes.txt:274` |
| 功能白名单 | `GET /web/v1/func-whitelist?scene=ai_film` → `{check:false}` | `routes.txt:812`、`net1.json#request-（同）` |
| 未读消息（长轮询） | `GET /web/v1/msg/exist-unread?pid=20438` → 超时返回 `741001 long polling timeout` | `routes.txt:828`、`net1.json#request-（同）` |
| 用户 IP | `GET /web/v1/user/ip` | `routes.txt:898` |
| 语言上报 | `GET /web/v1/user/language/report` | `routes.txt:899` |
| 设置项 | `GET/PUT /web/v1/user-settings?scope_type=&keys=` | `routes.txt:890` |
| 最近订单 | `GET /web/v1/trade-order/latest?before_sec=` | `routes.txt:888` |
| 环境信息 | `GET /web/v1/env` | `routes.txt:774` |

- 配置中心是**全站文案/头图/模型引导/定价头图的统一来源**（`pricing_header_banner`、`pricing_skus_activity`、`page_init`、`operation_banner`、`ActivityHeaderPopupData`、`hot_drama_showcase`、`model_guide_popup` 等 key，见 `net1.json` 的请求 URL 列表）。`module_name` 区分 `20438`（产品）/`sys`/`web` 三个配置域。
- `func-whitelist?scene=ai_film` 是**影视版内测开关**，实测 `check:false`（未开通），与 `/film-creation` 页面的"内测申请"对应。
- `user-settings` 用 `scope_type=1/2` 区分作用域（推断：1=个人、2=团队），`keys=home_creation_tab` 说明**首页创作 tab 的默认选中项是按用户偏好存的**。

---

## 8. 该域的产品逻辑要点
**① 积分是"统一成本口径"，不是"虚拟货币"。**
`points_code`（`tm_text2video_5s_720p`）把价格直接编码成"厂商前缀 + 能力 + 时长 + 分辨率"的规则名，`credit_original`/`credit_discount`/`strike_*` 把原价/折扣/划线价分离。这意味着**改价是改配置表，不是改代码**；也让"按秒报价"与"按次扣分"能共存于同一套账（§4.5）。对手若用"直接对接各家 API 按量付费"，则永远无法做出统一的跨模型对账与团队预算池。

**② 订阅卖的是"折扣率"，不是"额度"。**
同一模型 `member_price` 是 `original_price` 的 6~8 折（§4.6）；`reelmate-premium`（团队档）与个人 `ultra` 的元/分单价差 10 倍（§4.2）。平台实质是在**批发转零售**：以团队/年付锁定采购量，换取更低的模型成本分摊。

**③ 团队档的价值锚点是"席位 × 并发"，不是积分。**
前三档 10 人/10 并发完全相同却相差 25 倍价格（§4.4），差异全在功能权限矩阵（`func_*`/`ex_*` 19 项）。这说明团队客户**为"能不能用"付钱，不为"用多少"付钱**——这是 B 端 SaaS 的标准定价法，也是 ReelMate 从 C 端工具升级为企业采购的关键一跳。

**④ 先出片后扣费（负债 + 火山后结算），把付费摩擦挪出创作流。**
`debt-list`（`debt_amount` + `待充值补扣`/`已充值补扣` 状态）与 `volc-query`（`query_expire_at` 查询窗口）证明平台允许生成过程中余额耗尽、先把任务跑完再挂账（§3.4）。这直接保护了"一集 100+ 镜"的长任务不被余额中断——**在批量生产场景下，这是刚需而非宽容**。

**⑤ 首次免费权益贯穿整条流水线，是获客设计的核心。**
5 个 `BENEFIT_*`（建集/资产提取/资产提示词/主体匹配/拆分镜）各给一次免费额度（§7.4），让新用户能零成本跑通完整一集。配合"充值包无阶梯折扣、订阅才有折扣"（§4.1），漏斗被刻意设计成：**免费跑通一集 → 发现积分不够 → 订阅（而非充值）**。

---

## 9. 未知项 / 证据缺口
| # | 未知项 | 影响 | 已尝试的取证路径 |
|---|---|---|---|
| U1 | **VIP 各档的功能权益文案**（`pricing_v3_cn.ex_*` / `func_*` 的 19 项具体内容） | 无法判断"中段团队档凭什么贵 25 倍"的具体权益名 | chunk `eFtVKThN.js` 仅含 i18n **key**，文案在语言包内，未在本批导出文件中（`scripts/files` 只有 133 个 chunk，语言包未包含） |
| U2 | **`Ie={basic:108,std:403,pro:633,ultra:2300}` 与 `Ke=[215,1150,6389,13372,67648]` 两组常量的语义** | 可能是"月度赠送额度"或"成本基线"，直接影响对毛利结构的判断 | 已检索全 chunk，仅定义无调用点（打包后未被引用或由其它 chunk 消费）；与价格/积分的比值均非线性 |
| U3 | **`buy/vip` 与 `buy/df-vip` 的区别** | 可能存在"个人订阅"与"团队订阅"两套完全不同的商品 | `buy/vip` 无 query 参数（`requestDataOptional:!0`），且**从未在任何抓包中被调用**（`net1/net2/net3/net-canvas/net-node/net-explore` 全无命中）；`buy/df-vip` 实测返回 13 档。推断：`buy/vip` 为旧版/海外版接口 |
| U4 | **`buy/sku-price` 的请求/响应 schema** | 动态价格机制无法确认 | `routes.txt:225` 有路由，`chunk core-lib` 有 `apiBuySkuPricePostRequestConfig`（唯一带硬编码 `Authorization:""` 请求头），但**无抓包样本**，`requestDataJsonSchema:{}` 为空 |
| U5 | **`subscribe/activity-upgrade/upgrade` 的业务语义** | 无法确认"活动升级"是补差价升级还是活动赠送升级 | `routes.txt:870` 仅一条，`requestBodyType:json` 但无字段定义，无抓包 |
| U6 | **`trade-order/latest` 的返回结构与用途** | 无法确认是否有"订单中心"产品页 | `routes.txt:888`、`query:["before_sec"]`，无抓包；页面路由中无 `/orders` 类入口（仅外链 `wondershare.cn/web/history`，见 chunk `core-lib` 的 `FRIENDLY_LINKS.USER_ORDERS_HISTORY`） |
| U7 | **激励活动的具体奖金池数字**（如"最高 8 万元/部"） | 无法验证报告 §1 的金额 | `/campaign/awards` 与 `/campaign/detail` 均需 `campaign_id`/`campaign_key`，本次未取得有效活动 ID；打包产物内无硬编码金额 |
| U8 | **`op/points-giveaway` 的触发条件与发放规则** | 无法确认是"运营定向发放"还是"用户自助领取" | 仅知 `POST`、无 query、`requestDataOptional:!1`（必带 body） |
| U9 | **团队积分过期的具体周期**（`EXPIRE_RECYCLE=4` 的触发规则） | 直接影响企业预算可回收性的判断 | 仅在 chunk `BINuMtH7.js` 见枚举值与配色/i18n key，无时长常量 |
| U10 | **`cam/team/temp-info` 的 `name` 字段全集**（实测仅见 `other`） | 无法确认有几个团队套餐代号、与 5 个 premium 档的映射关系 | `net1.json#request-436` 实测值为 `"other"`（该账号无团队）；`pricing_skus_activity` 的 `sku_name` 提供 5 个中文名但无代号映射 |
| U11 | **data_center 与价格的关系**（`sz`/`eus`/`eop`/`sgp`） | 无法确认海外是否另一套 SKU/币种 | `net1.json#request-324` 实测 `data_center:"sz"`、`currency:"CNY"`；`报告 §12.9` 提到 `eus/eop/sgp` 结果域名，但无海外定价抓包 |
| U12 | **`crc/user/incentive` 的激励规则与金额** | 创作者中心激励与 campaign 的关系不明 | 单端点无参数定义，激励规则外链 CMS（`incentive-rules.html`），本次未抓取该 CMS 页面 |

**已知证据缺口的方法学说明**：本域 90% 以上的一手证据来自两条路径——(a) `routes.txt` 的路由清单（927 条，可确认"有什么"，不可确认"怎么用"）；(b) `net1.json` 的登录态首页+定价页抓包（可确认"定价与账户结构"，但只覆盖 4 个购买端点的成功响应）。**所有"权限/团队/创作者/运营"子域的接口都只有路由、没有实际请求/响应样本**，故本文对这些子域的描述以"端点存在 + 参数名可读 + 前端 chunk 有对应逻辑"三层交叉为限，凡涉及具体数值或业务规则的一律标「推断」或列入本表。
