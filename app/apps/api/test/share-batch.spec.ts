import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq, inArray } from "drizzle-orm";
import { models, taskShares, tasks } from "@app/db";
import { newId } from "@app/shared";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { env } from "../src/config/env";
import { db } from "../src/db/database";

/**
 * 分享页批量下载（模块 #26 收尾）：`POST /share/:token/batch-download`。
 *
 * 这是**唯一一个不需要登录**的写行为（匿名访客点"打包下载"），所以测试重点不是
 * happy path，而是**越权边界**：
 * 1. token 被撤销 / 过期 / 不存在 → 400102（不能因为"公开"就放松校验）；
 * 2. **只打包该 share 指向任务的产物**：同一空间还有别的成功任务，zip 里不能出现它们的文件
 *    （越权读取=事故）。这一点直接解压 zip 读 manifest 断言，而不是只看 `count`；
 * 3. 任务没有产物 → 400102（不是给一个空 zip 让用户以为下载成功）。
 */
describe("share batch-download e2e", () => {
  let app: NestFastifyApplication;
  let token = "";
  let spaceId = "";
  let shareTaskId = "";
  let siblingTaskId = "";
  let emptyTaskId = "";
  let shareToken = "";
  const seededTaskIds: bigint[] = [];
  const writtenFiles: string[] = [];

  const inject = async (method: string, url: string, payload?: unknown, authToken?: string) => {
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (authToken) headers.authorization = `Bearer ${authToken}`;
    const res = await app.inject({
      method: method as "GET" | "POST" | "DELETE",
      url: `/v1${url}`,
      headers,
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(res.body) as Record<string, unknown>;
    } catch {
      body = { raw: res.body };
    }
    return {
      status: res.statusCode,
      code: (body as { code?: number }).code ?? -1,
      msg: (body as { msg?: string }).msg ?? "",
      data: (body as { data?: unknown }).data,
    };
  };

  /** 直接把产物写进本地存储目录（不跑 worker，测的是下载路径而不是生成） */
  function seedStoredFile(name: string): string {
    const key = `u/test/shares/${Date.now()}-${name}`;
    const target = join(env.STORAGE_DIR, key);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, Buffer.from(`artifact:${name}`));
    writtenFiles.push(target);
    return key;
  }

  async function seedTask(userId: string, results: unknown): Promise<string> {
    const [model] = await db.select({ id: models.id }).from(models).limit(1);
    const id = BigInt(newId());
    await db.insert(tasks).values({
      id,
      spaceId: BigInt(spaceId),
      userId: BigInt(userId),
      capability: "image",
      mode: "text2image",
      modelId: model.id,
      input: { prompt: "分享批量下载" },
      options: { ratio: "1:1", resolution: "1k", duration: 5, count: 1 },
      status: 3,
      results: results as unknown,
      finishedAt: new Date(),
    });
    seededTaskIds.push(id);
    return String(id);
  }

  beforeAll(async () => {
    const appInstance = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    await appInstance.register(cookie as never);
    appInstance.setGlobalPrefix("v1");
    appInstance.useGlobalFilters(new AllExceptionsFilter());
    appInstance.useGlobalInterceptors(new EnvelopeInterceptor());
    await appInstance.init();
    app = appInstance;

    const phone = `1${String(Date.now()).slice(-8)}01`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const code = (sms.data as { debug_code?: string } | undefined)?.debug_code;
    const loginRes = await inject("POST", "/auth/login", { phone, code, age_confirmed: true });
    const loginData = loginRes.data as
      | { access_token?: string; space_id?: string; user?: { id?: string } }
      | undefined;
    token = loginData?.access_token ?? "";
    spaceId = String(loginData?.space_id ?? "");
    const userId = String(loginData?.user?.id ?? "");

    const keyA = seedStoredFile("a.png");
    const keyB = seedStoredFile("b.png");
    shareTaskId = await seedTask(userId, [{ uri: keyA }, { uri: keyB }]);
    // 同空间、同用户的另一个成功任务：绝不能被这次打包带出去
    siblingTaskId = await seedTask(userId, [{ uri: seedStoredFile("sibling.png") }]);
    emptyTaskId = await seedTask(userId, []);

    const share = await inject("POST", `/tasks/${shareTaskId}/share`, { expires_in_days: 7 }, token);
    expect(share.code).toBe(0);
    shareToken = (share.data as { token: string }).token;
  });

  afterAll(async () => {
    if (seededTaskIds.length > 0) {
      await db.delete(taskShares).where(inArray(taskShares.taskId, seededTaskIds));
      await db.delete(tasks).where(inArray(tasks.id, seededTaskIds));
    }
    for (const file of writtenFiles) rmSync(file, { force: true });
    await app.close();
  });

  it("匿名访客（不带任何凭证）可以打包下载", async () => {
    const res = await inject("POST", `/share/${shareToken}/batch-download`);
    expect(res.code).toBe(0);
    const data = res.data as { url: string; filename: string; count: number; expires_in: number };
    expect(data.count).toBe(2);
    expect(data.expires_in).toBeGreaterThan(0);
    expect(data.filename.endsWith(".zip")).toBe(true);
    expect(data.url).toContain("/files/local?");
    expect(data.url).toContain("sig=");
  });

  it("只打包该 share 任务的产物（解压读 manifest，确认没有同空间其它任务）", async () => {
    const res = await inject("POST", `/share/${shareToken}/batch-download`);
    const data = res.data as { url: string; count: number };
    const key = new URL(data.url).searchParams.get("key") ?? "";
    expect(key.length).toBeGreaterThan(0);

    const zipPath = join(env.STORAGE_DIR, key);
    writtenFiles.push(zipPath);
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(readFileSync(zipPath));
    const manifestRaw = await zip.file("manifest.json")?.async("string");
    expect(manifestRaw).toBeTruthy();
    const manifest = JSON.parse(manifestRaw ?? "{}") as {
      task_id: string;
      files: string[];
    };
    // 打包范围由 share 行决定：task_id 必须是分享的那一条
    expect(manifest.task_id).toBe(shareTaskId);
    expect(manifest.files).toHaveLength(2);
    // 泄漏判定：兄弟任务的产物（sibling.png）绝不能出现在包里
    const names = Object.keys(zip.files);
    expect(names.some((name) => name.includes("sibling"))).toBe(false);
    expect(manifest.files.every((name) => /^result-\d+\.png$/.test(name))).toBe(true);
  });

  it("token 被撤销后 → 400102（公开不等于无校验）", async () => {
    const share = await inject("POST", `/tasks/${siblingTaskId}/share`, { expires_in_days: 7 }, token);
    const token2 = (share.data as { token: string }).token;
    const ok = await inject("POST", `/share/${token2}/batch-download`);
    expect(ok.code).toBe(0);

    const revoke = await inject("DELETE", `/tasks/${siblingTaskId}/share`, undefined, token);
    expect(revoke.code).toBe(0);

    const after = await inject("POST", `/share/${token2}/batch-download`);
    expect(after.code).toBe(400102);
  });

  it("token 过期后 → 400102", async () => {
    const share = await inject("POST", `/tasks/${shareTaskId}/share`, { expires_in_days: 7 }, token);
    const token2 = (share.data as { token: string }).token;
    await db
      .update(taskShares)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(taskShares.token, token2));
    const res = await inject("POST", `/share/${token2}/batch-download`);
    expect(res.code).toBe(400102);
  });

  it("不存在的 token → 400102", async () => {
    const res = await inject("POST", "/share/not-a-real-token/batch-download");
    expect(res.code).toBe(400102);
  });

  it("任务没有产物 → 400102（不给空 zip 假装成功）", async () => {
    const share = await inject("POST", `/tasks/${emptyTaskId}/share`, { expires_in_days: 7 }, token);
    const token2 = (share.data as { token: string }).token;
    const res = await inject("POST", `/share/${token2}/batch-download`);
    expect(res.code).toBe(400102);
  });

  it("公开预览接口仍可用（回归：批量下载没有破坏 GET /share/:token）", async () => {
    const res = await inject("GET", `/share/${shareToken}`);
    expect(res.code).toBe(0);
    const data = res.data as { results: unknown[] };
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.results).toHaveLength(2);
  });
});
