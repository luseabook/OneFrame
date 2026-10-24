# 项目列表页重做 + 工作台 SSR 策略统一

> 2026-10-25 · 第四阶段

## 一、`/projects` 列表页重做（217 → 281 行）

原实现是「左侧表单 + 右侧纯文字列表」的两栏布局，无封面、无状态、无操作分组。重做后：

| 部分 | 说明 |
|---|---|
| 页头 | 标题 + 计数副标题 + 「按作品查看」/「+ 新建项目」双操作 |
| 项目网格 | `auto-fill 240px` 卡片：16:10 封面（渐变占位显示画幅）、示例/已归档角标、标题、来源与创建日期 |
| 新建弹窗 | 从内嵌表单改为 `Modal`：名称（`TextField`）+ 来源/画幅（`SelectField` 双列）+ 素材（`TextAreaField` 带字数） |
| 三态 | `Skeleton` 骨架屏 / `EmptyState` 空态（带 CTA）/ 错误条 |
| 反馈 | 创建成功/失败走全局 `Toast` |
| 响应式 | 390px 下卡片单列，overflow=0 |

**实测**：
```
projects: {"cards":4, titles:[验收新项目×3, 示例：雨夜来信], sampleTag:1, overflow:0}
create modal: {open:true, fields:4}
after create -> /projects/107528485261148160  （正常跳转流水线）
mobile projects overflow: 0
```

## 二、hydration mismatch 根因与最终方案

### 现象
`/projects` 稳定报 `Hydration completed but contains mismatches.`（3/3 复现），`/works` 却始终干净。

### 定位过程（4 轮，逐步收敛）
| 轮次 | 假设 | 结论 |
|---|---|---|
| 1 | `Skeleton v-if="loading"` 时序 | 改为 `loading` 初值 true → 无效 |
| 2 | 用 `mounted` 门控列表区 | → 无效 |
| 3 | 计数 `共 {{ total }}` 在门控外 | 移入门控 → 仍无效 |
| 4 | 服务端 HTML 与客户端 DOM **逐字符比对** | 定位到 `共 0 个项目`（SSR）vs `共 1 个项目`（客户端）——**页面确实被 SSR 了**，服务端 list 为空 |

### 根因
`definePageMeta({ ssr: false })` 对「直接 URL 访问」未生效——Nuxt 仍渲染了页面 HTML（含空列表），客户端加载后数据变化 → 结构不一致。

### 最终方案（框架层）
在 `nuxt.config.ts` 的 `routeRules` 中为所有数据驱动页面显式关闭 SSR：
```ts
"/home": { ssr: false },
"/projects": { ssr: false },
"/projects/**": { ssr: false },
"/works": { ssr: false },
"/tasks": { ssr: false },
"/assets": { ssr: false },
"/credits": { ssr: false },
"/settings": { ssr: false },
"/tools": { ssr: false },
"/admin": { ssr: false },
```

**验证**：`/projects` 连续 3 次独立访问全部 clean；全站 13 页巡检 0 error。

> 教训记录：`definePageMeta({ ssr:false })` 在 SSR 传输层不一定生效，页面级 meta 与路由级 routeRules 需要同时设置才能保证首帧一致。

## 三、全量验证

```
构建 ✓   lint 6 任务 ✓   typecheck 10 任务（--force）✓
测试 ✓ 93 项全通过（api 50 / adapters 9 / shared 13 / db 11 / worker 4 / storage 6）
逐页巡检 13 页：全部 clean（0 error / 0 warning），overflow=0
移动端 390×844：/ /works /tasks /credits overflow=0
```
