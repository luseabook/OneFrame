import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { sql } from "drizzle-orm";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { db } from "../src/db/database";

/**
 * 项目成员绑定（竞品 `/project-members`，第 132 批）的**落库**契约。
 *
 * 页面接线（`apps/web/pages/project-members.vue`）已经过 typecheck/build，但那只能证明
 * "按钮点了会发请求"，证明不了"绑定真的写进了 team_member_projects、解绑真的删掉了"。
 * 这三条端点是既有代码，此前没有用例直接覆盖，所以补一条最小闭环：
 *
 * 1. `POST /cam/project/:id/members/bind` → `GET .../members` 能看到同一行（含 participation_type）；
 * 2. `POST .../members/delete` → 同一行消失；
 * 3. 非本团队成员不能被绑定（`member not in this team`，400101）——跨空间串人是最危险的一种。
 *
 * 用真实 PG/Redis（与其它 e2e 同口径），不 mock 数据层。
 */
describe("project members binding e2e", () => {
  let app: NestFastifyApplication;
  let teamSpaceId = "";
  let projectId = "";
  let ownerToken = "";
  let memberUserId = "";
  let outsiderUserId = "";

  const inject = async (
    method: "GET" | "POST" | "DELETE",
    url: string,
    payload?: unknown,
    token?: string,
    spaceId?: string,
  ): Promise<{ code: number; msg?: string; data?: unknown }> => {
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;
    if (spaceId) headers["x-space-id"] = spaceId;
    const res = await app.inject({
      method,
      url: `/v1${url}`,
      headers,
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });
    return res.json() as { code: number; msg?: string; data?: unknown };
  };

  async function loginNewUser(prefix: string): Promise<{ token: string; userId: string }> {
    // ^1\d{10}$：1 + 时间戳后 8 位 + 两位前缀，避免用例之间撞号
    const tail = String(Date.now()).slice(-8);
    const tag = String(prefix).replace(/\D/g, "").slice(-2).padStart(2, "0");
    const phone = `1${tail}${tag}`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const code = (sms.data as { debug_code?: string } | undefined)?.debug_code ?? "";
    const login = await inject("POST", "/auth/login", { phone, code, age_confirmed: true });
    const data = login.data as { access_token?: string; user?: { id?: string } } | undefined;
    if (!data?.access_token) throw new Error(`login helper failed: ${JSON.stringify(login).slice(0, 200)}`);
    return { token: data.access_token, userId: String(data.user?.id ?? "") };
  }

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    await app.register(cookie as never);
    app.setGlobalPrefix("v1");
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const owner = await loginNewUser("01");
    ownerToken = owner.token;

    // 团队空间（ADR-010：团队 = spaces(type=2)，不另建表）+ owner 成员
    const idRow = (await db.execute(
      sql`select (extract(epoch from clock_timestamp())*1000000)::bigint as id`,
    )) as { rows?: Array<{ id: string }> };
    const base = BigInt(idRow.rows?.[0]?.id ?? Date.now());
    const teamId = base * 1000n + BigInt(Math.floor(Math.random() * 1000));
    teamSpaceId = String(teamId);
    await db.execute(sql`
      insert into spaces (id, owner_user_id, type, name, max_seats, status, agent_whitelist, film_enabled, created_at, updated_at)
      values (${teamId}, ${BigInt(owner.userId)}, 2, '项目成员测试团队', 5, 1, 0, 0, now(), now())
    `);
    await db.execute(sql`
      insert into credit_accounts (space_id, balance, frozen, updated_at)
      values (${teamId}, 0, 0, now())
      on conflict (space_id) do nothing
    `);
    await db.execute(sql`
      insert into space_members (space_id, user_id, role, credits_quota, status, role_code, created_at, updated_at)
      values (${teamId}, ${BigInt(owner.userId)}, 1, 0, 1, 'master', now(), now())
      on conflict (space_id, user_id) do update set role = 1, role_code = 'master', status = 1
    `);

    // 团队空间里的项目（用真实端点创建，避免手写表结构漂移）
    const created = await inject(
      "POST",
      "/projects",
      { title: "项目成员绑定测试", drama_type: 1, ratio: "9:16", source_type: 2, source_text: "" },
      ownerToken,
      teamSpaceId,
    );
    projectId = String((created.data as { id?: string } | undefined)?.id ?? "");
    if (!projectId) throw new Error(`create project failed: ${JSON.stringify(created).slice(0, 300)}`);

    // 团队成员（直接落库，避免邀请/发码链拖慢本节）
    const member = await loginNewUser("02");
    memberUserId = member.userId;
    await db.execute(sql`
      insert into space_members (space_id, user_id, role, credits_quota, status, role_code, created_at, updated_at)
      values (${teamId}, ${BigInt(memberUserId)}, 3, 0, 1, 'member', now(), now())
      on conflict (space_id, user_id) do update set role = 3, role_code = 'member', status = 1
    `);

    // 另一个用户（不属于该团队），用于跨空间拒绝用例
    outsiderUserId = (await loginNewUser("03")).userId;
  }, 90_000);

  afterAll(async () => {
    // 只清绑定与成员行；团队空间/项目留给库（删除 spaces 会牵动 credit_accounts/
    // script_projects 等一串 FK，清理成本高于收益，其它 e2e 同样保留夹具数据）。
    if (teamSpaceId) {
      await db.execute(sql`delete from team_member_projects where space_id = ${BigInt(teamSpaceId)}`);
      await db.execute(sql`delete from space_members where space_id = ${BigInt(teamSpaceId)}`);
    }
    await app.close();
  });

  it("绑定 → 列表可见（participation_type 落库）→ 解绑 → 列表消失", async () => {
    const bind = await inject(
      "POST",
      `/cam/project/${projectId}/members/bind`,
      { user_id: memberUserId, project_kind: 1, participation_type: 2 },
      ownerToken,
      teamSpaceId,
    );
    expect(bind.code).toBe(0);

    const list1 = await inject("GET", `/cam/project/${projectId}/members`, undefined, ownerToken, teamSpaceId);
    expect(list1.code).toBe(0);
    const rows1 = (list1.data as { list: Array<Record<string, unknown>> }).list;
    const hit = rows1.find((r) => String(r.user_id) === memberUserId && String(r.project_id) === projectId);
    expect(hit, `绑定行未出现在列表中：${JSON.stringify(rows1).slice(0, 300)}`).toBeTruthy();
    expect(Number(hit?.project_kind)).toBe(1);
    expect(Number(hit?.participation_type)).toBe(2);

    const unbind = await inject(
      "POST",
      `/cam/project/${projectId}/members/delete`,
      { user_id: memberUserId, project_kind: 1 },
      ownerToken,
      teamSpaceId,
    );
    expect(unbind.code).toBe(0);

    const list2 = await inject("GET", `/cam/project/${projectId}/members`, undefined, ownerToken, teamSpaceId);
    const rows2 = (list2.data as { list: Array<Record<string, unknown>> }).list;
    expect(rows2.some((r) => String(r.user_id) === memberUserId && String(r.project_id) === projectId)).toBe(false);
  });

  it("重复绑定幂等（唯一索引 + onConflictDoUpdate，不产生两行）", async () => {
    for (let i = 0; i < 2; i += 1) {
      const res = await inject(
        "POST",
        `/cam/project/${projectId}/members/bind`,
        { user_id: memberUserId, project_kind: 1, participation_type: 1 },
        ownerToken,
        teamSpaceId,
      );
      expect(res.code).toBe(0);
    }
    const list = await inject("GET", `/cam/project/${projectId}/members`, undefined, ownerToken, teamSpaceId);
    const rows = (list.data as { list: Array<Record<string, unknown>> }).list.filter(
      (r) => String(r.user_id) === memberUserId && String(r.project_id) === projectId,
    );
    expect(rows.length).toBe(1);
  });

  it("非本团队成员不能被绑定（跨空间串人 → 400101）", async () => {
    const res = await inject(
      "POST",
      `/cam/project/${projectId}/members/bind`,
      { user_id: outsiderUserId, project_kind: 1, participation_type: 1 },
      ownerToken,
      teamSpaceId,
    );
    expect(res.code).toBe(400101);
    expect(res.msg ?? "").toContain("member");
  });
});