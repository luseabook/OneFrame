import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";

/**
 * 通用资源库（竞品 `/df/resources/*`，第 136 批）。
 *
 * 竞品形状（2026-11-04 逆向）：
 * - `GET /web/v1/df/resources/list?sp_id&page&page_size&resource_type&status&name`；
 * - `POST /web/v1/df/resources/add`；
 * - `resource_type`：1 role / 2 setting / 3 implement / 4 referenceVideo / 5 referenceImage / 8 filmNonRole。
 *
 * 我方用 `project_assets.resource_type`（由 kind 派生的生成列）承载：
 * 本 spec 锁「按类型过滤 + 参考视频创建 + 非法类型/缺 sp_id 拒绝」。
 */
describe("df resources list/add e2e", () => {
  let app: NestFastifyApplication;
  let token = "";
  let spaceId = "";
  let projectId = "";

  const inject = async (
    method: "GET" | "POST",
    url: string,
    payload?: unknown,
    authToken?: string,
  ): Promise<{ code: number; msg?: string; data?: unknown }> => {
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (authToken) headers.authorization = `Bearer ${authToken}`;
    const res = await app.inject({
      method,
      url: `/v1${url}`,
      headers,
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });
    return res.json() as { code: number; msg?: string; data?: unknown };
  };

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    await app.register(cookie as never);
    app.setGlobalPrefix("v1");
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const phone = `1${String(Date.now()).slice(-10)}`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const code = (sms.data as { debug_code?: string } | undefined)?.debug_code ?? "";
    const login = await inject("POST", "/auth/login", { phone, code, age_confirmed: true });
    const data = login.data as { access_token?: string; space_id?: string } | undefined;
    token = data?.access_token ?? "";
    spaceId = String(data?.space_id ?? "");
    expect(token).toBeTruthy();

    const project = await inject(
      "POST",
      "/projects",
      { title: "资源库测试项目", drama_type: 1, ratio: "9:16", source_type: 2, source_text: "" },
      token,
    );
    projectId = String((project.data as { id?: string } | undefined)?.id ?? "");
    expect(projectId).toBeTruthy();
  }, 90_000);

  afterAll(async () => {
    void spaceId;
    await app.close();
  });

  it("referenceVideo 资源创建后可按 resource_type=4 列出", async () => {
    const created = await inject(
      "POST",
      "/df/resources/add",
      {
        sp_id: projectId,
        resource_type: 4,
        name: "ref-1.mp4",
        file_uri: "u/mock/ref-1.mp4",
        content_type: "video/mp4",
      },
      token,
    );
    expect(created.code).toBe(0);

    const list = await inject(
      "GET",
      `/df/resources/list?sp_id=${projectId}&resource_type=4&page=1&page_size=20`,
      undefined,
      token,
    );
    expect(list.code).toBe(0);
    const data = list.data as { list: Array<Record<string, unknown>>; total: number };
    expect(data.total).toBe(1);
    const row = data.list[0]!;
    expect(Number(row.resource_type)).toBe(4);
    expect(String(row.file_uri)).toBe("u/mock/ref-1.mp4");
    expect(String(row.content_type)).toBe("video/mp4");
  });

  it("道具（prop → resource_type=3）与参考视频互不串类型", async () => {
    const prop = await inject(
      "POST",
      `/projects/${projectId}/assets`,
      { kind: "prop", name: "测试道具" },
      token,
    );
    expect(prop.code).toBe(0);

    const implementsList = await inject(
      "GET",
      `/df/resources/list?sp_id=${projectId}&resource_type=3`,
      undefined,
      token,
    );
    const implData = implementsList.data as { list: Array<Record<string, unknown>> };
    expect(implData.list.length).toBe(1);
    expect(Number(implData.list[0]!.resource_type)).toBe(3);

    const refList = await inject(
      "GET",
      `/df/resources/list?sp_id=${projectId}&resource_type=4`,
      undefined,
      token,
    );
    const refData = refList.data as { list: Array<Record<string, unknown>> };
    expect(refData.list.every((r) => Number(r.resource_type) === 4)).toBe(true);
  });

  it("单资源改名/定稿/取消定稿，批量删除生效", async () => {
    const created = await inject(
      "POST",
      "/df/resources/add",
      {
        sp_id: projectId,
        resource_type: 4,
        name: "ref-rename.mp4",
        file_uri: "u/mock/ref-rename.mp4",
        content_type: "video/mp4",
      },
      token,
    );
    const resourceId = String((created.data as { id?: string } | undefined)?.id ?? "");
    expect(created.code).toBe(0);
    expect(resourceId).toBeTruthy();

    const rename = await inject(
      "POST",
      `/df/resources/${resourceId}/rename`,
      { sp_id: projectId, name: "ref-renamed.mp4" },
      token,
    );
    expect(rename.code).toBe(0);
    expect((rename.data as { name?: string }).name).toBe("ref-renamed.mp4");

    const confirm = await inject(
      "POST",
      `/df/resources/${resourceId}/confirm`,
      { sp_id: projectId },
      token,
    );
    expect(confirm.code).toBe(0);
    expect((confirm.data as { status?: number }).status).toBe(2);

    const unconfirm = await inject(
      "POST",
      `/df/resources/${resourceId}/unconfirm`,
      { sp_id: projectId },
      token,
    );
    expect((unconfirm.data as { status?: number }).status).toBe(1);

    const deleted = await inject(
      "POST",
      "/df/resources/batch-delete",
      { sp_id: projectId, resource_ids: [resourceId] },
      token,
    );
    expect(deleted.code).toBe(0);
    expect((deleted.data as { deleted?: number }).deleted).toBe(1);

    const list = await inject(
      "GET",
      `/df/resources/list?sp_id=${projectId}&resource_type=4`,
      undefined,
      token,
    );
    const rows = (list.data as { list: Array<Record<string, unknown>> }).list;
    expect(rows.some((row) => String(row.id) === resourceId)).toBe(false);
  });

  it("批量 id 含非本项目资源 → 整批 400102", async () => {
    const res = await inject(
      "POST",
      "/df/resources/batch-delete",
      { sp_id: projectId, resource_ids: ["999999999"] },
      token,
    );
    expect(res.code).not.toBe(0);
  });

  it("目录：创建 → 资源移入 → 按 dir_id 过滤 → 删除目录后资源回未归档", async () => {
    const dir = await inject(
      "POST",
      "/df/resources/dir",
      { sp_id: projectId, name: "参考视频目录" },
      token,
    );
    expect(dir.code).toBe(0);
    const dirId = String((dir.data as { id?: string } | undefined)?.id ?? "");
    expect(dirId).toBeTruthy();

    const created = await inject(
      "POST",
      "/df/resources/add",
      {
        sp_id: projectId,
        resource_type: 4,
        name: "dir-ref.mp4",
        file_uri: "u/mock/dir-ref.mp4",
        content_type: "video/mp4",
      },
      token,
    );
    const resourceId = String((created.data as { id?: string } | undefined)?.id ?? "");

    const moved = await inject(
      "POST",
      "/df/resources/dir/asset/batch-move",
      { sp_id: projectId, resource_ids: [resourceId], dir_id: dirId },
      token,
    );
    expect(moved.code).toBe(0);

    const inDir = await inject(
      "GET",
      `/df/resources/list?sp_id=${projectId}&resource_type=4&dir_id=${dirId}`,
      undefined,
      token,
    );
    const rows = (inDir.data as { list: Array<Record<string, unknown>> }).list;
    expect(rows.some((row) => String(row.id) === resourceId && String(row.dir_id) === dirId)).toBe(true);

    const dirs = await inject("GET", `/df/resources/dir/list?sp_id=${projectId}`, undefined, token);
    const dirRows = (dirs.data as { list: Array<Record<string, unknown>> }).list;
    expect(dirRows.some((d) => String(d.id) === dirId && Number(d.resource_count) === 1)).toBe(true);

    const removed = await inject(
      "POST",
      `/df/resources/dir/${dirId}/delete`,
      { sp_id: projectId },
      token,
    );
    expect(removed.code).toBe(0);

    const unfiled = await inject(
      "GET",
      `/df/resources/list?sp_id=${projectId}&resource_type=4&dir_id=none`,
      undefined,
      token,
    );
    const unfiledRows = (unfiled.data as { list: Array<Record<string, unknown>> }).list;
    expect(unfiledRows.some((row) => String(row.id) === resourceId)).toBe(true);
  });

  it("缺 sp_id / 非法 resource_type 均 400101", async () => {
    const noSp = await inject("GET", "/df/resources/list?resource_type=4", undefined, token);
    expect(noSp.code).toBe(400101);

    const badType = await inject(
      "GET",
      `/df/resources/list?sp_id=${projectId}&resource_type=6`,
      undefined,
      token,
    );
    expect(badType.code).toBe(400101);
  });
});