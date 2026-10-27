import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { sql } from "drizzle-orm";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { db, pool } from "../src/db/database";
import { PERMISSION_CATALOG } from "../src/modules/team/permission-catalog";

/**
 * 团队权限码体系契约测试 —— 对照 `_acceptance/_gap/contract-draft-cam-film.md` §3.2：
 * 竞品客户端 bundle 实测 **62 条** `permission_code`（53 细码 + 10 粗码并存，
 * `hasPermission` 按精确串匹配）。本批目标是"目录 + 角色绑定存储"，验收点：
 *
 * 1. 目录 ≥58 条、码形如 `domain.action`、**无重复**、按模块分组；
 * 2. 角色权限读/写：写 `team_roles.power_list`（竞品真实形状 `{module,action,permission_code}`）；
 * 3. **幂等**：同一集合重复 PUT，落库字节与返回值都不变（审计 diff 不能每次都"看起来变了"）；
 * 4. 边界：未知码拒绝（不静默丢弃）、owner 角色不可改、非特权成员 403、跨 space 角色 400102；
 * 5. `temp-info`：能推导的给真值，推不出来的给 null + unverified（不用假 false 冒充）。
 *
 * ⚠️ 本批**不做**全站入口拦截（会把既有 13 个 e2e suite 全打红），所以这里也**不**断言
 * "某成员没有某码就访问不了某端点"——那是下一批的事，见回报的边界说明。
 */
