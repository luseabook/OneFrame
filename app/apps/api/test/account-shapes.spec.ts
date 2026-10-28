import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { pool } from "../src/db/database";

/**
 * 账号/鉴权域的「客户端形状」契约（第 85 批，竞品 `/web/v1/user*` 一族）。
 *
 * 这批端点大多**没有竞品字段证据**（两个 schema 都是 `{}`），所以测试要盯的不是"字段名对不对"，
 * 而是三条能自证的性质：
 *  1. 形状在：按竞品的方法+路径打进来不能 404（`POST /user-info`、`PUT /user-settings`、
 *     `GET /user/ip`、`GET /user/credits*`、`POST /buy/sku-price`）；
 *  2. 语义对：设置是"按键合并"不是整体替换、清空头像用 null、余额读的是空间钱包、
 *     价格 POST 与 GET 同一份数据；
 *  3. 边界硬：空 patch、非法 scope_type、未知 event_type、越权/未登录都有明确错误码，
 *     而不是 500 或静默成功。
 */
describe("account shapes (e2e)", () => {
  let app: NestFastifyApplication;
  let token = "";

  const inject = async (
    method: string,
    url: string,
    payload?: unknown,
    authToken?: string,
    headersIn: Record<string, string> = {},
  ) => {
    const headers: Record<string, string> = { ...headersIn };
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (authToken) headers.authorization = `Bearer ${authToken}`;
    const res = await app.inject({
      method: method as "GET" | "POST" | "PUT",
      url: `/v1${url}`,
      headers,
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = JSON.parse(res.body);
    return { status: res.statusCode, ...body, raw: res.body };
  };

  /** 测试环境 sms-code 回显 debug_code，无需读 Redis */
  async function loginNewUser(prefix: string): Promise<string> {
    const phone = `${prefix}${String(Date.now()).slice(-9)}`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const code = sms.data?.debug_code as string;
    const login = await inject("POST", "/auth/login", { phone, code, age_confirmed: true });
    return (login.data?.access_token ?? "") as string;
  }

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter({ trustProxy: true }),
      { logger: false },
    );
    await app.register(cookie as never);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    token = await loginNewUser("18");
    expect(token).not.toBe("");
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  it("POST /user-info 改资料：PATCH 语义、空 body 拒、头像可清空", async () => {
    const before = await inject("GET", "/me", undefined, token);
    expect(before.code).toBe(0);

    // 只给 nickname：头像不动
    const onlyName = await inject(
      "POST",
      "/user-info",
      { nickname: "  新昵称  " },
      token,
    );
    expect(onlyName.code).toBe(0);
    expect(onlyName.data.user.nickname).toBe("新昵称");
    expect(onlyName.data.user.avatar_uri).toBe(before.data.user.avatar_uri);

    // nickname + 头像
    const both = await inject(
      "POST",
      "/user-info",
      { nickname: "二号", avatar_uri: "u/avatar/test.png" },
      token,
    );
    expect(both.code).toBe(0);
    expect(both.data.user.avatar_uri).toBe("u/avatar/test.png");

    // GET /me 能读到（不是只回显入参）
    const afterMe = await inject("GET", "/me", undefined, token);
    expect(afterMe.data.user.nickname).toBe("二号");
    expect(afterMe.data.user.avatar_uri).toBe("u/avatar/test.png");

    // 空 body：拒绝，而不是"什么也没改却 200"
    const empty = await inject("POST", "/user-info", {}, token);
    expect(empty.code).toBe(400101);
    expect(empty.msg).toContain("nothing to update");

    // 空白昵称 / 超长昵称
    const blank = await inject("POST", "/user-info", { nickname: "   " }, token);
    expect(blank.code).toBe(400101);
    expect(blank.msg).toContain("nickname is required");
    const long = await inject("POST", "/user-info", { nickname: "x".repeat(41) }, token);
    expect(long.code).toBe(400101);
    expect(long.msg).toContain("40");

    // null 清空头像
    const cleared = await inject("POST", "/user-info", { avatar_uri: null }, token);
    expect(cleared.code).toBe(0);
    expect(cleared.data.user.avatar_uri).toBeNull();

    // 未知字段被剥掉（不 500、也不假装支持）
    const unknown = await inject("POST", "/user-info", { nickname: "三号", nope: 1 }, token);
    expect(unknown.code).toBe(0);
    expect(unknown.data.user.nickname).toBe("三号");
  });

  it("GET/PUT /user-settings 按键合并、按 scope 隔离、keys 过滤", async () => {
    const empty = await inject("GET", "/user-settings", undefined, token);
    expect(empty.code).toBe(0);
    expect(empty.data.scope_type).toBe("default");
    expect(empty.data.settings).toEqual({});

    const first = await inject(
      "PUT",
      "/user-settings",
      { settings: { guide_dismissed: true, notify: { email: false } } },
      token,
    );
    expect(first.code).toBe(0);
    expect(first.data.updated.sort()).toEqual(["guide_dismissed", "notify"]);
    expect(first.data.settings.guide_dismissed).toBe(true);

    // 第二次只写一个键：另一个键必须还在（合并而不是替换）
    const second = await inject("PUT", "/user-settings", { patch: { theme: "dark" } }, token);
    expect(second.code).toBe(0);
    expect(second.data.settings).toMatchObject({
      guide_dismissed: true,
      theme: "dark",
      notify: { email: false },
    });

    // keys 过滤
    const filtered = await inject(
      "GET",
      "/user-settings?keys=guide_dismissed,missing",
      undefined,
      token,
    );
    expect(filtered.code).toBe(0);
    expect(filtered.data.settings).toEqual({ guide_dismissed: true });

    // 另一个 scope 独立
    const other = await inject(
      "PUT",
      "/user-settings",
      { scope_type: "workspace", settings: { density: "compact" } },
      token,
    );
    expect(other.code).toBe(0);
    const otherRead = await inject("GET", "/user-settings?scope_type=workspace", undefined, token);
    expect(otherRead.data.settings).toEqual({ density: "compact" });
    const defaultRead = await inject("GET", "/user-settings", undefined, token);
    expect(defaultRead.data.settings.density).toBeUndefined();

    // 平铺写法（body 顶层直接是设置对象）
    const flat = await inject("PUT", "/user-settings", { last_tab: "home" }, token);
    expect(flat.code).toBe(0);
    expect(flat.data.updated).toEqual(["last_tab"]);

    // 边界：空 patch / 非法 scope / 超大值
    const emptyPatch = await inject("PUT", "/user-settings", {}, token);
    expect(emptyPatch.code).toBe(400101);
    expect(emptyPatch.msg).toContain("settings are required");
    const badScope = await inject(
      "PUT",
      "/user-settings",
      { scope_type: "BAD SCOPE", settings: { a: 1 } },
      token,
    );
    expect(badScope.code).toBe(400101);
    expect(badScope.msg).toContain("invalid scope_type");
    const big = await inject("PUT", "/user-settings", { settings: { blob: "x".repeat(5000) } }, token);
    expect(big.code).toBe(400101);
    expect(big.msg).toContain("too large");
  });

  it("GET /user/ip 读真实客户端 IP（信任代理时取 X-Forwarded-For 首个）", async () => {
    const plain = await inject("GET", "/user/ip", undefined, token);
    expect(plain.code).toBe(0);
    expect(typeof plain.data.ip).toBe("string");

    const proxied = await inject("GET", "/user/ip", undefined, token, {
      "x-forwarded-for": "203.0.113.9, 10.0.0.1",
    });
    expect(proxied.code).toBe(0);
    expect(proxied.data.ip).toBe("203.0.113.9");
  });

  it("GET /user/credits 与 /user/credits-dashboard：余额读空间钱包，聚合按流水 kind", async () => {
    const balance = await inject("GET", "/user/credits", undefined, token);
    expect(balance.code).toBe(0);
    expect(typeof balance.data.balance).toBe("number");
    expect(balance.data.available).toBe(balance.data.balance);
    // 没建过欠费模型：明确告诉前端别展示"待补缴"入口
    expect(balance.data.debt_supported).toBe(false);

    // 充一笔：mock 下单 + mock 支付，然后看板与流水都要能看到
    const order = await inject("POST", "/billing/orders", { sku: "credits-1000", channel: "mock" }, token);
    expect(order.code).toBe(0);
    const paid = await inject("POST", `/billing/orders/${order.data.order_id}/mock-pay`, {}, token);
    expect(paid.data.credited).toBe(true);

    const after = await inject("GET", "/user/credits", undefined, token);
    expect(after.data.balance).toBe(balance.data.balance + 1000);

    const dashboard = await inject("GET", "/user/credits-dashboard", undefined, token);
    expect(dashboard.code).toBe(0);
    expect(dashboard.data.balance).toBe(after.data.balance);
    expect(dashboard.data.debt_supported).toBe(false);
    expect(dashboard.data.recharged).toBeGreaterThanOrEqual(1000);
    expect(typeof dashboard.data.last_flow_at).toBe("string");
    const recharge = (dashboard.data.by_kind as Array<{ kind: string; flows: number }>).find(
      (row) => row.kind === "recharge",
    );
    expect(recharge?.flows).toBeGreaterThanOrEqual(1);

    // 流水：event_type 映射到 kind 集合
    const rechargeLog = await inject(
      "GET",
      "/user/credits-log?page=1&page_size=10&event_type=recharge",
      undefined,
      token,
    );
    expect(rechargeLog.code).toBe(0);
    expect(rechargeLog.data.total).toBeGreaterThanOrEqual(1);
    expect(
      (rechargeLog.data.list as Array<{ kind: string }>).every((row) =>
        ["recharge", "gift", "refund", "adjust"].includes(row.kind),
      ),
    ).toBe(true);

    // 看板页签：consume 允许为空（这单是充值），但不能报错
    const consumeTab = await inject(
      "GET",
      "/user/credits-dashboard/flows?tab=consume&page=1&page_size=5",
      undefined,
      token,
    );
    expect(consumeTab.code).toBe(0);
    expect(Array.isArray(consumeTab.data.list)).toBe(true);

    // 未知 event_type 明确拒绝，而不是"静默返回全部"
    const bogus = await inject("GET", "/user/credits-log?event_type=bogus", undefined, token);
    expect(bogus.code).toBe(400101);
    expect(bogus.msg).toContain("unsupported event_type");
  });

  it("POST /buy/sku-price 与 GET /billing/sku-price 同一份数据（body 优先、query 兜底）", async () => {
    const get = await inject("GET", "/billing/sku-price?sku=credits-500");
    expect(get.code).toBe(0);

    const post = await inject("POST", "/buy/sku-price", { sku: "credits-500" });
    expect(post.code).toBe(0);
    expect(post.data).toEqual(get.data);

    // query 兜底（竞品没有字段证据，两种位置都收）
    const viaQuery = await inject("POST", "/buy/sku-price?sku=credits-500");
    expect(viaQuery.code).toBe(0);
    expect(viaQuery.data).toEqual(get.data);

    const missing = await inject("POST", "/buy/sku-price", {});
    expect(missing.code).toBe(400101);
    expect(missing.msg).toContain("sku is required");

    const unknownSku = await inject("POST", "/buy/sku-price", { sku: "no-such-sku" });
    expect(unknownSku.code).not.toBe(0);
    expect(unknownSku.status).toBeLessThan(500);
  });

  it("未登录访问账号端点：401 而不是 200/500", async () => {
    const cases: Array<[string, string, unknown]> = [
      ["GET", "/user/credits", undefined],
      ["GET", "/user/credits-log", undefined],
      ["GET", "/user/credits-dashboard", undefined],
      ["GET", "/user-settings", undefined],
      ["GET", "/user/ip", undefined],
      ["POST", "/user-info", { nickname: "nobody" }],
      ["PUT", "/user-settings", { settings: { a: 1 } }],
    ];
    for (const [method, url, payload] of cases) {
      const res = await inject(method, url, payload);
      // 本项目的错误信封统一走 200 + code（见 EnvelopeInterceptor），所以断言 code 而不是 status
      expect(res.code).toBe(401101);
      expect(res.msg.length).toBeGreaterThan(0);
    }
  });
});
