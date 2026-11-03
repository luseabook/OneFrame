import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildEnv } from "../src/config/env";

/**
 * 监听地址（N-09）：api 不得把 `0.0.0.0` 写死在代码里。
 *
 * 背景（验收环境实测）：`apps/api/src/main.ts` 长期是 `app.listen(env.PORT, "0.0.0.0")`，
 * `HOST` 环境变量完全无效。于是"只让本机 nginx 反代、不暴露到内网/公网"这件事
 * 只能靠 ufw 兜着 —— 防火墙成了唯一防线，换台机器、换个人部署就会漏。
 *
 * 现行口径：默认 **loopback**（`127.0.0.1`），"要暴露"必须是部署者的显式决定；
 * 容器形态由 `docker-compose.prod.yml` 的 `x-app-env` 显式写 `HOST: 0.0.0.0`。
 *
 * 这里锁三件事：
 * 1. env schema 默认值是 loopback，且显式值能生效；
 * 2. `main.ts` 真的用了 `env.HOST`（而不是又一个字面量）；
 * 3. 生产 compose 仍然把容器内的监听地址显式设成 `0.0.0.0`（否则容器间反代会静默断掉）。
 */
const APP_ROOT = join(__dirname, "..", "..", "..");
const MAIN_TS = join(APP_ROOT, "apps/api/src/main.ts");
const PROD_COMPOSE = join(APP_ROOT, "docker-compose.prod.yml");

describe("监听地址：默认 loopback，对外必须显式（N-09）", () => {
  it("默认是 127.0.0.1，不是 0.0.0.0", () => {
    expect(buildEnv({ NODE_ENV: "development" }).HOST).toBe("127.0.0.1");
    expect(buildEnv({ NODE_ENV: "test" }).HOST).toBe("127.0.0.1");
  });

  it("显式 HOST 生效（部署者要对外就必须自己写）", () => {
    expect(buildEnv({ NODE_ENV: "development", HOST: "0.0.0.0" }).HOST).toBe("0.0.0.0");
    expect(buildEnv({ NODE_ENV: "development", HOST: "::" }).HOST).toBe("::");
    expect(buildEnv({ NODE_ENV: "development", HOST: "10.0.0.5" }).HOST).toBe("10.0.0.5");
  });

  it("main.ts 用 env.HOST 监听，且不再出现硬编码 0.0.0.0", () => {
    const source = readFileSync(MAIN_TS, "utf8");
    expect(source).toContain("app.listen(env.PORT, env.HOST)");
    expect(source).not.toMatch(/app\.listen\([^)]*"0\.0\.0\.0"/);
    expect(source).not.toContain('"0.0.0.0"');
  });

  it("生产 compose 显式声明容器内 HOST=0.0.0.0（容器间反代依赖它）", () => {
    const compose = readFileSync(PROD_COMPOSE, "utf8");
    expect(compose).toContain('HOST: "0.0.0.0"');
  });

  it("生产 compose 不再给 LLM_MODE 兜底 mock（守卫已拒绝 mock，兜底只会换来 CrashLoop）", () => {
    const compose = readFileSync(PROD_COMPOSE, "utf8");
    expect(compose).not.toMatch(/LLM_MODE:\s*\$\{LLM_MODE:-/);
    expect(compose).toMatch(/LLM_MODE:\s*"\$\{LLM_MODE:\?/);
  });
});
