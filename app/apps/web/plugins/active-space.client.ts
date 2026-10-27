/**
 * 活动空间恢复（ADR-010）。
 *
 * ## 为什么需要这个 plugin
 * `useActiveSpaceId()` 用 `useState("active-space-id", () => localStorage.getItem(...) ?? "")` 初始化。
 * 但**带 SSR 的应用里，useState 的初值在服务端算一次并被序列化进 payload**：客户端 hydration 时
 * 不会重新执行 initializer，于是 localStorage 里的 `active_space_id` **永远不会被读回来**。
 *
 * 症状（真实踩到过）：
 * - 在 `/team/dashboard` 上按 F5 刷新 → 提示"请先在团队管理里选择团队空间"，看板整页空；
 * - 直接打开 `/team/dashboard` 链接 → 同样空（只有先去过「团队管理」才会被那里 setActiveSpaceId 带起来）。
 *
 * 修法：客户端启动时把持久化的值同步进 state（plugin 在组件挂载前执行），服务端保持空值，
 * 避免 hydration 前后一致性问题（服务端本来就读不到 localStorage）。
 */
export default defineNuxtPlugin(() => {
  const stored = localStorage.getItem("active_space_id");
  if (stored) setActiveSpaceId(stored);
});
