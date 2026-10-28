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
 * ⚠️ 拦截边界（本批已落**渐进式**拦截，只开 3 个码）：
 * `team.edit`（PATCH /cam/team/info）、`team.permission`（PUT /cam/roles/:id/permissions）、
 * `member.create`（POST /cam/team/member/batch = 邀请入口）。
 * 判定语义是**默认放行**：角色没有显式 power_list 时视为拥有全部权限，否则存量 13 个
 * e2e（成员都是 role=3 且无 power_list）会全红。清单见 `enforced-permissions.ts`。
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

  // ══ 渐进式入口拦截（模块 #7 收尾）════════════════════════════════════
  //
  // 三个已落拦截的端点见 `src/modules/team/enforced-permissions.ts`。
  // 必须守住的语义是**默认放行**：角色没有显式 power_list 时视为拥有全部权限；
  // 只有"被显式配置过、且码不在集合里"才拒绝。否则存量 13 个 e2e（成员都是
  // role=3 且无 power_list）会全红——那是把灰度做成了全量破坏。

  /**
   * 确保 space 内存在该 role_code 的角色行。
   *
   * 为什么需要：`POST /cam/team` 建团队时只落 `master` 一行，`listRoles` 见"已有行"
   * 就不会再初始化内置 11 级角色（幂等逻辑的副作用）。而 `requirePermission` 的
   * 第 3 步是"岗位没有角色行 → 默认放行"，所以不先建行的话，无论怎么配 power_list
   * 都不会生效——测试会误判成"拦截没做"。
   */
  async function ensureRole(spaceId: string, roleCode: string): Promise<void> {
    const id = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
    await db.execute(sql`
      insert into team_roles (id, space_id, role_code, role_name, role_level, is_system, created_at, updated_at)
      values (${id}, ${BigInt(spaceId)}, ${roleCode}, ${roleCode}, 5, false, now(), now())
      on conflict (space_id, role_code) do nothing
    `);
  }

  /**
   * 直接写角色的 power_list（`null` = 清空 = 恢复"未配置 → 默认放行"）。
   *
   * 为什么直接落库而不走 `PUT /cam/roles/:id/permissions`：那个端点本身也被拦截，
   * 拿它做前置会在"谁有权改权限"上绕圈，测试反而不稳。
   */
  async function setRolePowerList(
    spaceId: string,
    roleCode: string,
    codes: string[] | null,
  ): Promise<void> {
    await ensureRole(spaceId, roleCode);
    // 注意：`power_list` 是 NOT NULL（默认 '[]'），所以"未配置"的表达是**空数组**，
    // 不是 SQL NULL。`powerListToCodes([])` → [] → 判定链第 4 步"未配置 → 放行"。
    const payload =
      codes === null
        ? "[]"
        : JSON.stringify(
            [...new Set(codes)].sort().map((code) => {
              const idx = code.indexOf(".");
              return idx < 0
                ? { module: code, action: "*", permission_code: code }
                : {
                    module: code.slice(0, idx),
                    action: code.slice(idx + 1),
                    permission_code: code,
                  };
            }),
          );
    await db.execute(sql`
      update team_roles set power_list = ${payload}::jsonb, updated_at = now()
      where space_id = ${BigInt(spaceId)} and role_code = ${roleCode}
    `);
  }

  /** 角色 role_code → role_id（缺失的岗位先补行） */
  async function roleIdByCode(
    token: string,
    spaceId: string,
  ): Promise<Record<string, string>> {
    await ensureRole(spaceId, "producer");
    const res = await inject("GET", "/cam/role/list", undefined, token, spaceId);
    expect(res.code).toBe(0);
    const roles = (res.data as { list?: Array<{ id: string; role_code: string }> }).list ?? [];
    const map: Record<string, string> = {};
    for (const role of roles) map[role.role_code] = String(role.id);
    return map;
  }

  /** owner + 一个指定 role/role_code 的成员 + 团队空间 */
  async function setupTeamWithMember(
    tagOwner: string,
    tagMember: string,
    memberRole: number,
    memberRoleCode: string | null,
  ) {
    const owner = await loginNewUser(tagOwner);
    const member = await loginNewUser(tagMember);
    const teamSpaceId = await createTeam(owner, "权限拦截团队");
    await addMember(teamSpaceId, member.userId, memberRoleCode ?? "animator", memberRole);
    if (memberRoleCode === null) {
      // addMember 的默认 role_code 是 animator；要测"无岗位码"必须显式清掉
      await db.execute(sql`
        update space_members set role_code = null
        where space_id = ${BigInt(teamSpaceId)} and user_id = ${BigInt(member.userId)}
      `);
    }
    return { owner, member, teamSpaceId };
  }

  it("enforced 清单：正好 6 个码、与端点一一对应、且都在权限目录里", async () => {
    const { owner, teamSpaceId } = await setupTeamWithMember("41", "42", 3, "producer");

    const res = await inject("GET", "/cam/permissions", undefined, owner.token, teamSpaceId);
    expect(res.code).toBe(0);
    const data = res.data as {
      list: Array<{ code: string; enforced: boolean }>;
      enforced: Array<{ code: string; method: string; endpoint: string; note: string }>;
      enforced_count: number;
    };
    expect(data.enforced_count).toBe(6);
    expect(data.enforced.map((item) => item.code).sort()).toEqual([
      "member.create",
      "member.edit",
      "member.points",
      "member.remove",
      "team.edit",
      "team.permission",
    ]);
    // 每个 enforced 码必须真实存在于目录（否则前端矩阵无处显示"生效中"）
    const allCodes = new Set(data.list.map((entry) => entry.code));
    for (const item of data.enforced) expect(allCodes.has(item.code)).toBe(true);
    // 逐码布尔位：6 个 true，其余 false
    const byCode = new Map(data.list.map((entry) => [entry.code, entry.enforced]));
    for (const code of ["team.edit", "team.permission", "member.create", "member.remove", "member.edit", "member.points"]) {
      expect(byCode.get(code), code).toBe(true);
    }
    expect(byCode.get("project.view")).toBe(false);
    // 端点形状可直接对着 curl
    expect(data.enforced.find((item) => item.code === "team.edit")).toMatchObject({
      method: "PATCH",
      endpoint: "/v1/cam/team/info",
    });
  });

  /**
   * 第 100 批：只补「上一条没覆盖」的那一面 —— **note 字段**（前端 tooltip 依赖）
   * 与「两种读法全量自洽」。
   *
   * 背景：`enforced` / `enforced_count` 后端一直返回，但**前端 DTO 里没有、模板从不渲染**，
   * 页面还停在一句过期的「尚未接入接口级拦截」（实际 6 个码早就 403 了）。
   * 本批把前端接上（逐码标「已生效」+ 用 note 做 tooltip）；这个用例守的是
   * 「note 别哪天被删掉，导致 tooltip 空着」。
   */
  it("enforced 每条都要有可读 note（前端 tooltip 依赖），且两种读法全量自洽", async () => {
    const { owner, teamSpaceId } = await setupTeamWithMember("51", "52", 3, "producer");

    const res = await inject("GET", "/cam/permissions", undefined, owner.token, teamSpaceId);
    expect(res.code).toBe(0);
    const data = res.data as {
      list: Array<{ code: string; enforced?: boolean }>;
      enforced: Array<{ code: string; note: string }>;
      enforced_count: number;
    };

    // 1) note 非空且人类可读（前端 `<span :title="enforcedNote(code)">` 直接用它）
    for (const item of data.enforced) {
      expect(item.note.trim().length, `note missing for ${item.code}`).toBeGreaterThanOrEqual(6);
    }

    // 2) 顶层清单与逐条布尔位**全量**一致（不是只抽查几个码）——
    //    两种读法各说一套时，前端标「已生效」与运维按清单排查会得出不同结论
    const enforcedSet = new Set(data.enforced.map((e) => e.code));
    expect(enforcedSet.size).toBe(data.enforced_count);
    const mismatched = data.list.filter((row) => Boolean(row.enforced) !== enforcedSet.has(row.code));
    expect(mismatched.map((row) => row.code)).toEqual([]);

    // 3) 「只存不生效」的码确实存在 —— 否则「部分生效」这个 UI 文案就不成立
    expect(data.list.filter((row) => !row.enforced).length).toBeGreaterThan(0);
  });

  it("显式收紧：power_list 缺 member.remove / member.edit / member.points → 三个端点都 403101", async () => {
    const { owner, member, teamSpaceId } = await setupTeamWithMember("45", "46", 3, "producer");
    // 只给 team.edit，缺这三码 → 三个端点都应拒绝
    await setRolePowerList(teamSpaceId, "producer", ["team.edit"]);

    const remove = await inject(
      "DELETE",
      `/cam/team/member/${member.userId}`,
      undefined,
      member.token,
      teamSpaceId,
    );
    expect(remove.code).toBe(403101);
    expect(String(remove.msg)).toContain("member.remove");

    const patchMember = await inject(
      "PATCH",
      `/cam/team/member/${member.userId}`,
      { role: 3 },
      member.token,
      teamSpaceId,
    );
    expect(patchMember.code).toBe(403101);
    expect(String(patchMember.msg)).toContain("member.edit");

    const allocate = await inject(
      "POST",
      "/cam/team/points-allocation",
      { user_id: member.userId, credits: 10 },
      member.token,
      teamSpaceId,
    );
    expect(allocate.code).toBe(403101);
    expect(String(allocate.msg)).toContain("member.points");

    // owner 始终可（role_code=master 短路）：用 owner 打同一个分配端点应不是 403101
    const ownerAllocate = await inject(
      "POST",
      "/cam/team/points-allocation",
      { user_id: member.userId, credits: 1 },
      owner.token,
      teamSpaceId,
    );
    expect(ownerAllocate.code).not.toBe(403101);
  });

  it("默认放行①：owner（role=1/master）短路 —— 角色被限制也照样能改团队设置", async () => {
    const { owner, teamSpaceId } = await setupTeamWithMember("43", "44", 3, "producer");
    // 把 owner 的 master 角色写成空集合（模拟"被误配"），owner 仍应可
    await setRolePowerList(teamSpaceId, "master", []);
    const res = await inject(
      "PATCH",
      "/cam/team/info",
      { name: `owner-改-${Date.now()}` },
      owner.token,
      teamSpaceId,
    );
    expect(res.code, res.msg).toBe(0);
  });

  it("默认放行②：有岗位码但 power_list 未配置（null）→ 放行", async () => {
    const { member, teamSpaceId } = await setupTeamWithMember("45", "46", 3, "producer");
    await roleIdByCode(member.token, teamSpaceId); // 懒建角色行
    await setRolePowerList(teamSpaceId, "producer", null);
    const res = await inject(
      "PATCH",
      "/cam/team/info",
      { name: `未配置-${Date.now()}` },
      member.token,
      teamSpaceId,
    );
    expect(res.code, res.msg).toBe(0);
  });

  it("默认放行③：无岗位码的 admin（role=2）→ 放行", async () => {
    const { member, teamSpaceId } = await setupTeamWithMember("47", "48", 2, null);
    const res = await inject(
      "PATCH",
      "/cam/team/info",
      { name: `无岗位码-${Date.now()}` },
      member.token,
      teamSpaceId,
    );
    expect(res.code, res.msg).toBe(0);
  });

  it("显式收紧：power_list 里没有 team.edit → 403101，且 msg 带缺失码", async () => {
    const { member, teamSpaceId } = await setupTeamWithMember("51", "52", 3, "producer");
    await roleIdByCode(member.token, teamSpaceId);
    await setRolePowerList(teamSpaceId, "producer", ["team.view", "project.view"]);
    const res = await inject(
      "PATCH",
      "/cam/team/info",
      { name: `应被拒-${Date.now()}` },
      member.token,
      teamSpaceId,
    );
    expect(res.code).toBe(403101);
    expect(res.msg).toContain("team.edit");
  });

  it("放开即时生效：加回 team.edit → 200（不需要重启/清缓存）", async () => {
    const { member, teamSpaceId } = await setupTeamWithMember("53", "54", 3, "producer");
    await roleIdByCode(member.token, teamSpaceId);
    await setRolePowerList(teamSpaceId, "producer", ["team.view"]);
    const denied = await inject(
      "PATCH",
      "/cam/team/info",
      { name: "先拒" },
      member.token,
      teamSpaceId,
    );
    expect(denied.code).toBe(403101);

    await setRolePowerList(teamSpaceId, "producer", ["team.view", "team.edit"]);
    const allowed = await inject(
      "PATCH",
      "/cam/team/info",
      { name: `后放-${Date.now()}` },
      member.token,
      teamSpaceId,
    );
    expect(allowed.code, allowed.msg).toBe(0);
  });

  it("改角色权限矩阵需要 team.permission：缺 → 403101；给 → 200", async () => {
    const { member, teamSpaceId } = await setupTeamWithMember("55", "56", 3, "producer");
    const roles = await roleIdByCode(member.token, teamSpaceId);
    const roleId = roles.producer;
    expect(roleId).toBeTruthy();

    await setRolePowerList(teamSpaceId, "producer", ["team.view"]);
    const denied = await inject(
      "PUT",
      `/cam/roles/${roleId}/permissions`,
      { permissions: ["project.view"] },
      member.token,
      teamSpaceId,
    );
    expect(denied.code).toBe(403101);
    expect(denied.msg).toContain("team.permission");

    await setRolePowerList(teamSpaceId, "producer", ["team.view", "team.permission"]);
    const allowed = await inject(
      "PUT",
      `/cam/roles/${roleId}/permissions`,
      { permissions: ["project.view", "project.edit"] },
      member.token,
      teamSpaceId,
    );
    expect(allowed.code, allowed.msg).toBe(0);
    expect((allowed.data as { permissions: string[] }).permissions.sort()).toEqual([
      "project.edit",
      "project.view",
    ]);
  });

  it("邀请/批量加成员需要 member.create：缺 → 403101；给 → 200", async () => {
    const { member, teamSpaceId } = await setupTeamWithMember("57", "58", 3, "producer");
    const invitee = await loginNewUser("59");
    await roleIdByCode(member.token, teamSpaceId);

    await setRolePowerList(teamSpaceId, "producer", ["team.view"]);
    const denied = await inject(
      "POST",
      "/cam/team/member/batch",
      { members: [{ user_id: invitee.userId }] },
      member.token,
      teamSpaceId,
    );
    expect(denied.code).toBe(403101);
    expect(denied.msg).toContain("member.create");

    await setRolePowerList(teamSpaceId, "producer", ["team.view", "member.create"]);
    const allowed = await inject(
      "POST",
      "/cam/team/member/batch",
      { members: [{ user_id: invitee.userId }] },
      member.token,
      teamSpaceId,
    );
    expect(allowed.code, allowed.msg).toBe(0);
  });

  it("非成员访问 → 403101（L2 成员闸门先于权限码，且 msg 可区分）", async () => {
    const { teamSpaceId } = await setupTeamWithMember("61", "62", 3, "producer");
    const outsider = await loginNewUser("63");
    const res = await inject(
      "PATCH",
      "/cam/team/info",
      { name: "outsider" },
      outsider.token,
      teamSpaceId,
    );
    expect(res.code).toBe(403101);
    expect(res.msg).toContain("not a member");
  });

  it("历史脏码不影响已授权码判定（power_list 含目录外旧码也能通过）", async () => {
    const { member, teamSpaceId } = await setupTeamWithMember("64", "65", 3, "producer");
    await roleIdByCode(member.token, teamSpaceId);
    await setRolePowerList(teamSpaceId, "producer", ["legacy.unknown.code", "team.edit"]);
    const res = await inject(
      "PATCH",
      "/cam/team/info",
      { name: `脏码-${Date.now()}` },
      member.token,
      teamSpaceId,
    );
    expect(res.code, res.msg).toBe(0);
  });
});
