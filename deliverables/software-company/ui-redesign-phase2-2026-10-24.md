# UI 重构 · 第二阶段（全站深色 1:1 对齐竞品 App）

> 2026-10-24 · 指令：**先尽量 1:1 对齐 UI 再继续**。
> 证据：`rea-reelmate/` 竞品 App 实拍截图（home / loggedin / tools / t2v / pricing / login-modal）+ Phase1 实测 CSS 变量。
> 结论修正：Phase1 曾把工作台做成浅色（当时的产品决策）；竞品证据显示其 **App 全站为深色**（base #000），本阶段全站翻深、逐页 1:1。

## 一、全局

- `tokens.css` 语义翻转：`--bg-app #000 / --bg-surface #141414 / --bg-raised #1f1f1f / --bg-hover 白5%`；文本 `#fff → 白75% → 白56% → 白35%`；边框 `白8%/12%/20%`；`color-scheme: dark`（原生控件深色）；侧栏宽 216→240px（竞品实测）。因全部页面走 token，16 页自动完成深色迁移，无残留浅色硬编码（grep 验证）。
- `app.vue`：去掉 theme-light/theme-dark 双主题，单深色；布局三分：`default`（公共）/ `app`（工作台壳）/ `tool`（生成工具独立页）。
- 组件深色适配：Button.secondary、Button.text hover、Tag.brand、TabBar 徽标、TextField/SelectField/TextAreaField 聚焦环（`#7e70ff2e`）、Modal 遮罩加深。
- **修复 Modal 受控开关缺陷**：组件原本无 `open` prop，`tasks` / `projects/[id]` 传入的 `:open` 被忽略 → 弹窗常开遮全页（此前验收未覆盖该状态）。现支持 `open` 受控（默认 true 兼容旧用法）。

## 二、壳层（layouts/app.vue 重写，对齐 home.png）

- 侧栏 240px：渐变紫 logo 方块 + 品牌名 + 折叠按钮；主导航 首页/全部项目/工具箱（SVG 线性图标），分隔线 + 「团队」分组：资产库/任务中心；底部固定 影视版[申请内测]、添加专属运营助手（品牌紫）、法务三链。
- 顶栏 64px（透明叠 #000 blur）：铃铛→任务中心、问号→举报反馈、金色「积分充值」胶囊→定价、✦积分胶囊→积分页；登录态：头像渐变圆 + 下拉（个人设置/退出）；未登录：紫色「立即登录」胶囊。
- 登录后默认落地页改为 `/home`（原 /create/text-to-video）。

## 三、新页面

| 页面 | 对齐证据 | 内容 |
|---|---|---|
| `/home` 工作台首页 | home.png | 居中大标题「您的专属AI漫剧工作室」；短剧工作流卡（渐变描边+辉光+点阵）与工具箱卡双入口；7 格工具矩阵（3 可用 + 4 即将上线/敬请期待 角标）；活动轮播（3 张渐变横幅+箭头+进度点）；爆款案例 4 卡墙 |
| `/tools` 工具箱 | tools.png | 标题 + 全部/AI视频/AI图片/AI音频 Tab + 4 列工具卡（3 可用入口 + 5 即将上线），空分类 EmptyState |
| `/create/*` 生成工具 | t2v.png | 独立布局（返回+「视频生成」标题，无侧栏）；左表单（模式 Tab 图生/文生/参考生、提示词+灵感 chips、模型条、画幅/分辨率/时长三参数卡、渐变紫「立即生成」+AI 甄别声明）；右结果（全部/视频/进行中筛选、选中任务预览<video>、历史网格、空态文案对齐竞品「快去生成你的创意吧」）；两模式间 Tab 互通 |

## 四、公共层

- `layouts/default.vue` 加页头（logo + 定价 + 登录态入口）与合规页脚（协议/隐私/举报 + AI 甄别声明），落地页/登录页/法务页共用；`/login` 不显示登录按钮。
- 落地页 Hero 加品牌紫辉光与渐变标题，CTA 改胶囊形。

## 五、验证

```
_acceptance/ui-phase2.cjs（shots-v3/，1440×900）：
  登录 → /home 落地 ✔
  /  /tools  /create/text-to-video  /create/image-to-video  /projects
  /tasks  /assets  /credits  /pricing  /settings  /terms  /privacy  /report
  → 15/15 PASS，每页 0 console error / 0 pageerror
  深色基线：body #000 ✔ 侧栏 240px ✔
check-pipeline.cjs：创建项目 → /projects/{id} 流水线页渲染 ✔ 0 console error
桌面 Chrome headless；构建 pnpm -F @app/web build ✔、eslint ✔
```

## 六、遗留（Phase 3 候选）

1. 响应式与可访问性回归（竞品证据仅桌面端）；
2. 流水线页（大纲/角色/分镜/投递）按竞品「向导+分镜工作台」视觉细化；
3. 落地页信息架构扩充（能力矩阵/作品展示，竞品营销站为 CSR 空壳无渲染证据，按 App 视觉语言延展）；
4. 轮播/案例墙目前为装饰性占位，待接入真实公开作品。
