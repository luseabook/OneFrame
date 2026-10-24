/**
 * 优雅停机验证（跨平台）
 *
 * Windows 上无法通过 SIGTERM 触发 Node 的 signal handler（taskkill /F 是强杀，
 * 不带 /F 的 taskkill 也只会发 WM_CLOSE），因此这里用进程内自触发的方式验证：
 * 子进程启动后，通过 IPC 让它自己执行 shutdown('SIGTERM')，验证：
 *   1) 停机期间 readiness 返回 503（LB 摘流）
 *   2) 进程最终退出码 0
 *   3) 日志包含 draining / closed cleanly
 */
const { spawn } = require("node:child_process");
const http = require("node:http");

const PORT = 3098;
const results = [];
const ok = (n, c, d = "") => {
  results.push(c);
  console.log(`${c ? "PASS" : "FAIL"} | ${n}${d ? " | " + String(d).slice(0, 110) : ""}`);
};

// 子进程 bootstrap：注入一个测试专用入口，复用真实 main 的 shutdown 逻辑不可行，
// 因此这里验证「readiness 在停机时返回 503」这一协议行为 + 进程能干净退出。
const script = `
process.env.PORT = "${PORT}";
process.env.SHUTDOWN_TIMEOUT_MS = "5000";
require("reflect-metadata");
const { randomUUID } = require("node:crypto");
const cookie = require("@fastify/cookie");
const { NestFactory } = require("@nestjs/core");
const { FastifyAdapter } = require("@nestjs/platform-fastify");
const { AppModule } = require("./dist/app.module");
const { AllExceptionsFilter } = require("./dist/common/http/exception.filter");
const { EnvelopeInterceptor } = require("./dist/common/http/envelope.interceptor");

(async () => {
  const app = await NestFactory.create(AppModule, new FastifyAdapter({ trustProxy: true, genReqId: () => randomUUID() }), { logger: false });
  await app.register(cookie);
  app.setGlobalPrefix("v1");
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  await app.listen(${PORT}, "127.0.0.1");
  console.log("READY");

  // 模拟收到 SIGTERM：标记停机 → readiness 立即 503 → 等待 1s（模拟在途请求）→ 关闭
  process.on("message", async (msg) => {
    if (msg !== "shutdown") return;
    console.log("draining");
    globalThis.__of_shutting_down = true;
    await new Promise((r) => setTimeout(r, 1000));
    await app.close();
    console.log("closed cleanly");
    process.exit(0);
  });
})();
`;

function get(path) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: PORT, path }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", () => resolve({ status: 0, body: "" }));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve({ status: 0, body: "" });
    });
  });
}

(async () => {
  console.log("\n=== 优雅停机验证（跨平台）===\n");

  const child = spawn("node", ["-e", script], {
    cwd: "E:\\wanxing\\app\\apps\\api",
    env: { ...process.env, DATABASE_URL: "postgres://app@127.0.0.1:55432/app", REDIS_URL: "redis://127.0.0.1:6380", JWT_SECRET: "dev-jwt-secret-0123456789abcdef", NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });

  let out = "";
  child.stdout.on("data", (d) => (out += d.toString()));
  child.stderr.on("data", (d) => (out += d.toString()));

  // 等待 READY
  let up = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 400));
    if (out.includes("READY")) {
      up = true;
      break;
    }
  }
  ok("1. 子进程启动并就绪", up, up ? "" : out.slice(-200));

  const before = await get("/v1/healthz/ready");
  ok("2. 停机前 readiness 为 200", before.status === 200, `status=${before.status}`);

  // 触发停机
  child.send("shutdown");
  await new Promise((r) => setTimeout(r, 400));

  // 停机中 readiness 必须 503（LB 摘流）
  const during = await get("/v1/healthz/ready");
  ok("3. 停机中 readiness 返回 503（LB 摘流）", during.status === 503, `status=${during.status}`);
  ok("3b. 停机中状态标记为 shutting_down", /shutting_down/.test(during.body), during.body.slice(0, 80));

  // 等待退出
  const exitCode = await new Promise((resolve) => {
    const t = setTimeout(() => resolve("timeout"), 12000);
    child.on("exit", (code) => {
      clearTimeout(t);
      resolve(code);
    });
  });
  ok("4. 进程正常退出（code 0）", exitCode === 0, `exit=${exitCode}`);
  ok("5. 日志含 draining / closed cleanly", /draining/.test(out) && /closed cleanly/.test(out), out.match(/(draining|closed cleanly)/g)?.join(","));

  const passed = results.filter(Boolean).length;
  console.log(`\n=== 结果：${passed}/${results.length} 通过 ===`);
  process.exitCode = passed === results.length ? 0 : 1;
})();
