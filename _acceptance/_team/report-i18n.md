# 第 8 批：多语言（i18n）交付报告

> 负责人：agent-impl · 时间：2026-10-27 10:40 (+08)
> 任务：`task-14` i18n 基建 + 5 语言包 + `X-Lang` 协商 + 6 页迁移（权重 8）
> 结论：**基建落盘、5 语言包 312 key 全一致、6 页迁移完成、`i18n-check`（静态 + 浏览器逐页）全绿、web typecheck 0 错**。
> 未迁移页面与不做的部分逐条列在「未完成」，壳层（`layouts/app.vue`）不在我的写权限内，需要 Lead 接。

---

## 交付

### 1. 基建（不引 `@nuxtjs/i18n`）

| 文件 | 内容 |
|---|---|
| `app/apps/web/i18n/index.ts` | 内核（纯函数、无 Vue 依赖）：`SUPPORTED_LOCALES` / `LANGUAGES` / `normalizeLocale` / `pickFromAcceptLanguage` / `lookup`（点路径）/ `interpolate`（`{var}`）/ `createTranslator` / `flattenKeys` |
| `app/apps/web/i18n/locales/{zh-CN,en,ja,pt-BR,es}.json` | 5 个语言包，namespace：`common/nav/lang/auth/landing/pricing/tools/tasks/settings/errors/billing`，**312 个 key** |
| `app/apps/web/composables/useI18n.ts` | `useI18n()` → `{ t, locale, setLocale, languages, supported, htmlLang }`；状态在 `useState`（SSR 请求间隔离）；缺 key 返回 key 本身 + dev `console.warn` |
| `app/apps/web/plugins/i18n.ts` | 首次协商：`?lang=` → cookie `of_lang` → `Accept-Language`(服务端)/`navigator.language`(客户端) → `zh-CN`；`useHead({ htmlAttrs: { lang } })` 跟随切换 |
| `app/apps/web/components/i18n/LangSwitcher.vue` | 语言切换器（原生 `<select>`，`tone="light"` 供浅色登录页）；语言名用**各语言自己的写法**（简体中文/English/日本語/Português (Brasil)/Español） |
| `app/apps/web/composables/useApi.ts` | **仅加一行**：`headers["X-Lang"] = i18n.locale.value`（+ 注释与 setup 期捕获的 `const i18n = useI18n()`） |
| `_acceptance/i18n-check.cjs` | 验收脚本：静态校验 + `--browser` 模式逐语言逐页校验 |

### 2. 语言选择与协商

- **cookie `of_lang`**（1 年，`samesite=lax`）+ **`?lang=` 覆盖**（命中后写回 cookie，分享/投放链接只带一次参数）+ **`Accept-Language`/`navigator.language` 兜底**。
- `htmlAttrs.lang` 用 `computed` 绑定：**切换不刷新页面**（Vue 响应式，`<html lang>` 同步变）。
- 两个踩过的坑（已写进 `plugins/i18n.ts` 注释，避免后人改回去）：
  1. 客户端必须用 `window.location.search` 读 `?lang=`，**不能用 `useRoute().query`**——`pages/**` 大多 `ssr:false`，插件执行时路由还没解析，会被 cookie 顶掉（现象：URL 写 `ja`、界面还是上次语言）。
  2. 必须 `watch(route.query.lang)`：站内 SPA 跳转不重跑插件，`?lang=` 否则只首次生效。

### 3. 请求协商：`X-Lang`（**服务端不做文案翻译**）

`useApi` 每个请求带 `X-Lang: <当前 locale>`。**服务端不翻译**，理由：

