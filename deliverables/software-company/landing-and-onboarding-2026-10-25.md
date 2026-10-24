# 落地页重做 + 示例作品 + 全局 Toast

> 2026-10-25 · 第三阶段：把「首次可走通」的最后一环补齐。

## 一、落地页重做（124 → 620 行）

原落地页只有 hero + 3 张卡，无导航无页脚。按竞品 ReelMate 首页信息架构重建：

| 区块 | 内容 |
|---|---|
| 顶部导航 | 品牌 + 能力/流程/定价锚点 + 登录/免费开始（已登录改为「进入工作台」） |
| Hero | 引导徽标「AI 漫剧 · 短剧生产流水线」+ 主标题（渐变文字）+ 双行说明 + 双 CTA + Alpha 说明 |
| 双工作流入口 | 「短剧工作流 / 工具箱」两张卡（对齐竞品首页的 flow-card 形态） |
| 能力矩阵 | 6 项：剧本流水线 / 角色一致性 / 价格透明 / 批量与预算 / 资产复用 / AI 双标识 |
| 流水线六步 | 01 建项目 → 02 生成大纲 → 03 角色定妆 → 04 写分镜 → 05 批量出片 → 06 导出成片（带箭头连接） |
| 底部 CTA | 「现在就把第一部剧做出来」+ 免费开始 |
| 页脚 | 品牌 + 协议/隐私/举报/定价 + AI 声明与备案占位 |

**实测**：`h1`「你的专属 AI 漫剧工作室」、workflows=2、capabilities=6、pipeline=6、nav/foot 均存在、overflow=0、console 0 错误。

## 二、示例作品（首次体验闭环）

- 新增 env `SEED_SAMPLE_PROJECT`（默认 true）
- 新用户注册时自动创建示例作品「示例：雨夜来信」：2 集已确认大纲 + 2 个角色，**无分镜**（用户可亲自体验生成分镜→投递）
- 标记 `is_sample=1`，可在作品库看到

**实测（新号 13900002222）**：
```
works total=1  示例：雨夜来信 | sample=true state=draft ep=2 shot=0
episodes=2  第1集 来信 / 第2集 老城区（含梗概）
characters=2  林晚（25岁短发深色风衣）/ 守夜老人（60岁灰白胡须）
```

## 三、全局 Toast

- `components/ToastHost.vue`：右下角堆叠、三态（success/error/info）、自动 2.6s 消失、点击关闭、TransitionGroup 动画
- `composables/useToast.ts`：**惰性解析宿主**（关键——页面 setup 早于 ToastHost 挂载，提前取值会拿到空实现）
- `app.vue` 全局挂载
- 已接入：作品库归档/恢复

**实测**：点击归档 → `POST /archive` 201 `{"archived":true}` → Toast 显示「已归档」✓

## 四、修复的 hydration 问题

| 页面 | 根因 | 修复 |
|---|---|---|
| `/home` | 引导条依赖 `auth.onboarded`，SSR/客户端分支不同 | `ClientOnly` 包裹引导条 |
| `/tasks` | 5s 轮询在 hydrate 期间改数据 | 整页 `ClientOnly` 包裹 |

验证方式：逐页独立页面 + 独立 console 监听（避免复用同一 page 的假阳性）。

## 五、全量验证

```
构建：✓
静态检查：✓ lint（6）✓ typecheck（10，--force）
测试：✓ 93 项全通过
逐页巡检（13 个页面，独立监听）：
  / /home /works /projects /tasks /assets /credits /tools /settings
  /pricing /terms /privacy /report
  → 全部 clean（0 error / 0 warning），overflow=0
响应式：390×844 下 / /works /tasks /credits 均 overflow=0
```

## 六、目标达成度盘点

| 目标要素 | 状态 |
|---|---|
| 产品形态文档（A 型 SaaS） | ✅ `PRD-supplement-works-and-onboarding.md` |
| 作品库（成果可见） | ✅ `/works` + `GET /works` 聚合 |
| 二次创作（续做一集） | ✅ `POST /projects/:id/episodes` |
| 新手引导（首次可走通） | ✅ 引导条 + 示例作品 |
| 留存闭环 | ✅ 建作品→出片→作品库→续做 全链路可用 |
| 对齐竞品 IA | ✅ 首页/落地页/工作台壳/工具箱 结构一致 |
| 核心链路 F1–F8 | ✅ 93 项测试覆盖 |
