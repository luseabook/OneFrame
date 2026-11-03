import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MOCK_LLM_ESCAPE_ON,
  buildEnv,
  collectLlmProblems,
  collectProductionProblems,
  mockLlmAllowed,
} from "../src/config/env";
import { llmStatus } from "../src/health/llm-status";

/**
 * LLM 验收逃生舱 `ONEFRAME_ALLOW_MOCK_LLM`（launch-gap §8 决策记录，2026-11-03）。
 *
 * 背景：生产守卫收紧到"`LLM_MODE=mock` 一律拒绝"后，验收机（有生产构建、**没有**任何
 * 供应商 Key）一部署新构建就起不来，连带把 N-09（`HOST=127.0.0.1`）压住发不出去。
 * 决策选了"具名逃生舱"而不是补 Key（Key 不在工程手里）或钉旧构建（把安全改进往后推）。
 *
 * 它比 ICP 逃生舱多四道限制，其中两条在代码里：
 * 1. **只认字面 `1`**：写 `true`/`yes`/`on` 要**响亮失败并回显实际值**——
 *    绝不像 `=== "true"` 那样静默走到另一侧（第 124 批那 15 例静默错向就是这种形态）；
 * 2. **机器可判定**：`/v1/healthz/ready` 的 `llmMode`/`mockAllowed`、`/v1/metrics` 的
 *    两个 gauge、`GET /v1/me` 的 `llm_mode`——"假内容在跑"不能只留在日志里。
 *
 * 刻意**不**放宽的几处（都有用例锁着）：
 * - 开了逃生舱但 `LLM_MODE` 未显式设置 → 仍然拒绝（默认值不能替部署者决定）；
 * - 逃生舱写 `true` → 拒绝，且报错里带 `"true"` 原值（运维才知道自己写了什么）；
 * - 非生产环境完全不受影响（本地/CI 不设仍是 mock）。
 */
const secureProd = (overrides: Record<string, string | undefined> = {}) => ({
  NODE_ENV: "production",
  JWT_SECRET: "Prod-Jwt-Secret-0123456789AbCdEf",
  ADMIN_JWT_SECRET: "Prod-Admin-Jwt-Secret-0123456789AbCdEf",
  PHONE_HMAC_PEPPER: "Prod-Phone-Pepper-0123456789AbC",
  PHONE_ENC_KEY: "Prod-Phone-Enc-Key-0123456789AbC",
  STORAGE_SIGN_SECRET: "Prod-Storage-Sign-0123456789AbC",
  ADMIN_USERNAME: "ops-admin",
  ADMIN_PASSWORD: "Prod-Admin-Password-123456",
  COOKIE_SECURE: "true",
  METRICS_TOKEN: "Prod-Metrics-Token-0123456789",
  PAYMENT_LIVE: "false",
  LLM_MODE: "real",
  DEEPSEEK_API_KEY: "Prod-Deepseek-Key-0123456789",
  ...overrides,
});

/** 这些字段是**契约面**，缺一个就等于"机器判不了、前端看不见"（见 api-spec §33.1） */
const CONTRACT_GUARDS = {
  me: join(__dirname, "..", "src/modules/auth/auth.controller.ts"),
  ready: join(__dirname, "..", "src/health/health.controller.ts"),
  metrics: join(__dirname, "..", "src/health/metrics.controller.ts"),
  ping: join(__dirname, "..", "src/app.controller.ts"),
} as const;

