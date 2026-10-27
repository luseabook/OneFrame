import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { sql } from "drizzle-orm";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { db, pool } from "../src/db/database";

/**
 * 主体库（subject）契约测试 —— 对照竞品 `cmd/subject.md`。
 *
 * 重点验证四件（错了就没有「角色跨镜一致性」）：
 * 1. **审核三态**：新建一律 `reviewing`；只有 `approved` 可用于生成；`rejected` 的
 *    `retryable` 必须是 false（竞品：驳回不可自动重试，误当 internal 重试会触发风控）；
 * 2. **save-from-resource 语义**：绑定原资产、**不新建资产**，重复保存幂等返回既有主体；
 *    ✓ 定稿 + 有参考图才允许；未定稿 400105（与生成侧同口径）；
 * 3. **多租户隔离**：跨 space 一律查不到（400102，不泄露主体是否存在）；
 * 4. **软删**：删除后详情 400102、重复删除 400102。
 *
 * 为什么断言"不新建资产"要数 project_assets：竞品这条命令的价值就是"不要重复建资产"，
 * 一旦实现里偷偷 insert 一行，ID 复用和一致性都会崩，所以必须用行数证明。
 */
describe("subjects e2e", () => {
  let app: NestFastifyApplication;
  let token = "";
  let tokenOther = "";
  let spaceId = "";
  let otherSpaceId = "";
  let projectId = "";
  let finalizedSceneId = "";
  let draftSceneId = "";
  const stamp = `subj${Date.now()}`;
  const refUri = `u/test/subject-${stamp}.png`;

  interface Envelope {
    code: number;
    msg: string;
    data: any;
  }

  const raw = async (
    asToken: string,
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    payload?: Record<string, unknown>,
  ): Promise<Envelope> => {
    const res = await app.inject({
      method,
      url: `/v1${url}`,
      payload,
      headers: { authorization: `Bearer ${asToken}` },
    });
    return res.json() as Envelope;
  };
  const inject = (
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    payload?: Record<string, unknown>,
  ) => raw(token, method, url, payload);

  const login = async (phone: string) => {
    const sms = (await app.inject({ method: "POST", url: "/v1/auth/sms-code", payload: { phone } })).json() as Envelope;
    expect(sms.code).toBe(0);
    const body = (
      await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { phone, code: sms.data.debug_code as string, age_confirmed: true },
      })
    ).json() as Envelope;
    expect(body.code).toBe(0);
    return { token: body.data.access_token as string, spaceId: String(body.data.space_id) };
  };

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    await app.register(cookie as never);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const a = await login(`15${String(Math.floor(Math.random() * 900000000) + 100000000)}`);
    token = a.token;
    spaceId = a.spaceId;
    const b = await login(`15${String(Math.floor(Math.random() * 900000000) + 100000000)}`);
    tokenOther = b.token;
    otherSpaceId = b.spaceId;

    // 一个项目 + 一个已定稿场景资产 + 一个草稿场景资产（用于 400105 与 save-from-resource）
    const project = await inject("POST", "/projects", {
      title: `主体库测试-${stamp}`,
      source_type: 1,
      source_text: "第一章：林晚在雨夜收到一封匿名信。",
    });
    expect(project.code).toBe(0);
    projectId = project.data.id;

    const scene = await inject("POST", `/projects/${projectId}/assets`, {
      kind: "scene",
      name: `雨夜街角-${stamp}`,
      description: "主角第一次出场的街角",
      prompt: "电影感雨夜街角，霓虹反光，浅景深",
      ref_image_uri: refUri,
    });
    expect(scene.code).toBe(0);
    finalizedSceneId = scene.data.id;
    // 定稿（status=2 才会写 finalized_at）——主体只能从定稿资产保存
    const finalized = await inject("PATCH", `/projects/${projectId}/assets/${finalizedSceneId}`, { status: 2 });
    expect(finalized.code).toBe(0);
    expect(finalized.data.status).toBe(2);

    const draft = await inject("POST", `/projects/${projectId}/assets`, {
      kind: "scene",
      name: `未定稿场景-${stamp}`,
      ref_image_uri: `u/test/draft-${stamp}.png`,
    });
    expect(draft.code).toBe(0);
    draftSceneId = draft.data.id;
  });

  afterAll(async () => {
    // 只清自己造的行（随机后缀），不 touch 其它测试的数据
    await db.execute(sql`delete from subject_files where subject_id in (
      select id from subjects where name like ${`%${stamp}%`}
    )`);
    await db.execute(sql`delete from subjects where name like ${`%${stamp}%`}`);
    await db.execute(sql`delete from storyboard_assets where project_asset_id in (
      select id from project_assets where project_id in (
        select id from script_projects where title like ${`%${stamp}%`}
      )
    )`);
    await db.execute(sql`delete from project_assets where project_id in (
      select id from script_projects where title like ${`%${stamp}%`}
    )`);
    await db.execute(sql`delete from script_projects where title like ${`%${stamp}%`}`);
    await app.close();
    // 与 kds.spec 一致：显式关连接池（vitest 每个文件独立 module registry）
    await pool.end().catch(() => {});
  });

  let createdSubjectId = "";

  it("creates a subject (reviewing) and exposes it in list/detail with filter", async () => {
    // 新主体一律「审核中」：竞品 from-resource 返回成功不代表审核通过（subject.md:278）
    const created = await inject("POST", "/subjects", {
      name: `${stamp}-林晚`,
      kind: "character",
      desc: "主角",
      business_list: [3],
      tags: ["主角"],
      project_id: projectId,
      files: [{ uri: `u/test/subject-main-${stamp}.png`, role: 2, sort: 0 }],
    });
    expect(created.code).toBe(0);
    expect(created.data.review_status).toBe(1);
    expect(created.data.review_status_name).toBe("reviewing");
    expect(created.data.retryable).toBe(true);
    expect(created.data.kind).toBe(1);
    expect(created.data.kind_name).toBe("character");
    expect(created.data.business_list).toEqual([3]);
    expect(created.data.files).toHaveLength(1);
    expect(created.data.files[0].url).toContain("files/local");
    createdSubjectId = created.data.id;

    const list = await inject("GET", `/subjects?kind=character&review_status=1&project_id=${projectId}`);
    expect(list.code).toBe(0);
    expect(list.data.list.some((item: { id: string }) => item.id === createdSubjectId)).toBe(true);
    // 过滤真的生效：换 kind 就查不到
    const scenes = await inject("GET", "/subjects?kind=scene");
    expect(scenes.code).toBe(0);
    expect(scenes.data.list.some((item: { id: string }) => item.id === createdSubjectId)).toBe(false);

    const detail = await inject("GET", `/subjects/${createdSubjectId}`);
    expect(detail.code).toBe(0);
    expect(detail.data.name).toBe(`${stamp}-林晚`);
    expect(detail.data.project_id).toBe(projectId);
  });

  it("validates params: empty name / bad kind / bad review_status → 400101", async () => {
    expect((await inject("POST", "/subjects", {})).code).toBe(400101);
    expect((await inject("POST", "/subjects", { name: "  x  ", kind: 9 } as never)).code).toBe(400101);
    const badReview = await inject("PATCH", `/subjects/${createdSubjectId}`, { review_status: 9 });
    expect(badReview.code).toBe(400101);
  });

  it("save-from-resource rejects an unfinalized asset with 400105 (same rule as generation)", async () => {
    const res = await inject("POST", "/subjects/from-asset", {
      project_id: projectId,
      asset_id: draftSceneId,
      name: `${stamp}-未定稿`,
    });
    expect(res.code).toBe(400105);
    // 失败信封里 data 为 null（不返回半成品主体）
    expect(res.data).toBeNull();
  });

  it("save-from-resource binds the original asset without creating a new one (idempotent)", async () => {
    const before = await inject("GET", `/projects/${projectId}/assets`);
    expect(before.code).toBe(0);
    const beforeCount = before.data.list.length as number;

    const saved = await inject("POST", "/subjects/from-asset", {
      project_id: projectId,
      asset_id: finalizedSceneId,
      name: `${stamp}-雨夜街角`,
      subject_type: 2,
      business_list: [3],
    });
    expect(saved.code).toBe(0);
    expect(saved.data.created).toBe(true);
    expect(saved.data.review_status).toBe(1);
    // subject_type=2 → scene；参考图直接取原资产，不复制资产
    expect(saved.data.kind).toBe(2);
    expect(saved.data.kind_name).toBe("scene");
    expect(saved.data.files.length).toBeGreaterThanOrEqual(1);
    expect(saved.data.files[0].uri).toBe(refUri);

    const after = await inject("GET", `/projects/${projectId}/assets`);
    expect(after.code).toBe(0);
    // 关键：没有新增项目资产（save-from-resource 不建资产）
    expect(after.data.list.length).toBe(beforeCount);

    // 幂等：同一资产再存一次 → 返回既有主体、created=false
    const again = await inject("POST", "/subjects/from-asset", {
      project_id: projectId,
      asset_id: finalizedSceneId,
      name: `${stamp}-雨夜街角-重复`,
    });
    expect(again.code).toBe(0);
    expect(again.data.created).toBe(false);
    expect(again.data.id).toBe(saved.data.id);
  });

  it("moves through the three review states; rejecting requires a reason", async () => {
    const approved = await inject("PATCH", `/subjects/${createdSubjectId}`, { review_status: 2 });
    expect(approved.code).toBe(0);
    expect(approved.data.review_status_name).toBe("approved");
    expect(approved.data.retryable).toBe(true);

    // 驳回必须带原因（否则调用方无法告知用户为什么被拒）
    const noReason = await inject("PATCH", `/subjects/${createdSubjectId}`, { review_status: 3 });
    expect(noReason.code).toBe(400101);

    const rejected = await inject("PATCH", `/subjects/${createdSubjectId}`, {
      review_status: 3,
      reject_reason: "形象与角色设定不符",
    });
    expect(rejected.code).toBe(0);
    expect(rejected.data.review_status_name).toBe("rejected");
    expect(rejected.data.reject_reason).toContain("不符");
    // 驳回不可自动重试：这个字段是给调用方看的硬语义
    expect(rejected.data.retryable).toBe(false);

    const status = await inject("POST", "/subjects/status", {
      subject_ids: [createdSubjectId, "999999999999"],
    });
    expect(status.code).toBe(0);
    expect(status.data.items[0]).toMatchObject({ status: "rejected", retryable: false });
    // 未知 ID 标 unknown，**不默认 approved**（subject.md:216）
    expect(status.data.items[1]).toMatchObject({ status: "unknown", retryable: false });
  });

  it("files are additive via PATCH and removable by id", async () => {
    const added = await inject("PATCH", `/subjects/${createdSubjectId}`, {
      files: [{ uri: `u/test/subject-side-${stamp}.png`, role: 3, sort: 1 }],
    });
    expect(added.code).toBe(0);
    const side = added.data.files.find((file: { uri: string }) => file.uri.includes("subject-side"));
    expect(side).toBeTruthy();

    const removed = await inject("PATCH", `/subjects/${createdSubjectId}`, {
      remove_file_ids: [side.id],
    });
    expect(removed.code).toBe(0);
    expect(removed.data.files.some((file: { uri: string }) => file.uri.includes("subject-side"))).toBe(false);
  });

  it("isolates by space: another space cannot see the subject (400102, no leak)", async () => {
    const cross = await raw(tokenOther, "GET", `/subjects/${createdSubjectId}`);
    // 不给 403 而给 400102：跨 space 连"是否存在"都不该泄露
    expect(cross.code).toBe(400102);
    const list = await raw(tokenOther, "GET", "/subjects");
    expect(list.code).toBe(0);
    expect(list.data.total).toBe(0);
    void otherSpaceId;
    void spaceId;
  });

  it("soft deletes: detail after delete → 400102, second delete → 400102", async () => {
    const removed = await inject("DELETE", `/subjects/${createdSubjectId}`);
    expect(removed.code).toBe(0);
    expect(removed.data.ok).toBe(true);
    expect((await inject("GET", `/subjects/${createdSubjectId}`)).code).toBe(400102);
    expect((await inject("DELETE", `/subjects/${createdSubjectId}`)).code).toBe(400102);
    const list = await inject("GET", "/subjects");
    expect(list.data.list.some((item: { id: string }) => item.id === createdSubjectId)).toBe(false);
  });

  it("starred & template_key: patch, filter, and starred-first ordering", async () => {
    const templateKey = `ip:${stamp}`;
    const plain = await inject("POST", "/subjects", {
      name: `${stamp}-普通主体`,
      kind: "scene",
    });
    expect(plain.code).toBe(0);
    const starred = await inject("POST", "/subjects", {
      name: `${stamp}-星标主体`,
      kind: "scene",
      template_key: templateKey,
    });
    expect(starred.code).toBe(0);
    expect(starred.data.is_starred).toBe(false);
    expect(starred.data.template_key).toBe(templateKey);

    // 置顶：PATCH is_starred
    const starredPatch = await inject("PATCH", `/subjects/${starred.data.id}`, { is_starred: true });
    expect(starredPatch.code).toBe(0);
    expect(starredPatch.data.is_starred).toBe(true);

    // 默认列表：星标优先（同组内仍按创建时间倒序）
    const list = await inject("GET", `/subjects?q=${encodeURIComponent(stamp)}`);
    expect(list.code).toBe(0);
    const ids = (list.data.list as Array<{ id: string }>).map((item) => item.id);
    expect(ids[0]).toBe(starred.data.id);

    // starred=1 只返回星标
    const onlyStarred = await inject("GET", `/subjects?starred=1&q=${encodeURIComponent(stamp)}`);
    expect(onlyStarred.code).toBe(0);
    expect((onlyStarred.data.list as Array<{ id: string }>).map((item) => item.id)).toEqual([
      starred.data.id,
    ]);

    // template_key 筛选（IP/模板归类）
    const byTemplate = await inject(
      "GET",
      `/subjects?template_key=${encodeURIComponent(templateKey)}&q=${encodeURIComponent(stamp)}`,
    );
    expect(byTemplate.code).toBe(0);
    expect((byTemplate.data.list as Array<{ id: string }>).map((item) => item.id)).toEqual([
      starred.data.id,
    ]);

    // 取消星标 + 改模板键
    const unstar = await inject("PATCH", `/subjects/${starred.data.id}`, {
      is_starred: false,
      template_key: `${templateKey}:v2`,
    });
    expect(unstar.code).toBe(0);
    expect(unstar.data.is_starred).toBe(false);
    expect(unstar.data.template_key).toBe(`${templateKey}:v2`);
    const afterUnstar = await inject("GET", `/subjects?starred=1&q=${encodeURIComponent(stamp)}`);
    expect(afterUnstar.data.list).toEqual([]);

    // 清理
    expect((await inject("DELETE", `/subjects/${plain.data.id}`)).code).toBe(0);
    expect((await inject("DELETE", `/subjects/${starred.data.id}`)).code).toBe(0);
  });
});
