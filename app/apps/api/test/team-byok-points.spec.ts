import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { sql } from "drizzle-orm";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { db, pool } from "../src/db/database";

/**
 * 团队域三块「参照有、我方第 79 批补上」的能力（F1 §12.3 / §14.5）：
 *
 * 1. **BYOK 第三方 Key**（`cam/user/third/key/*`，5 条）—— 表 `user_third_keys`
 *    早在迁移 0013 就建了，但全仓只有 `tempInfo` 读过一次计数，**没有写入口**。
 * 2. **项目关联用户**（`GET cam/linked-users`）—— 数据源是成员↔项目绑定，不是在线名单。
 * 3. **项目维度积分**（`cam/team/project-points-flow/*` + `project-points-ranking`）——
 *    消耗流水只记到任务，项目维度要靠 `tasks.episode_id → episodes.project_id` 反查。
 *
 * 三条测试红线（错了会静默腐化）：
 * - BYOK **明文永不回传**，且**只能看自己的**（管理员也不行）；
 * - 项目维度只算 `kind='settle'`（冻结/解冻/回收是同一笔钱的不同阶段）；
 * - 反查不到项目的消耗**保留**（`project_id=null`），不丢——丢了账就对不上。
 */
describe("team byok / linked-users / project points (cam e2e)", () => {
  let app: NestFastifyApplication;
  let seq = 0;
  const teamSpaceIds: bigint[] = [];
  const touchedSpaceIds: bigint[] = [];
  const touchedUserIds: bigint[] = [];

  /** 自增 id：`Date.now()*1000 + seq`，同一毫秒内也不会撞 */
  const mkId = (): bigint => {
    seq += 1;
    return BigInt(Date.now()) * 1000n + BigInt(seq);
  };

  const inject = async (
    method: string,
    url: string,
    payload?: unknown,
    authToken?: string,
    spaceId?: string,
  ) => {
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (authToken) headers.authorization = `Bearer ${authToken}`;
    if (spaceId) headers["x-space-id"] = spaceId;
    const res = await app.inject({
      method: method as "GET" | "POST" | "PATCH" | "DELETE",
      url: `/v1${url}`,
      headers,
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = JSON.parse(res.body) as { code: number; msg: string; data?: unknown };
    return { status: res.statusCode, code: body.code, msg: body.msg, data: body.data as never, raw: res.body };
  };

  async function loginNewUser(
    prefix: string,
  ): Promise<{ token: string; spaceId: string; userId: string; phone: string }> {
    const tail = String(Date.now()).slice(-8);
    const tag = String(prefix).replace(/\D/g, "").slice(-2).padStart(2, "0");
    const phone = `1${tail}${tag}`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const code = (sms.data as { debug_code?: string } | undefined)?.debug_code as string;
    const login = await inject("POST", "/auth/login", { phone, code, age_confirmed: true });
    const data = login.data as { access_token?: string; space_id?: string; user?: { id?: string } };
    const token = data?.access_token as string;
    const spaceId = String(data?.space_id ?? "");
    const userId = String(data?.user?.id ?? "");
    if (!token || !userId || userId === "undefined") {
      throw new Error(`login helper: bad body=${login.raw.slice(0, 200)}`);
    }
    touchedSpaceIds.push(BigInt(spaceId));
    touchedUserIds.push(BigInt(userId));
    return { token, spaceId, userId, phone };
  }

  /** 建团队空间（spaces.type=2）+ owner 成员 + 已注资的账户（同 team.spec 口径） */
  async function createTeamSpace(ownerUserId: string): Promise<bigint> {
    const teamId = mkId();
    await db.execute(sql`
      insert into spaces (id, owner_user_id, type, name, max_seats, status, agent_whitelist, film_enabled, created_at, updated_at)
      values (${teamId}, ${BigInt(ownerUserId)}, 2, '测试团队', 5, 1, 0, 0, now(), now())
    `);
    await db.execute(sql`
      insert into credit_accounts (space_id, balance, frozen, updated_at)
      values (${teamId}, 1000, 0, now())
      on conflict (space_id) do update set balance = 1000, frozen = 0, updated_at = now()
    `);
    await db.execute(sql`
      insert into space_members (space_id, user_id, role, credits_quota, status, role_code, created_at, updated_at)
      values (${teamId}, ${BigInt(ownerUserId)}, 1, 0, 1, 'master', now(), now())
      on conflict (space_id, user_id) do update set role = 1, role_code = 'master', status = 1
    `);
    teamSpaceIds.push(teamId);
    return teamId;
  }

  /** 往团队里塞一个成员（绕过邀请流程，只为造编制表） */
  async function addMemberRow(spaceId: bigint, userId: string, roleCode = "animator") {
    await db.execute(sql`
      insert into space_members (space_id, user_id, role, credits_quota, status, role_code, nickname, created_at, updated_at)
      values (${spaceId}, ${BigInt(userId)}, 3, 0, 1, ${roleCode}, '小王', now(), now())
      on conflict (space_id, user_id) do update set role_code = ${roleCode}, nickname = '小王', status = 1
    `);
  }

  async function createProject(spaceId: bigint, title: string): Promise<bigint> {
    const pid = mkId();
    await db.execute(sql`
      insert into script_projects (id, space_id, title, ratio, source_type, created_at, updated_at)
      values (${pid}, ${spaceId}, ${title}, '9:16', 1, now(), now())
    `);
    return pid;
  }

  async function createEpisode(projectId: bigint, epNo: number): Promise<bigint> {
    const eid = mkId();
    await db.execute(sql`
      insert into episodes (id, project_id, ep_no, title, status, created_at, updated_at)
      values (${eid}, ${projectId}, ${epNo}, ${`第${epNo}集`}, 1, now(), now())
    `);
    return eid;
  }

  /** 造一条成功任务（`tasks` 有 models 外键，必须先取一个真实模型） */
  async function createTask(spaceId: bigint, userId: string, episodeId: bigint | null): Promise<bigint> {
    const tid = mkId();
    await db.execute(sql`
      insert into tasks (id, space_id, user_id, episode_id, capability, mode, model_id, input, options, status, created_at, updated_at)
      values (
        ${tid}, ${spaceId}, ${BigInt(userId)}, ${episodeId}, 'text_to_image', 'single',
        (select id from models order by id limit 1), '{}'::jsonb, '{}'::jsonb, 3, now(), now()
      )
    `);
    return tid;
  }

  async function addFlow(row: {
    spaceId: bigint;
    delta: number;
    kind: string;
    refTaskId?: bigint | null;
    opUserId?: string | null;
    createdAt?: Date;
  }) {
    await db.execute(sql`
      insert into credit_flows (id, space_id, delta, frozen_delta, kind, ref_task_id, op_user_id, balance_after, memo, created_at)
      values (${mkId()}, ${row.spaceId}, ${row.delta}, 0, ${row.kind}, ${row.refTaskId ?? null},
              ${row.opUserId ? BigInt(row.opUserId) : null}, 0, 'spec', ${row.createdAt ?? new Date()})
    `);
  }

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter({ trustProxy: true }),
      { logger: false },
    );
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 90_000);

  afterAll(async () => {
    /**
     * 清理是**尽力而为**：登录时可能自动 seed 了示例项目（带 project_assets /
     * 分镜等子行），这里按遇到的第一个外键约束就跳过更好——测试失败时不该再
     * 抛出第二个无关错误把真正的断言失败盖掉。
     */
    const quiet = async (q: ReturnType<typeof sql>) => {
      try {
        await db.execute(q);
      } catch {
        /* 清理阶段忽略外键约束 */
      }
    };
    for (const spaceId of [...teamSpaceIds, ...touchedSpaceIds]) {
      await quiet(sql`delete from credit_flows where space_id = ${spaceId}`);
      await quiet(sql`delete from tasks where space_id = ${spaceId}`);
      await quiet(sql`delete from project_assets where project_id in (select id from script_projects where space_id = ${spaceId})`);
      await quiet(sql`delete from episodes where project_id in (select id from script_projects where space_id = ${spaceId})`);
      await quiet(sql`delete from script_projects where space_id = ${spaceId}`);
      await quiet(sql`delete from team_member_projects where space_id = ${spaceId}`);
      await quiet(sql`delete from space_members where space_id = ${spaceId}`);
      await quiet(sql`delete from user_third_keys where space_id = ${spaceId}`);
    }
    for (const spaceId of teamSpaceIds) {
      await quiet(sql`delete from credit_accounts where space_id = ${spaceId}`);
      await quiet(sql`delete from spaces where id = ${spaceId}`);
    }
    await app.close();
    await pool.end().catch(() => {});
  }, 90_000);

  it("BYOK：只回自己的 Key、明文永不回传、重复 key 拒绝、坏 id 是 400101", async () => {
    const a = await loginNewUser("81");
    const b = await loginNewUser("82");
    const plain = `sk-live-${Date.now()}-abcdefghijklmn`;

    // 初始为空
    const empty = await inject("GET", "/cam/user/third/key/list", undefined, a.token, a.spaceId);
    expect(empty.status).toBe(200);
    expect((empty.data as { list: unknown[] }).list).toHaveLength(0);

    const created = await inject(
      "POST",
      "/cam/user/third/key/add",
      { provider: "openai", label: "主力号", api_key: plain },
      a.token,
      a.spaceId,
    );
    expect(created.status).toBe(201);
    const key = (created.data as { third_key: Record<string, unknown> }).third_key;
    expect(key.provider).toBe("openai");
    expect(key.label).toBe("主力号");
    expect(key.status).toBe(1);
    // 打码，且响应体里绝不出现明文
    expect(String(key.api_key_masked)).toMatch(/^sk-l…klmn$/);
    expect(created.raw.includes(plain)).toBe(false);

    // 列表 / 详情
    const list = await inject("GET", "/cam/user/third/key/list", undefined, a.token, a.spaceId);
    expect((list.data as { list: unknown[] }).list).toHaveLength(1);
    const info = await inject("GET", `/cam/user/third/key/${key.id}/info`, undefined, a.token, a.spaceId);
    expect((info.data as { third_key: { id: string } }).third_key.id).toBe(key.id);

    // 同一把 key 再配一次 → 400101 且指到 api_key
    const dup = await inject(
      "POST",
      "/cam/user/third/key/add",
      { provider: "openai", api_key: plain },
      a.token,
      a.spaceId,
    );
    expect(dup.code).toBe(400101);
    expect(dup.msg).toContain("already registered");

    // 换 provider 存同一把 key 是允许的（不同供应商各自一把）
    const otherProvider = await inject(
      "POST",
      "/cam/user/third/key/add",
      { provider: "volc", api_key: plain },
      a.token,
      a.spaceId,
    );
    expect(otherProvider.status).toBe(201);

    // 编辑：备注清空 + 停用
    const updated = await inject(
      "PUT",
      `/cam/user/third/key/${key.id}/update`,
      { label: null, status: 2 },
      a.token,
      a.spaceId,
    );
    const updatedKey = (updated.data as { third_key: Record<string, unknown> }).third_key;
    expect(updatedKey.label).toBe("");
    expect(updatedKey.status).toBe(2);

    // 别人看不到（各自 space 各看各的）
    const otherList = await inject("GET", "/cam/user/third/key/list", undefined, b.token, b.spaceId);
    expect((otherList.data as { list: unknown[] }).list).toHaveLength(0);
    const otherInfo = await inject("GET", `/cam/user/third/key/${key.id}/info`, undefined, b.token, b.spaceId);
    expect(otherInfo.code).toBe(400102);

    // 坏 id / 不存在
    const badId = await inject("GET", "/cam/user/third/key/abc/info", undefined, a.token, a.spaceId);
    expect(badId.code).toBe(400101);
    expect(badId.msg).toContain("invalid id");
    const missing = await inject(
      "GET",
      "/cam/user/third/key/999999999999999999/info",
      undefined,
      a.token,
      a.spaceId,
    );
    expect(missing.code).toBe(400102);

    // 删掉后列表空、再查 400102
    const del = await inject("DELETE", `/cam/user/third/key/${key.id}/delete`, undefined, a.token, a.spaceId);
    expect((del.data as { deleted: boolean }).deleted).toBe(true);
    const afterDelete = await inject("GET", `/cam/user/third/key/${key.id}/info`, undefined, a.token, a.spaceId);
    expect(afterDelete.code).toBe(400102);
  });

  it("linked-users：按项目过滤，读的是成员↔项目编制表而不是登录态", async () => {
    const owner = await loginNewUser("83");
    const member = await loginNewUser("84");
    const teamSpaceId = await createTeamSpace(owner.userId);
    await addMemberRow(teamSpaceId, member.userId);

    const projectA = await createProject(teamSpaceId, "关联用户剧A");
    const projectB = await createProject(teamSpaceId, "关联用户剧B");

    // 绑定（走真端点，owner 是 master 有特权）
    const bind = await inject(
      "POST",
      `/cam/project/${projectA}/members/bind`,
      { user_id: member.userId, project_kind: 1, project_id: String(projectA), participation_type: 1 },
      owner.token,
      String(teamSpaceId),
    );
    expect(bind.status).toBe(201);

    const all = await inject("GET", "/cam/linked-users", undefined, owner.token, String(teamSpaceId));
    const allData = all.data as { list: Array<Record<string, unknown>>; user_count: number; total: number };
    expect(allData.total).toBe(1);
    expect(allData.user_count).toBe(1);
    expect(allData.list[0].user_id).toBe(member.userId);
    expect(allData.list[0].project_id).toBe(String(projectA));
    expect(allData.list[0].project_title).toBe("关联用户剧A");
    expect(allData.list[0].nickname).toBe("小王"); // 团队内备注优先于全局昵称

    const byProjectA = await inject(
      "GET",
      `/cam/linked-users?sp_id=${projectA}`,
      undefined,
      owner.token,
      String(teamSpaceId),
    );
    expect((byProjectA.data as { total: number }).total).toBe(1);

    const byProjectB = await inject(
      "GET",
      `/cam/linked-users?sp_id=${projectB}`,
      undefined,
      owner.token,
      String(teamSpaceId),
    );
    expect((byProjectB.data as { total: number }).total).toBe(0);

    const badProject = await inject(
      "GET",
      "/cam/linked-users?sp_id=abc",
      undefined,
      owner.token,
      String(teamSpaceId),
    );
    expect(badProject.code).toBe(400101);
    expect(badProject.msg).toContain("invalid sp_id");
  });

  it("成员凭据：只回打码登录方式，并诚实说明没有子账号密码", async () => {
    const owner = await loginNewUser("88");
    const member = await loginNewUser("89");
    const teamSpaceId = await createTeamSpace(owner.userId);
    await addMemberRow(teamSpaceId, member.userId);

    const res = await inject(
      "GET",
      `/cam/team/member/${member.userId}/credential`,
      undefined,
      owner.token,
      String(teamSpaceId),
    );
    const data = res.data as {
      user_id: string;
      has_password: boolean;
      can_reset_password: boolean;
      login_methods: Array<{ provider: string; account_masked: string | null }>;
    };
    expect(data.user_id).toBe(member.userId);
    expect(data.has_password).toBe(false);
    expect(data.can_reset_password).toBe(false);
    expect(data.login_methods[0].provider).toBe("phone");
    expect(String(data.login_methods[0].account_masked)).toMatch(/^\d{3}\*{4}\d{4}$/);
    // 打码之外不出现完整手机号（响应体里不该有该账号的明文手机号）
    expect(res.raw.includes(member.phone)).toBe(false);
    expect(res.raw.includes(`*${member.phone.slice(-4)}`)).toBe(true);

    // 不是本团队成员 → 400102（不告诉"这个人存在但不在你团队"）
    const outsider = await loginNewUser("90");
    const notMember = await inject(
      "GET",
      `/cam/team/member/${outsider.userId}/credential`,
      undefined,
      owner.token,
      String(teamSpaceId),
    );
    expect(notMember.code).toBe(400102);

    // 坏 id → 400101
    const bad = await inject(
      "GET",
      "/cam/team/member/abc/credential",
      undefined,
      owner.token,
      String(teamSpaceId),
    );
    expect(bad.code).toBe(400101);
    expect(bad.msg).toContain("invalid member_id");
  });

  it("项目维度积分：只算 settle，按任务反查项目，归不上的保留为 null", async () => {
    const user = await loginNewUser("85");
    const spaceId = BigInt(user.spaceId);
    await db.execute(sql`update users set nickname = '积分小白' where id = ${BigInt(user.userId)}`);

    const project = await createProject(spaceId, "积分剧A");
    const episode = await createEpisode(project, 1);
    const taskInProject = await createTask(spaceId, user.userId, episode);
    const taskNoEpisode = await createTask(spaceId, user.userId, null);

    await addFlow({ spaceId, delta: -30, kind: "settle", refTaskId: taskInProject, opUserId: user.userId });
    await addFlow({ spaceId, delta: -20, kind: "settle", refTaskId: taskNoEpisode, opUserId: user.userId });
    // 这三种都不该进项目消耗
    await addFlow({ spaceId, delta: 100, kind: "recharge", opUserId: user.userId });
    await addFlow({ spaceId, delta: 0, kind: "freeze", refTaskId: taskInProject, opUserId: user.userId });
    await addFlow({ spaceId, delta: 0, kind: "unfreeze", refTaskId: taskInProject, opUserId: user.userId });

    const list = await inject("GET", "/cam/team/project-points-flow/list", undefined, user.token, user.spaceId);
    const data = list.data as {
      list: Array<{ points: number; project_id: string | null; project_title: string | null; op_user_name: string | null }>;
      total: number;
    };
    expect(data.total).toBe(2);
    expect(data.list.map((r) => r.points).sort((x, y) => x - y)).toEqual([20, 30]);
    const attributed = data.list.find((r) => r.points === 30)!;
    expect(attributed.project_id).toBe(String(project));
    expect(attributed.project_title).toBe("积分剧A");
    expect(attributed.op_user_name).toBe("积分小白");
    const unattributed = data.list.find((r) => r.points === 20)!;
    expect(unattributed.project_id).toBeNull();
    expect(unattributed.project_title).toBeNull();

    // 时间过滤（未来起点 → 空）
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const empty = await inject(
      "GET",
      `/cam/team/project-points-flow/list?create_time_start=${encodeURIComponent(future)}`,
      undefined,
      user.token,
      user.spaceId,
    );
    expect((empty.data as { total: number }).total).toBe(0);

    // 操作人姓名过滤
    const byName = await inject(
      "GET",
      `/cam/team/project-points-flow/list?op_user_name=${encodeURIComponent("积分")}`,
      undefined,
      user.token,
      user.spaceId,
    );
    expect((byName.data as { total: number }).total).toBe(2);
    const byOtherName = await inject(
      "GET",
      "/cam/team/project-points-flow/list?op_user_name=nobody-here",
      undefined,
      user.token,
      user.spaceId,
    );
    expect((byOtherName.data as { total: number }).total).toBe(0);

    // 分页：page_size=1 只回 1 行，total 仍是 2
    const paged = await inject(
      "GET",
      "/cam/team/project-points-flow/list?page=1&page_size=1",
      undefined,
      user.token,
      user.spaceId,
    );
    const pagedData = paged.data as { list: unknown[]; total: number };
    expect(pagedData.list).toHaveLength(1);
    expect(pagedData.total).toBe(2);
  });

  it("项目消耗排行：按项目聚合，归不上的单独一档（project_id=null）", async () => {
    const user = await loginNewUser("86");
    const spaceId = BigInt(user.spaceId);
    const project = await createProject(spaceId, "排行剧A");
    const episode = await createEpisode(project, 1);
    const t1 = await createTask(spaceId, user.userId, episode);
    const t2 = await createTask(spaceId, user.userId, episode);
    const t3 = await createTask(spaceId, user.userId, null);
    await addFlow({ spaceId, delta: -40, kind: "settle", refTaskId: t1, opUserId: user.userId });
    await addFlow({ spaceId, delta: -10, kind: "settle", refTaskId: t2, opUserId: user.userId });
    await addFlow({ spaceId, delta: -25, kind: "settle", refTaskId: t3, opUserId: user.userId });

    const res = await inject("POST", "/cam/team/project-points-ranking", { limit: 10 }, user.token, user.spaceId);
    const list = (res.data as { list: Array<{ rank: number; project_id: string | null; points: number; flow_count: number }> })
      .list;
    expect(list).toHaveLength(2);
    expect(list[0].rank).toBe(1);
    expect(list[0].project_id).toBe(String(project));
    expect(list[0].points).toBe(50);
    expect(list[0].flow_count).toBe(2);
    expect(list[1].project_id).toBeNull();
    expect(list[1].points).toBe(25);

    // limit 生效
    const limited = await inject("POST", "/cam/team/project-points-ranking", { limit: 1 }, user.token, user.spaceId);
    expect((limited.data as { list: unknown[] }).list).toHaveLength(1);

    // 坏 body（limit 超范围）→ zod 400101
    const bad = await inject("POST", "/cam/team/project-points-ranking", { limit: 999 }, user.token, user.spaceId);
    expect(bad.code).toBe(400101);
  });

  it("项目消耗导出：CSV 现签链接，行数与筛选一致", async () => {
    const user = await loginNewUser("87");
    const spaceId = BigInt(user.spaceId);
    const project = await createProject(spaceId, "导出剧A");
    const episode = await createEpisode(project, 1);
    const task = await createTask(spaceId, user.userId, episode);
    await addFlow({ spaceId, delta: -12, kind: "settle", refTaskId: task, opUserId: user.userId });
    await addFlow({ spaceId, delta: -8, kind: "settle", refTaskId: null, opUserId: user.userId });

    const res = await inject("GET", "/cam/team/project-points-flow/export", undefined, user.token, user.spaceId);
    const data = res.data as { file_uri: string; filename: string; expires_at: string; row_count: number };
    expect(data.row_count).toBe(2);
    expect(data.filename).toMatch(/^project-points-flow-\d+\.csv$/);
    expect(data.file_uri.length).toBeGreaterThan(10);
    expect(new Date(data.expires_at).getTime()).toBeGreaterThan(Date.now());
  });
});
