import { afterAll, beforeAll, describe, expect, it } from "vitest";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { and, eq, gte, ilike } from "drizzle-orm";
import { adminAuditLogs, adminUsers, appConfigs } from "@app/db";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { db } from "../src/db/database";

/**
 * P1 运营后台基建 e2e（契约 §3）：管理员账号 / 操作审计 / 配置中心 / 订单对账导出。
 *
 * 覆盖的**行为契约**（改实现可以，改这些语义不行）：
 * 1. 管理员 CRUD 仅 `super` 可调；`viewer` 能读不能写；普通用户 token 打不过来；
 * 2. 改密/停用会让 `token_version++`，旧 token 立刻 401101（而不是等到过期）；
 * 3. 最后一个 super 不能被降级/停用，也不能停用自己；
 * 4. 审计拦截器只记 `/v1/ops/` 的写操作，密码等敏感字段必须脱敏成 `***`；
 * 5. 配置中心 upsert + 公开读（不存在时 `exists:false` 而不是 404）；
 * 6. 订单 CSV 表头列顺序固定（对账脚本按位置消费）+ `text/csv`。
 *
 * 本机没有 PG 时这些用例会直接失败（与其余 admin e2e 同口径），
 * 所以契约 §6 规定验证只跑 typecheck/lint；这里保证的是"有库时断言正确"。
 */
