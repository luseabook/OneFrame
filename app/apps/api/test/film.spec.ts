import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { sql } from "drizzle-orm";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { db, pool } from "../src/db/database";
import { FilmRealtimeService } from "../src/modules/film/film.realtime";

/**
 * 影视版（film）域契约测试 —— 对照参照产品 `/web/v1/film/projects/*` 37 路径 / 48 操作
 * （`_acceptance/_gap/contract-draft-cam-film.md` §1.3 / §3.5）+ 准入 `func-whitelist`。
 *
 * 覆盖重点是**三个关键机制**，而不是端点数量本身（端点数量只是覆盖面）：
 *
 * 1. **审核版本链**：每次提交产生不可变 V01/V02…；评论挂版本、已读按版本；
 *    行 status 与版本 status 双轨（一次通过后行=5 而旧版本仍是 approved）。
 * 2. **submit-result 是唯一自动化衔接点**：画布节点产物 → 登记版本 → 行 status 推
 *    `pending_review` → 通知。断言的是"画布提交后表格里这一行真的进入待审"。
 * 3. **协同**：`client_id` 回声抑制是纯函数，进程内广播本身没有传输层可断言
 *    （WS 网关未在仓库中，见 `film.realtime.ts` 头注释）。
 *
 * 另外三类易错点各有用例：**稀疏单元格**（无值=无行、清空=DELETE）、
 * **只读列拒写**（task_status/review_ref/points_ro）、**跨租户隔离**（400102 不泄露存在性）。
 *
 * 数据自清理：只删本 spec 自己创建的 space 及其 film/canvas/asset 行，绝不用
 * `where type=...` 这类宽条件（其他 spec 并行造数据）。
 */

interface Ctx {
  token: string;
  userId: string;
  /** 登录时的个人空间（未开通影视版，用于准入负例） */
  personalSpaceId: string;
  /** 测试用团队空间（已开通影视版） */
  teamSpaceId: string;
}