1. **同一份文案不能有两处事实源**。语言包已在前端（312 key），服务端若再翻一份（错误 msg、目录名、状态名），两套必然漂移；竞品把 `X-Lang` 放请求头正是"让服务端知道语言，但文案仍由前端持有"的形态（`报告:172`、`feature-map.md:414`）。
2. **我们所有用户可见文案都在前端**：后端返回的是**数据**（工具目录标题、space 名、SKU label、错误 msg）。数据按原样展示才符合"运营改数据即生效"；把中文数据翻成外语需要运营侧多语言字段（数据模型改动，超出本批）。
3. 成本/风险：服务端翻译要先做"文案抽取 + 语言包同步 + 缓存"，收益仅是错误 msg 与目录名——本批用前端错误映射（`errors.*`）覆盖了通用错误，剩下的是业务异常 msg（后端原样回显）。
4. `X-Lang` 仍然有价值：日志追溯、内容审核按语言归档、将来按语言返回运营位/文案数据。

### 4. 页面迁移（6/6，严格限定）

| 页面 | 状态 | 说明 |
|---|---|---|
| `pages/index.vue` | ✅ 已迁 | 全页文案（Hero/双工作流/6 能力/6 步/CTA/页脚）+ `useSeoMeta` 描述随语言；`html lang` SSR 正确（`?lang=en` 首帧即英文，无闪烁） |
| `pages/login.vue` | ✅ 已迁 | 全部文案 + **OAuth 按钮模板接线**（`oauthConfigured/oauthTitle/startOauth`，见下"协作"）；品牌名 `landing.brandName` |
| `pages/pricing.vue` | ✅ 已迁 | 页签/促销/周期/渠道/卡片/订单/计费说明 + 错误与 toast；挂载 `<SubscriptionPlans />`（Lead 组件，同时把它的文案接到 `t()`） |
| `pages/tools.vue` | ✅ 已迁 | 标题/页签/提示/加载/错误/空态；`LangSwitcher` 挂在头部 |
| `pages/tasks.vue` | ✅ 已迁 | 状态页签与状态名（不再用全局 `statusLabel` 常量，改为本页 `statusText()` 随语言）、表头、到期提醒、分页、详情弹窗、全部 info/error 提示；日期用 `toLocaleString(locale)` |
| `pages/settings.vue` | ✅ 已迁 | 账号信息/协议/注销（含二次确认文案） |

组件（本批直接引用、且改了文案）：`components/i18n/LangSwitcher.vue`（新增）、`components/billing/SubscriptionPlans.vue`（Lead 允许改文案 → 周期名/产品线名/空态/按钮/toast 全接 `t()`，逻辑零改动）。

### 5. 协作（同轮并行）

- **`pages/login.vue` 与 task-11 (`film-api`) 撞车**：他加 SSO、我做 i18n。已协商：他只写逻辑不整文件覆盖，我做模板接线 + 文案迁移。OAuth 4 个 `.tp` 按钮已接 `:disabled="!oauthConfigured(provider) || oauthBusy !== ''"`、`:title/:aria-label="oauthTitle(provider)"`、`@click="startOauth(provider)"`；`OAUTH_FALLBACK_LABEL` 已替换为 `oauthLabelText()`（品牌名走语言包，避免外语界面露中文）；`渠道未返回授权地址`/`暂不可用` 已接 `auth.oauthNoUrl` / `auth.oauthUnavailable`。
- **`SubscriptionPlans.vue`**：Lead 组件，已挂到 `/pricing`「积分充值包」之后并完成文案 i18n（截图见下）。

---

## 术语表（统一译法，改文案请照这张表）

