import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { connect } from "node:net";
import { join, relative } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import ts from "typescript";
import { DEFAULT_DOWNLOAD_TIMEOUT_MS } from "@app/shared";
import {
  BODY_LIMIT_BYTES,
  INBOUND_LIMITS,
  createHttpAdapter,
  inboundServerOptions,
  resolveInboundLimits,
} from "../src/config/inbound-limits";
import type { InboundLimits } from "../src/config/inbound-limits";

/**
 * 门禁：HTTP 入站三道闸（第 122 批）。
 *
 * 为什么需要它（先量的事实，`_acceptance/d122`）：
 * - Fastify 5.12.7 的 `defaultInitOptions`（`lib/config-validator.js:1265`）把
 *   `requestTimeout` / `connectionTimeout` / `handlerTimeout` 全定成 `0`，`lib/server.js:339-341`
 *   再把这几个 0 原样写到 Node 的 server 上 —— Node 24 自带的 `requestTimeout` 默认 300s
 *   被一起抹掉。于是「请求体发一半就不动了」的连接可以永远占着解析器和已收字节。
 *   语法完全合法，类型检查 / lint / 构建 / 总闸都不会红。
 * - 这三项**不能**靠「照抄 Node 默认值」：Fastify 的 0 是「不设上限」，Node 的 0 在
 *   `setTimeout` 语义下也是「不设上限」，但 Node 的 `requestTimeout` 默认是 300000。
 *   只有显式给出三个数，语义才确定。
 *
 * 本文件三层，各盯一件事：
 *   1. **纯函数层**：`INBOUND_LIMITS` 的取值、冻结、resolver 的拒绝面（0 / 负数 / NaN /
 *      Infinity / 小数 / 拼错键 / handlerMs ≠ 0 / idle ≤ request）。
 *   2. **接线层（实测，不启 Nest、不连库）**：`createHttpAdapter().getInstance()` 上的
 *      `server.requestTimeout / timeout / headersTimeout / keepAliveTimeout`、
 *      `initialConfig.handlerTimeout / bodyLimit / trustProxy / genReqId` —— 断言
 *      「选项真的落到了 Node 上」，而不是「我们传了选项所以应该生效」。
 *   3. **行为层（裸 socket，只看事件有无，不看毫秒数）**：静默 handler 会不会被断、
 *      写能不能重置静默闸、requestTimeout 单开时会不会误杀 handler。
 *   4. **静态守卫**：`apps/api/src` 里 `new FastifyAdapter(` 只许有一处，且必须展开
 *      `...inboundServerOptions(...)` —— 删掉那行 spread 立刻红。
 *
 * 覆盖边界（诚实说明）：
 * - `requestTimeout` 由 Node 的定时扫描生效，**没有** Fastify 选项能调小扫描间隔；
 *   所以「半截 body 收到 408」这一形状用裸 `http.createServer` 单独锚定，生产接线只
 *   断言 `server.requestTimeout === 120_000`。要真等 120s 才能观察一次，不做。
 * - 行为层只用「有没有 data / 有没有 close / 抓住 hold 末仍开着」判定，不断言具体
 *   毫秒数（那会是 CI 抖动源）；每次 hold 都给足余量（400ms 闸配 1300ms 观察窗）。
 * - 不断言 keep-alive 空转连接的回收：第 122 批量测里 `connectionTimeout` 与
 *   `keepAliveTimeout` 在 1.6s 窗内都没回收空转连接，没有可断言的结论。
 * - 静态守卫只认 `new FastifyAdapter(...)` / `new x.FastifyAdapter(...)` 两种写法；
 *   先 `import { FastifyAdapter as FA }` 再 `new FA(...)` 不会被认出（当前仓库没有）。
 */

const APP_ROOT = join(__dirname, "..", "..", "..");
const SCAN_ROOT = "apps/api/src";
/** 全仓唯一允许 `new FastifyAdapter(` 的地方 */
const ADAPTER_FILE = "apps/api/src/config/inbound-limits.ts";
const ENTRY_FILE = "apps/api/src/main.ts";

