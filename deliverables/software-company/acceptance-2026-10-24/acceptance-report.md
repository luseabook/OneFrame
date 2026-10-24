# 本地验收报告 — 万帧 MVP（2026-10-24）

> 环境：Windows + Docker Desktop；`pnpm install --frozen-lockfile` → `docker compose -f app/docker-compose.prod.yml up -d --build`（PG16 / Redis7 / MinIO / nginx / api / worker / web）。
> 入口：`http://127.0.0.1:8080`（nginx 同源反代）。浏览器：本机 Chrome 156（Playwright 驱动，playwright-core 1.49.1）。
> 脚本：`api-acceptance.ps1`（接口）、`ui-acceptance.cjs`（UI，59 张截图见 `shots/`）。

---

## 一、结论

| 维度 | 结果 |
|---|---|
| 接口层 | 12 组全部通过（认证/报价/生成/分享/举报/资产/项目/admin/注销/越权/边界） |
| UI 渲染 | 12 个页面全部渲染正常，**控制台 0 error / 0 warning** |
| 交互流程 | 8 组交互全部通过（登录、年龄门禁、生成提交、任务筛选、项目创建、资产回收站、注销二次确认、举报表单、管理台 5 页签） |
| 多视口 | 1920/1280/820/390 四档 × 5 页 = 20 项，**横向溢出 0px** |
| 回归 | 全仓 **93 项**测试通过（api 50 / adapters 9 / shared 13 / db 11 / worker 4 / storage 6）+ lint/typecheck/build 全绿 |

验收过程中**发现并修复 4 个真实缺陷**（见第五节），修复后复测全绿。

---

## 二、接口层验收（12 组）

| # | 验收点 | 预期 | 实际 | 结论 |
|---|---|---|---|---|
| A1 | 新号未确认 18 岁 | 拒绝建号 | `400101 请确认已满 18 周岁` | ✅ |
| A2 | 错误验证码 | 拒绝登录 | `400101 验证码不存在或已过期` | ✅ |
| A3 | 非法手机号 | 参数校验失败 | `400101 invalid phone` | ⚠️ 见问题 4（文案未本地化） |
| A4 | 未携带 token | 401 | `401101 missing bearer token` | ✅ |
| A5 | 余额与流水 | 80 / gift 流水 1 条 | `balance=80 frozen=0`；`gift/80` | ✅ |
| A6 | 不存在的模型 | 400101 | `400101 model not found: no-such-model` | ✅ |
| A7 | 正常报价 | 返回积分与余额预估 | `credits=8 balance_after=72` | ✅ |
| A8 | 生成不带 quote_id | 按契约可选，允许 | `code=0`（api-spec：quote_id 可选，带上才校验） | ✅ |
| A9 | 敏感词提示词 | 745801 且不扣费 | `745801 内容包含敏感词，请修改后重试`，余额不变 | ✅ |
| A10 | 非法画幅 | 400101 | `400101 ratio 21:9 not supported` | ✅ |
| B1 | 生成→执行→完成 | status=3 + 结果 uri | `status=3 uri=u/<space>/tasks/<id>/r0.mp4` | ✅ |
| B2 | 幂等重放（同 key 同体） | 返回同一 task_id | `same task_id: true` | ✅ |
| B3 | 任务不存在 | 400102 | `400102 task not found` | ✅ |
| B4 | 结果下载 URL | S3 预签名 | `host=localhost expires=86400` | ✅ |
| B5 | 分享→公开预览→举报→撤销 | 撤销后 400102 | share `code=0`、public `code=0`、report `code=0`、revoke `code=0`、after revoke `400102` | ✅ |
| B6 | 无效 token 举报 | 400102 | `400102 share not found or expired` | ✅ |
| B7 | 资产目录/转存/标签/回收站/恢复 | 全部 200 | folder/from-task/patch/delete/restore 均 `code=0`；标签检索 total=1 | ✅ |
| B8 | 项目/矩阵/分镜素材 | 全部 200 | project/matrix/shot-material `code=0`；materials=1 | ✅ |
| B9 | 跨空间越权访问 | 400102 | `400102 project not found`（GET 与 POST 均拦截） | ✅ |
| B10 | admin 漏斗/指标/CSV/普通用户 403 | 全部符合 | funnel 6 段；failure_rate=0；CSV 200 且表头正确；普通用户 token → `403101` | ✅ |
| B11 | 注销后 token 失效 | 401101 | `delete code=0 purge_after=+30d`；随后 `401101 account disabled` | ✅ |
| B12 | 等待名单 | 入队并返回位次 | `code=0 position=1` | ✅ |

---

## 三、UI 验收

### 3.1 页面渲染（12 页，控制台 0 问题）