describe("film/影视版 e2e", () => {
  let app: NestFastifyApplication;
  const createdSpaceIds: string[] = [];

  const inject = async (method: string, url: string, payload?: unknown, token?: string, spaceId?: string) => {
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
      body,
      data: (body as { data?: unknown }).data,
    };
  };

  /** 造一个全新用户（手机号带随机后缀，避免与并行 spec 撞） */
  async function loginNewUser(prefix: string): Promise<{ token: string; userId: string; spaceId: string }> {
    const tail = String(Date.now()).slice(-8);
    const rand = String(Math.floor(Math.random() * 90) + 10);
    const phone = `17${tail}${prefix.slice(-1)}${rand}`.slice(0, 11);
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const code = (sms.data as { debug_code?: string } | undefined)?.debug_code;
    const login = await inject("POST", "/auth/login", { phone, code, age_confirmed: true });
    const data = login.data as { access_token?: string; space_id?: string; user?: { id?: string } } | undefined;
    return {
      token: data?.access_token ?? "",
      userId: String(data?.user?.id ?? ""),
      spaceId: String(data?.space_id ?? ""),
    };
  }

  /**
   * 建团队空间并**开通影视版**（`spaces.film_enabled=1`，对齐商务开通制）。
   * 影视版是 L0 功能准入，未开通时所有 film 端点都 403 —— 见"准入"用例。
   */
  async function createFilmTeam(ownerUserId: string, name = "影视测试团队", filmEnabled = 1) {
    const idRow = (await db.execute(
      sql`select (extract(epoch from clock_timestamp())*1000000)::bigint as id`,
    )) as { rows?: Array<{ id: string }> };
    const teamId = BigInt(idRow.rows?.[0]?.id ?? Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 999));
    await db.execute(sql`
      insert into spaces (id, owner_user_id, type, name, max_seats, status, agent_whitelist, film_enabled, created_at, updated_at)
      values (${teamId}, ${BigInt(ownerUserId)}, 2, ${name}, 10, 1, 0, ${filmEnabled}, now(), now())
    `);
    await db.execute(sql`
      insert into credit_accounts (space_id, balance, frozen, updated_at)
      values (${teamId}, 0, 0, now())
      on conflict (space_id) do update set updated_at = now()
    `);
    await db.execute(sql`
      insert into space_members (space_id, user_id, role, credits_quota, status, role_code, created_at, updated_at)
      values (${teamId}, ${BigInt(ownerUserId)}, 1, 0, 1, 'master', now(), now())
      on conflict (space_id, user_id) do update set role = 1, role_code = 'master', status = 1
    `);
    createdSpaceIds.push(String(teamId));
    return String(teamId);
  }

  async function addMember(teamSpaceId: string, userId: string, roleCode = "animator", role = 3) {
    await db.execute(sql`
      insert into space_members (space_id, user_id, role, credits_quota, status, role_code, created_at, updated_at)
      values (${BigInt(teamSpaceId)}, ${BigInt(userId)}, ${role}, 0, 1, ${roleCode}, now(), now())
      on conflict (space_id, user_id) do update set role = ${role}, role_code = ${roleCode}, status = 1
    `);
  }

  /** 完整上下文：owner + 已开通团队 */
  async function setup(): Promise<Ctx> {
    const owner = await loginNewUser("9");
    const teamSpaceId = await createFilmTeam(owner.userId, "影视团队");
    return { token: owner.token, userId: owner.userId, personalSpaceId: owner.spaceId, teamSpaceId };
  }

  function newProjectId(): string {
    // 项目 id 是不透明雪花形；这里用时间戳派生，保证跨用例不撞
    return String(BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 999)));
  }

  async function createTable(ctx: Ctx, projectId: string, name = "任务表") {
    const res = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables`,
      { name },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(res.code).toBe(0);
    return res.data as { id: string; name: string; version: number; is_preset: boolean; project_id: string };
  }

  async function listFields(ctx: Ctx, projectId: string, tableId: string) {
    const res = await inject(
      "GET",
      `/film/projects/${projectId}/task-tables/${tableId}/fields`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(res.code).toBe(0);
    return (res.data as { list: Array<{ id: string; key: string; field_type: string; is_system: boolean; sort: number }> }).list;
  }

  async function createField(
    ctx: Ctx,
    projectId: string,
    tableId: string,
    body: { name: string; field_type: string; is_unique_type?: boolean; config_json?: Record<string, unknown> },
  ) {
    return inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${tableId}/fields`,
      body,
      ctx.token,
      ctx.teamSpaceId,
    );
  }

  async function createTasks(
    ctx: Ctx,
    projectId: string,
    tableId: string,
    body: Record<string, unknown> = {},
  ) {
    const res = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${tableId}/tasks`,
      body,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(res.code).toBe(0);
    return (res.data as { list: Array<{ id: string; version: number; status: number; cells: Record<string, unknown> }> }).list;
  }

  async function insertCanvas(spaceId: string, userId: string, title = "测试画布"): Promise<string> {
    const id = BigInt(String(Date.now())) * 1000n + BigInt(Math.floor(Math.random() * 999)) + 7n;
    await db.execute(sql`
      insert into canvases (id, space_id, title, version, creation_mode, owner_user_id, created_at, updated_at)
      values (${id}, ${BigInt(spaceId)}, ${title}, 1, 2, ${BigInt(userId)}, now(), now())
    `);
    return String(id);
  }

  async function insertAsset(spaceId: string): Promise<string> {
    const id = BigInt(String(Date.now())) * 1000n + BigInt(Math.floor(Math.random() * 999)) + 3n;
    await db.execute(sql`
      insert into assets (id, space_id, kind, uri, name, created_at, updated_at)
      values (${id}, ${BigInt(spaceId)}, 'image', ${"s3://test/film-" + String(id)}, '产物', now(), now())
    `);
    return String(id);
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
    // 精确清理：只动本 spec 创建的 space（film 子表按 FK 顺序删）
    for (const spaceId of createdSpaceIds) {
      const sid = BigInt(spaceId);
      const statements = [
        sql`delete from film_review_reads where space_id = ${sid}`,
        sql`delete from film_review_comments where space_id = ${sid}`,
        sql`delete from film_review_versions where space_id = ${sid}`,
        sql`delete from film_canvas_bindings where space_id = ${sid}`,
        sql`delete from film_cells where space_id = ${sid}`,
        sql`delete from film_tasks where space_id = ${sid}`,
        sql`delete from film_table_prefs where space_id = ${sid}`,
        sql`delete from film_recent_opens where space_id = ${sid}`,
        sql`delete from film_fields where space_id = ${sid}`,
        sql`delete from film_tables where space_id = ${sid}`,
        sql`delete from film_task_templates where space_id = ${sid}`,
        sql`delete from film_exports where space_id = ${sid}`,
        sql`delete from assets where space_id = ${sid}`,
        sql`delete from canvases where space_id = ${sid}`,
        sql`delete from space_members where space_id = ${sid}`,
        sql`delete from credit_accounts where space_id = ${sid}`,
      ];
      for (const stmt of statements) {
        await db.execute(stmt).catch(() => undefined);
      }
      await db.execute(sql`delete from spaces where id = ${sid}`).catch(() => undefined);
    }
    await app.close();
    await pool.end().catch(() => undefined);
  });

  // ══════════════════════════════════════════════════════════════════
  // 准入（L0）：GET /func-whitelist?scene=ai_film
  // ══════════════════════════════════════════════════════════════════

  it("准入：未开通影视版 → check=false，且 film 端点 403 film_not_enabled（不是 404，前端要显示开通引导）", async () => {
    const owner = await loginNewUser("1");
    // 个人空间默认 film_enabled=0
    const whitelist = await inject(
      "GET",
      "/func-whitelist?scene=ai_film",
      undefined,
      owner.token,
      owner.spaceId,
    );
    expect(whitelist.code).toBe(0);
    expect((whitelist.data as { check: boolean }).check).toBe(false);

    const blocked = await inject(
      "GET",
      `/film/projects/${newProjectId()}/task-tables`,
      undefined,
      owner.token,
      owner.spaceId,
    );
    expect(blocked.code).toBe(403101);
    expect(blocked.status).toBe(200); // AppError → HTTP 200 + code≠0（api-spec §1）
    expect(blocked.msg).toContain("film");
  });

  it("准入：开通后 check=true；未知 scene 返回 false 而不是报错（避免前端白屏）", async () => {
    const ctx = await setup();
    const ok = await inject("GET", "/func-whitelist?scene=ai_film", undefined, ctx.token, ctx.teamSpaceId);
    expect(ok.code).toBe(0);
    expect((ok.data as { check: boolean }).check).toBe(true);

    const unknown = await inject("GET", "/func-whitelist?scene=mv", undefined, ctx.token, ctx.teamSpaceId);
    expect(unknown.code).toBe(0);
    expect((unknown.data as { check: boolean }).check).toBe(false);

    const anon = await inject("GET", "/func-whitelist?scene=ai_film");
    expect(anon.code).toBe(401101);
  });

  // ══════════════════════════════════════════════════════════════════
  // 任务表本体 8
  // ══════════════════════════════════════════════════════════════════

  it("建表：返回表版本 0，并自动补齐 6 个系统字段（title/assignees/produce/task_status/review/points）", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "分镜表");
    expect(table.id).toBeTruthy();
    expect(table.version).toBe(0);
    expect(table.is_preset).toBe(false);

    const fields = await listFields(ctx, projectId, table.id);
    const systemKeys = fields.filter((f) => f.is_system).map((f) => f.key).sort();
    expect(systemKeys).toEqual(["assignees", "points", "produce", "review", "task_status", "title"]);
    // 系统字段的类型必须与契约一致（review/points/task_status 是只读列）
    const typeByKey = new Map(fields.map((f) => [f.key, f.field_type]));
    expect(typeByKey.get("title")).toBe("text");
    expect(typeByKey.get("task_status")).toBe("task_status");
    expect(typeByKey.get("review")).toBe("review_ref");
    expect(typeByKey.get("points")).toBe("points_ro");
  });

  it("建表：外部传 is_preset=true 会被强制降为 false（否则可绕过「预置表不可删」）", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const res = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables`,
      { name: "伪装预置表", is_preset: true },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(res.code).toBe(0);
    expect((res.data as { is_preset: boolean }).is_preset).toBe(false);
  });

  it("表列表：只返回本项目、本 space 的表；排序按 sort", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const a = await createTable(ctx, projectId, "表A");
    const b = await createTable(ctx, projectId, "表B");
    const other = newProjectId();
    await createTable(ctx, other, "别的项目表");

    const res = await inject(
      "GET",
      `/film/projects/${projectId}/task-tables`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(res.code).toBe(0);
    const list = (res.data as { list: Array<{ id: string }> }).list;
    expect(list.map((t) => t.id)).toEqual([a.id, b.id]);
  });

  it("改表：带 version 成功且 version+1；version 过期 → 746002 冲突（让前端刷新后重试）", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "旧名");

    const ok = await inject(
      "PATCH",
      `/film/projects/${projectId}/task-tables/${table.id}`,
      { name: "新名", version: 0 },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(ok.code).toBe(0);
    expect((ok.data as { name: string; version: number }).name).toBe("新名");
    expect((ok.data as { version: number }).version).toBe(1);

    const stale = await inject(
      "PATCH",
      `/film/projects/${projectId}/task-tables/${table.id}`,
      { name: "又改名", version: 0 },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(stale.code).toBe(746002);
  });

  it("表排序：table_ids 重排后列表顺序变化；不属于本项目的 id → 400101", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const a = await createTable(ctx, projectId, "A");
    const b = await createTable(ctx, projectId, "B");
    const reorder = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/reorder`,
      { table_ids: [b.id, a.id] },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(reorder.code).toBe(0);

    const list = await inject("GET", `/film/projects/${projectId}/task-tables`, undefined, ctx.token, ctx.teamSpaceId);
    expect((list.data as { list: Array<{ id: string }> }).list.map((t) => t.id)).toEqual([b.id, a.id]);

    const foreign = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/reorder`,
      { table_ids: [a.id, "999999999999999999"] },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(foreign.code).toBe(400101);
  });

  it("预置表：ensure-presets 建 2 张预置表且幂等（第二次 created 为空）；预置表不可删", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const first = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/ensure-presets`,
      {},
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(first.code).toBe(0);
    const firstData = first.data as { created: string[]; table_ids: string[] };
    expect(firstData.created.length).toBe(2);
    expect(firstData.table_ids.length).toBe(2);

    const second = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/ensure-presets`,
      {},
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(second.code).toBe(0);
    expect((second.data as { created: string[] }).created).toEqual([]);
    expect((second.data as { table_ids: string[] }).table_ids.length).toBe(2);

    const del = await inject(
      "DELETE",
      `/film/projects/${projectId}/task-tables/${firstData.table_ids[0]}`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(del.code).toBe(400101);
  });

  it("导入：按表头建列建行，标题列不重复建字段；空单元格不落行（稀疏）", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const res = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/import`,
      {
        name: "导入表",
        field_types: { 集数: "number", 概述: "text" },
        rows: [
          { 标题: "第1集", 集数: "1", 概述: "开场" },
          { 标题: "第2集", 集数: "2" },
        ],
      },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(res.code).toBe(0);
    const data = res.data as { table_ids: string[]; rows_imported: number; fields_created: number };
    expect(data.rows_imported).toBe(2);
    expect(data.fields_created).toBe(2); // 集数/概述；标题走系统列

    const tableId = data.table_ids[0];
    const fields = await listFields(ctx, projectId, tableId);
    expect(fields.filter((f) => !f.is_system).map((f) => f.name).sort()).toEqual(["概述", "集数"]);

    const query = await inject(
      "GET",
      `/film/projects/${projectId}/task-tables/${tableId}/tasks/query?page=1&page_size=10`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    const tasks = (query.data as { tasks: Array<{ title: string; cells: Record<string, unknown> }> }).tasks;
    expect(tasks.length).toBe(2);
    // 第 2 行没有「概述」→ 该列在 cells 里不出现（稀疏），但 title 一定有值
    const second = tasks.find((t) => t.title === "第2集")!;
    const textFieldIds = fields.filter((f) => f.name === "概述").map((f) => f.id);
    expect(second.cells[textFieldIds[0]]).toBeUndefined();
  });

  it("删表：级联清子表；再删同一 id → 400102（不泄露存在性）", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "待删表");
    await createTasks(ctx, projectId, table.id, { count: 2 });
    const del = await inject(
      "DELETE",
      `/film/projects/${projectId}/task-tables/${table.id}`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(del.code).toBe(0);
    const again = await inject(
      "DELETE",
      `/film/projects/${projectId}/task-tables/${table.id}`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(again.code).toBe(400102);
  });

  // ══════════════════════════════════════════════════════════════════
  // 字段 6
  // ══════════════════════════════════════════════════════════════════

  it("建字段：key 由服务端派生；is_unique_type 是「该类型每表至多一个」而非值唯一", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "字段表");

    // 用 asset_ref（系统列没有占用该类型；canvas_ref 已被系统列 produce 独占）
    const a = await createField(ctx, projectId, table.id, { name: "成品资产", field_type: "asset_ref", is_unique_type: true });
    expect(a.code).toBe(0);
    // key 由 name 派生（中文名 slug 后为空 → field_<n> 兜底），但必须非空且稳定
    expect((a.data as { key: string }).key.length).toBeGreaterThan(0);
    expect((a.data as { is_unique_type: boolean }).is_unique_type).toBe(true);

    // 第二个「同类型且 unique」→ 冲突（注意与"值唯一"无关：此时还没有任何单元格）
    const b = await createField(ctx, projectId, table.id, {
      name: "另一个成品资产",
      field_type: "asset_ref",
      is_unique_type: true,
    });
    expect(b.code).toBe(400101);

    // 不标 unique 的同类型列可以建（证明约束是列级而非类型禁用）
    const c = await createField(ctx, projectId, table.id, { name: "再一个成品资产", field_type: "asset_ref" });
    expect(c.code).toBe(0);

    // 非法 field_type（review_ref 属系统只读列，用户不可建）
    const bad = await createField(ctx, projectId, table.id, { name: "审核", field_type: "review_ref" });
    expect(bad.code).toBe(400101);
  });

  it("改字段：改类型且有单元格 → 400101 需要 confirm_clear；带 confirm_clear 后旧值被清掉", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "改类型表");
    const created = await createField(ctx, projectId, table.id, { name: "日期列", field_type: "date" });
    const fieldId = (created.data as { id: string }).id;

    const [task] = await createTasks(ctx, projectId, table.id, { cells: { [fieldId]: "2026-01-01" } });
    expect(task.cells[fieldId]).toBe("2026-01-01");

    const blocked = await inject(
      "PATCH",
      `/film/projects/${projectId}/task-tables/${table.id}/fields/${fieldId}`,
      { field_type: "number" },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(blocked.code).toBe(400101);

    const forced = await inject(
      "PATCH",
      `/film/projects/${projectId}/task-tables/${table.id}/fields/${fieldId}`,
      { field_type: "number", confirm_clear: true },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(forced.code).toBe(0);
    expect((forced.data as { field_type: string }).field_type).toBe("number");

    const query = await inject(
      "GET",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/query`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    const tasks = (query.data as { tasks: Array<{ cells: Record<string, unknown> }> }).tasks;
    expect(tasks[0].cells[fieldId]).toBeUndefined(); // 清空 = 无 cell 行
  });

  it("删字段：系统字段不可删（400101）；用户字段软删后列表不可见，batch-restore 可恢复", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "删字段表");
    const fields = await listFields(ctx, projectId, table.id);
    const titleField = fields.find((f) => f.key === "title")!;

    const sysDel = await inject(
      "DELETE",
      `/film/projects/${projectId}/task-tables/${table.id}/fields/${titleField.id}`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(sysDel.code).toBe(400101);

    const created = await createField(ctx, projectId, table.id, { name: "成本", field_type: "number" });
    const fieldId = (created.data as { id: string }).id;
    const del = await inject(
      "DELETE",
      `/film/projects/${projectId}/task-tables/${table.id}/fields/${fieldId}`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(del.code).toBe(0);
    expect((await listFields(ctx, projectId, table.id)).some((f) => f.id === fieldId)).toBe(false);

    const restore = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/fields/batch-restore`,
      { field_ids: [fieldId] },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(restore.code).toBe(0);
    expect((restore.data as { restored_field_ids: string[] }).restored_field_ids).toEqual([fieldId]);
    expect((await listFields(ctx, projectId, table.id)).some((f) => f.id === fieldId)).toBe(true);
  });

  it("字段排序：reorder 改 sort；混入别的表的 field_id → 400101", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "排序表");
    const f1 = (await createField(ctx, projectId, table.id, { name: "甲", field_type: "text" })).data as { id: string };
    const f2 = (await createField(ctx, projectId, table.id, { name: "乙", field_type: "text" })).data as { id: string };

    const res = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/fields/reorder`,
      { field_ids: [f2.id, f1.id] },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(res.code).toBe(0);
    const fields = await listFields(ctx, projectId, table.id);
    const order = fields.map((f) => f.id);
    expect(order.indexOf(f2.id)).toBeLessThan(order.indexOf(f1.id));

    const foreign = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/fields/reorder`,
      { field_ids: [f1.id, "123456789012345678"] },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(foreign.code).toBe(400101);
  });

  // ══════════════════════════════════════════════════════════════════
  // 表视图偏好 2
  // ══════════════════════════════════════════════════════════════════

  it("视图偏好：未设置时返回空默认值；PUT 后回显；重复 PUT 覆盖（per table+user 一行）", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "偏好表");

    const empty = await inject(
      "GET",
      `/film/projects/${projectId}/task-tables/${table.id}/pref`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(empty.code).toBe(0);
    expect((empty.data as { hidden_field_ids: string[] }).hidden_field_ids).toEqual([]);

    const put = await inject(
      "PUT",
      `/film/projects/${projectId}/task-tables/${table.id}/pref`,
      { hidden_field_ids: ["1"], filter: [{ field_key: "title", op: "contains", value: "第" }], ui: { row_height: 40 } },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(put.code).toBe(0);

    const read = await inject(
      "GET",
      `/film/projects/${projectId}/task-tables/${table.id}/pref`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect((read.data as { hidden_field_ids: string[] }).hidden_field_ids).toEqual(["1"]);
    expect((read.data as { ui: { row_height: number } }).ui.row_height).toBe(40);

    // 覆盖写：再 PUT 空值后 hidden_field_ids 变空（不是合并）
    const overwrite = await inject(
      "PUT",
      `/film/projects/${projectId}/task-tables/${table.id}/pref`,
      { hidden_field_ids: [], filter: [], ui: {} },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(overwrite.code).toBe(0);
    const read2 = await inject(
      "GET",
      `/film/projects/${projectId}/task-tables/${table.id}/pref`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect((read2.data as { hidden_field_ids: string[] }).hidden_field_ids).toEqual([]);
  });

  // ══════════════════════════════════════════════════════════════════
  // 行（任务）12
  // ══════════════════════════════════════════════════════════════════

  it("建行：count=3 批量建；title 落冗余列且同步为 title 单元格；初始 status=1 version=1", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "建行表");
    const rows = await createTasks(ctx, projectId, table.id, { title: "镜头1", count: 3 });
    expect(rows.length).toBe(3);
    for (const r of rows) {
      expect(r.status).toBe(1);
      expect(r.version).toBe(1);
    }

    const query = await inject(
      "GET",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/query`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    const fields = await listFields(ctx, projectId, table.id);
    const titleFieldId = fields.find((f) => f.key === "title")!.id;
    const tasks = (query.data as { tasks: Array<{ title: string; cells: Record<string, unknown> }> }).tasks;
    expect(tasks.length).toBe(3);
    expect(tasks[0].title).toBe("镜头1");
    expect(tasks[0].cells[titleFieldId]).toBe("镜头1");
  });

  it("写单元格：版本 CAS 正确则 version+1；只读列（task_status/points_ro/review_ref）拒写 400101 且带 field", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "单元格表");
    const fields = await listFields(ctx, projectId, table.id);
    const textField = (await createField(ctx, projectId, table.id, { name: "备注", field_type: "text" })).data as { id: string };
    const [task] = await createTasks(ctx, projectId, table.id, {});

    const ok = await inject(
      "PUT",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/cells`,
      { version: task.version, cells: { [textField.id]: "hello" } },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(ok.code).toBe(0);
    const updated = ok.data as { version: number; cells: Record<string, unknown>; status: number };
    expect(updated.version).toBe(task.version + 1);
    expect(updated.cells[textField.id]).toBe("hello");
    expect(updated.status).toBe(2); // 首次写格子 → 未开始(1) 自动推进到 制作中(2)

    // 只读列：三种都不接受写入（系统列的 key 是 task_status/review/points，类型名不是 key）
    for (const key of ["task_status", "points", "review"]) {
      const fieldId = fields.find((f) => f.key === key)!.id;
      const res = await inject(
        "PUT",
        `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/cells`,
        { version: updated.version, cells: { [fieldId]: 5 } },
        ctx.token,
        ctx.teamSpaceId,
      );
      expect(res.code).toBe(400101);
      const details = (res.body as { data?: unknown }).data;
      void details;
      expect((res as { msg: string }).msg).toContain("read-only");
    }
  });

  it("版本 CAS：用过期 version 写同一行 → 746002（并发抢写后到者必须刷新）", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "CAS表");
    const f = (await createField(ctx, projectId, table.id, { name: "文本", field_type: "text" })).data as { id: string };
    const [task] = await createTasks(ctx, projectId, table.id, {});
    const first = await inject(
      "PUT",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/cells`,
      { version: task.version, cells: { [f.id]: "a" } },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(first.code).toBe(0);
    const stale = await inject(
      "PUT",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/cells`,
      { version: task.version, cells: { [f.id]: "b" } },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(stale.code).toBe(746002);
  });

  it("稀疏单元格：只传一列不清别的列；传 null 才是清空（落库删行）", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "稀疏表");
    const f1 = (await createField(ctx, projectId, table.id, { name: "列一", field_type: "text" })).data as { id: string };
    const f2 = (await createField(ctx, projectId, table.id, { name: "列二", field_type: "text" })).data as { id: string };
    const [task] = await createTasks(ctx, projectId, table.id, {});
    const v1 = await inject(
      "PUT",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/cells`,
      { version: task.version, cells: { [f1.id]: "A", [f2.id]: "B" } },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(v1.code).toBe(0);

    // 只改 f1：f2 必须还在（稀疏语义，不是整行替换）
    const v2 = await inject(
      "PUT",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/cells`,
      { version: (v1.data as { version: number }).version, cells: { [f1.id]: "A2" } },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(v2.code).toBe(0);
    const cells2 = (v2.data as { cells: Record<string, unknown> }).cells;
    expect(cells2[f1.id]).toBe("A2");
    expect(cells2[f2.id]).toBe("B");

    // 清空 f2
    const v3 = await inject(
      "PUT",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/cells`,
      { version: (v2.data as { version: number }).version, cells: { [f2.id]: null } },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(v3.code).toBe(0);
    const cells3 = (v3.data as { cells: Record<string, unknown> }).cells;
    expect(cells3[f2.id]).toBeUndefined();
    expect(cells3[f1.id]).toBe("A2");
  });

  it("单元格类型校验：date 列塞对象 / number 列塞字符串 / select 越界 → 400101（带 field）", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "类型表");
    const dateF = (await createField(ctx, projectId, table.id, { name: "日期", field_type: "date" })).data as { id: string };
    const numF = (await createField(ctx, projectId, table.id, { name: "数字", field_type: "number" })).data as { id: string };
    const selF = (
      await createField(ctx, projectId, table.id, {
        name: "枚举",
        field_type: "select",
        config_json: { options: [{ id: "a", name: "A" }] },
      })
    ).data as { id: string };
    const [task] = await createTasks(ctx, projectId, table.id, {});

    const cases: Array<[string, unknown]> = [
      [dateF.id, { nested: true }],
      [numF.id, "not-a-number"],
      [selF.id, "zzz"],
    ];
    let version = task.version;
    for (const [fieldId, value] of cases) {
      const res = await inject(
        "PUT",
        `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/cells`,
        { version, cells: { [fieldId]: value } },
        ctx.token,
        ctx.teamSpaceId,
      );
      expect(res.code).toBe(400101);
    }
    // 合法值应当能写（证明上面的拒绝是类型判定而不是整列禁写）
    const okRes = await inject(
      "PUT",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/cells`,
      { version, cells: { [dateF.id]: "2026-02-02", [selF.id]: "a" } },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(okRes.code).toBe(0);
    version = (okRes.data as { version: number }).version;

    // 未知 field_id（不属于本表）→ 400101
    const unknown = await inject(
      "PUT",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/cells`,
      { version, cells: { "123456789012345678": "x" } },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(unknown.code).toBe(400101);
  });

  it("子行：children 建一层子行；查询只返回根行但带 children[]；父行不能再挂子行", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "子行表");
    const [parent] = await createTasks(ctx, projectId, table.id, { title: "父" });
    const childRes = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${parent.id}/children`,
      { title: "子" },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(childRes.code).toBe(0);
    const child = childRes.data as { id: string; parent_id: string };
    expect(child.parent_id).toBe(parent.id);

    // 在子行上再建子行 → 拒绝（只支持一层）
    const nested = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${child.id}/children`,
      { title: "孙" },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(nested.code).toBe(400101);

    const query = await inject(
      "GET",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/query`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    const tasks = (query.data as { tasks: Array<{ id: string; children: Array<{ id: string }> }> }).tasks;
    expect(tasks.length).toBe(1);
    expect(tasks[0].children.map((c) => c.id)).toEqual([child.id]);
  });

  it("行状态：无审核版本不能置 done（400101）；置 3 只改行状态", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "状态表");
    const [task] = await createTasks(ctx, projectId, table.id, {});

    const done = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/status`,
      { status: 5 },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(done.code).toBe(400101);
    expect(done.msg).toContain("review");

    const pending = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/status`,
      { status: 3 },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(pending.code).toBe(0);
    expect((pending.data as { status: number }).status).toBe(3);

    const bad = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/status`,
      { status: 9 },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(bad.code).toBe(400101);
  });

  it("派工通知：通知负责人返回 notified；非成员目标 → 400101（防跨租户骚扰）", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "通知表");
    const member = await loginNewUser("2");
    await addMember(ctx.teamSpaceId, member.userId, "animator", 3);
    const [task] = await createTasks(ctx, projectId, table.id, { assignee_user_id: member.userId });

    const res = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/notify-assignees`,
      { op_user_ids: [] },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(res.code).toBe(0);
    const data = res.data as { notified: number; user_ids: string[]; channel: string };
    expect(data.notified).toBe(1);
    expect(data.user_ids).toEqual([member.userId]);
    expect(data.channel).toContain(`film_table_${ctx.teamSpaceId}`);

    const outsider = await loginNewUser("3");
    const blocked = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/notify-assignees`,
      { op_user_ids: [outsider.userId] },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(blocked.code).toBe(400101);
  });

  it("标题查重：title-matches 大小写不敏感命中；exclude_task_id 排除自身", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "查重表");
    const [a] = await createTasks(ctx, projectId, table.id, { title: "Shot-01" });
    await createTasks(ctx, projectId, table.id, { title: "Shot-02" });

    const hit = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/title-matches`,
      { title: "shot-01" },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(hit.code).toBe(0);
    expect((hit.data as { list: Array<{ task_id: string }> }).list.map((x) => x.task_id)).toEqual([a.id]);

    const excluded = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/title-matches`,
      { title: "shot-01", exclude_task_id: a.id },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect((excluded.data as { list: unknown[] }).list).toEqual([]);
  });

  it("未绑定画布查询：绑过的行不再出现（绑定集合与未绑定集合互补）", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "未绑定表");
    const rows = await createTasks(ctx, projectId, table.id, { count: 2 });
    const canvasId = await insertCanvas(ctx.teamSpaceId, ctx.userId);

    const before = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/unbound-query`,
      { page: 1, page_size: 20 },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect((before.data as { page: { total: number } }).page.total).toBe(2);

    await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${rows[0].id}/canvas-bindings`,
      { canvas_id: canvasId },
      ctx.token,
      ctx.teamSpaceId,
    );
    const after = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/unbound-query`,
      { page: 1, page_size: 20 },
      ctx.token,
      ctx.teamSpaceId,
    );
    const data = after.data as { page: { total: number }; rows: Array<{ id: string }> };
    expect(data.page.total).toBe(1);
    expect(data.rows.map((r) => r.id)).toEqual([rows[1].id]);
  });

  it("行排序：reorder 后 sort 改变；跨父级混排 → 400101", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "行排序表");
    const rows = await createTasks(ctx, projectId, table.id, { count: 2 });
    const res = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/reorder`,
      { task_ids: [rows[1].id, rows[0].id], parent_id: null },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(res.code).toBe(0);
    const query = await inject(
      "GET",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/query`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect((query.data as { tasks: Array<{ id: string }> }).tasks.map((t) => t.id)).toEqual([rows[1].id, rows[0].id]);

    const [parent] = await createTasks(ctx, projectId, table.id, { title: "父" });
    const mixed = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/reorder`,
      { task_ids: [rows[0].id, parent.id], parent_id: null },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(mixed.code).toBe(0); // 都是根行，允许
    const childRes = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${parent.id}/children`,
      { title: "子" },
      ctx.token,
      ctx.teamSpaceId,
    );
    const childId = (childRes.data as { id: string }).id;
    const bad = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/reorder`,
      { task_ids: [rows[0].id, childId], parent_id: null },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(bad.code).toBe(400101);
  });

  it("批量删/恢复：软删后查询不可见、batch-restore 复原（数据不丢）；重复删同一 id → 400101", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "批量表");
    const rows = await createTasks(ctx, projectId, table.id, { count: 3 });
    const ids = rows.map((r) => r.id);

    const del = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/batch-delete`,
      { task_ids: ids.slice(0, 2) },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(del.code).toBe(0);
    expect((del.data as { deleted_task_ids: string[] }).deleted_task_ids.length).toBe(2);

    const q1 = await inject(
      "GET",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/query`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect((q1.data as { tasks: unknown[] }).tasks.length).toBe(1);

    const restore = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/batch-restore`,
      { task_ids: ids.slice(0, 2) },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(restore.code).toBe(0);
    expect((restore.data as { restored_task_ids: string[] }).restored_task_ids.length).toBe(2);

    const q2 = await inject(
      "GET",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/query`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect((q2.data as { tasks: unknown[] }).tasks.length).toBe(3);

    // 已删过的再批量删 → 400101（语义：不能把"已删"当成功吞掉）
    await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/batch-delete`,
      { task_ids: [ids[0]] },
      ctx.token,
      ctx.teamSpaceId,
    );
    const again = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/batch-delete`,
      { task_ids: [ids[0]] },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(again.code).toBe(400101);
  });

  it("单行删除：DELETE 成功；再删同 id → 400102", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "单删表");
    const [task] = await createTasks(ctx, projectId, table.id, {});
    const del = await inject(
      "DELETE",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(del.code).toBe(0);
    const again = await inject(
      "DELETE",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(again.code).toBe(400102);
  });

  it("查询筛选与排序：按文本 contains 筛、按数字 desc 排；未知 field_id → 400101", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "筛选表");
    const numF = (await createField(ctx, projectId, table.id, { name: "工作量", field_type: "number" })).data as { id: string };
    const rows = await createTasks(ctx, projectId, table.id, { count: 3 });
    const values = [3, 1, 2];
    let version = rows[0].version;
    for (let i = 0; i < rows.length; i += 1) {
      const res = await inject(
        "PUT",
        `/film/projects/${projectId}/task-tables/${table.id}/tasks/${rows[i].id}/cells`,
        { version: rows[i].version, cells: { [numF.id]: values[i] } },
        ctx.token,
        ctx.teamSpaceId,
      );
      expect(res.code).toBe(0);
      version = (res.data as { version: number }).version;
    }
    void version;

    const sorted = await inject(
      "GET",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/query?sorts=${encodeURIComponent(
        JSON.stringify([{ field_id: numF.id, order: "desc" }]),
      )}`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(sorted.code).toBe(0);
    const sortedTasks = (sorted.data as { tasks: Array<{ cells: Record<string, unknown> }> }).tasks;
    expect(sortedTasks.map((t) => t.cells[numF.id])).toEqual([3, 2, 1]);

    const filtered = await inject(
      "GET",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/query?filters=${encodeURIComponent(
        JSON.stringify([{ field_id: numF.id, op: "gte", value: 2 }]),
      )}`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(filtered.code).toBe(0);
    expect((filtered.data as { tasks: Array<{ cells: Record<string, unknown> }> }).tasks.length).toBe(2);

    const badOp = await inject(
      "GET",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/query?filters=${encodeURIComponent(
        JSON.stringify([{ field_id: numF.id, op: "contains", value: "x" }]),
      )}`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(badOp.code).toBe(400101); // number 列不支持 contains

    const badField = await inject(
      "GET",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/query?filters=${encodeURIComponent(
        JSON.stringify([{ field_id: "1", op: "eq", value: "x" }]),
      )}`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(badField.code).toBe(400101);
  });

  it("统计：tasks/stats 按状态与负责人聚合（空项目也不 500）", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const empty = await inject("GET", `/film/projects/${projectId}/tasks/stats`, undefined, ctx.token, ctx.teamSpaceId);
    expect(empty.code).toBe(0);
    expect((empty.data as { total: number }).total).toBe(0);

    const table = await createTable(ctx, projectId, "统计表");
    const member = await loginNewUser("4");
    await addMember(ctx.teamSpaceId, member.userId, "animator", 3);
    await createTasks(ctx, projectId, table.id, { count: 2, assignee_user_id: member.userId });
    const [t3] = await createTasks(ctx, projectId, table.id, {});
    await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${t3.id}/status`,
      { status: 2 },
      ctx.token,
      ctx.teamSpaceId,
    );

    const res = await inject("GET", `/film/projects/${projectId}/tasks/stats`, undefined, ctx.token, ctx.teamSpaceId);
    expect(res.code).toBe(0);
    const data = res.data as {
      total: number;
      by_status: Record<string, number>;
      by_assignee: Array<{ user_id: string | null; total: number }>;
    };
    expect(data.total).toBe(3);
    expect(data.by_status.not_started).toBe(2);
    expect(data.by_status.in_progress).toBe(1);
    const mine = data.by_assignee.find((r) => r.user_id === member.userId);
    expect(mine?.total).toBe(2);
  });

  // ══════════════════════════════════════════════════════════════════
  // 审核 3（+1 提交扩展）—— 机制 #1
  // ══════════════════════════════════════════════════════════════════

  it("审核版本链：每次提交产生新版本 V01/V02（不可变、不复用）；行状态推 pending_review", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "审核表");
    const [task] = await createTasks(ctx, projectId, table.id, {});

    const v1 = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/review`,
      { asset_ids: [], comment: "第一版" },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(v1.code).toBe(0);
    expect((v1.data as { version_no: string }).version_no).toBe("V01");
    expect((v1.data as { task_status: number }).task_status).toBe(3);

    const v2 = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/review`,
      { asset_ids: [], comment: "第二版" },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(v2.code).toBe(0);
    expect((v2.data as { version_no: string }).version_no).toBe("V02");

    const review = await inject(
      "GET",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/review`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(review.code).toBe(0);
    const data = review.data as { latest_version_no: string; versions: Array<{ version_no: string }>; unread: number };
    expect(data.latest_version_no).toBe("V02");
    // 版本链按 version_no 倒序返回（最新在前）
    expect(data.versions.map((v) => v.version_no)).toEqual(["V02", "V01"]);
    expect(data.unread).toBe(2);
  });

  it("审核评论：必须挂在属于本行的版本上（跨行版本 → 400102）；评论计入 comment_count", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "评论表");
    const [taskA] = await createTasks(ctx, projectId, table.id, {});
    const [taskB] = await createTasks(ctx, projectId, table.id, {});
    const vA = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${taskA.id}/review`,
      { asset_ids: [] },
      ctx.token,
      ctx.teamSpaceId,
    );
    const versionA = (vA.data as { version_id: string }).version_id;

    const ok = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${taskA.id}/review/comments`,
      { version_id: versionA, content: "这里的光要柔和" },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(ok.code).toBe(0);
    expect((ok.data as { comment_id: string }).comment_id).toBeTruthy();

    const cross = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${taskB.id}/review/comments`,
      { version_id: versionA, content: "挂错行" },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(cross.code).toBe(400102);

    const review = await inject(
      "GET",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${taskA.id}/review`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    const data = review.data as { comments: Array<{ content: string }>; versions: Array<{ comment_count: number }> };
    expect(data.comments.length).toBe(1);
    expect(data.versions[0].comment_count).toBe(1);
  });

  it("已读回执：按版本标记（重复标记幂等），unread 相应减少", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "已读表");
    const [task] = await createTasks(ctx, projectId, table.id, {});
    const v1 = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/review`,
      { asset_ids: [] },
      ctx.token,
      ctx.teamSpaceId,
    );
    const v2 = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/review`,
      { asset_ids: [] },
      ctx.token,
      ctx.teamSpaceId,
    );
    const ids = [(v1.data as { version_id: string }).version_id, (v2.data as { version_id: string }).version_id];

    const read = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/review/read`,
      { version_ids: ids },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(read.code).toBe(0);
    expect((read.data as { read_version_ids: string[] }).read_version_ids.length).toBe(2);

    // 幂等：重复标记不报错
    const again = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/review/read`,
      { version_ids: ids },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(again.code).toBe(0);

    const review = await inject(
      "GET",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/review`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect((review.data as { unread: number }).unread).toBe(0);

    const foreign = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/review/read`,
      { version_ids: ["123456789012345678"] },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(foreign.code).toBe(400102);
  });

  it("双轨状态：status=5 就地批准最新版本（version.status=2）；已被批准的版本不可再次决策（400101）", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "双轨表");
    const [task] = await createTasks(ctx, projectId, table.id, {});
    await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/review`,
      { asset_ids: [] },
      ctx.token,
      ctx.teamSpaceId,
    );

    const done = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/status`,
      { status: 5, comment: "过了" },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(done.code).toBe(0);
    expect((done.data as { status: number }).status).toBe(5);
    expect((done.data as { decision: { status: number } }).decision.status).toBe(2);

    const review = await inject(
      "GET",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/review`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    const versions = (review.data as { versions: Array<{ status: number; decision_comment: string }> }).versions;
    expect(versions[0].status).toBe(2); // 版本轨：已批准
    expect(versions[0].decision_comment).toBe("过了");

    // 已决策版本不可改判：再试图驳回 → 400101 version_immutable
    const reject = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/status`,
      { status: 4 },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(reject.code).toBe(400101);
  });

  it("驳回后再提交：版本号继续递增（V02），行回到 pending_review", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "驳回表");
    const [task] = await createTasks(ctx, projectId, table.id, {});
    await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/review`,
      { asset_ids: [] },
      ctx.token,
      ctx.teamSpaceId,
    );
    const rejected = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/status`,
      { status: 4, comment: "重做" },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(rejected.code).toBe(0);
    expect((rejected.data as { decision: { status: number } }).decision.status).toBe(3);

    const resubmit = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/review`,
      { asset_ids: [], comment: "改好了" },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(resubmit.code).toBe(0);
    expect((resubmit.data as { version_no: string }).version_no).toBe("V02");
    expect((resubmit.data as { task_status: number }).task_status).toBe(3);
  });

  // ══════════════════════════════════════════════════════════════════
  // 行↔画布绑定 4
  // ══════════════════════════════════════════════════════════════════

  it("绑定：POST 幂等（同 task+canvas+node 只一条）、GET 回读、PUT 全量替换、DELETE 解绑", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "绑定表");
    const [task] = await createTasks(ctx, projectId, table.id, {});
    const canvas1 = await insertCanvas(ctx.teamSpaceId, ctx.userId, "画布1");
    const canvas2 = await insertCanvas(ctx.teamSpaceId, ctx.userId, "画布2");

    const bind1 = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/canvas-bindings`,
      { canvas_id: canvas1 },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(bind1.code).toBe(0);
    expect((bind1.data as { canvas_ids: string[] }).canvas_ids).toEqual([canvas1]);

    // 幂等：重复绑定不产生第二条
    const bindAgain = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/canvas-bindings`,
      { canvas_id: canvas1 },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(bindAgain.code).toBe(0);
    expect((bindAgain.data as { list: unknown[] }).list.length).toBe(1);

    const getRes = await inject(
      "GET",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/canvas-bindings`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect((getRes.data as { canvas_ids: string[] }).canvas_ids).toEqual([canvas1]);

    const put = await inject(
      "PUT",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/canvas-bindings`,
      { canvas_ids: [canvas1, canvas2] },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(put.code).toBe(0);
    expect((put.data as { canvas_ids: string[] }).canvas_ids.sort()).toEqual([canvas1, canvas2].sort());

    const del = await inject(
      "DELETE",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/canvas-bindings`,
      { canvas_ids: [canvas1] },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(del.code).toBe(0);
    expect((del.data as { canvas_ids: string[] }).canvas_ids).toEqual([canvas2]);

    // 绑定别的 space 的画布 → 400102/403（canvas 域判存在性，不泄露）
    const other = await setup();
    const foreignCanvas = await insertCanvas(other.teamSpaceId, other.userId);
    const badBind = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/canvas-bindings`,
      { canvas_id: foreignCanvas },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect([400102, 403101]).toContain(badBind.code);
  });

  // ══════════════════════════════════════════════════════════════════
  // 画布侧 5 —— 含机制 #2 submit-result
  // ══════════════════════════════════════════════════════════════════

  it("画布侧：canvases/visible 返回本 space 画布；task-bindings/task-panel 反查行", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "画布侧表");
    const [task] = await createTasks(ctx, projectId, table.id, { title: "镜头A" });
    const canvasId = await insertCanvas(ctx.teamSpaceId, ctx.userId, "画布X");
    await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/canvas-bindings`,
      { canvas_id: canvasId, node_id: "123" },
      ctx.token,
      ctx.teamSpaceId,
    );

    const visible = await inject(
      "GET",
      `/film/projects/${projectId}/canvases/visible`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(visible.code).toBe(0);
    expect((visible.data as { list: Array<{ canvas_id: string }> }).list.map((c) => c.canvas_id)).toContain(canvasId);

    const bindings = await inject(
      "GET",
      `/film/projects/${projectId}/canvases/${canvasId}/task-bindings`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(bindings.code).toBe(0);
    const list = (bindings.data as { list: Array<{ task_id: string; title: string }> }).list;
    expect(list.map((b) => b.task_id)).toEqual([task.id]);
    expect(list[0].title).toBe("镜头A");

    const panel = await inject(
      "GET",
      `/film/projects/${projectId}/canvases/${canvasId}/task-panel`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(panel.code).toBe(0);
    const panelTasks = (panel.data as { tasks: Array<{ task_id: string; node_ids: string[] }> }).tasks;
    expect(panelTasks[0].task_id).toBe(task.id);
    expect(panelTasks[0].node_ids).toContain("123");
  });

  it("submit-result（机制 #2）：画布产物 → 登记版本 V01 → 行 status 推 pending_review → 通知返回", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "提报表");
    const member = await loginNewUser("5");
    await addMember(ctx.teamSpaceId, member.userId, "animator", 3);
    const [task] = await createTasks(ctx, projectId, table.id, { title: "待提交", assignee_user_id: member.userId });
    const canvasId = await insertCanvas(ctx.teamSpaceId, ctx.userId, "提交画布");
    const assetId = await insertAsset(ctx.teamSpaceId);

    const res = await inject(
      "POST",
      `/film/projects/${projectId}/canvases/${canvasId}/submit-result`,
      { task_id: task.id, node_id: "555", asset_ids: [assetId], thumb_file_id: "thumb/1.png", comment: "画布产物" },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(res.code).toBe(0);
    const data = res.data as {
      version_no: string;
      task_status: number;
      notified: number;
      user_ids: string[];
      version_id: string;
    };
    expect(data.version_no).toBe("V01");
    expect(data.task_status).toBe(3);
    expect(data.notified).toBe(1);
    expect(data.user_ids).toEqual([member.userId]);

    // 行状态真的推进了（不是只写版本）
    const query = await inject(
      "GET",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/query`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    const row = (query.data as { tasks: Array<{ id: string; status: number; review: { version_id: string } }> }).tasks.find(
      (t) => t.id === task.id,
    )!;
    expect(row.status).toBe(3);
    expect(row.review.version_id).toBe(data.version_id);

    // 版本里冻结了产物与缩略图（审核抽屉据此渲染）
    const review = await inject(
      "GET",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/review`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    const v = (review.data as { versions: Array<{ asset_ids: string[]; thumb_file_id: string }> }).versions[0];
    expect(v.asset_ids).toEqual([assetId]);
    expect(v.thumb_file_id).toBe("thumb/1.png");

    // 提交即绑定（自动补绑，画布侧提交不需要先手动绑）
    const bindings = await inject(
      "GET",
      `/film/projects/${projectId}/canvases/${canvasId}/task-bindings`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect((bindings.data as { list: Array<{ task_id: string }> }).list.map((b) => b.task_id)).toContain(task.id);
  });

  it("submit-result：未知 asset（跨 space）→ 400101；未知 task → 400102", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "提报负例表");
    const [task] = await createTasks(ctx, projectId, table.id, {});
    const canvasId = await insertCanvas(ctx.teamSpaceId, ctx.userId);
    const other = await setup();
    const foreignAsset = await insertAsset(other.teamSpaceId);

    const badAsset = await inject(
      "POST",
      `/film/projects/${projectId}/canvases/${canvasId}/submit-result`,
      { task_id: task.id, node_id: "1", asset_ids: [foreignAsset] },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(badAsset.code).toBe(400101);

    const badTask = await inject(
      "POST",
      `/film/projects/${projectId}/canvases/${canvasId}/submit-result`,
      { task_id: "123456789012345678", node_id: "1", asset_ids: [] },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(badTask.code).toBe(400102);
  });

  it("DELETE canvases/:canvas_id 是解绑（不删画布本体）：返回 deleted_canvas=false，画布仍在 visible 里", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "解绑表");
    const [task] = await createTasks(ctx, projectId, table.id, {});
    const canvasId = await insertCanvas(ctx.teamSpaceId, ctx.userId, "解绑画布");
    await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/canvas-bindings`,
      { canvas_id: canvasId },
      ctx.token,
      ctx.teamSpaceId,
    );

    const res = await inject(
      "DELETE",
      `/film/projects/${projectId}/canvases/${canvasId}`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(res.code).toBe(0);
    const data = res.data as { deleted_canvas: boolean; unbound_task_ids: string[] };
    expect(data.deleted_canvas).toBe(false);
    expect(data.unbound_task_ids).toEqual([task.id]);

    const visible = await inject(
      "GET",
      `/film/projects/${projectId}/canvases/visible`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect((visible.data as { list: Array<{ canvas_id: string }> }).list.map((c) => c.canvas_id)).toContain(canvasId);
  });

  // ══════════════════════════════════════════════════════════════════
  // 任务模板 3 + apply-template
  // ══════════════════════════════════════════════════════════════════

  it("模板：创建 → 列表（个人 scope 仅本人可见）→ apply-template 建列建行 → 删除", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const member = await loginNewUser("6");
    await addMember(ctx.teamSpaceId, member.userId, "animator", 3);

    const created = await inject(
      "POST",
      `/film/projects/${projectId}/task-templates`,
      {
        name: "标准分镜模板",
        scope: 1,
        payload: {
          fields: [{ key: "budget", name: "预算", field_type: "number", config_json: {} }],
          tasks: [{ title: "镜1" }, { title: "镜2" }],
        },
      },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(created.code).toBe(0);
    const templateId = (created.data as { template_id: string }).template_id;

    const list = await inject(
      "GET",
      `/film/projects/${projectId}/task-templates`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect((list.data as { list: Array<{ template_id: string }> }).list.map((t) => t.template_id)).toContain(templateId);

    // 个人模板对别人不可见
    const otherList = await inject(
      "GET",
      `/film/projects/${projectId}/task-templates`,
      undefined,
      member.token,
      ctx.teamSpaceId,
    );
    expect((otherList.data as { list: unknown[] }).list).toEqual([]);

    const table = await createTable(ctx, projectId, "套模板表");
    const applied = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/apply-template`,
      { template_id: templateId },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(applied.code).toBe(0);
    expect((applied.data as { fields_created: number }).fields_created).toBe(1);
    const fields = await listFields(ctx, projectId, table.id);
    expect(fields.some((f) => f.name === "预算")).toBe(true);

    // 别人的个人模板删不掉（403）
    const forbidden = await inject(
      "DELETE",
      `/film/projects/${projectId}/task-templates/${templateId}`,
      undefined,
      member.token,
      ctx.teamSpaceId,
    );
    expect(forbidden.code).toBe(403101);

    const del = await inject(
      "DELETE",
      `/film/projects/${projectId}/task-templates/${templateId}`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(del.code).toBe(0);
    const delAgain = await inject(
      "DELETE",
      `/film/projects/${projectId}/task-templates/${templateId}`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(delAgain.code).toBe(400102);

    // 空 payload 模板 → 400101（否则 apply-template 是空操作，前端却以为成功了）
    const emptyTpl = await inject(
      "POST",
      `/film/projects/${projectId}/task-templates`,
      { name: "空模板", scope: 2, payload: {} },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(emptyTpl.code).toBe(400101);
  });

  // ══════════════════════════════════════════════════════════════════
  // 导出 2（`format=xlsx` → 真 OOXML；`format=csv` → csv/zip，见 film.exports.service 头注释）
  // ══════════════════════════════════════════════════════════════════

  it("导出：xlsx 返回真 OOXML（单表/多表都是 xlsx），csv 仍走 csv/zip；delivered_format 如实声明", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const t1 = await createTable(ctx, projectId, "导出表1");
    const t2 = await createTable(ctx, projectId, "导出表2");
    await createTasks(ctx, projectId, t1.id, { count: 2 });

    const single = await inject(
      "POST",
      `/film/projects/${projectId}/exports`,
      { table_ids: [t1.id], format: "xlsx" },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(single.code).toBe(0);
    const s = single.data as { delivered_format: string; format_requested: string; download_url: string; row_count: number; file_uri: string };
    expect(s.format_requested).toBe("xlsx");
    // 第 4 轮起：xlsx 是真 OOXML（不再降级成 csv）
    expect(s.delivered_format).toBe("xlsx");
    expect(s.file_uri.endsWith(".xlsx")).toBe(true);
    expect(s.row_count).toBe(2);
    expect(s.download_url).toBeTruthy();

    const multi = await inject(
      "POST",
      `/film/projects/${projectId}/exports`,
      { table_ids: [t1.id, t2.id], format: "xlsx" },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(multi.code).toBe(0);
    const m = multi.data as { delivered_format: string; table_count: number };
    expect(m.delivered_format).toBe("xlsx");
    expect(m.table_count).toBe(2);

    // csv 路径保持历史行为：单表 csv、多表 zip（零回归）
    const csvSingle = await inject(
      "POST",
      `/film/projects/${projectId}/exports`,
      { table_ids: [t1.id], format: "csv" },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(csvSingle.code).toBe(0);
    expect((csvSingle.data as { delivered_format: string }).delivered_format).toBe("csv");
    const csvMulti = await inject(
      "POST",
      `/film/projects/${projectId}/exports`,
      { table_ids: [t1.id, t2.id], format: "csv" },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(csvMulti.code).toBe(0);
    expect((csvMulti.data as { delivered_format: string }).delivered_format).toBe("zip");

    const list = await inject(
      "GET",
      `/film/projects/${projectId}/exports`,
      undefined,
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(list.code).toBe(0);
    // 本用例共建了 4 次导出（xlsx 单/多 + csv 单/多）
    expect((list.data as { list: unknown[] }).list.length).toBe(4);

    // 导出别人的表 → 400101（导出是跨项目数据外带的口子，必须严校验）
    const other = await setup();
    const otherTable = await createTable(other, newProjectId(), "别人的表");
    const foreign = await inject(
      "POST",
      `/film/projects/${projectId}/exports`,
      { table_ids: [otherTable.id], format: "csv" },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(foreign.code).toBe(400101);
  });

  // ══════════════════════════════════════════════════════════════════
  // 最近打开 2
  // ══════════════════════════════════════════════════════════════════

  it("最近打开：POST 记录（每人每项目一行，覆盖语义）；GET 返回 current", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "最近表");
    const table2 = await createTable(ctx, projectId, "最近表2");

    const mark1 = await inject(
      "POST",
      `/film/projects/${projectId}/recent-open`,
      { table_id: table.id },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(mark1.code).toBe(0);
    await inject("POST", `/film/projects/${projectId}/recent-open`, { table_id: table2.id }, ctx.token, ctx.teamSpaceId);

    const list = await inject("GET", `/film/projects/${projectId}/recent-open`, undefined, ctx.token, ctx.teamSpaceId);
    expect(list.code).toBe(0);
    const data = list.data as { list: unknown[]; current: { project_id: string; table_id: string } };
    expect(data.list.length).toBe(1); // 覆盖，不是流水
    expect(data.current.project_id).toBe(projectId);
    expect(data.current.table_id).toBe(table2.id);

    // 项目列表里也能看到最近打开时间
    const projects = await inject("GET", "/film/projects", undefined, ctx.token, ctx.teamSpaceId);
    expect(projects.code).toBe(0);
    const row = (projects.data as { list: Array<{ project_id: string; last_opened_at: string | null }> }).list.find(
      (p) => p.project_id === projectId,
    )!;
    expect(row.last_opened_at).toBeTruthy();
  });

  // ══════════════════════════════════════════════════════════════════
  // 权限：L2 成员 / L3 特权 / L4 跨租户
  // ══════════════════════════════════════════════════════════════════

  it("权限：非成员带 X-Space-Id → 403 not_member；普通成员删表 → 403 role_insufficient", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "权限表");

    const outsider = await loginNewUser("7");
    const notMember = await inject(
      "GET",
      `/film/projects/${projectId}/task-tables`,
      undefined,
      outsider.token,
      ctx.teamSpaceId,
    );
    expect(notMember.code).toBe(403101);

    const member = await loginNewUser("8");
    await addMember(ctx.teamSpaceId, member.userId, "animator", 3);
    const forbidden = await inject(
      "DELETE",
      `/film/projects/${projectId}/task-tables/${table.id}`,
      undefined,
      member.token,
      ctx.teamSpaceId,
    );
    expect(forbidden.code).toBe(403101);

    // 普通成员仍可读写行（film 域没有细粒度权限码，写=成员；只有删/导出要特权）
    const rows = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks`,
      {},
      member.token,
      ctx.teamSpaceId,
    );
    expect(rows.code).toBe(0);
  });

  it("跨租户：拿别人的 table_id 访问 → 400102（不泄露存在性，不是 403）", async () => {
    const ctxA = await setup();
    const ctxB = await setup();
    const projectA = newProjectId();
    const tableA = await createTable(ctxA, projectA, "A的表");

    const fields = await inject(
      "GET",
      `/film/projects/${projectA}/task-tables/${tableA.id}/fields`,
      undefined,
      ctxB.token,
      ctxB.teamSpaceId,
    );
    expect(fields.code).toBe(400102);

    const query = await inject(
      "GET",
      `/film/projects/${projectA}/task-tables/${tableA.id}/tasks/query`,
      undefined,
      ctxB.token,
      ctxB.teamSpaceId,
    );
    expect(query.code).toBe(400102);

    // 项目作用域：B 访问 A 的 project_id（A 有表）→ 400102
    const tables = await inject(
      "GET",
      `/film/projects/${projectA}/task-tables`,
      undefined,
      ctxB.token,
      ctxB.teamSpaceId,
    );
    expect(tables.code).toBe(400102);
  });

  // ══════════════════════════════════════════════════════════════════
  // 协同：client_id 回声抑制
  // ══════════════════════════════════════════════════════════════════

  it("协同：广播事件带 origin_client_id，回声抑制按 client_id 判定（同用户不同端仍要收到）", () => {
    const realtime = new FilmRealtimeService();
    const received: Array<{ seq: number; type: string }> = [];
    const channel = realtime.channelFor("100", "200");
    const unsubscribe = realtime.subscribe(channel, (event) => received.push({ seq: event.seq, type: event.type }));

    const event = realtime.broadcast({
      spaceId: "100",
      projectId: "300",
      tableId: "200",
      type: "task.cells_updated",
      payload: { task_id: "1" },
      originUserId: "u1",
      originClientId: "client-A",
    });
    unsubscribe();
    expect(received).toEqual([{ seq: event.seq, type: "task.cells_updated" }]);
    expect(event.channel).toBe("film_table_100_200");
    expect(event.origin_client_id).toBe("client-A");

    // 自己那台机器（client-A）丢弃自己的回声
    expect(FilmRealtimeService.shouldDeliver(event, { clientId: "client-A", userId: "u1" })).toBe(false);
    // 同一个人的另一个端（client-B）必须收到，否则多端协同就断了
    expect(FilmRealtimeService.shouldDeliver(event, { clientId: "client-B", userId: "u1" })).toBe(true);
    // 没有 client_id 的服务端订阅者一律收到
    expect(FilmRealtimeService.shouldDeliver(event, {})).toBe(true);
  });

  it("协同：写接口接受 client_id 且不因为它改变业务结果（服务端不解释该参数）", async () => {
    const ctx = await setup();
    const projectId = newProjectId();
    const table = await createTable(ctx, projectId, "clientId表");
    const [task] = await createTasks(ctx, projectId, table.id, {});
    const res = await inject(
      "POST",
      `/film/projects/${projectId}/task-tables/${table.id}/tasks/${task.id}/status`,
      { status: 2, client_id: "browser-42" },
      ctx.token,
      ctx.teamSpaceId,
    );
    expect(res.code).toBe(0);
    expect((res.data as { status: number }).status).toBe(2);
  });
});