const BODY = '{"a":1}'; // 7 字节；Content-Length 必须按真实字节算，写错会让 handler 根本不跑

function probeHead(path = "/probe"): string {
  return `POST ${path} HTTP/1.1\r\nHost: probe\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(BODY)}\r\n\r\n`;
}

type ProbeEvent =
  | { readonly at: number; readonly kind: "data"; readonly head: string }
  | { readonly at: number; readonly kind: "close" }
  | { readonly at: number; readonly kind: "still-open" }
  | { readonly at: number; readonly kind: "error"; readonly code: string };

/**
 * 用裸 socket 发一次完整请求，记录 data / close / error；到 holdMs 仍开着就记
 * `still-open`（这条很重要：client 自己 destroy 也会产生 close，只是「有 close」
 * 证明不了是服务端断的）。
 */
function drive(port: number, payload: string, holdMs: number): Promise<ProbeEvent[]> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const events: ProbeEvent[] = [];
    let settled = false;
    let hold: ReturnType<typeof setTimeout> | undefined;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (hold !== undefined) clearTimeout(hold);
      resolve(events);
    };

    const socket = connect(port, "127.0.0.1");
    socket.setNoDelay(true);
    socket.on("connect", () => socket.write(payload));
    socket.on("data", (chunk: Buffer) => {
      const head = chunk.toString("latin1").split("\r\n")[0] ?? "";
      events.push({ at: Date.now() - startedAt, kind: "data", head });
    });
    socket.on("error", (error: NodeJS.ErrnoException) => {
      events.push({ at: Date.now() - startedAt, kind: "error", code: error.code ?? error.message });
    });
    socket.on("close", () => {
      events.push({ at: Date.now() - startedAt, kind: "close" });
      finish();
    });
    hold = setTimeout(() => {
      if (!socket.destroyed) {
        events.push({ at: Date.now() - startedAt, kind: "still-open" });
        socket.destroy();
      }
      finish();
    }, holdMs);
  });
}

const dataHeads = (events: readonly ProbeEvent[]): string[] =>
  events.flatMap((event) => (event.kind === "data" ? [event.head] : []));
const closedByPeer = (events: readonly ProbeEvent[]): boolean =>
  events.some((event) => event.kind === "close") && !events.some((event) => event.kind === "still-open");

/** 起一个真实的 adapter 实例（只注册探测路由），跑完必关 */
async function withAdapter(
  overrides: Partial<InboundLimits>,
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
  run: (port: number) => Promise<void>,
): Promise<void> {
  const instance: FastifyInstance = createHttpAdapter(overrides).getInstance();
  instance.post("/probe", handler);
  await instance.listen({ port: 0, host: "127.0.0.1" });
  const address = instance.server.address();
  if (address === null || typeof address === "string") throw new Error("adapter did not bind a TCP port");
  try {
    await run(address.port);
  } finally {
    await instance.close();
  }
}

/** 静默 handler：body 已收全，但 900ms 不写任何字节 —— 只有静默闸能断它 */
const silentHandler = async (): Promise<void> => {
  await sleep(900);
};

