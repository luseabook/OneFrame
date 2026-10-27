/**
 * cam 团队域权限码目录（`PERMISSION_CATALOG`）—— 竞品证据：
 * `_acceptance/_gap/contract-draft-cam-film.md` §3.2（`:632-643`）：客户端 bundle 里
 * `permission_code` 实测 **62 条**，且**粗码与细码并存**（`hasPermission` 按精确串匹配，
 * 所以两者都要落库）。
 *
 * 本文件的码表 = 竞品实测的 53 个细码 + 10 个粗码（逐条来自 §3.2 的分类清单）
 * + 5 个 film 域码（我方扩展：竞品对 film **零** permission_code 映射，A4 已取证）
 * + 2 个团队管理扩展码（`team.role` / `team.permission`，本批新增的"改角色权限"动作需要
 *   一个可授予的权限码，否则运维无从表达"谁能改权限"）。
 *
 * 命名规范：`domain.action`（点号分隔、全小写、action 内可用下划线，如 `member.edit_admin`）。
 * **不要**用 `role_level <= N` 推导权限：竞品 `role_level` 不是单调特权轴
 * （level 11 的 film_maker 特权高于 level 4 的导演），见 §3.1。
 *
 * ⚠️ 边界（渐进式拦截，本批只开 3 个码）：
 * 本文件负责"目录 + 角色绑定存储"，判权在 `TeamService.requirePermission`。
 * 目前**只有** `team.edit` / `team.permission` / `member.create` 三个码挂了入口拦截
 * （清单见 `enforced-permissions.ts`，`GET /cam/permissions` 的 `enforced` 也来自它）。
 * 其余码仍是"可配置但不拦截"，保持与存量 13 个 e2e 兼容：**没有显式 power_list 的角色
 * 视为拥有全部权限**（默认放行）。做全站拦截需要同时迁移存量角色默认权限，属独立批次。
 */

export interface PermissionEntry {
  code: string;
  name: string;
  /** 分组 key（= 码的 domain 部分，粗码即自身） */
  group: string;
}

export interface PermissionGroup {
  group: string;
  name: string;
  codes: string[];
}

/** 分组展示名 */
const GROUP_NAMES: Record<string, string> = {
  project: "项目",
  episode: "分集",
  storyboard: "分镜",
  resource: "资源",
  member: "成员",
  team: "团队",
  knowledge: "知识库",
  knowaistoryboard: "知识分镜",
  playwriting: "剧本创作",
  group: "分组",
  film: "影视版",
};

interface GroupSpec {
  group: string;
  /** [action, 中文名] */
  actions: Array<[string, string]>;
}

/** 竞品实测的细码（§3.2 `:632-643` 的分类清单，逐域展开） */
const FINE_SPECS: GroupSpec[] = [
  {
    group: "project",
    actions: [
      ["view", "查看项目"],
      ["create", "创建项目"],
      ["edit", "编辑项目"],
      ["delete", "删除项目"],
      ["export", "导出项目"],
      ["member", "管理项目成员"],
    ],
  },
  {
    group: "episode",
    actions: [
      ["view", "查看分集"],
      ["create", "创建分集"],
      ["edit", "编辑分集"],
      ["delete", "删除分集"],
      ["download", "下载分集"],
    ],
  },
  {
    group: "storyboard",
    actions: [
      ["view", "查看分镜"],
      ["create", "创建分镜"],
      ["edit", "编辑分镜"],
      ["delete", "删除分镜"],
      ["confirm", "确认分镜"],
    ],
  },
  {
    group: "resource",
    actions: [
      ["view", "查看资源"],
      ["upload", "上传资源"],
      ["edit", "编辑资源"],
      ["delete", "删除资源"],
      ["download", "下载资源"],
    ],
  },
  {
    group: "member",
    actions: [
      ["view", "查看成员"],
      ["edit", "编辑成员"],
      ["remove", "移除成员"],
      ["edit_admin", "设置管理员"],
      ["disable_admin", "取消管理员"],
      ["create", "新增成员"],
      ["points", "分配/回收积分"],
      ["download", "导出成员"],
    ],
  },
  {
    group: "team",
    actions: [
      ["view", "查看团队"],
      ["edit", "编辑团队"],
      ["download", "导出团队数据"],
      ["add_admin", "新增管理员"],
      // 我方扩展：改角色权限需要一个可授予的码，否则"谁能改权限"无法表达
      ["role", "管理角色"],
      ["permission", "管理权限"],
    ],
  },
  {
    group: "knowledge",
    actions: [
      ["view", "查看知识库"],
      ["create", "创建知识库内容"],
      ["edit", "编辑知识库内容"],
      ["delete", "删除知识库内容"],
    ],
  },
  {
    group: "knowaistoryboard",
    actions: [
      ["view", "查看知识分镜"],
      ["create", "创建知识分镜"],
      ["edit", "编辑知识分镜"],
      ["delete", "删除知识分镜"],
    ],
  },
  {
    group: "playwriting",
    actions: [
      ["view", "查看剧本"],
      ["edit", "编辑剧本"],
      ["upload", "上传剧本"],
      ["download", "下载剧本"],
      ["delete", "删除剧本"],
      ["member", "管理剧本成员"],
    ],
  },
  {
    group: "group",
    actions: [
      ["view", "查看分组"],
      ["create", "创建分组"],
      ["edit", "编辑分组"],
      ["delete", "删除分组"],
      ["download", "导出分组"],
      ["member_change", "调整分组成员"],
    ],
  },
  {
    group: "film",
    actions: [
      ["view", "查看影视版"],
      ["edit", "编辑影视版任务表"],
      ["delete", "删除影视版数据"],
      ["export", "导出影视版"],
      ["bind", "绑定画布"],
    ],
  },
];

