import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { FilmNotifyService } from "../src/modules/film/film-notify.service";

/**
 * 影视版离线通知 webhook 投递单测（模块 #8 收尾）。
 *
 * 为什么用真实的本地 HTTP 服务而不是 mock fetch：
 * 这里要验的恰恰是**网络行为**——签名头是否随请求发出、接收方 500 时是否真的重试 3 次、
 * 未配置时是否真的不发请求。mock fetch 能"证明代码调了函数"，但证明不了这些。
 *
 * 用 `process.env` 在用例内切换配置（服务在调用时读取，见 film-notify.service 文件头）。
 */

const servers: Server[] = [];

async function startReceiver(
  handler: (body: string, headers: Record<string, string | string[] | undefined>) => number,
): Promise<{ url: string; received: Array<{ body: string; headers: Record<string, string | string[] | undefined> }> }> {
  const received: Array<{ body: string; headers: Record<string, string | string[] | undefined> }> = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      received.push({ body, headers: req.headers });
      const status = handler(body, req.headers);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: status < 400 }));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}/hook`, received };
}

afterEach(async () => {
  delete process.env.FILM_NOTIFY_WEBHOOK_URL;
  delete process.env.FILM_NOTIFY_SECRET;
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe("film-notify", () => {
  const service = new FilmNotifyService();

  it("未配置 URL → delivery=stored 且不发任何请求", async () => {
    const { url, received } = await startReceiver(() => 200);
    void url;
    const result = await service.deliver({ type: "film.task.notified", spaceId: "1" });
    expect(result.delivery).toBe("stored");
    expect(result.attempts).toBe(0);
    expect(received).toHaveLength(0);
  });

  it("配置了 URL → 真投递，带 x-of-signature 且签名可复算验证", async () => {
    const { url, received } = await startReceiver(() => 200);
    process.env.FILM_NOTIFY_WEBHOOK_URL = url;
    process.env.FILM_NOTIFY_SECRET = "test-secret";

    const result = await service.deliver({
      type: "film.task.notified",
      spaceId: "1085",
      projectId: "42",
      tableId: "77",
      payload: { task_id: "9", user_ids: ["5"] },
    });

    expect(result.delivery).toBe("delivered");
    expect(result.attempts).toBe(1);
    expect(result.status).toBe(200);
    expect(received).toHaveLength(1);

    const sent = received[0]!;
    const signature = String(sent.headers["x-of-signature"] ?? "");
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    // 接收方视角复算：用同一密钥对原始 body 做 HMAC，必须与头部一致
    expect(signature).toBe(service.sign(sent.body, "test-secret"));
    expect(String(sent.headers["x-of-event"])).toBe("film.task.notified");
    const parsed = JSON.parse(sent.body) as Record<string, unknown>;
    expect(parsed.type).toBe("film.task.notified");
    expect(parsed.space_id).toBe("1085");
    expect(parsed.project_id).toBe("42");
    expect(parsed.table_id).toBe("77");
  });

  it("接收方 500 → 重试 3 次后 delivery=failed（不无限重试、不假装成功）", async () => {
    const { url, received } = await startReceiver(() => 500);
    process.env.FILM_NOTIFY_WEBHOOK_URL = url;

    const result = await service.deliver({ type: "film.task.notified", spaceId: "1" });
    expect(result.delivery).toBe("failed");
    expect(result.attempts).toBe(3);
    expect(received).toHaveLength(3);
    expect(result.status).toBe(500);
  }, 15_000);

  it("接收方先 500 后 200 → 第 2 次成功，attempts=2", async () => {
    let calls = 0;
    const { url, received } = await startReceiver(() => {
      calls += 1;
      return calls === 1 ? 500 : 200;
    });
    process.env.FILM_NOTIFY_WEBHOOK_URL = url;

    const result = await service.deliver({ type: "film.task.notified", spaceId: "1" });
    expect(result.delivery).toBe("delivered");
    expect(result.attempts).toBe(2);
    expect(received).toHaveLength(2);
  }, 15_000);

  it("无密钥时不发签名头（避免用空密钥签出可伪造的签名）", async () => {
    const { url, received } = await startReceiver(() => 200);
    process.env.FILM_NOTIFY_WEBHOOK_URL = url;

    await service.deliver({ type: "film.task.notified", spaceId: "1" });
    expect(received[0]!.headers["x-of-signature"]).toBeUndefined();
  });
});
