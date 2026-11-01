# 邀请码并发删除 × 陈旧快照 浏览器 E2E（第 111 批）交付报告

> 负责人：batch-111｜日期：2026-11-01｜baseline `e8f418f`
> 对应缺口：`docs/README.md` v6.68「仍未做」——「后台 E2E 仍是**单进程单浏览器**，不覆盖多管理员同时操作同一条码」。
> 口径纪律（ADR-013）：只写**实测过**的东西；没覆盖的写「未覆盖」；每次运行会落一条数据到本机开发库，明确写在 §3。

---

## 1. 交付

### 1.1 验收脚本（新增）

`_acceptance/e2e-invite-race.cjs` —— `playwright-core` + 真栈（api :3002 / web :3003），
**两个隔离浏览器上下文**（各自 `localStorage.admin_token`，不共享缓存与页面状态）同时操作同一条码：

| 段落 | 现场 | 断言 |
|---|---|---|
| S1 并发删除 | 两个后台会话都打开 `/admin?tab=invites`，看到同一行 `0/1`、删除可点；`Promise.all` 同时点删除 | 后端**恰好一个成功**；赢家看到含码值的成功条、行移除；输家收到 `400101`/`400102` 业务错误、**保留陈旧行**并出现错误条；点「刷新」后行消失；API 列表不再含该码 |
| S2 陈旧快照 | 后台停在该行的 `0/1` 快照；真实短信用户走完整登录 + `/invite` 前台补填核销 | 用户侧核销成功 + 成功 toast；**后台仍是 `0/1`、删除仍可点**（无轮询/推送）；此时点删除被后端 `400101` 拒绝、错误条给出「已核销，请改用停用」、行不被前端擅自移除；刷新后 `1/1`、状态「已耗尽」、删除禁用且 `title` 为 `deleteUsedHint`；后端 `used_count=1 / status=3` |
| S3 已删除码 | 管理员删除一张未核销码后，用户在前台补填 | 核销接口 `400101` + `msg`「邀请码不存在」，页面弹错误 toast |

脚本自建的码在 `finally` 里按 id 直连开发库清理（先删 `invite_redemptions`，再删 `invite_codes`；
id 是 bigint 雪花，按十进制字符串传 `::bigint[]`，不走 `Number`），并把清理结果记为一条检查 ——
残留会直接出现在 `RESULT` 里，不会静默。

**明确不做**（脚本头注释同样写明）：

- 不造第二个 `admin_users`：`admin_users` 不支持物理删除（审计外键），造号会在开发库永久留痕；
  角色矩阵（viewer 只读、写 `403101`）由 `apps/api/test/admin-ops-p1.spec.ts` 与面板单测覆盖。
- 不压测：单 API 进程 + 单 PG 实例，不覆盖多副本、网络延迟、连接池耗尽。
- 不假设赢家：S1 只断言「恰好一个成功」，谁赢由调度决定。
- 不重复覆盖「后台 UI 新建邀请码」：`e2e-admin-panels.cjs` 的「生成 → 停用 → 删除」已覆盖，
  本脚本用 API 造码把注意力集中在并发与陈旧快照上。

### 1.2 脚本冒烟时修的两个自身缺陷（不是产品缺陷）

| # | 现象 | 修法 |
|---|---|---|
| 1 | `waitEnvelope` 把 Playwright `Response` 当成旧版 `APIResponse.response()`，抛 `TypeError: r.response is not a function`，S1 第一行就中断 | 改为 `res.json()` 解析 envelope；等待失败返回 `{status:0, body:null}`，让断言给出可读失败而不是整段崩 |
| 2 | 开发栈回显短信验证码的字段是 `data.debug_code`，脚本先读了 `data.code/sms_code/dev_code` | 增加 `debug_code` 优先读取；仍拿不到就直接失败，不猜 |

---

## 2. 验收实测（本机真栈）

```
node _acceptance/e2e-invite-race.cjs
RESULT PASS 28/28 checks · web=http://127.0.0.1:3003 · 2026-11-01T02:03:41.032Z   EXIT=0
```

关键日志（节选）：

