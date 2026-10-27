/**
 * 已落**入口拦截**的权限码（渐进式拦截的第一批）。
 *
 * 为什么只放 3 个、且必须"默认放行"：
 * - 存量 13 个 e2e suite 里的团队成员都是 `role=3` 且**没有** power_list；
 *   若"没有配置 = 没有权限"，这些用例会全红——那是把灰度做成了全量破坏。
 * - 所以语义定为：**成员没有任何显式 power_list 时视为拥有全部权限**；
 *   只有角色被显式配置过、且码不在列表里才拒绝。这样运营可以"先给高危角色收紧，
 *   其余保持开放"，不需要一次性迁移所有存量角色。
 *
 * 本表同时是 `GET /cam/permissions` 的 `enforced` 数据源（前端矩阵据此标「生效中」），
 * 也是 `test/team-permissions.spec.ts` 的断言依据——**加新拦截时三处必须同步**：
 * 1) 本表加一行；2) 对应 controller 调 `requirePermission`；3) spec 加一条越权用例。
 *
 * 选这 3 个的理由：都是"低风险但边界清晰"的管理写入口——改动团队设置、
 * 改角色权限矩阵、拉人进团队。它们错了的后果可控（不会删数据/不会扣积分），
 * 但恰好是权限模型最该先管住的三件事。
 */
export interface EnforcedPermission {
  /** 权限码（必须在 `PERMISSION_CATALOG` 里存在，否则矩阵上无处显示） */
  code: string;
  method: "PATCH" | "PUT" | "POST" | "DELETE";
  /** 已拦截的端点（对外路径，带 /v1 前缀便于直接对着 curl） */
  endpoint: string;
  /** 人类可读说明（前端 tooltip / 报告引用） */
  note: string;
}

export const ENFORCED_PERMISSIONS: readonly EnforcedPermission[] = [
  {
    code: "team.edit",
    method: "PATCH",
    endpoint: "/v1/cam/team/info",
    note: "改团队设置（名称/席位/简介）",
  },
  {
    code: "team.permission",
    method: "PUT",
    endpoint: "/v1/cam/roles/:role_id/permissions",
    note: "改角色权限矩阵",
  },
  {
    // 任务书写的 `team.member` 在权限目录里不存在；`member.create` 才是"新增/邀请成员"的码，
    // 这里用真实码，避免造一个前端矩阵里永远不显示的孤儿码。
    code: "member.create",
    method: "POST",
    endpoint: "/v1/cam/team/member/batch",
    note: "邀请/批量添加成员（= 邀请入口）",
  },
] as const;

/** 快速判定某个码是否已落拦截（`GET /cam/permissions` 用） */
export const ENFORCED_PERMISSION_CODES: ReadonlySet<string> = new Set(
  ENFORCED_PERMISSIONS.map((item) => item.code),
);

export function isEnforcedPermission(code: string): boolean {
  return ENFORCED_PERMISSION_CODES.has(code);
}
