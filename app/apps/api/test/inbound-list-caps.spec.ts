import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { pool } from "../src/db/database";

/**
 * 入站「列表形」参数封顶的端到端契约（第 120 批）。
 *
 * 这批的缺陷类：**同一个语义的列表字段，在一个入口封了顶、在另一个入口没封**。
 * 静态守卫（`inbound-list-bounds.spec.ts`）盯住全树 95 个 `z.array(...)` 站点与
 * 4 个 `@Query string | string[]` 站点；这里只抽 9 个真实端点，证明**运行时**也真的
 * 在服务层之前返回 400101，而不是先解析几十万项再在适配器/DB 里才拒绝。
 *
 * 选取的 9 个端点覆盖三种入参形状与两种校验路径：
 * - query 逗号串：tasks `?ids=`、knowledge `?tags=`、market `?tag_ids=`、
 *   op `?experiment_keys=`、auth `?keys=`、works `?project_categories=`、team `?role_ids=`；
 * - body 数组：canvas commit 的 `nodes[].group_ids`（每画布 7 槽）、
 *   generations 的 `options.ranges`（切片适配器上限 50 段）。
 * - 两种路径：`parseListParam`（controller / service 手写）与 `csvListQuery`（zod schema）。
 *
 * 诚实边界：
 * - 只断言 `code` 与统一文案 / 边界放行，不断言 HTTP status（错误信封统一 200，
 *   见 `EnvelopeInterceptor`，与 `account-shapes.spec.ts:305` 的注释一致）；
 * - 边界放行只用「不产生写入」的请求：tasks / knowledge 的 GET，以及一个**不存在的
 *   canvas id**（group_ids=7 时服务层会 404，恰好证明上限本身没拦）；
 * - 只证明这 9 个入口，其余入口由静态守卫覆盖；两者互补，缺一不可。
 */
