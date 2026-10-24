/**
 * 可运维性验收：liveness / readiness / metrics / 优雅停机
 */
const { execSync, spawn } = require("node:child_process");
const API = "http://127.0.0.1:3000/v1";
const results = [];
const ok = (n, c, d = "") => {
  results.push(c);
  console.log(`${c ? "PASS" : "FAIL"} | ${n}${d ? " | " + String(d).slice(0, 100) : ""}`);
};

(async () => {
  console.log("\n=== 可运维性验收 ===\n");

  // ── 1. liveness ──
  const live = await fetch(`${API}/healthz/live`);
  const liveBody = await live.json();
  ok("1. liveness 返回 200", live.status === 200, `status=${live.status}`);
  ok("1b. liveness 含 uptime 与 pid", !!liveBody.data?.uptime_s && !!liveBody.data?.pid, `pid=${liveBody.data?.pid}`);

  // ── 2. readiness ──
  const ready = await fetch(`${API}/healthz/ready`);
  const readyBody = await ready.json();
  ok("2. readiness 依赖可用时 200", ready.status === 200, `status=${ready.status}`);
  ok("2b. readiness 报告 db/redis", readyBody.data?.checks?.db === "up" && readyBody.data?.checks?.redis === "up", JSON.stringify(readyBody.data?.checks));

  // ── 3. metrics ──
  const metrics = await fetch(`${API}/metrics`);
  const text = await metrics.text();
  ok("3. metrics 返回 200", metrics.status === 200, `status=${metrics.status}`);
  ok(
    "3b. content-type 为 prometheus 文本",
    /text\/plain/.test(metrics.headers.get("content-type") ?? ""),
    metrics.headers.get("content-type"),
  );
  ok("3c. 含任务状态指标", /oneframe_tasks_total\{status="\d+"\}/.test(text), text.match(/oneframe_tasks_total\{[^}]+\} \d+/)?.[0]);
  ok("3d. 含失败率指标", /oneframe_failure_ratio_15m \d/.test(text), text.match(/oneframe_failure_ratio_15m [\d.]+/)?.[0]);
  ok("3e. 含资金链路指标", /oneframe_orders_paid_without_credit \d/.test(text), text.match(/oneframe_orders_paid_without_credit \d+/)?.[0]);
  ok("3f. 含进程指标", /oneframe_process_uptime_seconds \d/.test(text), text.match(/oneframe_process_uptime_seconds \d+/)?.[0]);
  ok("3g. 指标为纯文本非 JSON 信封", !text.trim().startsWith("{"), text.slice(0, 40));

  // ── 4. 优雅停机 ──
  // Windows 无法通过 SIGTERM 触发 Node signal handler（taskkill /F 是强杀），
  // 该链路已由 graceful-shutdown.cjs 用跨平台方式验证（6/6），此处不重复。
  console.log("SKIP | 4. 优雅停机由 graceful-shutdown.cjs 覆盖");
  const passed = results.filter(Boolean).length;
  console.log(`\n=== 结果：${passed}/${results.length} 通过 ===`);
  process.exitCode = passed === results.length ? 0 : 1;
})();