/** 竞品实测的 10 个"仅模块名"粗码（§3.2 `:640-642`），与细码并存、按精确串匹配 */
const COARSE_CODES: Array<[string, string]> = [
  ["project", "项目（模块级粗码）"],
  ["episode", "分集（模块级粗码）"],
  ["storyboard", "分镜（模块级粗码）"],
  ["resource", "资源（模块级粗码）"],
  ["member", "成员（模块级粗码）"],
  ["team", "团队（模块级粗码）"],
  ["knowledge", "知识库（模块级粗码）"],
  ["knowaistoryboard", "知识分镜（模块级粗码）"],
  ["playwriting", "剧本创作（模块级粗码）"],
  ["group", "分组（模块级粗码）"],
];

function buildCatalog(): PermissionEntry[] {
  const list: PermissionEntry[] = [];
  for (const spec of FINE_SPECS) {
    for (const [action, name] of spec.actions) {
      list.push({ code: `${spec.group}.${action}`, name, group: spec.group });
    }
  }
  for (const [code, name] of COARSE_CODES) {
    list.push({ code, name, group: code });
  }
  return list;
}

/** 权限码目录（顺序稳定：先按分组定义顺序，组内按 action 定义顺序，最后是粗码） */
export const PERMISSION_CATALOG: PermissionEntry[] = buildCatalog();

export const PERMISSION_CODES: ReadonlySet<string> = new Set(PERMISSION_CATALOG.map((p) => p.code));

export function isKnownPermission(code: string): boolean {
  return PERMISSION_CODES.has(code);
}

export function groupName(group: string): string {
  return GROUP_NAMES[group] ?? group;
}

/** 目录视图（前端矩阵编辑器直接用：按分组渲染勾选框） */
export function listPermissionCatalog(): {
  list: PermissionEntry[];
  groups: PermissionGroup[];
  total: number;
} {
  const groups: PermissionGroup[] = [];
  const index = new Map<string, PermissionGroup>();
  for (const entry of PERMISSION_CATALOG) {
    let g = index.get(entry.group);
    if (!g) {
      g = { group: entry.group, name: groupName(entry.group), codes: [] };
      index.set(entry.group, g);
      groups.push(g);
    }
    g.codes.push(entry.code);
  }
  return { list: PERMISSION_CATALOG, groups, total: PERMISSION_CATALOG.length };
}

/**
 * 码 → `power_list` 条目（竞品 power_list 的真实形状：`{module,action,permission_code}`）。
 *
 * 粗码（无点号）的 `module` 就是它自己、`action` 取 `"*"`：这样前端按 module 分组时
 * 粗码能落回同一个域，而 `permission_code` 仍是精确串（匹配逻辑不看 action）。
 */
export function codeToPowerEntry(code: string): { module: string; action: string; permission_code: string } {
  const idx = code.indexOf(".");
  if (idx < 0) return { module: code, action: "*", permission_code: code };
  return { module: code.slice(0, idx), action: code.slice(idx + 1), permission_code: code };
}

/** `power_list` → 码集合（兼容三种历史形状：字符串、{permission_code}、{module,action}） */
export function powerListToCodes(powerList: unknown): string[] {
  const out: string[] = [];
  const push = (code: string | undefined) => {
    if (!code) return;
    if (!out.includes(code)) out.push(code);
  };
  if (!Array.isArray(powerList)) return out;
  for (const item of powerList) {
    if (typeof item === "string") {
      push(item);
      continue;
    }
    if (typeof item === "object" && item !== null) {
      const obj = item as Record<string, unknown>;
      if (typeof obj.permission_code === "string") push(obj.permission_code);
      else if (typeof obj.module === "string" && typeof obj.action === "string" && obj.action !== "*") {
        push(`${obj.module}.${obj.action}`);
      }
    }
  }
  return out;
}

/** 码集合 → 排序后的 `power_list`（顺序稳定，保证"同集合重复写"落库字节相同） */
export function codesToPowerList(codes: string[]): Array<{ module: string; action: string; permission_code: string }> {
  const unique = [...new Set(codes)].sort();
  return unique.map(codeToPowerEntry);
}