| 中文 | en | ja | pt-BR | es |
|---|---|---|---|---|
| 积分 | credits | クレジット | créditos | créditos |
| 任务 / 任务中心 | task / Task center | タスク / タスクセンター | tarefa / Central de tarefas | tarea / Centro de tareas |
| 工具箱 | Toolbox | ツールボックス | Caixa de ferramentas | Caja de herramientas |
| 无限画布 | canvas | キャンバス | canvas | lienzo |
| 作品 / 项目 | work / project | 作品 / プロジェクト | obra / projeto | obra / proyecto |
| 剧集 / 分镜 | episode / storyboard | エピソード / 絵コンテ | episódio / storyboard | episodio / storyboard |
| 镜头 / 卡点 | shot | カット | plano | plano |
| 角色定妆（设定图） | character design | キャラクター設定 | design de personagem | diseño de personaje |
| 资产库 | asset library | アセットライブラリ | biblioteca de recursos | biblioteca de recursos |
| 充值包 / 订阅 | credit package / subscription | クレジットパック / サブスク | pacote de créditos / assinatura | paquete de créditos / suscripción |
| 会员 | membership | メンバーシップ | assinatura | suscripción |
| 月付 / 季付 / 半年付 / 年付 | Monthly / Quarterly / Half-yearly / Yearly | 月払い / 四半期払い / 半年払い / 年払い | Mensal / Trimestral / Semestral / Anual | Mensual / Trimestral / Semestral / Anual |
| 登录 | Sign in | ログイン | Entrar | Iniciar sesión |
| 验证码 | verification code | 認証コード | código de verificação | código de verificación |
| 邀请码 | invite code | 招待コード | código de convite | código de invitación |
| 注销账号 | delete account | アカウント削除 | excluir conta | eliminar cuenta |
| 用户协议 / 隐私政策 | Terms of Service / Privacy Policy | 利用規約 / プライバシーポリシー | Termos de Uso / Política de Privacidade | Términos del Servicio / Política de Privacidad |
| 品牌名「一帧」 | OneFrame | OneFrame | OneFrame | OneFrame |
| 品牌字形「一」 | 保留字形（不翻译） | 同左 | 同左 | 同左 |

---

## 验收（本机实测）

### 静态：`node _acceptance/i18n-check.cjs` → **exit 0**

```
[i18n-check] baseline zh-CN: 312 keys

zh-CN  missing   0  extra   0  empty   0  residue   0  placeholder   0
en     missing   0  extra   0  empty   0  residue   0  placeholder   0
ja     missing   0  extra   0  empty   0  residue   0  placeholder   0
pt-BR  missing   0  extra   0  empty   0  residue   0  placeholder   0
es     missing   0  extra   0  empty   0  residue   0  placeholder   0

[pages] 8 个文件，共用到 291 个 key
✅ i18n-check 通过：5 个语言包 key 一致、无空值、无中文残留、占位符一致、页面 key 齐全
```

校验项：① key 集合完全一致（missing/extra 都报）② 无空值 ③ 外语包无中文残留 ④ `{var}` 占位符集合一致（漏 `{count}` 界面会缺口且 TS 抓不到）⑤ **6 页 + 2 组件里 `t("...")` 用到的 291 个 key 在每个语言包里都存在**（任何拼错都会在运行时渲染成 key 本身，必须在验收阶段炸出来）。

### 浏览器：`node _acceptance/i18n-check.cjs --browser` → **exit 0**

5 语言 × 6 页 = 30 个页面组合，逐页断言：
- DOM 里**不漏出未翻译 key**（`landing.heroTitle` 这类正则 0 命中）；
- `<html lang>` 等于当前语言（切换后立即变，不刷新）；
- 该页的**代表性文案在当前语言下确实出现**（用语言包自身取值做正向断言，不写死期望文案）；
- 截图：`_acceptance/i18n-shots/{en_*, ja_, pt-BR_pricing, en_pricing_subscription}.png`

```
[browser] zh-CN：6 个页面扫描完成
[browser] en：6 个页面扫描完成
[browser] ja：6 个页面扫描完成
[browser] pt-BR：6 个页面扫描完成
[browser] es：6 个页面扫描完成
✅ i18n-check 通过：…（含浏览器逐页校验）
```

### 类型与风格

```
pnpm --filter @app/web typecheck                       → 0 error（vue-tsc 退出 0）
npx eslint i18n plugins composables/useI18n.ts components/i18n components/billing pages/{index,login,pricing,tools,tasks,settings}.vue → 0 problem
```

