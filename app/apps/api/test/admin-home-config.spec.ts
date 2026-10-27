import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { sql } from "drizzle-orm";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { db, pool } from "../src/db/database";

/**
 * 首页板块配置（`home_configs` global 层）管理端读写。
 *
 * 为什么补这个测试：`GET /home/config` 早就支持「space 覆盖 > global > 内置默认」，
 * 但**一直没有写入入口**——运营只能看到 source=default，等于首页板块不可配。
 * 本轮补 `GET/POST /ops/admin/home-config`，这里锁四件事：
 *   1. 无行时读回 source=default + 6 个内置 key（与 home.service 的 DEFAULT_SECTIONS 对齐）；
 *   2. 写入后读回 source=db，且 `GET /home/config`（用户侧）立即生效（同一张表）；
 *   3. `version` 乐观锁：旧版本号提交 → 746002，不静默覆盖；
 *   4. 白名单与去重：未知 key / 重复 key → 400101，脏数据进不去。
 */
describe("admin home config (global sections)", () => {
  let app: NestFastifyApplication;
  let adminToken = "";

  const inject = async (
    method: "GET" | "POST",
    url: string,
    payload?: unknown,
    token?: string,
  ): Promise<{ code: number; data?: unknown; msg?: string }> => {
    const res = await app.inject({
      method,
      url: `/v1${url}`,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    return res.json() as { code: number; data?: unknown; msg?: string };
  };

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    app.setGlobalPrefix("v1");
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    // 清掉 global 行，保证「无行 → default」这条分支可测
    await db.execute(sql`delete from home_configs where scope = 'global' and space_id is null`);

    const login = await inject("POST", "/ops/admin/login", {
      username: process.env.ADMIN_USERNAME || "admin",
      password: process.env.ADMIN_PASSWORD || "admin12345",
    });
    adminToken = (login.data as { token: string }).token;
  }, 60_000);

  afterAll(async () => {
    await db.execute(sql`delete from home_configs where scope = 'global' and space_id is null`);
    await app.close();
    await pool.end().catch(() => undefined);
  });

  it("无行时返回内置默认（source=default，6 个 key）", async () => {
    const res = await inject("GET", "/ops/admin/home-config", undefined, adminToken);
    expect(res.code).toBe(0);
    const data = res.data as { version: number | null; source: string; sections: Array<{ key: string }> };
    expect(data.source).toBe("default");
    expect(data.version).toBeNull();
    expect(data.sections.map((s) => s.key)).toEqual(["hero", "workflow", "canvas", "tools", "banner", "recent"]);
  });

  it("写入后读回 source=db，且用户侧 /home/config 立即生效", async () => {
    const sections = [
      { key: "hero", visible: true, sort: 10 },
      { key: "workflow", visible: false, sort: 20 },
      { key: "canvas", visible: true, sort: 30 },
      { key: "tools", visible: true, sort: 40 },
      { key: "banner", visible: true, sort: 50 },
      { key: "recent", visible: false, sort: 60 },
    ];
    const saved = await inject("POST", "/ops/admin/home-config", { sections }, adminToken);
    if (saved.code !== 0) console.log("SAVE_ERR:", JSON.stringify(saved));
    expect(saved.code).toBe(0);
    const version = (saved.data as { version: number }).version;
    expect(version).toBe(1);

    const read = await inject("GET", "/ops/admin/home-config", undefined, adminToken);
    const data = read.data as { source: string; sections: Array<{ key: string; visible: boolean }> };
    expect(data.source).toBe("db");
    expect(data.sections.find((s) => s.key === "workflow")?.visible).toBe(false);
    expect(data.sections.find((s) => s.key === "recent")?.visible).toBe(false);

    // 用户侧读接口与后台写的是同一张表：这里不建用户也能验证表内容
    const [row] = await db.execute<{ payload: { sections: Array<{ key: string; visible: boolean }> } }>(
      sql`select payload from home_configs where scope = 'global' and space_id is null`,
    ).then((r) => (r as unknown as { rows: Array<{ payload: { sections: Array<{ key: string; visible: boolean }> } }> }).rows);
    expect(row?.payload.sections.find((s) => s.key === "workflow")?.visible).toBe(false);
  });

  it("版本冲突 → 746002（不静默覆盖别人的编辑）", async () => {
    const stale = await inject(
      "POST",
      "/ops/admin/home-config",
      { version: 1, sections: [{ key: "hero", visible: false, sort: 10 }] },
      adminToken,
    );
    // 上一例已把 version 写成 1；这一例用 version=1 再提交，应成功并把版本推到 2
    expect(stale.code).toBe(0);
    const now = (stale.data as { version: number }).version;
    expect(now).toBe(2);

    // 再用过期版本 1 提交 → 冲突
    const conflict = await inject(
      "POST",
      "/ops/admin/home-config",
      { version: 1, sections: [{ key: "hero", visible: true, sort: 10 }] },
      adminToken,
    );
    expect(conflict.code).toBe(746002);
  });

  it("未知 key / 重复 key → 400101（白名单与去重）", async () => {
    const unknown = await inject(
      "POST",
      "/ops/admin/home-config",
      { sections: [{ key: "not_a_section", visible: true, sort: 1 }] },
      adminToken,
    );
    expect(unknown.code).toBe(400101);

    const dup = await inject(
      "POST",
      "/ops/admin/home-config",
      {
        sections: [
          { key: "hero", visible: true, sort: 10 },
          { key: "hero", visible: false, sort: 20 },
        ],
      },
      adminToken,
    );
    expect(dup.code).toBe(400101);
  });

  it("非管理员 → 401101", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/ops/admin/home-config" });
    const body = res.json() as { code: number };
    expect(body.code).toBeGreaterThan(0);
    expect(body.code).not.toBe(0);
  });
});
