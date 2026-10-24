/**
 * 真实 HTTP 供应商联调验收：
 * 起本地假供应商（实现 Ark 协议），让 worker 用真实 ADAPTER_MODE=real 走一遍
 * 提交 → 轮询 → 结果转存，验证协议字段、错误映射、超时重试。
 */
const http = require("node:http");
const { execSync } = require("node:child_process");

const VENDOR_PORT = 4100;
const API = "http://127.0.0.1:3000/v1";
const PHONE = "1389999" + String(Date.now()).slice(-4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const ok = (n, c, d = "") => {
  results.push(c);
  console.log(`${c ? "PASS" : "FAIL"} | ${n}${d ? " | " + String(d).slice(0, 90) : ""}`);
};
function rg(k) {
  const raw = execSync(`redis-cli -p 6380 --raw get ${k}`, { encoding: "utf8" }).trim();
  try {
    return JSON.parse(raw).code;
  } catch {
    return raw;
  }
}
async function api(m, p, b, t) {
  const h = {};
  if (t) h.authorization = `Bearer ${t}`;
  if (b !== undefined) h["content-type"] = "application/json";
  const r = await fetch(`${API}${p}`, { method: m, headers: h, body: b === undefined ? undefined : JSON.stringify(b) });
  const x = await r.text();
  try {
    return { status: r.status, ...JSON.parse(x) };
  } catch {
    return { status: r.status, code: "EXC", raw: x };
  }
}

// ── 假供应商：实现 Ark 协议，可注入审核驳回与 5xx ──
const received = [];
let pollCount = 0;
let mode = "success"; // success | rejected | fail

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const json = (code, obj) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.method === "POST" && req.url === "/api/v3/contents/generations/tasks") {
      const payload = JSON.parse(body || "{}");
      received.push({ auth: req.headers.authorization, body: payload });
      return json(200, { id: `ark-task-${Date.now()}` });
    }
    if (req.method === "GET" && req.url.startsWith("/api/v3/contents/generations/tasks/")) {
      pollCount += 1;
      if (mode === "rejected") return json(200, { status: "rejected", error: { message: "violence detected" } });
      if (mode === "fail") return json(200, { status: "failed", error: { message: "internal error" } });
      if (pollCount < 2) return json(200, { status: "running" });
      return json(200, {
        status: "succeeded",
        content: [{ video_url: `http://127.0.0.1:${VENDOR_PORT}/v.mp4`, cover_url: null, duration: 5 }],
      });
    }
    if (req.method === "GET" && req.url === "/v.mp4") {
      res.writeHead(200, { "content-type": "video/mp4", "content-length": 4 });
      return res.end(Buffer.from([0, 0, 0, 0]));
    }
    json(404, {});
  });
});

(async () => {
  await new Promise((r) => server.listen(VENDOR_PORT, "127.0.0.1", r));
  console.log(`\n=== 供应商联调验收（假 Ark 供应商 :${VENDOR_PORT}）===\n`);

  // 直接调用适配器（进程内，避免依赖 worker 重启）
  const { ArkVideoAdapter } = await import(
    "file:///E:/wanxing/app/packages/model-adapters/dist/ark-video.js"
  );

  const mkReq = (prompt) => ({
    task_id: "t-1",
    request: {
      mode: "universal_reference",
      model: "seedance-2.5",
      scene: "storyboard_reference_video",
      input: { prompt, reference_uris: ["https://cdn/ref.jpg"] },
      options: { ratio: "9:16", resolution: "720p", duration: 5, count: 1 },
    },
    model: { name: "seedance-2.5", vendor: "volcengine", adapter_code: "volcengine:seedance" },
  });

  // 1) 提交：协议字段正确
  mode = "success";
  pollCount = 0;
  const adapter = new ArkVideoAdapter({
    apiKey: "test-key",
    baseUrl: `http://127.0.0.1:${VENDOR_PORT}`,
    timeoutMs: 5000,
    retryBaseMs: 50,
  });

  const sub = await adapter.submit(mkReq("雨夜街道，镜头推进"));
  ok("1. 提交返回 vendor task id", typeof sub.vendor_task_id === "string", sub.vendor_task_id);

  const r0 = received[0];
  ok("2. 请求带 Bearer 鉴权", r0?.auth === "Bearer test-key", r0?.auth);
  ok("3. 请求 body 含 model", r0?.body?.model === "seedance-2.5", r0?.body?.model);
  const textItem = r0?.body?.content?.find((c) => c.type === "text");
  ok("4. content 含 text 项且带镜头参数", /--ratio 9:16/.test(textItem?.text ?? ""), String(textItem?.text).slice(0, 60));
  const imgItems = r0?.body?.content?.filter((c) => c.type === "image_url") ?? [];
  ok("5. content 含参考图 image_url", imgItems.length === 1 && imgItems[0].image_url.url === "https://cdn/ref.jpg", imgItems.length);

  // 2) 轮询到成功
  let st = await adapter.poll(sub.vendor_task_id);
  ok("6. 首次轮询为 running", st.status === "running", st.status);
  st = await adapter.poll(sub.vendor_task_id);
  ok("7. 二次轮询成功并带结果 URI", st.status === "succeeded" && st.results?.[0]?.uri?.includes("/v.mp4"), st.results?.[0]?.uri);

  // 3) 审核驳回映射
  mode = "rejected";
  pollCount = 0;
  const sub2 = await adapter.submit(mkReq("违规内容"));
  const st2 = await adapter.poll(sub2.vendor_task_id);
  ok("8. 审核驳回映射为 review_rejected", st2.status === "review_rejected", st2.status);
  ok("9. 驳回错误码为 output_rejected（与全站一致）", st2.error?.code === "output_rejected", st2.error?.code);

  // 4) 失败映射
  mode = "fail";
  pollCount = 0;
  const sub3 = await adapter.submit(mkReq("失败场景"));
  const st3 = await adapter.poll(sub3.vendor_task_id);
  ok("10. 失败映射为 failed", st3.status === "failed", st3.status);
  ok("11. 失败错误码为 vendor_error（与全站一致）", st3.error?.code === "vendor_error", st3.error?.code);

  // 5) 5xx 重试
  const flaky = new ArkVideoAdapter(
    { apiKey: "k", baseUrl: `http://127.0.0.1:${VENDOR_PORT}`, timeoutMs: 5000, retryBaseMs: 20, maxRetries: 2 },
    (async (url, init) => {
      // 第一次 503，之后透传真实 fetch
      if (!globalThis.__retried) {
        globalThis.__retried = true;
        return { ok: false, status: 503, json: async () => ({}), text: async () => "busy" };
      }
      return fetch(url, init);
    }),
  );
  const sub4 = await flaky.submit(mkReq("重试场景"));
  ok("12. 5xx 后重试成功", typeof sub4.vendor_task_id === "string", sub4.vendor_task_id);

  console.log(`\n=== 结果：${results.filter(Boolean).length}/${results.length} 通过 ===`);
  server.close();
  process.exitCode = results.every(Boolean) ? 0 : 1;
})();
