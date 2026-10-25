// 运营后台菜单（唯一来源：layout 侧栏与页面标题共用，避免两处漂移）
export type AdminTab = "dashboard" | "models" | "tasks" | "shares" | "reports" | "funnel" | "orders";

export interface AdminMenuEntry {
  key: AdminTab;
  label: string;
  hint: string;
}

export const ADMIN_MENU: AdminMenuEntry[] = [
  { key: "dashboard", label: "概览", hint: "核心指标与队列" },
  { key: "models", label: "模型 / 价格", hint: "上架状态与计价" },
  { key: "tasks", label: "任务审计", hint: "失败率与任务明细" },
  { key: "shares", label: "分享管理", hint: "公开分享下线" },
  { key: "reports", label: "举报处置", hint: "内容举报处理" },
  { key: "funnel", label: "流水线漏斗", hint: "各环节转化率" },
  { key: "orders", label: "订单 / 退款", hint: "支付与全额退款" },
];

export function useAdminMenu(): AdminMenuEntry[] {
  return ADMIN_MENU;
}

/** 当前运营菜单项由 URL query 决定（/admin?tab=orders），刷新/前进后退都保持 */
export function useAdminTab() {
  const route = useRoute();
  return computed<AdminTab>(() => {
    const q = String(route.query.tab ?? "dashboard");
    return ADMIN_MENU.some((item) => item.key === q) ? (q as AdminTab) : "dashboard";
  });
}