describe("team permissions (cam) e2e", () => {
  let app: NestFastifyApplication;
  const createdSpaceIds: string[] = [];

  const inject = async (
    method: string,
    url: string,
    payload?: unknown,
    token?: string,
    spaceId?: string,
  ) => {
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;
    if (spaceId) headers["x-space-id"] = spaceId;
    const res = await app.inject({
      method: method as "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
      url: `/v1${url}`,
      headers,
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(res.body) as Record<string, unknown>;
    } catch {
      body = { raw: res.body };
    }
    return {
      status: res.statusCode,
      code: (body as { code?: number }).code ?? -1,
      msg: (body as { msg?: string }).msg ?? "",
      data: (body as { data?: unknown }).data,
      body,
    };
  };

  async function loginNewUser(prefix: string) {
    const tail = String(Date.now()).slice(-8);
    const tag = String(prefix).replace(/\D/g, "").slice(-2).padStart(2, "0");
    const phone = `1${tail}${tag}`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const code = (sms.data as { debug_code?: string } | undefined)?.debug_code;
    const login = await inject("POST", "/auth/login", { phone, code, age_confirmed: true });
    const data = login.data as { access_token?: string; space_id?: string; user?: { id?: string } } | undefined;
    return { token: data?.access_token ?? "", spaceId: String(data?.space_id ?? ""), userId: String(data?.user?.id ?? "") };
  }

  /** 建团队（走真实端点，与前端"创建团队"同一条路径） */
  async function createTeam(owner: { token: string; spaceId: string }, name: string): Promise<string> {
    const res = await inject("POST", "/cam/team", { name }, owner.token, owner.spaceId);
    expect(res.code).toBe(0);
    const spaceId = String((res.data as { space_id: string }).space_id);
    createdSpaceIds.push(spaceId);
    return spaceId;
  }

  async function addMember(spaceId: string, userId: string, roleCode = "animator", role = 3) {
    await db.execute(sql`
      insert into space_members (space_id, user_id, role, credits_quota, status, role_code, created_at, updated_at)
      values (${BigInt(spaceId)}, ${BigInt(userId)}, ${role}, 0, 1, ${roleCode}, now(), now())
      on conflict (space_id, user_id) do update set role = ${role}, role_code = ${roleCode}, status = 1
    `);
  }

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: true }), {
      logger: false,
    });
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 90_000);

  afterAll(async () => {
    for (const spaceId of createdSpaceIds) {
      const sid = BigInt(spaceId);
      await db.execute(sql`delete from team_roles where space_id = ${sid}`).catch(() => undefined);
      await db.execute(sql`delete from team_member_projects where space_id = ${sid}`).catch(() => undefined);
      await db.execute(sql`delete from space_members where space_id = ${sid}`).catch(() => undefined);
      await db.execute(sql`delete from credit_accounts where space_id = ${sid}`).catch(() => undefined);
      await db.execute(sql`delete from spaces where id = ${sid}`).catch(() => undefined);
    }
    await app.close();
    await pool.end().catch(() => undefined);
  });

  // ── 目录 ────────────────────────────────────────────────

  it("权限码目录：≥58 条、码格式 domain.action、无重复、按模块分组（粗码与细码并存）", async () => {
    const owner = await loginNewUser("31");
    const teamSpaceId = await createTeam(owner, "权限目录团队");

    const res = await inject("GET", "/cam/permissions", undefined, owner.token, teamSpaceId);
    expect(res.code).toBe(0);
    const data = res.data as {
      total: number;
      list: Array<{ code: string; name: string; group: string }>;
      groups: Array<{ group: string; name: string; codes: string[] }>;
    };
    expect(data.total).toBeGreaterThanOrEqual(58);
    expect(data.total).toBe(data.list.length);
    expect(data.total).toBe(PERMISSION_CATALOG.length);

    const codes = data.list.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length); // 无重复
    for (const code of codes) {
      // 细码：domain.action；粗码：单个模块名
      expect(code).toMatch(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/);
      expect(code.length).toBeLessThanOrEqual(64);
    }
    // 逐条要有中文名（前端矩阵不能显示裸码）
    for (const p of data.list) expect(p.name.length).toBeGreaterThan(0);

    // 分组完整：每个码都落在某个分组里，且分组 codes 与 list 一致
    const grouped = data.groups.flatMap((g) => g.codes);
    expect(grouped.sort()).toEqual([...codes].sort());
    for (const g of data.groups) expect(g.name.length).toBeGreaterThan(0);

    // 证据锚点：竞品实测存在的几类码必须出现（细码 + 粗码）
    for (const required of ["project.view", "project.edit", "member.edit_admin", "group.member_change", "playwriting.member"]) {
      expect(codes).toContain(required);
    }
    for (const coarse of ["project", "storyboard", "playwriting"]) {
      expect(codes).toContain(coarse);
    }
  });

  // ── 角色权限读写 ────────────────────────────────────────

  it("角色权限：读取初始为空；PUT 写入 power_list（{module,action,permission_code}）；GET 回读一致", async () => {
    const owner = await loginNewUser("32");
    const teamSpaceId = await createTeam(owner, "角色权限团队");

    const roleList = await inject("GET", "/cam/role/list", undefined, owner.token, teamSpaceId);
    expect(roleList.code).toBe(0);
    const roles = (roleList.data as { list: Array<{ id: string; role_code: string }> }).list;
    expect(roles.length).toBeGreaterThanOrEqual(11); // 内置 11 级
    const animator = roles.find((r) => r.role_code === "animator")!;

    const before = await inject("GET", `/cam/roles/${animator.id}/permissions`, undefined, owner.token, teamSpaceId);
    expect(before.code).toBe(0);
    expect((before.data as { permissions: string[] }).permissions).toEqual([]);

    const put = await inject(
      "PUT",
      `/cam/roles/${animator.id}/permissions`,
      { permissions: ["project.view", "storyboard.edit", "resource.upload"] },
      owner.token,
      teamSpaceId,
    );
    expect(put.code).toBe(0);
    const putData = put.data as {
      changed: boolean;
      permissions: string[];
      power_list: Array<{ module: string; action: string; permission_code: string }>;
    };
    expect(putData.changed).toBe(true);
    expect(putData.permissions).toEqual(["project.view", "resource.upload", "storyboard.edit"]); // 排序稳定
    expect(putData.power_list).toHaveLength(3);
    // 竞品 power_list 的真实形状
    expect(putData.power_list).toContainEqual({ module: "project", action: "view", permission_code: "project.view" });

    const after = await inject("GET", `/cam/roles/${animator.id}/permissions`, undefined, owner.token, teamSpaceId);
    const afterData = after.data as { permissions: string[]; power_list: unknown[]; unknown_permissions: string[] };
    expect(afterData.permissions).toEqual(["project.view", "resource.upload", "storyboard.edit"]);
    expect(afterData.power_list).toHaveLength(3);
    expect(afterData.unknown_permissions).toEqual([]);
  });

  it("幂等：同一集合重复 PUT → changed=false 且 power_list 字节不变；乱序输入归一为同一结果", async () => {
    const owner = await loginNewUser("33");
    const teamSpaceId = await createTeam(owner, "幂等团队");
    const roles = (await inject("GET", "/cam/role/list", undefined, owner.token, teamSpaceId)).data as {
      list: Array<{ id: string; role_code: string }>;
    };
    const editor = roles.list.find((r) => r.role_code === "editor")!;

    const first = await inject(
      "PUT",
      `/cam/roles/${editor.id}/permissions`,
      { permissions: ["episode.view", "episode.edit", "film.view"] },
      owner.token,
      teamSpaceId,
    );
    const second = await inject(
      "PUT",
      `/cam/roles/${editor.id}/permissions`,
      // 故意换顺序 + 带重复项：归一化后必须与第一次完全相同
      { permissions: ["film.view", "episode.edit", "episode.view", "film.view"] },
      owner.token,
      teamSpaceId,
    );
    expect(second.code).toBe(0);
    const a = first.data as { power_list: unknown[]; permissions: string[] };
    const b = second.data as { power_list: unknown[]; permissions: string[]; changed: boolean };
    expect(b.changed).toBe(false);
    expect(JSON.stringify(b.power_list)).toBe(JSON.stringify(a.power_list));
    expect(b.permissions).toEqual(a.permissions);
  });

  it("校验：未知权限码 → 400101 unknown_code（附全部未知码，不静默丢弃）", async () => {
    const owner = await loginNewUser("34");
    const teamSpaceId = await createTeam(owner, "校验团队");
    const roles = (await inject("GET", "/cam/role/list", undefined, owner.token, teamSpaceId)).data as {
      list: Array<{ id: string; role_code: string }>;
    };
    const director = roles.list.find((r) => r.role_code === "director")!;

    const res = await inject(
      "PUT",
      `/cam/roles/${director.id}/permissions`,
      { permissions: ["project.view", "project.destroy", "nonsense"] },
      owner.token,
      teamSpaceId,
    );
    expect(res.code).toBe(400101);
    expect(res.msg).toContain("unknown");
    // 失败不落部分权限（要么全写要么不写）
    const after = await inject("GET", `/cam/roles/${director.id}/permissions`, undefined, owner.token, teamSpaceId);
    expect((after.data as { permissions: string[] }).permissions).toEqual([]);
  });

  it("边界：owner(master) 角色不可改（400101）；非特权成员改权限 403；跨 space 角色 400102", async () => {
    const owner = await loginNewUser("35");
    const teamSpaceId = await createTeam(owner, "边界团队");
    const roles = (await inject("GET", "/cam/role/list", undefined, owner.token, teamSpaceId)).data as {
      list: Array<{ id: string; role_code: string }>;
    };
    const master = roles.list.find((r) => r.role_code === "master")!;
    const admin = roles.list.find((r) => r.role_code === "admin")!;

    const ownerImmutable = await inject(
      "PUT",
      `/cam/roles/${master.id}/permissions`,
      { permissions: ["project.view"] },
      owner.token,
      teamSpaceId,
    );
    expect(ownerImmutable.code).toBe(400101);
    expect(ownerImmutable.msg).toContain("owner_role_immutable");

    const member = await loginNewUser("36");
    await addMember(teamSpaceId, member.userId, "animator", 3);
    const forbidden = await inject(
      "PUT",
      `/cam/roles/${admin.id}/permissions`,
      { permissions: ["project.view"] },
      member.token,
      teamSpaceId,
    );
    expect(forbidden.code).toBe(403101);

    // 但普通成员**可以读**目录与角色权限（矩阵编辑器要给所有人看当前配置）
    const canRead = await inject("GET", "/cam/permissions", undefined, member.token, teamSpaceId);
    expect(canRead.code).toBe(0);

    const other = await loginNewUser("37");
    const otherTeam = await createTeam(other, "另一个团队");
    const crossSpaceRole = await inject(
      "GET",
      `/cam/roles/${admin.id}/permissions`,
      undefined,
      other.token,
      otherTeam,
    );
    expect(crossSpaceRole.code).toBe(400102);
  });

  // ── temp-info ──────────────────────────────────────────

  it("temp-info：返回团队真实开关（film_enabled/api_key_white），未取证项给 null 并列进 unverified", async () => {
    const owner = await loginNewUser("38");
    const teamSpaceId = await createTeam(owner, "开关矩阵团队");

    const res = await inject("GET", "/cam/temp-info", undefined, owner.token, teamSpaceId);
    expect(res.code).toBe(0);
    const data = res.data as Record<string, unknown> & {
      space_id: string;
      name: string;
      film_enabled: boolean;
      agent_whitelist: boolean;
      api_key_white: boolean;
      seedance_is_support: boolean;
      unverified: string[];
      model_families: { total_visible: number; vendors: string[] };
    };
    expect(data.space_id).toBe(teamSpaceId);
    expect(data.name).toBe("开关矩阵团队");
    expect(data.film_enabled).toBe(false); // 新团队默认未开通影视版
    expect(data.api_key_white).toBe(false); // 没配过 BYOK
    // 模型族支持位是"按 models 目录派生"的真值（本仓库 seedance 系列可见 → true）
    expect(typeof data.seedance_is_support).toBe("boolean");
    expect(data.seedance_is_support).toBe(true);
    expect(data.model_families.total_visible).toBeGreaterThan(0);
    // 未取证项必须是 null + 列名清单，**不能**用假 false 冒充"确定不支持"
    expect(data.is_lingman_wsid).toBeNull();
    expect(data.is_sd_discount_black).toBeNull();
    expect(data.is_support).toBeNull();
    expect(data.unverified).toEqual(["is_lingman_wsid", "is_sd_discount_black", "is_support"]);
    expect(data.derived_from).toBe("models_catalog");

    // 开通影视版后同一端点要能反映（证明不是静态常量）
    await inject("PATCH", "/cam/team/info", { film_enabled: true }, owner.token, teamSpaceId);
    const again = await inject("GET", "/cam/temp-info", undefined, owner.token, teamSpaceId);
    expect((again.data as { film_enabled: boolean }).film_enabled).toBe(true);
  });
});