describe("ONEFRAME_ALLOW_MOCK_LLM：只认字面 1", () => {
  it("生产 + mock + 逃生舱=1 → 允许启动", () => {
    expect(collectLlmProblems(secureProd({ LLM_MODE: "mock", ONEFRAME_ALLOW_MOCK_LLM: "1" }))).toEqual([]);
    expect(buildEnv(secureProd({ LLM_MODE: "mock", ONEFRAME_ALLOW_MOCK_LLM: "1" })).LLM_MOCK_ALLOWED).toBe(true);
  });

  it("生产 + mock + 没有逃生舱 → 拒绝，并指出该设哪个变量", () => {
    const joined = collectLlmProblems(secureProd({ LLM_MODE: "mock" })).join("\n");
    expect(joined).toContain("LLM_MODE=mock 在生产被拒绝");
    expect(joined).toContain("ONEFRAME_ALLOW_MOCK_LLM=1");
    expect(() => buildEnv(secureProd({ LLM_MODE: "mock" }))).toThrow(/ONEFRAME_ALLOW_MOCK_LLM=1/);
  });

  it("逃生舱写 true / yes / on / TRUE 一律拒绝，且回显实际值", () => {
    for (const spelling of ["true", "yes", "on", "TRUE", "True"]) {
      const problems = collectLlmProblems(
        secureProd({ LLM_MODE: "mock", ONEFRAME_ALLOW_MOCK_LLM: spelling }),
      );
      const joined = problems.join("\n");
      expect(joined, `${JSON.stringify(spelling)} 应被拒`).toContain('ONEFRAME_ALLOW_MOCK_LLM 只认字符串 "1"');
      // 回显原值：运维要知道自己写了什么，否则只能靠猜
      expect(joined).toContain(JSON.stringify(spelling.trim()));
    }
    expect(MOCK_LLM_ESCAPE_ON).toBe("1");
  });

  it("首尾空白会被裁掉（与全仓 env 取值口径一致），裁完是 1 即放行", () => {
    // 这不是放宽：`" 1"` 与 `"1"` 是同一个决定，不像 `=== "true"` 那样改变判定侧。
    for (const spelling of [" 1", "1 ", "\t1\n"]) {
      expect(
        collectLlmProblems(secureProd({ LLM_MODE: "mock", ONEFRAME_ALLOW_MOCK_LLM: spelling })),
        JSON.stringify(spelling),
      ).toEqual([]);
    }
  });

  it("开了逃生舱但 LLM_MODE 未设置 → 仍然拒绝（默认值不替部署者决定）", () => {
    const joined = collectLlmProblems(secureProd({ LLM_MODE: undefined, ONEFRAME_ALLOW_MOCK_LLM: "1" })).join("\n");
    expect(joined).toContain("LLM_MODE 必须显式设置为 real");
  });

  it("real + 真实 Key 时不关心逃生舱（开着也不影响，mock_active 恒 false）", () => {
    expect(collectLlmProblems(secureProd({ ONEFRAME_ALLOW_MOCK_LLM: "1" }))).toEqual([]);
    expect(llmStatus(buildEnv(secureProd({ ONEFRAME_ALLOW_MOCK_LLM: "1" }))).mock_active).toBe(false);
  });

  it("非生产完全不受影响：不设 / 设 mock 都不报，逃生舱为 false 但无害", () => {
    // 注意：必须走 collectProductionProblems —— collectLlmProblems 本身不看 NODE_ENV，
    // 只看生产的那层壳会先返回 []（这里用错会把"非生产不报"测成假通过）。
    expect(collectProductionProblems({ NODE_ENV: "test" })).toEqual([]);
    expect(collectProductionProblems({ NODE_ENV: "development", LLM_MODE: "mock" })).toEqual([]);
    const dev = buildEnv({ NODE_ENV: "development" });
    expect(dev.LLM_MODE).toBe("mock");
    expect(dev.LLM_MOCK_ALLOWED).toBe(false);
    expect(mockLlmAllowed({})).toBe(false);
  });
});

describe("llmStatus：给机器与前端读的三个字段", () => {
  it("mock 时 mock_active=true（哪怕没开逃生舱，非生产也走 mock）", () => {
    const env = buildEnv({ NODE_ENV: "development" });
    expect(llmStatus(env)).toEqual({ mode: "mock", mock_allowed: false, mock_active: true });
  });

  it("real 时 mock_active=false；mock_allowed 只反映逃生舱", () => {
    const env = buildEnv(secureProd());
    expect(llmStatus(env)).toEqual({ mode: "real", mock_allowed: false, mock_active: false });
  });
});

