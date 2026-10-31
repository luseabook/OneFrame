import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * web → api 反代目标守卫（第 107 批排查运营后台 E2E 时发现）。
 *
 * 背景：`apps/web/nuxt.config.ts` 用 `routeRules["/v1/**"].proxy` 把同源 /v1 反代到 api，
 * 但 **Nitro 在构建期就把 proxy 目标编译进 `.output/server`**——运行期再设
 * `NUXT_API_PROXY` 完全不生效。本地栈脚本原先只 build api，web 直接
 * `node .output/server/index.mjs`，于是产物里烤着默认的 `127.0.0.1:3000`
 * （本机那是另一个项目的端口）：后台面板标题/侧栏/按钮全部正常，`/v1/**` 数据全 404。
 *
 * 这个缺陷的特长是**全绿**：typecheck / lint / build 都发现不了，端口也照样在听。
 * 所以守卫要钉住的不是"有没有设置环境变量"，而是**设置的时机**：
 *   1. 构建阶段必须已经注入（Dockerfile 的 ARG/ENV、本地脚本 build web 之前）；
 *   2. 起服务后要证明"经反代能打到本项目 api"，而不是"端口在听"。
 *
 * **仍未覆盖**：真实代理链路的行为（需要一个真浏览器/真请求），
 * 那部分由 `_acceptance/e2e-admin-panels.cjs` 的 10 个面板断言负责。
 */
const APP_ROOT = join(__dirname, "..", "..", "..");
const REPO_ROOT = join(APP_ROOT, "..");

const NUXT_CONFIG = join(APP_ROOT, "apps", "web", "nuxt.config.ts");
const DOCKERFILE = join(APP_ROOT, "apps", "web", "Dockerfile");
const COMPOSE = join(APP_ROOT, "docker-compose.prod.yml");
const STACK_SCRIPT = join(REPO_ROOT, "_acceptance", "start-wanxing-stack.ps1");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** 某段文本第一次出现的位置；找不到返回 -1（用于断言"先后顺序"）。 */
function at(text: string, needle: string): number {
  return text.indexOf(needle);
}

describe("nuxt 配置：代理目标只能来自构建期环境变量", () => {
  const config = read(NUXT_CONFIG);

  it("proxy 目标由 NUXT_API_PROXY 推导，没有第二处硬编码上游地址", () => {
    expect(config).toContain("process.env.NUXT_API_PROXY");
    // routeRules 里用变量拼接，而不是直接写字面量 URL
    expect(config).toMatch(/proxy:\s*`\$\{apiProxyTarget\}\/v1\/\*\*`/);
    expect(config).not.toMatch(/proxy:\s*["'`]http/);
  });

  it("源码里写明了「构建期生效、运行期无效」（避免下一个人又去运行期设变量）", () => {
    expect(config).toContain("构建期");
  });
});

describe("镜像构建：NUXT_API_PROXY 必须在 pnpm build 之前注入", () => {
  const dockerfile = read(DOCKERFILE);

  it("声明了 ARG 与 ENV", () => {
    expect(dockerfile).toMatch(/^ARG NUXT_API_PROXY=/m);
    expect(dockerfile).toMatch(/^ENV NUXT_API_PROXY=\$\{NUXT_API_PROXY\}/m);
  });

  it("注入发生在 build 之前（写成运行期 ENV 等于没设）", () => {
    const envAt = at(dockerfile, "ENV NUXT_API_PROXY=");
    const buildAt = at(dockerfile, "pnpm --filter @app/web build");
    expect(envAt).toBeGreaterThan(-1);
    expect(buildAt).toBeGreaterThan(-1);
    expect(envAt).toBeLessThan(buildAt);
  });

  it("compose 用 build.args 传入（只写 environment 影响不到已编译的产物）", () => {
    // 去掉注释行再匹配：compose 里 args 下面有说明注释，直接正则会漏
    const yaml = read(COMPOSE)
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    expect(yaml).toMatch(/args:\n\s+NUXT_API_PROXY:\s*http:\/\/api:3000/);
  });
});

describe("本地栈脚本：构建期注入 + 启动后验证真实反代", () => {
  const script = read(STACK_SCRIPT);

  it("构建 web 之前设置 NUXT_API_PROXY（且指向本项目的 api 端口）", () => {
    const setAt = at(script, '$env:NUXT_API_PROXY = $apiProxyTarget');
    const buildAt = at(script, "pnpm --filter @app/web build");
    expect(setAt).toBeGreaterThan(-1);
    expect(buildAt).toBeGreaterThan(-1);
    expect(setAt).toBeLessThan(buildAt);
    expect(script).toContain('$apiProxyTarget = "http://127.0.0.1:$ApiPort"');
  });

  it("脚本确实会构建 web（不是只 build api 就 node .output）", () => {
    expect(script).toContain("pnpm --filter @app/web build");
  });

  it("启动前校验产物里烤着的目标与本次 api 端口一致", () => {
    expect(script).toContain("Assert-WebBuiltFor $apiProxyTarget");
    expect(script).toContain("nitro.mjs");
  });

  it("就绪判据是「经反代拿到 200」，不是「端口在听」", () => {
    expect(script).toContain("/v1/healthz/live");
    expect(script).toContain("Test-WebApiProxy");
    // 端口在听但反代不通时必须重启/报错，而不是打印 already up 就走
    expect(script).toMatch(/if \(Test-WebApiProxy \$WebPort\) \{ Write-Output "web :\$WebPort already up/);
  });

  it("脚本文件存在（防止路径改名后守卫空跑成假绿）", () => {
    expect(existsSync(STACK_SCRIPT)).toBe(true);
  });
});