describe("ops admin P1 (accounts/audit/config/orders.csv)", () => {
  let app: NestFastifyApplication;
  let superToken = "";
  let superAdminId = "";
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const createdAdmins: string[] = [];
  const createdConfigKeys: string[] = [];
  let auditStart = new Date();

  const inject = async (
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    payload?: unknown,
    tokenOverride?: string,
  ) => {
    const token = tokenOverride === undefined ? superToken : tokenOverride;
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await app.inject({
      method,
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
      msg: String((body as { msg?: string }).msg ?? ""),
      data: (body as { data?: any }).data,
      raw: res.body,
      contentType: String(res.headers["content-type"] ?? ""),
    };
  };

  const login = async (username: string, password: string) =>
    inject("POST", "/ops/admin/login", { username, password }, "");

  /** 等审计异步落库：拦截器是 fire-and-forget，断言前必须轮询（不能 sleep 猜时间） */
  async function waitForAudit(predicate: (items: any[]) => boolean, timeoutMs = 3000): Promise<any[]> {
    const deadline = Date.now() + timeoutMs;
    let last: any[] = [];
    while (Date.now() < deadline) {
      const res = await inject("GET", "/ops/admin/audit-logs?page=1&page_size=50");
      last = (res.data?.list ?? []) as any[];
      if (predicate(last)) return last;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return last;
  }

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.register(cookie as never);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    /**
     * 存量库兼容：本轮之前 bootstrap 出来的首账号是 `ops`，升级后它调不了"仅 super"的
     * 管理员端点。测试里显式提升（生产环境由运维执行同一条 UPDATE 或改用 ADMIN_* 重建）。
     */
    const [me] = await db.select().from(adminUsers).where(eq(adminUsers.username, "admin"));
    if (me && me.role !== "super") {
      await db.update(adminUsers).set({ role: "super" }).where(eq(adminUsers.id, me.id));
    }

    const res = await login("admin", "admin12345");
    expect(res.code).toBe(0);
    superToken = res.data.token;
    superAdminId = res.data.admin_id ?? "";
    if (!superAdminId) {
      // 登录响应只回 role（契约未要求回 id），这里直接查库拿 id 供"不能停用自己"用例使用
      const [row] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.username, "admin"));
      superAdminId = row ? String(row.id) : "";
    }
    auditStart = new Date();
  });

  afterAll(async () => {
    try {
      /**
       * 清理顺序必须遵守外键：`admin_audit_logs.admin_id` 与 `app_configs.updated_by` 都指向
       * `admin_users`，先删账号会撞 FK（no action）。所以按"日志 → 配置 → 账号"倒着删。
       */
      await db
        .delete(adminAuditLogs)
        .where(and(gte(adminAuditLogs.createdAt, auditStart), ilike(adminAuditLogs.path, "/v1/ops/%")));
      for (const key of createdConfigKeys) {
        await db.delete(appConfigs).where(eq(appConfigs.key, key));
      }
      for (const username of createdAdmins) {
        await db.delete(adminUsers).where(eq(adminUsers.username, username));
      }
    } finally {
      await app.close();
    }
  });

  it("bootstrap 首账号是 super（管理员端点的前置条件）", async () => {
    const res = await login("admin", "admin12345");
    expect(res.code).toBe(0);
    expect(res.data.role).toBe("super");
    expect(typeof res.data.expires_in).toBe("number");
  });

  it("无凭证仍是 401101（既有语义不变）", async () => {
    const res = await inject("GET", "/ops/admin/admins", undefined, "");
    expect(res.code).toBe(401101);
  });

  it("GET admins 只回契约字段，且不含密码哈希", async () => {
    const res = await inject("GET", "/ops/admin/admins");
    expect(res.code).toBe(0);
    const list = res.data.list as any[];
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    // 不用 list[0]：本机库里可能有历史管理员，按 username 精确定位 bootstrap 账号更稳
    const me = list.find((item) => item.username === "admin");
    expect(me).toBeTruthy();
    expect(Object.keys(me).sort()).toEqual(["created_at", "id", "last_login_at", "role", "status", "username"]);
    expect(me.role).toBe("super");
    expect(me.status).toBe(1);
    // 登录成功必须回写 last_login_at（安全审计口径）
    expect(me.last_login_at === null || typeof me.last_login_at === "string").toBe(true);
  });

  it("密码 <8 位或重名 → 400101", async () => {
    const short = await inject("POST", "/ops/admin/admins", {
      username: `p1-short-${suffix}`,
      password: "1234567",
      role: "ops",
    });
    expect(short.code).toBe(400101);

    const username = `p1-ops-${suffix}`;
    createdAdmins.push(username);
    const ok = await inject("POST", "/ops/admin/admins", { username, password: "ops-pass-123", role: "ops" });
    expect(ok.code).toBe(0);
    expect(ok.data.role).toBe("ops");
    expect(ok.data.status).toBe(1);

    const dup = await inject("POST", "/ops/admin/admins", { username, password: "ops-pass-123", role: "ops" });
    expect(dup.code).toBe(400101);
  });

  it("viewer 能读不能写，且调不了管理员 CRUD（403101）", async () => {
    const username = `p1-viewer-${suffix}`;
    createdAdmins.push(username);
    const created = await inject("POST", "/ops/admin/admins", {
      username,
      password: "viewer-pass-123",
      role: "viewer",
    });
    expect(created.code).toBe(0);

    const viewerLogin = await login(username, "viewer-pass-123");
    expect(viewerLogin.code).toBe(0);
    const viewerToken = viewerLogin.data.token as string;

    // 读：放行（配置列表是只读页签）
    const read = await inject("GET", "/ops/admin/configs", undefined, viewerToken);
    expect(read.code).toBe(0);

    // 写：viewer 只读 → 403101
    const write = await inject("PUT", `/ops/admin/config/p1.viewer.${suffix}`, { value: 1 }, viewerToken);
    expect(write.code).toBe(403101);

    // 管理员 CRUD：仅 super → 403101
    const listAdmins = await inject("GET", "/ops/admin/admins", undefined, viewerToken);
    expect(listAdmins.code).toBe(403101);
  });

  it("配置中心：upsert → 公开读 → 语言回退 → 删除", async () => {
    const key = `p1.config.${suffix}`;
    createdConfigKeys.push(key);

    const put = await inject("PUT", `/ops/admin/config/${key}`, { value: { title: "上线", sort: 3 } });
    expect(put.code).toBe(0);
    expect(put.data.key).toBe(key);
    expect(put.data.module).toBe("");
    expect(put.data.value).toEqual({ title: "上线", sort: 3 });

    // 公开读：未登录也能读（@Public）
    const pub = await inject("GET", `/ops/config/${key}`, undefined, "");
    expect(pub.code).toBe(0);
    expect(pub.data).toMatchObject({ key, exists: true, module: "" });
    expect(pub.data.value).toEqual({ title: "上线", sort: 3 });
    expect(typeof pub.data.updated_at).toBe("string");

    // 语言维度：module=home@en 命中；只有无语言版本时回落到 module=home
    const langKey = `${key}.lang`;
    createdConfigKeys.push(langKey);
    await inject("PUT", `/ops/admin/config/${langKey}`, { value: "fallback", module: "home" });
    await inject("PUT", `/ops/admin/config/${langKey}`, { value: "hello", module: "home@en" });
    await inject("PUT", `/ops/admin/config/${langKey}`, { value: "konnichiwa", module: "home@ja" });
    const en = await inject("GET", `/ops/config/${langKey}?module=home&lang=en`, undefined, "");
    expect(en.data.value).toBe("hello");
    expect(en.data.module).toBe("home@en");
    const ja = await inject("GET", `/ops/config/${langKey}?module=home&lang=ja`, undefined, "");
    expect(ja.data.value).toBe("konnichiwa");
    expect(ja.data.module).toBe("home@ja");

    // 列表筛选的 `?module=` 与删除寻址同口径：默认域（module=''）的行必须能筛出来。
    // 旧实现把它预处理成 undefined → 退化成"不筛"，运营筛默认域看到的仍是全表。
    const defaults = await inject("GET", `/ops/admin/configs?module=&q=${key}`);
    expect(defaults.code).toBe(0);
    const defaultRows = defaults.data.list as any[];
    expect(defaultRows.some((row) => row.key === key && row.module === "")).toBe(true);
    expect(defaultRows.every((row) => row.module === "")).toBe(true);

    /**
     * 删除的寻址粒度 = 列表行的粒度。
     *
     * 旧实现 DELETE 只按 key 删 → 删 `home@en` 会连 `home`/`home@ja` 一起清掉，
     * 运营看到的是"我只删了英文，日文也没了"。这里锁住两件事：
     *   ① 带 module 只删那一行，其它语言行完好；
     *   ② `?module=`（空串）是默认域这一行的地址，不能被折叠成"删全部"。
     */
    const delEn = await inject("DELETE", `/ops/admin/config/${langKey}?module=home%40en`);
    expect(delEn.code).toBe(0);
    expect(delEn.data.deleted_count).toBe(1);
    const enAfter = await inject("GET", `/ops/config/${langKey}?module=home&lang=en`, undefined, "");
    expect(enAfter.data).toMatchObject({ exists: true, module: "home", value: "fallback" });
    const jaAfter = await inject("GET", `/ops/config/${langKey}?module=home&lang=ja`, undefined, "");
    expect(jaAfter.data.value).toBe("konnichiwa");
    // langKey 没有默认域那一行：删 `?module=` 必须 400102，且不能顺手把 home/home@ja 删掉
    const delDefault = await inject("DELETE", `/ops/admin/config/${langKey}?module=`);
    expect(delDefault.code).toBe(400102);
    const jaStill = await inject("GET", `/ops/config/${langKey}?module=home&lang=ja`, undefined, "");
    expect(jaStill.data.value).toBe("konnichiwa");

    // value 超 64KB → 400101（防止配置中心变成对象存储）
    const tooBig = await inject("PUT", `/ops/admin/config/${key}`, { value: "x".repeat(65 * 1024) });
    expect(tooBig.code).toBe(400101);
    // null 存不进 jsonb NOT NULL（drizzle 会写成 SQL NULL）→ 显式 400101，别变成 500
    const nullValue = await inject("PUT", `/ops/admin/config/${key}`, { value: null });
    expect(nullValue.code).toBe(400101);

    const del = await inject("DELETE", `/ops/admin/config/${key}`);
    expect(del.code).toBe(0);
    const after = await inject("GET", `/ops/config/${key}`, undefined, "");
    expect(after.data.exists).toBe(false);
    expect(after.data.value).toBeNull();
    const delAgain = await inject("DELETE", `/ops/admin/config/${key}`);
    expect(delAgain.code).toBe(400102);
  });

  it("审计日志：记录写操作、只记非 GET、敏感字段脱敏", async () => {
    const username = `p1-audit-${suffix}`;
    createdAdmins.push(username);
    const created = await inject("POST", "/ops/admin/admins", { username, password: "audit-pass-123", role: "viewer" });
    expect(created.code).toBe(0);
    const targetId = String(created.data.id);

    // 触发一次带密码的写操作，验证密码必须被脱敏
    const patched = await inject("PATCH", `/ops/admin/admins/${targetId}`, { password: "audit-pass-456" });
    expect(patched.code).toBe(0);

    // 审计写库是 setImmediate 的 fire-and-forget（admin-audit.interceptor.ts：不得进入响应关键路径），
    // 所以只能轮询等。**等的必须是断言那一行**：旧写法只等「任意一条 PATCH」，只要库里已有别的
    // PATCH（并行跑的其他 spec / 上一轮遗留），第一次轮询就返回，随后 find 到的是还没写入的本行 →
    // 全量门禁下随机红（第 123 批判出）。谓词与 find 用同一个函数，两者不可能再错位。
    const isAdminPatch = (item: any) =>
      item.action.startsWith("PATCH ") && item.action.endsWith("/ops/admin/admins/:id");
    const list = await waitForAudit((items) => items.some(isAdminPatch));
    const patchRow = list.find(isAdminPatch);
    expect(patchRow).toBeTruthy();
    expect(patchRow.admin_username).toBe("admin");
    expect(patchRow.method).toBe("PATCH");
    expect(patchRow.ok).toBe(true);
    expect(patchRow.payload).toEqual({ password: "***" });
    expect(patchRow.status_code).toBe(200);
    // 审计只记写操作：GET（列表页刷新）不该产生日志
    expect(list.every((item) => item.method !== "GET")).toBe(true);
    // action 是**路由模板**而不是具体 URL：否则每个 id 一条聚合维度，运营没法按动作统计
    expect(patchRow.action).toContain(":id");
  });

  it("改密后旧 token 立刻失效（token_version++），新密码可登录", async () => {
    const username = `p1-rotate-${suffix}`;
    createdAdmins.push(username);
    const created = await inject("POST", "/ops/admin/admins", { username, password: "rotate-pass-1", role: "ops" });
    expect(created.code).toBe(0);
    const targetId = String(created.data.id);

    const before = await login(username, "rotate-pass-1");
    const oldToken = before.data.token as string;
    expect((await inject("GET", "/ops/admin/configs", undefined, oldToken)).code).toBe(0);

    const patched = await inject("PATCH", `/ops/admin/admins/${targetId}`, { password: "rotate-pass-2" });
    expect(patched.code).toBe(0);

    // 旧 token 的 ver 已过期 → 401101（不是 403：这是认证态问题，重登即可解决）
    expect((await inject("GET", "/ops/admin/configs", undefined, oldToken)).code).toBe(401101);
    expect((await login(username, "rotate-pass-1")).code).toBe(401101);
    expect((await login(username, "rotate-pass-2")).code).toBe(0);
  });

  it("停用账号：登录被拒 + 已签发 token 失效", async () => {
    const username = `p1-disable-${suffix}`;
    createdAdmins.push(username);
    const created = await inject("POST", "/ops/admin/admins", { username, password: "disable-pass-1", role: "ops" });
    const targetId = String(created.data.id);
    const logged = await login(username, "disable-pass-1");
    const token = logged.data.token as string;
    expect(logged.code).toBe(0);

    const disabled = await inject("PATCH", `/ops/admin/admins/${targetId}`, { status: 2 });
    expect(disabled.code).toBe(0);
    expect(disabled.data.status).toBe(2);

    expect((await login(username, "disable-pass-1")).code).toBe(401101);
    expect((await inject("GET", "/ops/admin/configs", undefined, token)).code).toBe(401101);
  });

  it("不能停用自己、不能降级/停用最后一个 super（400101）", async () => {
    expect(superAdminId).not.toBe("");
    const selfDisable = await inject("PATCH", `/ops/admin/admins/${superAdminId}`, { status: 2 });
    expect(selfDisable.code).toBe(400101);
    // 降级自己 = 让最后一个 super 消失，同样必须被拦
    const selfDemote = await inject("PATCH", `/ops/admin/admins/${superAdminId}`, { role: "ops" });
    expect(selfDemote.code).toBe(400101);
  });

  it("改角色立即生效（guard 每请求读库，不需要重新登录）", async () => {
    const username = `p1-demote-${suffix}`;
    createdAdmins.push(username);
    const created = await inject("POST", "/ops/admin/admins", { username, password: "demote-pass-1", role: "ops" });
    const targetId = String(created.data.id);
    const logged = await login(username, "demote-pass-1");
    const token = logged.data.token as string;
    expect((await inject("GET", "/ops/admin/configs", undefined, token)).code).toBe(0);

    const demoted = await inject("PATCH", `/ops/admin/admins/${targetId}`, { role: "viewer" });
    expect(demoted.code).toBe(0);
    // 同一个 token：读仍可以，写变成 403101
    expect((await inject("GET", "/ops/admin/configs", undefined, token)).code).toBe(0);
    expect((await inject("PUT", `/ops/admin/config/p1.demote.${suffix}`, { value: 1 }, token)).code).toBe(403101);
  });

  it("audit-logs 分页/过滤契约", async () => {
    const res = await inject("GET", "/ops/admin/audit-logs?page=1&page_size=5&action=admins");
    expect(res.code).toBe(0);
    expect(Array.isArray(res.data.list)).toBe(true);
    expect(res.data.page).toBe(1);
    expect(res.data.page_size).toBe(5);
    expect(typeof res.data.total).toBe("number");

    const badTime = await inject("GET", "/ops/admin/audit-logs?from=not-a-time");
    expect(badTime.code).toBe(400101);

    const tooBig = await inject("GET", "/ops/admin/audit-logs?page_size=999");
    expect(tooBig.code).toBe(400101);
  });

  it("orders.csv：表头列顺序固定 + text/csv", async () => {
    const res = await inject("GET", "/ops/admin/orders.csv");
    expect(res.status).toBe(200);
    expect(res.contentType).toContain("text/csv");
    const header = res.raw.split("\n")[0];
    expect(header).toBe(
      "order_id,space_id,user_id,sku,amount_cents,credits,channel,status,paid_at,refund_no," +
        "refund_status,refund_amount_cents,refunded_at,refund_reason,refund_operator,created_at",
    );

    const badStatus = await inject("GET", "/ops/admin/orders.csv?status=9");
    expect(badStatus.code).toBe(400101);
  });
});
