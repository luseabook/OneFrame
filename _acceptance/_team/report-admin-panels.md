# 运营后台 10 个面板浏览器 E2E（第 107 批）交付报告

> 负责人：batch-107｜日期：2026-10-31｜baseline `bd4d9cc`
> 对应缺口：`docs/README.md` P1「9 个后台面板无浏览器 E2E」；第 106 批后台拆分为 10 个面板后按实际数量计。
> 口径纪律（ADR-013）：只登记**实测过**的东西；没跑的写「未覆盖」，不写「应该没问题」；
> 每次运行会落一条数据到本机开发库，明确写在 §4。

---

## 1. 交付

### 1.1 验收脚本（新增）

`_acceptance/e2e-admin-panels.cjs` —— `playwright-core` + 真栈（api :3002 / web :3003），
不是组件单测、不是 mock：

| 段落 | 内容 |
|---|---|
| 登录 | `POST /v1/ops/admin/login` 拿 admin token → 写 `localStorage.admin_token`（`useAdminApi` 只认这个键，与用户域 token 隔离） |
| 未登录守卫 | 直访 `/admin?tab=prices` 必须被中间件弹回 `/admin/login` |
| 10 个面板 | 逐个打开：侧栏高亮 + 顶部 `.page-title` + 面板 h2 文案（取自 `i18n/locales/zh-CN.json`，不写死中文字面量） |
| 首屏数据 | 断言真实发出列表请求且 `code === 0`（不是「页面打开了但数据没回来」） |
| 只读交互 | 每个面板点一次刷新/重置，断言第二次列表请求同样成功（`admins` 面板无只读按钮，跳过该步） |
| 写操作 ×2 | 邀请码「生成 → 停用」；配置中心「新建 → 搜索 → 删除」——证明表单绑定、`window.confirm`、写后端、列表刷新整条链路 |
| 控制台 | 收集 `console.error` / `pageerror`，未白名单放行的一律算失败 |

**明确不做**（脚本头注释同样写明）：

- 不点封禁 / 退款 / 真实数据删除等**不可逆**操作；
- 不验证多管理员角色权限矩阵（需要第二个管理员账号，属于权限测试而非面板冒烟）；
- 价格面板只做读 + 刷新，**不写入**（新建价格会污染档位表，且没有删除端点可回收）。

### 1.2 修复的两个真实缺陷（脚本先踩出来的）

| 文件 | 缺陷 | 修法 |
|---|---|---|
| `app/apps/web/components/admin/AdminInviteCodesPanel.vue` | `parseIntField(raw: string)` 对入参调 `raw.trim()`；但 `<input type="number">` 上的裸 `v-model` 由 Vue 自动 looseToNumber，填了数字后入参是 **number** → 抛 `trim is not a function` → **POST 根本发不出去** | 签名改 `string \| number`，空串短路，统一 `String(raw).trim()` |
| `app/apps/web/components/admin/AdminPricePanel.vue` | `parseIntInput` 同一形状（价格编辑/新建 8 个数字输入都走它），E2E 的只读断言覆盖不到 | 同上 |

同类排查：`AdminMarketPanel.vue` 的两个数字输入显式用了 `v-model.number` + `Number(...) || 0`，**不受影响**。

### 1.3 新增静态守卫（7 例）

`app/apps/api/test/admin-numeric-inputs.spec.ts` —— 这类缺陷 typecheck / lint / build 全绿，
只能靠**结构守卫**钉住：

1. 两个解析器签名必须是 `string | number`，且用 `String(raw).trim()` 收口、不再出现 `raw.trim()`；
2. 全目录扫描：任何 `type="number"` 且用裸 `v-model` 绑定的文件，必须同时出现 `String(` 与
   `Number.isInteger(`（先收成字符串、再严格校验），防止下一个面板重犯；
3. 守卫非空跑：目录内确实存在裸绑定数字输入；
4. `AdminMarketPanel` 的数字输入全部是 `v-model.number`。

---

## 2. 验收实测（本机真栈）

```
$ pwsh _acceptance/start-wanxing-stack.ps1      # api up :3002 / web up :3003 (proxy -> http://127.0.0.1:3002)
$ node _acceptance/e2e-admin-panels.cjs
共 83 项：通过 83，失败 0
RESULT panels=10 panelFailures=0 writeFailures=0
EXIT=0
```

