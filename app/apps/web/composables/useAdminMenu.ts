// 运营后台菜单（唯一来源：layout 侧栏与页面标题共用，避免两处漂移）
export type AdminTab =
  | "dashboard"
  | "promo"
  | "home"
  | "prices"
  | "models"
  | "tasks"
  | "funnel"
  | "orders"
  | "shares"
  | "reports"
  | "creatorAudits"
  | "exports"
  | "market"
  | "skills"
  | "audit"
  | "admins"
  | "config"
  | "users"
  | "waitlist"
  | "invites"
  | "aiLabels";

export interface AdminMenuEntry {
  key: AdminTab;
  label: string;
  hint: string;
}

export const ADMIN_MENU: AdminMenuEntry[] = [
  { key: "dashboard", label: "概览", hint: "核心指标与队列" },
  { key: "promo", label: "运营位", hint: "banner / 弹窗 / 活动 / 创作者卡" },
  { key: "home", label: "首页板块", hint: "板块显隐与排序" },
  { key: "prices", label: "价格管理", hint: "模型档位与积分定价" },
  { key: "models", label: "模型", hint: "上架状态 / 排序 / 参数枚举" },
  { key: "tasks", label: "任务审计", hint: "失败率与任务明细" },
  { key: "funnel", label: "流水线漏斗", hint: "各环节转化率与耗时" },
  { key: "orders", label: "订单 / 退款", hint: "支付、全额退款与对账导出" },
  { key: "shares", label: "分享管理", hint: "公开分享下线" },
  { key: "reports", label: "举报处置", hint: "内容举报处理" },
  { key: "creatorAudits", label: "创作者审核", hint: "平台侧审核创作者作品" },
  { key: "exports", label: "导出审计", hint: "整集打包任务与过期时间" },
  { key: "market", label: "剧本广场", hint: "剧本审核 / 分类标签 / 推广 / 提现" },
  { key: "skills", label: "Skill 推荐位", hint: "平台 Skill 首页推荐编排" },
  { key: "audit", label: "操作日志", hint: "管理员操作留痕" },
  { key: "admins", label: "管理员", hint: "账号、角色与启停" },
  { key: "config", label: "配置中心", hint: "公告 / 文案 / 全站配置" },
  { key: "users", label: "用户管理", hint: "检索 / 封禁 / 注销恢复" },
  { key: "waitlist", label: "等待名单", hint: "Alpha 留资与邀请标记" },
  { key: "invites", label: "邀请码", hint: "运营发码 / 停用 / 用量" },
  { key: "aiLabels", label: "AI 标识审计", hint: "显式/隐式标识抽验与导出" },
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
