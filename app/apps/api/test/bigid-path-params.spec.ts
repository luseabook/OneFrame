import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { toBigId } from "../src/common/bigid";
import { isAppError } from "@app/shared";
import { db, pool } from "../src/db/database";

/**
 * 第 69 批：路径里的 id 写错时必须是 400101，不能是 500。
 *
 * 怎么发现这堆缺口的：把「每个 GET 路由的 `:param` 全换成 `abc`」跑了一遍
 * （248 条唯一 GET 路径，脚本 `_acceptance/_r69_routes.py` + `_acceptance/_r69_probe.js`），
 * 修前有 **18 条返回 HTTP 500 + code 500000**，修后 **0 条**。
 *
 * 根因不是「忘了 try/catch」，而是 `BigInt("abc")` 抛的是 `SyntaxError` ——
 * 它会穿过业务错误通道，落到 `AllExceptionsFilter` 的「未知异常」分支（第 45 行）。
 * 对用户是「服务器错误」，对监控是「客户端拼错参数持续制造 5xx 告警」。
 *
 * 本 spec 锁两件事：
 * ① 这些路径现在还返回 400101，且 `msg` 里的字段名对得上（业务错误一律 HTTP 200 + 非零 code，见 api-spec §1）；
 * ② `toBigId()` 自己的边界（空串/负号/小数/超长/数字类型/首尾空格）。
 *
 * 注：`abc` 同时充当「路径上所有 param」时，第一个被解析的是 canvas_id ——
 * 所以「cn_id / node_id 这一层」必须先造一张真画布才能测到（见 beforeAll）。
 */
let app: NestFastifyApplication;
const phone = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
let token = "";
let canvasId = "";

interface Envelope {
  code: number;
  msg: string;
  data: any;
}

async function inject(method: "GET" | "POST", url: string, payload?: Record<string, unknown>): Promise<Envelope> {
  const res = await app.inject({
    method,
    url: `/v1${url}`,
    payload,
    headers: { authorization: `Bearer ${token}` },
  });
  return res.json() as Envelope;
}

async function login(phoneValue: string): Promise<string> {
  const sms = await app.inject({ method: "POST", url: "/v1/auth/sms-code", payload: { phone: phoneValue } });
  const smsBody = sms.json() as Envelope;
  expect({ code: smsBody.code, msg: smsBody.msg }).toEqual({ code: 0, msg: "" });
  const body = (
    await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { phone: phoneValue, code: smsBody.data.debug_code, age_confirmed: true },
    })
  ).json() as Envelope;
  expect({ code: body.code, msg: body.msg }).toEqual({ code: 0, msg: "" });
  return body.data.access_token as string;
}

/** 修前实测返回 500 的 GET（canvas 一层的 id 用 `abc`），及期望在 msg 里出现的字段名 */
const BROKEN_CANVAS_CASES: Array<{ url: string; field: string }> = [
  { url: "/billing/orders/abc", field: "order_id" },
  { url: "/canvas/canvases/abc/download-lists", field: "canvas_id" },
  { url: "/canvas/canvases/abc/pin-groups", field: "canvas_id" },
  { url: "/canvas/canvases/abc/group-templates", field: "canvas_id" },
  { url: "/canvas/canvases/abc/materials", field: "canvas_id" },
  { url: "/canvas/canvases/abc/comment-nodes", field: "canvas_id" },
  { url: "/canvas/canvases/abc/comment-nodes/abc", field: "canvas_id" },
  // 这条的 handler 是 `listComments(spaceId, cn_id)`，不先校验 canvas —— 所以先炸的是 cn_id
  { url: "/canvas/canvases/abc/comment-nodes/abc/comments", field: "cn_id" },
  { url: "/canvas/canvases/abc/running-nodes", field: "canvas_id" },
  { url: "/canvas/canvases/abc/nodes/abc/task/abc", field: "canvas_id" },
  { url: "/canvas/canvases/abc/nodes/abc/video-parse/abc", field: "canvas_id" },
  { url: "/canvas/templates/abc", field: "template_id" },
  { url: "/canvas/templates/abc/instantiate", field: "template_id" },
  { url: "/kds/da/team/member/abc/point-consume-detail", field: "op_user_id" },
  { url: "/kds/da/team/member/abc/point-quota-detail", field: "op_user_id" },
  { url: "/cam/team/group/abc/stats", field: "group_id" },
  { url: "/cam/roles/abc/permissions", field: "role_id" },
  { url: "/cam/team/member/abc", field: "user_id" },
];

