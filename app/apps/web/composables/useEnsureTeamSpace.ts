/**
 * 确保"活动空间"已就绪（团队场景页面的前置）。
 *
 * ## 为什么需要它
 * 团队域页面（数据看板、团队资产等）都靠 `useActiveSpaceId()` 决定 `X-Space-Id`。
 * 但活动空间是**用户选择**的结果，直接打开深链接（或换设备）时它是空的——
 * 页面就只能显示"请先去团队管理选择团队"，深链接等于坏链。
 *
 * `team/index.vue`（团队管理）此前自己做了"取第一个团队并 setActiveSpaceId"，
 * 但只对**访问过团队管理**的用户生效。这里把它抽成共享函数：任何团队页在拿不到活动空间时，
 * 都先用 `GET /cam/teams/mine` 兜底选第一个团队，再继续加载。
 *
 * 返回空字符串表示"该用户没有任何团队空间"，调用方应给出可执行的引导文案（不是白屏）。
 */
export async function ensureActiveTeamSpace(
  api: { get: <T>(path: string) => Promise<T> },
): Promise<string> {
  const active = useActiveSpaceId();
  if (active.value) return active.value;
  try {
    const mine = await api.get<{ list?: Array<{ space_id?: string; type?: number }> }>("/cam/teams/mine");
    /**
     * **优先挑团队空间（type=2），而不是列表第一个**。
     *
     * `/cam/teams/mine` 会把"我的空间"（个人空间 type=1）排在最前；团队域页面若直接取 list[0]，
     * 活动空间就会指向个人空间——看板显示的是个人消耗、X-Space-Id 也不是团队，
     * 数字看着"有数据"但口径全错（比空页面更难发现）。
     */
    const list = mine.list ?? [];
    const team = list.find((item) => Number(item.type) === 2) ?? list[0];
    const picked = team?.space_id;
    if (picked) {
      setActiveSpaceId(String(picked));
      return String(picked);
    }
  } catch {
    // 取不到团队列表（网络/鉴权）时按"没有团队空间"处理，由调用方给引导文案
  }
  return "";
}