- 完整逐项输出：`_acceptance/admin-panels-e2e.log`
- 截图 13 张：`_acceptance/admin-panels-e2e/`（`panel-*.png` 10 张 + `guard-login.png` + `write-invites.png` + `write-config.png`）
- 同次运行的 api 访问日志（邀请码 POST 201 + 随后 GET 200）：`_acceptance/stack-api.log`

写操作实测值（本次运行）：

| 流程 | 结果 |
|---|---|
| 邀请码生成 | `POST /v1/ops/admin/invite-codes` → 201，`code=LJGVL5QQ`，chip 可见、列表新行可见 |
| 邀请码停用 | `PATCH …/invite-codes/:id {status:2}` → code=0，行状态「已停用」，提示「已更新 LJGVL5QQ」 |
| 配置中心 | `PUT` 新建 `e2e_admin107_…` → 按 key 能搜到 → `DELETE` → 行消失 |

---

## 3. 覆盖矩阵（10/10）

| tab | 面板 | 标题+侧栏 | 首屏 code=0 | 只读交互 | 控制台 |
|---|---|---|---|---:|---:|---:|
| prices | 价格管理 | ✅ | ✅ | 刷新 ✅ | 0 |
| market | 剧本广场 | ✅ | ✅ | 重置 ✅ | 0 |
| skills | Skill 推荐位 | ✅ | ✅ | 刷新 ✅ | 0 |
| audit | 操作日志 | ✅ | ✅ | 重置 ✅ | 0 |
| admins | 管理员 | ✅ | ✅（209 行，含当前账号） | —（无） | 0 |
| config | 配置中心 | ✅ | ✅ | 重置 ✅ + 写流程 | 0 |
| users | 用户管理 | ✅ | ✅ | 重置 ✅ | 0 |
| waitlist | 等待名单 | ✅ | ✅ | 刷新 ✅ | 0 |
| invites | 邀请码 | ✅ | ✅ | 刷新 ✅ + 写流程 | 0 |
| aiLabels | AI 标识审计 | ✅ | ✅ | 重置 ✅ | 0 |

---

## 4. 未覆盖 / 已知副作用（如实登记）

**未覆盖：**

- 封禁/解封、退款、真实数据删除等不可逆动作；
- 多管理员角色权限矩阵（viewer 点写按钮 → 403101 就地提示这条**有代码路径**，但本轮只用单账号 E2E，没有第二账号对照）；
- 价格面板的**写**操作（编辑/新建）没有 E2E，只由 §1.3 的静态守卫钉住解析器形状；
- `aiLabels` 的导出文件内容、`audit` 的筛选组合、各面板分页边界（翻页只验证了默认第 1 页）。

**副作用：** 邀请码后端不提供删除，只可停用 —— **每次运行会在本机开发库留下一条已停用的
`LJGVL5QQ` 类邀请码**（`credits=0 / max_uses=1`，不影响登录与计费）。配置中心的写流程自带删除，运行后无残留。

---

## 5. 过程记录：本批实测到的三个「全绿缺陷」

1. **web → api 反代目标是构建期常量**：`nuxt.config.ts` 的 `routeRules["/v1/**"].proxy` 在
   `pnpm build` 时被烤进 `.output/server`，运行期设 `NUXT_API_PROXY` 无效。本地栈脚本原先只 build api，
   web 产物里烤着默认 `127.0.0.1:3000`（本机是另一个项目的端口）——面板标题/侧栏/按钮全正常、`/v1/**` 全 404。
   已修：脚本 build web 前注入目标 + 启动前 `Assert-WebBuiltFor` 校验产物 + 就绪判据改为「经反代拿到 200」；
   守卫 `web-api-proxy.spec.ts`（10 例）。Dockerfile 的 ARG/ENV 顺序与 compose `build.args` 同步纳入守卫。
2. **数字 `v-model` 的 `.trim()` 崩溃**：见 §1.2。
3. **NestJS POST 默认 201**：脚本一开始只认 `status() === 200`，于是「邀请码已成功建出（201）」
   仍被判成超时并打印 `code=?`。已改为接受 2xx 并写明原因——**跨端断言不要假设 200**。

---

## 6. 需要 Lead 知道

- 本报告关闭的是「面板能在浏览器里打开、能读、两个可逆写流程能跑」；**运营后台的权限矩阵与不可逆动作**
  仍无 E2E，建议在有多角色测试账号后单独排一支（需要第二个管理员账号 + 角色分配，属于权限测试域）。
- 每次跑 E2E 会留一条停用邀请码（§4），如需清零只能直接操作开发库——这是后端缺删除端点的结果，
  不是脚本疏漏。