```
ok  S1 两个会话同时删除：恰好一个成功  ·  code=400101 / code=0
ok  S1 输家得到业务错误 400101/400102  ·  code=400101 msg=invite code has been redeemed, disable it instead of deleting
ok  S1 输家页面保留陈旧行且删除仍可点
ok  S1 输家点刷新后陈旧行消失  ·  code=0 rows=0
ok  S2 用户核销成功（业务成功 + 成功 toast）
ok  S2 用户核销后后台仍是陈旧快照（0/1、删除仍可点）  ·  usage=0/1 enabled=true
ok  S2 陈旧快照下删除被后端拒绝（400101 已核销）
ok  S2 刷新后用量变 1/1、状态变「已耗尽」  ·  usage=1/1 status=已耗尽
ok  S2 刷新后删除按钮禁用且 title 说明原因  ·  disabled=true title=该码已被核销，不能删除；请改用停用
ok  S3 用户补填已删除的码 → 400101「邀请码不存在」+ 错误 toast
ok  全流程无未预期 console / pageerror
```

**两次实跑观察到两种输家文案**（这是并发真的发生了的证据，也印证了已知的措辞不精确）：

| 运行 | S1 输家返回 | 说明 |
|---|---|---|
| 第 2 次 | `400102 invite code not found` | 输家的条件删除晚于赢家的 DELETE 提交，预检查已看不到行 |
| 第 3 次 | `400101 invite code has been redeemed, disable it instead of deleting` | 输家的预检查仍看到行，但条件删除返回 0 行 / 或撞上外键分支，复用了「已核销」这句 |

两句话对「码已经没了」都算正确拒绝，但后者字面上会让人以为码被核销过。**不视为缺陷**：
条件删除返回 0 行时没有「是否被并发删除」的区分信息，为了不给运营一个 500 而复用同一业务错误；
真要精确需在 0 行后再查一次存在性（会引入新的竞态窗口，收益为 0）。这条已写进脚本头注释与 README。

截图（本机生成，不入库）：`_acceptance/invite-race-e2e/s1-race-winner.png`、`s1-race-loser.png`、
`s2-stale-admin.png`、`s2-after-reload.png`、`s3-deleted-code.png`；机读结果 `result.json`。

---

## 3. 数据副作用

本次运行 `cleanup = {"ids":3,"redemptions":1,"codes":1,"leftCodes":0,"leftRedemptions":0}`：

- 共造 3 张码：S1 的码被赢家删除、S3 的码被管理员删除、S2 的码被真用户核销后由脚本按 id 直连清理
  （连带 1 条核销行）；残留 0 码 / 0 核销行。
- 每次运行仍会留下 **1 个短信测试用户**（S2 登录用）：开发库 `users` 表新增一行，手机号为
  `13` + 时间戳后 7 位 + 2 位随机数。与其它 E2E 同口径，README 已登记；清理测试用户不在本批范围
  （用户数据关联资产/空间，硬删会留下孤儿数据）。
- 未触碰 `admin_users`：两个会话都是同一个 bootstrap 管理员。

---

## 4. 未覆盖 / 诚实边界

1. **两个会话 ≠ 两个管理员账号**：证明的是「同一管理员在两个浏览器里并发操作同一条码」的
   前后端行为；多角色权限矩阵仍由接口用例覆盖，不在本脚本内。
2. **单进程 + 单 PG 实例**：行锁/条件删除跨实例语义相同，但多副本下的网络延迟、重试、
   连接池耗尽时序未覆盖；也未做持续压测。
3. **不证明赢家分布稳定**：S1 每轮只撞一次，样本量不足以谈比例，脚本也不试图断言谁赢。
4. **S1 输家文案可能不精确**（见 §2 表格），属已知且安全的措辞问题。
5. **S2/S3 的用户操作走本机开发栈的短信回显**：真实短信通道未接入，登录链路证明的是
   「前端 → API → DB」而非运营商通道。
6. **本机开发库里更早的 E2E 遗留记录仍要手工清理**：本脚本只清自己创建的码（按 id），
   不做启发式批量删除。

---

## 5. 复跑

```
node _acceptance/e2e-invite-race.cjs
```

前置：`_acceptance/start-wanxing-stack.ps1`（PG :55432 / Redis :6380 / api :3002 / web :3003）。
可用环境变量覆盖：`API`、`WEB`、`CHROME`、`ADMIN_USERNAME`、`ADMIN_PASSWORD`、`DATABASE_URL`。