/** 第二层 id：画布是真的，只有下游 id 非法 */
function nestedCases(): Array<{ url: string; field: string }> {
  return [
    { url: `/canvas/canvases/${canvasId}/comment-nodes/abc`, field: "cn_id" },
    { url: `/canvas/canvases/${canvasId}/comment-nodes/abc/comments`, field: "cn_id" },
    { url: `/canvas/canvases/${canvasId}/nodes/abc/task/abc`, field: "node_id" },
    { url: `/canvas/canvases/${canvasId}/nodes/abc/video-parse/abc`, field: "node_id" },
  ];
}

beforeAll(async () => {
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
  await app.register(cookie as never);
  app.setGlobalPrefix("v1");
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  token = await login(phone);
  const created = await inject("POST", "/canvas/canvases", { title: "bigid-spec" });
  expect({ code: created.code, msg: created.msg }).toEqual({ code: 0, msg: "" });
  canvasId = created.data.id as string;
}, 120_000);

afterAll(async () => {
  if (canvasId) await db.execute(sql`delete from canvases where id = ${BigInt(canvasId)}`).catch(() => {});
  await app.close();
  await pool.end().catch(() => {});
});

describe("bad path parameter → 400101（不是 500）", () => {
  it("修前 500 的 18 条 GET：路径 id 非法时全返回 400101，字段名对得上", async () => {
    const failures: string[] = [];
    for (const c of BROKEN_CANVAS_CASES) {
      const body = await inject("GET", c.url);
      if (body.code !== 400101) {
        failures.push(`${c.url} → code=${body.code} msg=${body.msg}`);
        continue;
      }
      // msg 形如 `invalid canvas_id`：字段名必须对得上，否则说明是在别的层被打回来的
      if (!body.msg.includes(c.field)) failures.push(`${c.url} → msg=${body.msg}（期望含 ${c.field}）`);
    }
    expect(failures).toEqual([]);
  }, 60_000);

  it("第二层 id（cn_id / node_id）也走同一条通道 —— 画布是真的、下游 id 是 abc", async () => {
    const failures: string[] = [];
    for (const c of nestedCases()) {
      const body = await inject("GET", c.url);
      if (body.code !== 400101 || !body.msg.includes(c.field)) {
        failures.push(`${c.url} → code=${body.code} msg=${body.msg}`);
      }
    }
    expect(failures).toEqual([]);
  }, 60_000);

  it("这些路径都不再是 500000（回归锚点：修前全中）", async () => {
    const internal: string[] = [];
    for (const c of [...BROKEN_CANVAS_CASES, ...nestedCases()]) {
      const body = await inject("GET", c.url);
      if (body.code === 500000) internal.push(c.url);
    }
    expect(internal).toEqual([]);
  }, 60_000);
});

describe("toBigId 的边界", () => {
  it("接受十进制数字串，并去掉首尾空格", () => {
    expect(toBigId("12", "x")).toBe(12n);
    expect(toBigId("  42  ", "x")).toBe(42n);
    expect(toBigId(7, "x")).toBe(7n);
    expect(toBigId("9223372036854775807", "x")).toBe(9223372036854775807n);
  });

  it("其余一律 400101，并带上字段名", () => {
    const bad = ["", " ", "abc", "12abc", "-1", "0", "1.5", "1e3", "0x10", "  ", "１２", "1\n2"];
    for (const raw of bad) {
      let code = 0;
      let msg = "";
      try {
        toBigId(raw, "canvas_id");
      } catch (err) {
        expect(isAppError(err)).toBe(true);
        code = (err as { code: number }).code;
        msg = (err as { message: string }).message;
      }
      expect({ raw, code }).toEqual({ raw, code: 400101 });
      expect(msg).toBe("invalid canvas_id");
    }
  });

  it("超过 20 位（BigInt 也吃得下）仍按非法处理 —— 我们的主键是雪花 id", () => {
    let code = 0;
    try {
      toBigId("123456789012345678901", "id");
    } catch (err) {
      code = (err as { code: number }).code;
    }
    expect(code).toBe(400101);
  });
});
