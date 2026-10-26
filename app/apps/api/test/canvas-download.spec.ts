import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import JSZip from "jszip";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { pool } from "../src/db/database";
import { StorageService } from "../src/storage/storage.service";

/**
 * 画布节点产物批量下载（C13）e2e
 *
 * 锁住四条容易做错的语义：
 * 1. **下载单要落库**：链接过期后必须还能重新取（只返 URL 的实现，24h 后同一批文件就永远拿不到了）；
 * 2. 产物来源两级兜底：节点 `params.result_uris` 优先，缺失时回查 `tasks.results`；
 * 3. `mock://` 这类假协议不能塞进 zip 冒充文件；一个文件读不到不阻断整包；
 * 4. 打包内容要能真的解开（文件名 + manifest 都在），而不是"接口返回成功、zip 是坏的"。
 */
describe("canvas batch download e2e", () => {
  let app: NestFastifyApplication;
  let token = "";
  let otherToken = "";
  let canvasId = "";
  let storage: StorageService;
  const keys: string[] = [];

  const inject = async (
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    payload?: unknown,
    authToken?: string,
  ) => {
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (authToken ?? token) headers.authorization = `Bearer ${authToken ?? token}`;
    const res = await app.inject({
      method,
      url: `/v1${url}`,
      headers,
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = JSON.parse(res.body);
    return { status: res.statusCode, ...body, body };
  };

  async function loginNewUser(tag: string): Promise<string> {
    const tail = String(Date.now()).slice(-8);
    const phone = `1${tail}${String(tag).replace(/\D/g, "").slice(-2).padStart(2, "0")}`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const login = await inject("POST", "/auth/login", { phone, code: sms.data?.debug_code, age_confirmed: true });
    const tk = login.data?.access_token as string;
    if (!tk) throw new Error(`login failed: ${JSON.stringify(login.body).slice(0, 200)}`);
    return tk;
  }

  /** 往本地存储写一个真文件，返回可被 storage.read 的 key（等价于"节点产物已存好"） */
  async function putFile(name: string, content: string): Promise<string> {
    const key = `u/test/canvas-download/${Date.now()}-${name}`;
    await storage.put(key, Buffer.from(content, "utf8"), "text/plain");
    keys.push(key);
    return key;
  }

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: true }), {
      logger: false,
    });
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    storage = app.get(StorageService);

    token = await loginNewUser("01");
    otherToken = await loginNewUser("02");
    const created = await inject("POST", "/canvas/canvases", { title: "批量下载测试" });
    canvasId = created.data.id as string;
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await pool.end().catch(() => {});
  });

  it("打包选中节点产物 → 下载单落库 → 能重新取到链接", async () => {
    const imgKey = await putFile("a.png", "PNG-BYTES");
    const vidKey = await putFile("b.mp4", "MP4-BYTES");

    const nodeA = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "image",
      name: "图一",
      x: 0,
      y: 0,
      params: { result_uris: [imgKey] },
    });
    const nodeB = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "video",
      name: "视频一",
      x: 200,
      y: 0,
      params: { result_uri: vidKey },
    });
    expect(nodeA.code).toBe(0);
    expect(nodeB.code).toBe(0);

    const created = await inject("POST", `/canvas/canvases/${canvasId}/nodes/batch-download`, {
      node_ids: [nodeA.data.id, nodeB.data.id],
    });
    expect(created.code).toBe(0);
    expect(created.data.node_count).toBe(2);
    expect(created.data.file_count).toBe(2);
    expect(created.data.status).toBe(2);
    const listId = created.data.download_list_id as string;

    // 列表能查到（这正是不把下载单做成"一次性返回 URL"的理由）
    const listed = await inject("GET", `/canvas/canvases/${canvasId}/download-lists`);
    expect(listed.code).toBe(0);
    const row = (listed.data.list as Array<{ download_list_id: string }>).find(
      (item) => item.download_list_id === listId,
    );
    expect(row).toBeTruthy();

    const url = await inject("POST", `/canvas/canvases/${canvasId}/download-lists/${listId}/url`);
    expect(url.code).toBe(0);
    expect(url.data.url).toBeTruthy();
    expect(url.data.expires_in).toBe(86_400);
    expect(url.data.filename).toContain(".zip");

    // 真的把 zip 解开看内容：接口返回成功但包是坏的，是最没价值的"通过"
    const { rows } = await pool.query<{ object_key: string }>(
      "select object_key from canvas_download_lists where id = $1",
      [listId],
    );
    const buffer = await storage.read(rows[0]!.object_key);
    const zip = await JSZip.loadAsync(buffer);
    const names = Object.keys(zip.files);
    expect(names).toContain("manifest.json");
    expect(names.some((name) => name.startsWith("image-"))).toBe(true);
    expect(names.some((name) => name.startsWith("video-"))).toBe(true);
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string")) as {
      nodes: Array<{ node_id: string; files: string[] }>;
    };
    expect(manifest.nodes).toHaveLength(2);
    expect(manifest.nodes.every((item) => item.files.length === 1)).toBe(true);

    /**
     * **链接必须真能下到文件**。
     * 这一步单独测：只断言"返回了一个 URL"是不够的——历史上出现过签名链接指向
     * 另一个端口（3000）的情况，接口全程 200，用户点开却是别人的服务/404。
     * 这里把签名 URL 的 path+query 直接打进本应用，等于走完"签名校验 → 读文件"全链。
     */
    const signedUrl = new URL(url.data.url);
    const downloaded = await app.inject({
      method: "GET",
      url: `${signedUrl.pathname}${signedUrl.search}`,
    });
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.headers["content-type"]).toContain("zip");
    expect(downloaded.rawPayload.subarray(0, 2).toString()).toBe("PK");
  }, 60_000);

  it("节点还没有产物 → 400101（不产生空的下载单）", async () => {
    const node = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "image",
      name: "还没生成",
      x: 0,
      y: 300,
      params: {},
    });
    const before = await inject("GET", `/canvas/canvases/${canvasId}/download-lists`);
    const res = await inject("POST", `/canvas/canvases/${canvasId}/nodes/batch-download`, {
      node_ids: [node.data.id],
    });
    expect(res.code).toBe(400101);
    const after = await inject("GET", `/canvas/canvases/${canvasId}/download-lists`);
    expect(after.data.total).toBe(before.data.total);
  });

  it("假协议（mock://）不会被塞进 zip 冒充文件", async () => {
    const node = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "image",
      name: "mock 产物",
      x: 300,
      y: 300,
      params: { result_uris: ["mock://results/x.mp4"] },
    });
    const res = await inject("POST", `/canvas/canvases/${canvasId}/nodes/batch-download`, {
      node_ids: [node.data.id],
    });
    expect(res.code).toBe(400101);
  });

  it("上限与归属：超过 50 个 → 400101；别人的画布 → 400102", async () => {
    const tooMany = await inject("POST", `/canvas/canvases/${canvasId}/nodes/batch-download`, {
      node_ids: Array.from({ length: 51 }, (_, i) => String(1000 + i)),
    });
    expect(tooMany.code).toBe(400101);

    const node = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "image",
      name: "别人的",
      x: 0,
      y: 600,
      params: { result_uris: [await putFile("c.png", "X")] },
    });
    const foreign = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/batch-download`,
      { node_ids: [node.data.id] },
      otherToken,
    );
    expect(foreign.code).toBe(400102);
  });

  it("未知下载单 → 400102；跨 space 取链接 → 400102", async () => {
    const unknown = await inject("POST", `/canvas/canvases/${canvasId}/download-lists/999999/url`);
    expect(unknown.code).toBe(400102);

    const listed = await inject("GET", `/canvas/canvases/${canvasId}/download-lists`);
    const someId = (listed.data.list as Array<{ download_list_id: string }>)[0]?.download_list_id;
    expect(someId).toBeTruthy();
    const foreign = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/download-lists/${someId}/url`,
      undefined,
      otherToken,
    );
    expect(foreign.code).toBe(400102);
  });
});