### 页面证据（en）

`/pricing` 首屏（英文 + 数据区域保持后端原文）：

![en pricing](i18n-shots/en_pricing.png)

`/pricing` 的会员订阅面板（`<SubscriptionPlans />`，本批完成文案 i18n）：

```
Membership
Subscriptions include monthly bonus credits and member pricing… 
Standard / DF / Pro / Studio   Monthly · Quarterly · Half-yearly · Yearly
¥299.00  / ¥24.92 per month   7200 bonus credits per month   Subscribe now
```

其余截图：`i18n-shots/en_.png`（落地页）、`en_login.png`、`en_tools.png`、`en_tasks.png`、`en_settings.png`、`ja_.png`。

---

## 竞品证据

| 我方实现 | 竞品证据 |
|---|---|
| 支持语言 zh(默认)/en/ja/pt-BR/es | `rea-reelmate/REELMATE-逆向分析报告.md:23`（`zh（默认）/ en / ja / br / es`）、`feature-map.md:152`；路由前缀实例 `rea-reelmate/routes.txt:50`(`/en`)、`:52`(`/es`)、`:60`(`/ja`) |
| 请求头 `X-Lang` 协商 | `报告:172`（动态头含 `X-Lang`）、`feature-map.md:414`（身份头清单含 `X-Lang`）；`feature-map.md:152`（"请求头 `X-Lang` 而非路径前缀"） |
| 语言包按 namespace 分组 | 竞品 chunk 内只有 i18n key、语言包不在导出集内 → 无法逐字对齐，按我方页面域切 namespace（`feature-map.md:555` 也登记了"语言包内容未取证"） |

**偏离（已登记待取证）**：竞品同时有**路径前缀**（`/en /ja /br /es`）+ `X-Lang`；我方本批只做 cookie/query/header，**不做路径前缀**——理由见下。

---

## 关键决策（含理由，供后续复用）

1. **不引 `@nuxtjs/i18n`**：只有一个 Nuxt 应用、5 语言、312 key；库带来的路由前缀/hreflang/多域能力一个都不用，却要改路由与构建链（本仓 5 个队友同轮改 web，风险不对等）。
2. **不做路径前缀**（`/en/...`）：会与同轮在改的 `nuxt.config.ts` 路由、`layouts`、大量 `<NuxtLink to>` 冲突；SEO 侧用 `hreflang` 后续单独补（本轮未做，见未完成）。
3. **`ja` 的"中文残留"不用统一汉字正则会误报**：日语正常书写就使用 CJK（`設定`/`確認`/`有効` 全在 `[\u4e00-\u9fa5]`）。所以 en/pt-BR/es 用该正则硬判，ja 改用**简体专用字表**（`号/投/私/按/片` 等日语也用到的字已剔除，避免假阳性）。这条规则写在 `i18n-check.cjs` 注释里，可扩展。
4. **缺 key 渲染 key 本身**（而不是空串）：空串是最难查的 i18n 事故（界面看起来"没加载"）；渲染 `pricing.buy` 能一眼定位，且被验收脚本拦截。dev 下 `console.warn`，生产不 warn（避免淹没真错误）。
5. **语言名不进语言包**：`简体中文/日本語/…` 是专有名词，放进包会让外语包出现中文（违反残留口径），也会把"本语言界面里的语言名"翻掉。
6. **壳层不迁**：`layouts/app.vue` 是 Lead 写权（侧栏 12 个入口 + 抬头），本批未动；外语界面里侧栏仍是中文（截图可见），需 Lead 接（见下）。

---

## 需要 Lead 做

