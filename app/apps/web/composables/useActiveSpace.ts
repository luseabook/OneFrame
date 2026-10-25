/**
 * 当前「活动空间」= 团队空间切换（ADR-010）
 *
 * - 个人空间时不设该值（请求不带 X-Space-Id，服务端用 token 里的 sid）；
 * - 切到团队后，所有 API 请求都带 `X-Space-Id`，服务端校验成员身份后以该空间为上下文；
 * - 持久化到 localStorage，刷新后保持。
 */
const STORAGE_KEY = "active_space_id";

export const useActiveSpaceId = () =>
  useState<string>("active-space-id", () => {
    if (import.meta.client) return localStorage.getItem(STORAGE_KEY) ?? "";
    return "";
  });

export function setActiveSpaceId(spaceId: string): void {
  const state = useActiveSpaceId();
  state.value = spaceId;
  if (import.meta.client) {
    if (spaceId) localStorage.setItem(STORAGE_KEY, spaceId);
    else localStorage.removeItem(STORAGE_KEY);
  }
}