| 页面 | 渲染 | 控制台 | 截图 |
|---|---|---|---|
| `/` 落地页 | ✅ | 0 | `shots/04-home.png` |
| `/login` | ✅ | 0 | `shots/01-login-desktop.png` |
| `/create/text-to-video` | ✅ | 0 | `shots/05-text2video.png` |
| `/create/image-to-video` | ✅ | 0 | `shots/06-image2video.png` |
| `/projects` | ✅ | 0 | `shots/07-projects.png` |
| `/assets` | ✅ | 0 | `shots/08-assets.png` |
| `/tasks` | ✅ | 0 | `shots/17-tasks-list.png` |
| `/credits` | ✅ | 0 | `shots/10-credits.png` |
| `/pricing` | ✅ | 0 | `shots/11-pricing.png` |
| `/settings` | ✅ | 0（修复后） | `shots/12-settings.png` |
| `/terms` `/privacy` `/report` | ✅ | 0 | `shots/13-terms.png` 等 |

### 3.2 交互与状态变化（8 组）

| # | 交互 | 预期 | 实际 | 结论 |
|---|---|---|---|---|
| U1 | 未勾 18 岁点登录 | 阻止并提示 | 停留 /login，显示「请确认已满 18 周岁」 | ✅ |
| U2 | 正确验证码登录 | 跳转工作台 | 跳转 `/create/text-to-video` | ✅ |
| U3 | 文生视频提交 | 有状态反馈 | 提交后显示积分/任务状态，0 错误块 | ✅ |
| U4 | 任务列表渲染 | 行 + 状态 + 操作按钮 | 7 行；已完成任务：下载可用、取消/重试禁用；任务号为可点链接 | ✅ |
| U5 | 任务状态筛选 | 过滤生效 | 选「已完成」后列表刷新 | ✅ |
| U6 | 项目创建 | 进入流水线 | 创建后跳 `/projects/107419591222759424` | ✅ |
| U7 | 资产回收站切换 | 切换到回收站 | 显示「返回资产库/恢复」 | ✅ |
| U8 | 注销二次确认 | 首次点击不注销 | 提示「请再次点击确认注销」，仍停留 /settings | ✅ |
| U9 | 举报表单无效 token | 错误提示 | 提示 token 缺失/不存在 | ✅ |
| U10 | 管理台 5 页签 | 均渲染 | 模型价格/任务审计/分享管理/举报处置/流水线漏斗全部正常 | ✅ |

### 3.3 多视口一致性（4 档 × 5 页 = 20 项）

| 视口 | 登录/文生/项目/任务/管理台 | 横向溢出 |
|---|---|---|
| 1920×1080 | ✅ | 0px ×5 |
| 1280×800 | ✅ | 0px ×5 |
| 820×1180（平板） | ✅ | 0px ×5 |
| 390×844（移动） | ✅ | **0px ×5（修复前为 16px）** |

截图：`shots/vp-{desktop-1920,laptop-1280,tablet-820,mobile-390}-*.png`

---

## 四、发现的问题与修复

### 问题 1（已修复，High）：`/settings` 首屏 hydration 不匹配

- **现象**：直接访问 `/settings` 控制台报 `Hydration completed but contains mismatches.`；客户端路由进入则正常。
- **定位**：`pages/settings.vue` 模板直接渲染 `auth.state.value.user?.nickname`；首屏 SSR 无登录态（渲染为 `-`），客户端 hydrate 后为真实昵称 → 文本不一致。`/credits`、`/tasks` 等页面不受影响，因其首屏内容不依赖登录态字段。
- **修复**：改为 `onMounted` 调 `/me` 填充本地 `user/credits` ref，模板不再直接读认证状态。
- **复验**：直接导航 `/settings` 控制台 0 错误（`shots/12-settings.png`）。

### 问题 2（已修复，High）：移动端 390px 横向溢出 16px

- **现象**：390×844 下所有页面 `scrollWidth=406 > clientWidth=390`；溢出元素为 `header .nav`（导航项不换行，left=49 right=406）。
- **定位**：`app.vue` 的 `.nav` 为固定 flex 且无 `flex-wrap`/滚动；`.header` 不允许换行。
- **修复**：`app.vue` → `.header { flex-wrap: wrap }`、`.nav { min-width:0; overflow-x:auto; scrollbar-width:none }`；`assets/css/tokens.css` 增加 ≤768px 基线（页面内边距收窄至 16px、`.table/.row` 容器内横向滚动、表格行 `min-width:560px`）。
- **复验**：390px 下 5 页 `scrollWidth=390`，溢出 0px。

### 问题 3（已修复，Medium）：反代后拿不到真实客户端 IP，频控桶被全站共用

