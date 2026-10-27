import { afterAll, beforeAll, describe, expect, it } from "vitest";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq } from "drizzle-orm";
import { promoSlots } from "@app/db";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { db } from "../src/db/database";

/**
 * 运营位后台（模块 #27 收尾）：`/ops/admin/promo-slots` CRUD + 时间窗口生效判断。
 *
 * 重点验证四件事：
 * 1. **四类 slot 合法、异类拒绝**：banner/pop_up/activity/creator，配错立刻 400101
 *    （而不是"存进去但首页永远不显示"）；
 * 2. **`active_now` 是真的按时间算的**：未开始/已结束/停用三种情况都必须 false，
 *    运营列表必须能一眼看出"这条现在到底上不上"；
 * 3. **改/删的边界**：不存在的 id → 400102；非法时间串 → 400101；
 * 4. **权限**：无凭证 401、拿普通用户 token 403（AdminGuard 语义，别把用户 token 当管理凭证）。
 */
describe("ops admin promo slots e2e", () => {
  let app: NestFastifyApplication;
  let adminToken = "";
  const created: string[] = [];

  const adminInject = async (method: string, url: string, payload?: unknown, tokenOverride?: string) => {
    const token = tokenOverride === undefined ? adminToken : tokenOverride;
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await app.inject({
      method: method as "GET" | "POST" | "PUT" | "DELETE",
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
    };
  };

  type SlotDto = {
    id: string;
    slot: string;
    title: string;
    sort: number;
    status: number;
    starts_at: string | null;
    ends_at: string | null;
    active_now: boolean;
    created_by: string | null;
  };

  /** 普通用户 token（用于验证 AdminGuard 不把用户当管理员 / 调公开读接口） */
  async function loginUserToken(): Promise<string> {
    const phone = `1${String(Date.now()).slice(-8)}${String(Math.floor(Math.random() * 90) + 10)}`;
    const sms = await app.inject({
      method: "POST",
      url: "/v1/auth/sms-code",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ phone }),
    });
    const code = (JSON.parse(sms.body) as { data?: { debug_code?: string } }).data?.debug_code;
    const loginRes = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ phone, code, age_confirmed: true }),
    });
    return (JSON.parse(loginRes.body) as { data?: { access_token?: string } }).data?.access_token ?? "";
  }

  const create = async (payload: Record<string, unknown>): Promise<SlotDto> => {
    const res = await adminInject("POST", "/ops/admin/promo-slots", payload);
    expect(res.code, `create failed: ${res.msg}`).toBe(0);
    const dto = res.data as SlotDto;
    created.push(dto.id);
    return dto;
  };

  beforeAll(async () => {
    const appInstance = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    await appInstance.register(cookie as never);
    appInstance.setGlobalPrefix("v1");
    appInstance.useGlobalFilters(new AllExceptionsFilter());
    appInstance.useGlobalInterceptors(new EnvelopeInterceptor());
    await appInstance.init();
    app = appInstance;

    const login = await adminInject("POST", "/ops/admin/login", {
      username: "admin",
      password: "admin12345",
    });
    expect(login.code).toBe(0);
    adminToken = (login.data as { token: string }).token;
  });

  afterAll(async () => {
    // 只删本套件创建的行（按 id），不碰其它运营数据
    for (const id of created) {
      await db.delete(promoSlots).where(eq(promoSlots.id, BigInt(id)));
    }
    await app.close();
  });

  it("列表接口可用且返回四类枚举（管理端要能配）", async () => {
    const res = await adminInject("GET", "/ops/admin/promo-slots");
    expect(res.code).toBe(0);
    const data = res.data as { list: SlotDto[]; count: number; slots: string[] };
    expect(Array.isArray(data.list)).toBe(true);
    expect(data.count).toBe(data.list.length);
    expect(data.slots).toEqual(["banner", "pop_up", "activity", "creator"]);
  });

  it("创建生效中的 banner：active_now=true，且落真实操作人（created_by=admin）", async () => {
    const now = Date.now();
    const dto = await create({
      slot: "banner",
      title: "双十一活动",
      image_uri: "promo/banner-1.png",
      link_uri: "/pricing",
      sort: 10,
      starts_at: new Date(now - 3600_000).toISOString(),
      ends_at: new Date(now + 3600_000).toISOString(),
    });
    expect(dto.slot).toBe("banner");
    expect(dto.status).toBe(1);
    expect(dto.active_now).toBe(true);

    // 迁移 0028：created_by 的外键指向 admin_users(id)，运营身份必须留痕（审计要求）
    const [row] = await db
      .select({ createdBy: promoSlots.createdBy })
      .from(promoSlots)
      .where(eq(promoSlots.id, BigInt(dto.id)));
    expect(row.createdBy).not.toBeNull();
  });

  it("配置驱动闭环：新建的 banner 立即出现在公开读接口 crc/banner_list，停用后消失", async () => {
    const dto = await create({
      slot: "banner",
      title: "闭环验证 banner",
      image_uri: "promo/loop.png",
      sort: 1,
    });

    const userToken = await loginUserToken();
    const listed = await app.inject({
      method: "GET",
      url: "/v1/crc/banner_list?type=banner",
      headers: { authorization: `Bearer ${userToken}` },
    });
    const listedBody = JSON.parse(listed.body) as {
      code: number;
      data?: { list?: Array<{ id: string; title: string }> };
    };
    expect(listedBody.code).toBe(0);
    const ids = (listedBody.data?.list ?? []).map((item) => String(item.id));
    expect(ids).toContain(dto.id);

    // 停用 → 公开读接口立即不再返回（这就是"运营位生效"的验收点）
    await adminInject("PUT", `/ops/admin/promo-slots/${dto.id}`, { status: 2 });
    const after = await app.inject({
      method: "GET",
      url: "/v1/crc/banner_list?type=banner",
      headers: { authorization: `Bearer ${userToken}` },
    });
    const afterBody = JSON.parse(after.body) as { data?: { list?: Array<{ id: string }> } };
    const afterIds = (afterBody.data?.list ?? []).map((item) => String(item.id));
    expect(afterIds).not.toContain(dto.id);
  });

  it("创建未开始 / 已结束 / 停用三种：active_now 全为 false", async () => {
    const now = Date.now();
    const future = await create({
      slot: "pop_up",
      title: "明天开始",
      starts_at: new Date(now + 3600_000).toISOString(),
    });
    expect(future.active_now).toBe(false);

    const past = await create({
      slot: "activity",
      title: "已经结束",
      ends_at: new Date(now - 1000).toISOString(),
    });
    expect(past.active_now).toBe(false);

    const disabled = await create({ slot: "creator", title: "停用素材", status: 2 });
    expect(disabled.active_now).toBe(false);
  });

  it("按 slot / status 过滤列表", async () => {
    const bySlot = await adminInject("GET", "/ops/admin/promo-slots?slot=pop_up");
    expect(bySlot.code).toBe(0);
    const list = (bySlot.data as { list: SlotDto[] }).list;
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((item) => item.slot === "pop_up")).toBe(true);

    const disabled = await adminInject("GET", "/ops/admin/promo-slots?status=2");
    const disabledList = (disabled.data as { list: SlotDto[] }).list;
    expect(disabledList.every((item) => item.status === 2)).toBe(true);
  });

  it("同 slot 内按 sort 升序（运营列表顺序可预期）", async () => {
    const a = await create({ slot: "banner", title: "sort-30", sort: 30 });
    const b = await create({ slot: "banner", title: "sort-5", sort: 5 });
    const res = await adminInject("GET", "/ops/admin/promo-slots?slot=banner");
    const list = (res.data as { list: SlotDto[] }).list;
    const own = list.filter((item) => item.id === a.id || item.id === b.id).map((item) => item.sort);
    expect(own).toEqual([5, 30]);
  });

  it("更新：停用后 active_now 立刻变 false；改名字/排序生效", async () => {
    const now = Date.now();
    const dto = await create({
      slot: "banner",
      title: "待改",
      starts_at: new Date(now - 1000).toISOString(),
      ends_at: new Date(now + 3600_000).toISOString(),
    });
    expect(dto.active_now).toBe(true);

    const updated = await adminInject("PUT", `/ops/admin/promo-slots/${dto.id}`, {
      title: "已改",
      sort: 99,
      status: 2,
    });
    expect(updated.code).toBe(0);
    const after = updated.data as SlotDto;
    expect(after.title).toBe("已改");
    expect(after.sort).toBe(99);
    expect(after.status).toBe(2);
    expect(after.active_now).toBe(false);
  });

  it("非法入参：未知 slot 类型 / 非法时间 → 400101", async () => {
    const badSlot = await adminInject("POST", "/ops/admin/promo-slots", { slot: "video" });
    expect(badSlot.code).toBe(400101);

    const badTime = await adminInject("POST", "/ops/admin/promo-slots", {
      slot: "banner",
      starts_at: "not-a-date",
    });
    // 时间串在 service 层解析 → 同样是参数错误（不是 500）
    expect(badTime.code).toBe(400101);

    const missingSlot = await adminInject("POST", "/ops/admin/promo-slots", { title: "没有类型" });
    expect(missingSlot.code).toBe(400101);
  });

  it("更新不存在 / 删除不存在的 id → 400102", async () => {
    const update = await adminInject("PUT", "/ops/admin/promo-slots/999999999999", { title: "x" });
    expect(update.code).toBe(400102);
    const remove = await adminInject("DELETE", "/ops/admin/promo-slots/999999999999");
    expect(remove.code).toBe(400102);
  });

  it("删除幂等语义：首次成功，二次 400102", async () => {
    const dto = await create({ slot: "banner", title: "待删" });
    const first = await adminInject("DELETE", `/ops/admin/promo-slots/${dto.id}`);
    expect(first.code).toBe(0);
    expect((first.data as { ok: boolean }).ok).toBe(true);
    const second = await adminInject("DELETE", `/ops/admin/promo-slots/${dto.id}`);
    expect(second.code).toBe(400102);
  });

  it("权限：无凭证 401、普通用户 token 403", async () => {
    const anonymous = await adminInject("GET", "/ops/admin/promo-slots", undefined, "");
    expect(anonymous.code).toBe(401101);

    // 普通用户 token 不是管理员凭证 → 403（不是"降级成用户身份"）
    const userToken = await loginUserToken();
    const asUser = await adminInject("GET", "/ops/admin/promo-slots", undefined, userToken);
    expect(asUser.code).toBe(403101);
  });
});