describe("入站三道闸（第 122 批）", () => {
  describe("取值与 resolver（纯函数）", () => {
    it("生产值写死为 收请求 120s / socket 静默 600s / handler 0，且冻结", () => {
      expect(INBOUND_LIMITS).toEqual({ requestMs: 120_000, idleMs: 600_000, handlerMs: 0 });
      expect(Object.isFrozen(INBOUND_LIMITS)).toBe(true);
    });

    it("requestMs 必须 > 60s：Node 取 headersTimeout = min(60_000, requestTimeout)，且不得大于 requestTimeout", () => {
      expect(INBOUND_LIMITS.requestMs).toBeGreaterThan(60_000);
    });

    it("idleMs 必须宽于出站下载闸（300s），否则「等一个合法下载」会被当死连接掐掉", () => {
      expect(DEFAULT_DOWNLOAD_TIMEOUT_MS).toBe(5 * 60_000);
      expect(INBOUND_LIMITS.idleMs).toBeGreaterThan(DEFAULT_DOWNLOAD_TIMEOUT_MS);
    });

    it("handlerMs 必须为 0：4 个 SSE 端点的 handler 要等客户端断开才 settle", () => {
      expect(INBOUND_LIMITS.handlerMs).toBe(0);
    });

    it("映射到 Fastify 选项名，且三处一一对应", () => {
      expect(inboundServerOptions()).toEqual({
        requestTimeout: 120_000,
        connectionTimeout: 600_000,
        handlerTimeout: 0,
      });
      expect(inboundServerOptions({ requestMs: 90_000, idleMs: 120_000 })).toEqual({
        requestTimeout: 90_000,
        connectionTimeout: 120_000,
        handlerTimeout: 0,
      });
    });

    it("bodyLimit 是 48MB（48 = 32MB 视频 × 4/3 + 余量）", () => {
      expect(BODY_LIMIT_BYTES).toBe(48 * 1024 * 1024);
    });

    it.each([
      ["requestMs", 0],
      ["idleMs", 0],
      ["requestMs", -1],
      ["idleMs", -60_000],
      ["requestMs", Number.NaN],
      ["idleMs", Number.POSITIVE_INFINITY],
      ["requestMs", 120_000.5],
    ])("拒绝「等于无限」或非法的 %s = %s", (key, value) => {
      expect(() => resolveInboundLimits({ [key]: value } as Partial<InboundLimits>)).toThrow(RangeError);
    });

    it("拒绝非 0 的 handlerMs（非 0 会把 SSE 长连接判成超时）", () => {
      expect(() => resolveInboundLimits({ handlerMs: 30_000 })).toThrow(RangeError);
    });

    it("拒绝 idleMs ≤ requestMs（静默闸比收请求闸还短，等于白设）", () => {
      expect(() => resolveInboundLimits({ requestMs: 60_000, idleMs: 60_000 })).toThrow(RangeError);
    });

    it("拒绝拼错的键（requestTimeout 之类会静默保留默认值，是最难发现的漏）", () => {
      expect(() => resolveInboundLimits({ requestTimeout: 1 } as unknown as Partial<InboundLimits>)).toThrow(
        /unknown inbound limit requestTimeout/,
      );
    });

    it("新对象，不改冻结的默认值", () => {
      const merged = resolveInboundLimits({ requestMs: 61_000 });
      expect(merged.requestMs).toBe(61_000);
      expect(INBOUND_LIMITS.requestMs).toBe(120_000);
      expect(merged).not.toBe(INBOUND_LIMITS);
    });
  });

  describe("接线（真实实例，不启 Nest / 不连库）", () => {
    it("三个数真的落到了 Node 的 server 上（而不是只存在于 options 里）", async () => {
      const instance: FastifyInstance = createHttpAdapter().getInstance();
      try {
        expect(instance.server.requestTimeout).toBe(120_000);
        expect(instance.server.timeout).toBe(600_000); // server.setTimeout(connectionTimeout)
        expect(instance.server.headersTimeout).toBe(60_000); // Node 推导：min(60_000, requestTimeout)
        expect(instance.server.keepAliveTimeout).toBe(72_000); // Fastify 默认，未改动
        expect(instance.initialConfig.handlerTimeout).toBe(0);
        expect(instance.initialConfig.bodyLimit).toBe(BODY_LIMIT_BYTES);
      } finally {
        await instance.close();
      }
    });

    it("trustProxy 生效（request.ip 取 X-Forwarded-For 的第一跳）", async () => {
      const instance: FastifyInstance = createHttpAdapter().getInstance();
      instance.get("/ip", async (request) => ({ ip: request.ip }));
      try {
        const response = await instance.inject({
          method: "GET",
          url: "/ip",
          headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
        });
        expect((response.json() as { ip: string }).ip).toBe("203.0.113.9");
      } finally {
        await instance.close();
      }
    });

    it("genReqId 产出 UUID（request_id 回传依赖它）", async () => {
      const instance: FastifyInstance = createHttpAdapter().getInstance();
      instance.get("/id", async (request) => ({ id: request.id }));
      try {
        const response = await instance.inject({ method: "GET", url: "/id" });
        expect(response.statusCode).toBe(200);
        expect((response.json() as { id: string }).id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
      } finally {
        await instance.close();
      }
    });

    it("改前形状（对照）：Fastify 的 0 会把 Node 自带的 300s 收请求上限抹成「不设上限」", async () => {
      const bare: Server = createServer();
      try {
        expect(bare.requestTimeout).toBe(300_000); // Node 24 默认
      } finally {
        await new Promise<void>((resolve) => bare.close(() => resolve()));
      }

      // 对照必须在测试里直接构造：这正是被 createHttpAdapter 取代的那个形状。
      const legacy = new FastifyAdapter({ requestTimeout: 0, connectionTimeout: 0 });
      const instance: FastifyInstance = legacy.getInstance();
      try {
        expect(instance.server.requestTimeout).toBe(0);
        expect(instance.initialConfig.connectionTimeout).toBe(0);
        expect(instance.initialConfig.handlerTimeout).toBe(0);
      } finally {
        await instance.close();
      }
    });
  });

  describe("行为（裸 socket，只看事件有无）", () => {
    it("生产值下，静默 900ms 的 handler 照常回 200（不误杀正常延迟）", async () => {
      await withAdapter({}, async (_request, reply) => {
        await silentHandler();
        reply.send({ ok: true });
      }, async (port) => {
        const events = await drive(port, probeHead() + BODY, 1_300);
        expect(dataHeads(events).some((head) => head.includes("200"))).toBe(true);
      });
    });

    it("requestTimeout 单开（400ms）不掐 handler —— 所以下面的断链只能归因于静默闸", async () => {
      await withAdapter({ requestMs: 400, idleMs: 6_000 }, async (_request, reply) => {
        await silentHandler();
        reply.send({ ok: true });
      }, async (port) => {
        const events = await drive(port, probeHead() + BODY, 1_300);
        expect(dataHeads(events).some((head) => head.includes("200"))).toBe(true);
      });
    });

    it("静默闸（400ms）掐住 body 已收全、handler 一直不回的连接，且不给响应", async () => {
      await withAdapter({ requestMs: 300, idleMs: 400 }, async (_request, reply) => {
        await silentHandler();
        reply.send({ ok: true });
      }, async (port) => {
        const events = await drive(port, probeHead() + BODY, 1_300);
        expect(dataHeads(events)).toEqual([]); // 裸 close：连 408 都没有
        expect(closedByPeer(events)).toBe(true);
      });
    });

    it("「写」会重置静默闸：400ms 闸下每 100ms 写一帧，600ms 的 6 帧全部到达", async () => {
      await withAdapter({ requestMs: 300, idleMs: 400 }, async (_request, reply) => {
        reply.raw.writeHead(200, { "content-type": "text/event-stream" });
        for (let index = 0; index < 6; index += 1) {
          await sleep(100);
          reply.raw.write(`data: ${String(index)}\n\n`);
        }
        reply.raw.end();
      }, async (port) => {
        const events = await drive(port, probeHead() + BODY, 1_300);
        const heads = dataHeads(events);
        expect(heads[0]).toContain("200");
        // 闸不重置的话最多只能到第 4 帧（400ms 处断）；第 5 帧在 500ms。
        expect(heads.length).toBeGreaterThanOrEqual(5);
      });
    });

    it("收请求闸的形状（裸 Node 锚定）：半截 body 在扫描时收到 408", async () => {
      const server = createServer({
        requestTimeout: 300,
        headersTimeout: 300,
        connectionsCheckingInterval: 100,
      });
      server.on("request", (request, reply) => {
        request.on("data", () => undefined);
        request.on("end", () => reply.end("ok"));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("bare server did not bind");
      try {
        const half = `POST /p HTTP/1.1\r\nHost: p\r\nContent-Length: 20\r\n\r\n{"a":`;
        const events = await drive(address.port, half, 1_500);
        expect(dataHeads(events).some((head) => head.includes("408"))).toBe(true);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  describe("静态守卫：全仓只有一个 new FastifyAdapter(", () => {
    it("扫描器自测：注释里的 new FastifyAdapter( 不算，真表达式才算", () => {
      const commented = scanAdapterSites(
        "synthetic.ts",
        "// 全仓唯一的 new FastifyAdapter( 在这里\nexport const a = 1;\n",
      );
      expect(commented).toEqual([]);

      const real = scanAdapterSites(
        "synthetic.ts",
        "import { FastifyAdapter } from \"@nestjs/platform-fastify\";\nexport const a = new FastifyAdapter({ ...inboundServerOptions() });\n",
      );
      expect(real).toHaveLength(1);
      expect(real[0]?.line).toBe(2);
      expect(real[0]?.spreadsInboundOptions).toBe(true);

      expect(scanAdapterSites("synthetic.ts", "export const a = new Fastify({});\n")).toEqual([]);
      expect(scanAdapterSites("synthetic.ts", "export const a = new platform.FastifyAdapter({});\n")).toHaveLength(1);

      // 手写选项（少了展开）必须被认出来，否则守卫只会「认得字」而不会「认得接线」。
      const manual = scanAdapterSites("synthetic.ts", "export const a = new FastifyAdapter({ requestTimeout: 1 });\n");
      expect(manual).toHaveLength(1);
      expect(manual[0]?.spreadsInboundOptions).toBe(false);
    });

    it("真实树：唯一一处，在 inbound-limits.ts，且展开了 ...inboundServerOptions(...)", () => {
      const sites = walk(join(APP_ROOT, SCAN_ROOT)).flatMap((full) =>
        scanAdapterSites(relative(APP_ROOT, full).replaceAll("\\", "/"), readFileSync(full, "utf8")),
      );
      expect(sites.map((site) => site.file)).toEqual([ADAPTER_FILE]);
      expect(sites[0]?.spreadsInboundOptions).toBe(true);
    });

    it("入口 main.ts 只调 createHttpAdapter()，不再自己 new 适配器", () => {
      const entry = readFileSync(join(APP_ROOT, ENTRY_FILE), "utf8");
      expect(scanAdapterSites(ENTRY_FILE, entry)).toEqual([]);
      expect(entry).toContain("createHttpAdapter()");
    });
  });
});

interface AdapterSite {
  readonly file: string;
  readonly line: number;
  /** 实参里有没有展开 `...inboundServerOptions(...)` */
  readonly spreadsInboundOptions: boolean;
}

/**
 * 扫描一段源码里的 `new FastifyAdapter(...)`；纯函数，自测与真树扫描共用。
 *
 * 必须是 AST：`inbound-limits.ts` 自己的头注释里就写着 `new FastifyAdapter(` 这几个字，
 * 文本匹配会让守卫在它要保护的那段注释上误报。
 */
function scanAdapterSites(file: string, source: string): AdapterSite[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const sites: AdapterSite[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : undefined;
      if (name === "FastifyAdapter") {
        const args = node.arguments === undefined ? [] : [...node.arguments];
        sites.push({
          file,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          spreadsInboundOptions: args.some(
            (arg) =>
              ts.isObjectLiteralExpression(arg) &&
              arg.properties.some(
                (property) =>
                  ts.isSpreadAssignment(property) &&
                  ts.isCallExpression(property.expression) &&
                  ts.isIdentifier(property.expression.expression) &&
                  property.expression.expression.text === "inboundServerOptions",
              ),
          ),
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return sites;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".ts") && !/\.(spec|test)\.ts$/.test(name)) out.push(full);
  }
  return out;
}