1. **`layouts/app.vue` 壳层文案 i18n**（写权限不在我这）：侧栏 12 个入口（首页/剧本创作/小说改编/创作 Agent/无限画布/全部项目/剪辑台/工具箱/资产库/团队管理/影视版/MCP & CLI/活动…）+ 抬头右上（创作手册/商务合作/会员订阅…）+ 页脚（用户协议/隐私政策/举报投诉）+ 品牌名。语言包已备好 `nav.*` 与 `common.*`，缺的 key 我可以按你给的清单一次补齐（或你自己加）。
2. **`app.vue` 的全局 `<meta name="description">`** 是中文常量（我在 `index.vue` 用 `useSeoMeta` 覆盖了落地页，其它页仍继承中文描述）。建议把它挪进语言包或改成按页覆盖。
3. **`LangSwitcher` 的最终位置**：现在挂在 6 个页面各自头部（index 的 nav、login 弹窗右上、pricing/tasks/tools/settings 的标题行）。全站最好只放一处（`layouts/app.vue` 抬头右侧 + 未登录页右上），届时页面里的 `<LangSwitcher />` 可以删掉——你接壳层时顺手定。
4. **重建 web**（`pnpm --filter @app/web build`）：新增了 `plugins/` 与 `components/i18n/` 目录，**增量 HMR 不会自动加载新插件**；`:3003` 是 `.output` 构建产物，必须重建后 `/agent`、i18n 才在共享栈可见（我验证用的是私有 `:3014` nuxt dev，已停掉）。
5. 可选：`packages/shared` 若要给后端错误码配多语言 msg，再单开任务（本批按"服务端不翻译"决策不做）。
6. **`_acceptance/*` 被 `.gitignore:36` 忽略**：新增的 `_acceptance/i18n-check.cjs` 与截图目录 `_acceptance/i18n-shots/` 不会自动进版本库（仓库里既有的 `_acceptance/*.cjs` 都是历史 `git add -f` 强加进去的）。要留档请：`git add -f _acceptance/i18n-check.cjs`（截图如不想入库可不加）。

---

## 未完成（诚实列出）

| # | 项 | 状态 | 说明 |
|---|---|---|---|
| 1 | 未迁移页面 | **未做**：`home`、`works`、`assets`、`admin/**`、`share/[token]`、`create/**`、`novel-market/**`、`creator-center/**`、`novel/**`、`reelflow/**`、`team`、`projects/**`、`tools` 子页等 | 任务明确限定只迁 6 页（其余同轮有 owner）；这些页在外语界面仍是中文 |
| 2 | 壳层（侧栏/抬头/页脚） | **未做** | 见「需要 Lead 做」1 |
| 3 | 后端返回的文案 | **不翻译（决策）** | 工具目录标题/描述、SKU `label`、space 名、错误 `msg` 保持后端原文；`i18n-check --browser` 会把这些列为提示（不判失败） |
| 4 | 路径前缀 `/en /ja /br /es` + `hreflang` | **未做** | 竞品有（`routes.txt:50/52/60`），我方用 cookie+query；SEO 需要单独做（`hreflang` + sitemap + 路由前缀），且会与路由改动冲突 |
| 5 | 日期/数字/货币本地化 | **部分** | `tasks` 的 `toLocaleString(locale)` 已本地化；金额仍是 `¥xx.xx` 人民币（币种未国际化，属计费域决策）；`halfyear` 等周期已本地化 |
| 6 | 韩语（竞品有错误文案支持） | **未做** | `报告:23` 提到竞品支持韩语错误文案；本批语言集按任务书 5 种 |
| 7 | 服务端错误 msg 的前端映射 | **部分** | `errors.*` 只覆盖通用网络/加载/操作失败；业务异常仍是后端中文 msg 原样回显 |
| 8 | 语言偏好持久到账号 | **未做** | 现在只落 cookie；若要多端一致需 `user_preferences` / `me` 字段（数据层改动，写进回报待拍板） |
| 9 | `?lang=` 之外的 URL 可分享性 | **已做 query，未做 path** | 分享链接带 `?lang=ja` 可用；但同一页面不同语言仍是同一 URL（无独立可索引地址） |