describe("inbound list caps (e2e)", () => {
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

  /**
   * 手机号必须是 1 + 10 位。仓库里 1～99 的前缀都已被别的 spec 占用，
   * 这里用「18 + 9 位随机数」降低跨文件并行时的撞号概率（撞号会让登录拿到同一个用户，
   * 不影响本批断言，但会让失败信息难读）。
   */
  async function loginNewUser(): Promise<string> {
    const phone = `18${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const code = sms.data?.debug_code as string;
    const login = await inject("POST", "/auth/login", { phone, code, age_confirmed: true });
    return (login.data?.access_token ?? "") as string;
  }

  /** 逗号串：`n` 个相同值（只关心项数，不关心值是否存在） */
  const csv = (n: number, value = "1") => Array.from({ length: n }, () => value).join(",");

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
    token = await loginNewUser();
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  describe("query 逗号串（parseListParam 手写路径）", () => {
    it("tasks ?ids=101 → 400101（上限 100 = page_size 上限）", async () => {
      const res = await inject("GET", `/tasks?ids=${csv(101)}`, undefined, token);
      expect(res.code).toBe(400101);
      expect(res.msg).toBe("too many ids: at most 100");
    });

    it("tasks ?ids=100 → 放行（边界正好，不是 off-by-one）", async () => {
      const res = await inject("GET", `/tasks?ids=${csv(100)}`, undefined, token);
      expect(res.code).toBe(0);
    });

    it("team ?role_ids=101 → 400101（与分页同一上限）", async () => {
      const res = await inject("GET", `/cam/team/members?role_ids=${csv(101)}`, undefined, token);
      expect(res.code).toBe(400101);
      expect(res.msg).toBe("too many role_ids: at most 100");
    });

    it("team ?role_ids=abc → 400101 而不是 500（BigInt 抛的 SyntaxError 不再漏出去）", async () => {
      const res = await inject("GET", "/cam/team/members?role_ids=abc", undefined, token);
      // 改造前：`BigInt("abc")` → 原生 SyntaxError → 500。非法 id 是入参问题，必须是 400101。
      expect(res.status).toBe(200);
      expect(res.code).toBe(400101);
      expect(res.msg).toBe("invalid role_ids: abc");
    });

    it("auth ?keys=21 → 400101（设置项读取与正文列表同一口径）", async () => {
      const res = await inject("GET", `/user-settings?keys=${csv(21, "k")}`, undefined, token);
      expect(res.code).toBe(400101);
      expect(res.msg).toBe("too many keys: at most 20");
    });

    it("works ?project_categories=21 → 400101（CSV 由调用方拼，项数仍要封顶）", async () => {
      const res = await inject("GET", `/works?project_categories=${csv(21)}`, undefined, token);
      expect(res.code).toBe(400101);
      expect(res.msg).toBe("too many project_categories: at most 20");
    });
  });

  describe("query 逗号串 / 重复参数（csvListQuery zod 路径）", () => {
    it("knowledge ?tags=21 → 400101", async () => {
      const res = await inject("GET", `/knowledge/assets?tags=${csv(21, "t")}`, undefined, token);
      expect(res.code).toBe(400101);
      expect(res.msg).toBe("too many tags: at most 20");
    });

    it("knowledge ?tags=20 → 放行", async () => {
      const tags = Array.from({ length: 20 }, (_, i) => `t${i}`).join(",");
      const res = await inject("GET", `/knowledge/assets?tags=${tags}`, undefined, token);
      expect(res.code).toBe(0);
    });

    it("knowledge 重复参数 ?tags=a&tags=b… 21 项 → 同一条 400101（两种形状同一语义）", async () => {
      const query = Array.from({ length: 21 }, (_, i) => `tags=t${i}`).join("&");
      const res = await inject("GET", `/knowledge/assets?${query}`, undefined, token);
      expect(res.code).toBe(400101);
      expect(res.msg).toBe("too many tags: at most 20");
    });

    it("market ?tag_ids=21 → 400101", async () => {
      const res = await inject("GET", `/market/scripts?tag_ids=${csv(21, "t")}`, undefined, token);
      expect(res.code).toBe(400101);
      expect(res.msg).toBe("too many tag_ids: at most 20");
    });

    it("op ?experiment_keys=21 → 400101", async () => {
      const res = await inject("GET", `/op/abtest/hit?experiment_keys=${csv(21, "e")}`, undefined, token);
      expect(res.code).toBe(400101);
      expect(res.msg).toBe("too many experiment_keys: at most 20");
    });
  });

  describe("body 数组（zod 上限）", () => {
    it("canvas commit nodes[].group_ids=8 → 400101（每画布 7 槽）", async () => {
      const res = await inject(
        "POST",
        "/canvas/canvases/123456789/commit",
        {
          version: 1,
          nodes: [
            {
              node_type: "text",
              x: 0,
              y: 0,
              group_ids: Array.from({ length: 8 }, (_, i) => `g${i}`),
            },
          ],
          edges: [],
        },
        token,
      );
      expect(res.code).toBe(400101);
      expect(res.msg).toContain("at most 7");
    });

    it("canvas commit nodes[].group_ids=7 → 走服务层 404（上限本身没拦）", async () => {
      const res = await inject(
        "POST",
        "/canvas/canvases/123456789/commit",
        {
          version: 1,
          nodes: [
            {
              node_type: "text",
              x: 0,
              y: 0,
              group_ids: Array.from({ length: 7 }, (_, i) => `g${i}`),
            },
          ],
          edges: [],
        },
        token,
      );
      // 7 项能过 zod；数字但不存在 → `mustGetCanvas` 的 400102，而不是 400101。
      expect(res.code).toBe(400102);
      expect(res.msg).toBe("canvas not found");
    });

    it("generations options.ranges=51 → 400101（切片适配器上限 50，前移到 API 边界）", async () => {
      const res = await inject(
        "POST",
        "/generations",
        {
          mode: "text2video",
          model: "cap-probe-model",
          input: {},
          options: {
            ranges: Array.from({ length: 51 }, (_, i) => ({ start: i, end: i + 1 })),
          },
        },
        token,
        // 幂等头在 zod 之前校验（`generations.controller.ts`），没有它拿不到 ranges 的 issue
        { "idempotency-key": "batch-120-ranges-cap" },
      );
      expect(res.code).toBe(400101);
      expect(res.msg).toContain("at most 50");
    });
  });
});