/**
 * 契约面守卫：这三处是"声明是否真的可见"的落点。
 *
 * 为什么做成静态断言而不是 e2e：`/v1/me` 要登录、`/v1/metrics` 要令牌，
 * 而它们失效的形态是"字段被人顺手删掉"，静态检查正对这个形态；
 * 真实取值已由 Ops 的 `07` 在部署机上断言（`llmMode` / `mockAllowed` / `llm_mode`）。
 */
describe("契约面：llm 状态必须出现在文档写明的位置", () => {
  it("GET /v1/me 带 llm_mode（只对已登录用户暴露，不放 ping）", () => {
    const source = readFileSync(CONTRACT_GUARDS.me, "utf8");
    expect(source).toContain("llm_mode: llmStatus(env).mode");
  });

  it("GET /v1/ping 明确定为不带 llm 状态（匿名端点不广播部署形态）", () => {
    const source = readFileSync(CONTRACT_GUARDS.ping, "utf8");
    // 断言"代码里没有这个字段/调用"，而不是"文件里没有这个字串"——
    // 注释里解释「为什么不放 ping」本身就会写到这个名字（第一版就被自己绊倒）。
    expect(source).not.toContain("llmStatus(");
    expect(source).not.toMatch(/llm_mode\s*:/);
  });

  it("/v1/healthz/ready 回 llmMode + mockAllowed，且不参与就绪判定", () => {
    const source = readFileSync(CONTRACT_GUARDS.ready, "utf8");
    expect(source).toContain("llmMode: llm.mode");
    expect(source).toContain("mockAllowed: llm.mock_allowed");
    // ok 只能由 db/redis 决定：mock 是配置状态，不该让 LB 摘流
    expect(source).toContain("const ok = db && redis;");
  });

  it("/v1/metrics 出两个 gauge（假文案必须能被 Prometheus 抓到）", () => {
    const source = readFileSync(CONTRACT_GUARDS.metrics, "utf8");
    expect(source).toContain("oneframe_llm_mock_allowed");
    expect(source).toContain("oneframe_llm_mock_active");
    expect(source).toContain("# TYPE oneframe_llm_mock_allowed gauge");
    expect(source).toContain("# TYPE oneframe_llm_mock_active gauge");
  });
});

/**
 * N-12：产物级标记（`episodes.llm_mock` → 导出 manifest）。
 *
 * 为什么不能只靠 gauge：gauge 证明"这个进程在跑 mock"，证明不了"**这份大纲**是假的"。
 * 文本被导出、贴给客户之后，进程信息全都丢了；行级字段会随 manifest 一起走。
 * 功能面（DB → zip 里的 manifest.json）已由 `apps/worker/test/export-trim.spec.ts` 覆盖，
 * 这里只锁"写入路径与列定义没有被顺手删掉"这一形态。
 */
describe("N-12 产物标记的三处落点", () => {
  const schema = join(__dirname, "..", "..", "..", "packages/db/src/schema.ts");
  const scriptService = join(__dirname, "..", "src/modules/script/script.service.ts");
  const llmService = join(__dirname, "..", "src/modules/script/llm.service.ts");

  it("episodes 表有 llm_mock 列（默认 false：老数据不被打标）", () => {
    const source = readFileSync(schema, "utf8");
    expect(source).toContain('llmMock: boolean("llm_mock").notNull().default(false)');
  });

  it("LlmService 暴露 isMock()，其判据与各方法内的 mock 分支同源", () => {
    const source = readFileSync(llmService, "utf8");
    expect(source).toContain("isMock(): boolean");
    expect(source).toContain("return this.deepseek === null;");
  });

  it("大纲与正文两处写入都打标（不靠「大纲是 mock 就推定正文也是」）", () => {
    const source = readFileSync(scriptService, "utf8");
    const hits = source.match(/llmMock: this\.llm\.isMock\(\)/g) ?? [];
    expect(hits.length).toBe(2);
  });

  it("episodeDto 暴露产物级 llm_mock（进程级 llm_mode 不能替代它）", () => {
    const source = readFileSync(scriptService, "utf8");
    // 按形态匹配，不按裸子串：注释里出现 `llm_mode` 字样不该把这条判红。
    expect(source).toMatch(/llm_mock:\s*row\.llmMock/);
  });
});
