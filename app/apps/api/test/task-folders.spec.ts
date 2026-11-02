import { afterAll, beforeAll, describe, expect, it } from "vitest";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { and, eq, inArray } from "drizzle-orm";
import { models, taskFolders, tasks } from "@app/db";
import { newId } from "@app/shared";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { db, pool } from "../src/db/database";

describe("task result folders", () => {
  let app: NestFastifyApplication;
  let token = "";
  let spaceId = "";
  let userId = "";
  let taskId = "";
  const folderIds: bigint[] = [];

  async function inject(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) {
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await app.inject({
      method,
      url: `/v1${url}`,
      headers,
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = JSON.parse(res.body) as { code?: number; msg?: string; data?: unknown };
    return { code: body.code ?? -1, msg: body.msg ?? "", data: body.data };
  }

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.register(cookie as never);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const phone = `1${String(Date.now()).slice(-10)}`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const code = (sms.data as { debug_code?: string } | undefined)?.debug_code;
    const login = await inject("POST", "/auth/login", { phone, code, age_confirmed: true });
    const data = login.data as { access_token: string; space_id: string; user: { id: string } };
    token = data.access_token;
    spaceId = data.space_id;
    userId = data.user.id;

    const [model] = await db.select({ id: models.id }).from(models).limit(1);
    if (!model) throw new Error("seed model missing");
    taskId = String(newId());
    await db.insert(tasks).values({
      id: BigInt(taskId),
      spaceId: BigInt(spaceId),
      userId: BigInt(userId),
      capability: "text",
      mode: "text_to_text",
      modelId: model.id,
      input: { prompt: "folder test" },
      options: {},
      status: 3,
    });
  });

  afterAll(async () => {
    if (taskId) await db.delete(tasks).where(eq(tasks.id, BigInt(taskId)));
    if (folderIds.length) await db.delete(taskFolders).where(inArray(taskFolders.id, folderIds));
    await app.close();
    await pool.end().catch(() => undefined);
  });

  it("creates, assigns, filters, renames and deletes a result folder", async () => {
    const name = `E2E folder ${Date.now()}`;
    const created = await inject("POST", "/tasks/folders", { name });
    expect(created.code).toBe(0);
    const folder = created.data as { id: string; name: string };
    folderIds.push(BigInt(folder.id));

    const assigned = await inject("PATCH", `/tasks/${taskId}/folder`, { folder_id: folder.id });
    expect(assigned.code).toBe(0);
    expect((assigned.data as { folder_id: string }).folder_id).toBe(folder.id);

    const filtered = await inject("GET", `/tasks?folder_id=${folder.id}&page=1&page_size=20`);
    expect(filtered.code).toBe(0);
    expect((filtered.data as { list: Array<{ task_id: string }> }).list.map((row) => row.task_id)).toContain(taskId);

    const unfiled = await inject("GET", "/tasks?folder_id=unfiled&page=1&page_size=20");
    expect((unfiled.data as { list: Array<{ task_id: string }> }).list.map((row) => row.task_id)).not.toContain(taskId);

    const renamed = await inject("PATCH", `/tasks/folders/${folder.id}`, { name: `${name} renamed` });
    expect(renamed.code).toBe(0);
    expect((renamed.data as { name: string }).name).toContain("renamed");

    const folders = await inject("GET", "/tasks/folders");
    expect(folders.code).toBe(0);
    expect((folders.data as { list: Array<{ id: string; task_count: number }> }).list.find((row) => row.id === folder.id)?.task_count).toBe(1);

    const deleted = await inject("DELETE", `/tasks/folders/${folder.id}`);
    expect(deleted.code).toBe(0);
    const after = await db.select({ folderId: tasks.folderId }).from(tasks).where(and(eq(tasks.id, BigInt(taskId)), eq(tasks.spaceId, BigInt(spaceId))));
    expect(after[0]?.folderId).toBeNull();
  });

  it("rejects duplicate names and folders from another space", async () => {
    const first = await inject("POST", "/tasks/folders", { name: "duplicate-folder" });
    expect(first.code).toBe(0);
    folderIds.push(BigInt((first.data as { id: string }).id));
    const duplicate = await inject("POST", "/tasks/folders", { name: "duplicate-folder" });
    expect(duplicate.code).toBe(400101);

    const invalid = await inject("PATCH", `/tasks/${taskId}/folder`, { folder_id: "999999999999999999" });
    expect(invalid.code).toBe(400102);
  });
});