- **现象**：`POST /auth/sms-code` 的 IP 频控键恒为 `sms:ip:172.21.0.1`（Docker 网关 IP）。生产在 nginx/LB 之后会导致**全站用户共用一个 20 次/小时的发码桶**。
- **定位**：两层原因——
  1. API 用 `req.ip`，Fastify 在反代后取代理节点 IP，不解析 `X-Forwarded-For`；
  2. nginx 未启用 `real_ip` 模块，`$remote_addr` 就是代理看到的来源。
- **修复**：
  - 新增 `apps/api/src/common/client-ip.ts`：优先 `X-Real-IP` → `X-Forwarded-For` 最左 → socket 远端；含 4 条单测；
  - `auth.controller`（发码）与 `reports.controller`（举报）改用 `clientIp(req)`；
  - `deploy/nginx.conf` 启用 `set_real_ip_from` + `real_ip_header X-Forwarded-For` + `real_ip_recursive on`，并对回源网段做信任声明；
  - `nuxt.config.ts` 的 `/v1/**` 代理补 `x-forwarded-for` / `x-real-ip` 透传（SSR 内部调用 API 时也保留来源 IP）。
- **复验**：带 `X-Real-IP: 9.9.9.9` 请求 → Redis 出现 `sms:ip:9.9.9.9`，键按真实客户端区分。
- **说明**：本机 Docker 环境下宿主访问 nginx 的来源 IP 恒为网关 `172.21.0.1`，属 Docker NAT 正常现象；真机/云主机部署时 `$remote_addr` 即真实用户 IP。生产需把 `set_real_ip_from` 换成 CDN/LB 实际出口网段。

### 问题 4（未修复，Low）：个别错误提示未本地化

- **现象**：`400101 invalid phone`（手机号格式错误）为英文，其余错误均为中文。
- **定位**：`packages/shared` 的 `phoneSchema` 使用英文 message。
- **修复建议**：改为中文「请输入 11 位手机号」并同步 `web` 端错误文案映射表；属文案统一项，不影响功能。

### 观察项（非缺陷）

- 任务列表中任务号为可点击链接（`<button class="link">`），符合"点号看详情"的设计，非多余元素。
- 已完成任务的「取消/重试」按钮为禁用态，符合 PRD「终态不可取消」。
- 生产模式不回显短信验证码（`data={}`），符合安全设计；验收时从 Redis 读取测试码。

### 问题 5（已修复，Medium）：登录页右上角导航与左下角页脚暴露冗余/内部信息

- **现象（用户反馈）**：登录页右上角与左下角出现一批元素，观感像"不该在这里"。
- **定位与判定**：
  - 左下角是**页脚**，右上角是**顶部导航**——两者本身都应存在（PRD F7 要求"前端展示内容由 AI 生成声明"与"全站页脚举报/投诉入口"，compliance B3/C2 同口径），但当前实现有三处问题：
    1. 未登录时顶部导航仍显示「项目/资产/任务/积分」等**需登录入口**，点击后被弹回登录页（`/login?redirect=/credits`），属体验断裂；
    2. 页脚同时存在「举报 / 投诉」链接与「举报邮箱」mailto，**重复冗余**；
    3. 页脚暴露内部工程路径 `docs/06-security-compliance/compliance.md A3` 作为占位文案。
- **修复**：
  - 未登录时导航只保留公开入口「定价」，工作台入口在登录后出现；
  - 页脚去掉重复的「举报邮箱」mailto（统一走 `/report` 表单），并把 ICP 占位改为「京 ICP 备 00000000 号（上线前替换）」，不再暴露内部文档路径。
- **复验**：
  - 未登录导航 = `["定价"]`；登录后导航 = `["项目","文生视频","图生视频","资产","任务","积分","定价"]`；
  - 页脚链接 = 举报/投诉(`/report`)、用户协议(`/terms`)、隐私政策(`/privacy`) 三条，无重复项；
  - 布局几何正常：header 高 70px、nav 右对齐、footer 贴底、横向溢出 0px。
  - 截图：`shots/fixed-login-anon.png`、`shots/fixed-home-auth.png`。

---

## 五、修复后的回归验证

```
pnpm lint        ✅
pnpm typecheck   ✅
pnpm test        ✅  api 50 / adapters 9 / shared 13 / db 11 / worker 4 / storage 6 = 93 passed
pnpm build       ✅
UI 验收         ✅  60 项断言全通过，console issues = 0
```

---

## 六、建议的后续动作

1. 修正问题 4 的文案本地化（Low，改动 1 行 + 前端映射表）。
2. 生产部署时把 `deploy/nginx.conf` 的 `set_real_ip_from` 替换为真实 CDN/LB 出口网段，并确认 `X-Real-IP` 生效。
3. 补充移动端交互回归（390px 下表单提交、弹窗、表格横向滚动的手势体验）——本次仅验证了布局无溢出，未覆盖触控交互。
