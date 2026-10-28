import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { db, pool } from "../src/db/database";

/**
 * 第 91 批：剧集与分镜的四个「单点/批量」形状。
 *
 * 竞品证据（`_acceptance/competitor_endpoints.tsv`）：
 * - `POST /web/v1/df/episode/batch-delete`（无 params，ids 放 body）
 * - `POST /web/v1/df/storyboard/:storyboard_id/info/batch-add`
 * - `GET /web/v1/df/episode/:ep_id/storyboard/:id/info`（单条分镜）
 * - `POST /web/v1/df/episode/status`（`requestDataJsonSchema` 为 `{}`）
 *
 * 三条不变量：
 * ① 批量删集**整批一个事务**：有一个 id 不属于本项目就整批拒绝（不出现半批结果）；
 * ② 单条分镜与「整集详情」里的同一行**完全同形**（键集合与值都要一致，否则前端要写两套）；
 * ③ 批量加分镜只在末尾追加，body 里夹带的 `shot_no` 会被剥掉（避免撞号后序号污染）。
 */
let app: NestFastifyApplication;
const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const phone = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
const otherPhone = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
let token = "";
let otherToken = "";
let projectId = "";
let episodeIds: string[] = [];

interface Envelope {
  code: number;
  msg: string;
  data: any;
}

async function inject(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: Record<string, unknown>,
  bearer = token,
): Promise<Envelope> {
  const res = await app.inject({
    method,
    url: `/v1${url}`,
    payload,
    headers: { authorization: `Bearer ${bearer}` },
  });
  return res.json() as Envelope;
}

async function login(phoneValue: string): Promise<string> {
  const sms = await app.inject({ method: "POST", url: "/v1/auth/sms-code", payload: { phone: phoneValue } });
  const smsBody = sms.json() as Envelope;
  expect({ code: smsBody.code, msg: smsBody.msg }).toEqual({ code: 0, msg: "" });
  const body = (
    await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { phone: phoneValue, code: smsBody.data.debug_code, age_confirmed: true },
    })
  ).json() as Envelope;
  expect({ code: body.code, msg: body.msg }).toEqual({ code: 0, msg: "" });
  return body.data.access_token as string;
}

async function storyboards(eid: string): Promise<Array<Record<string, unknown>>> {
  const res = await inject("GET", `/projects/${projectId}/episodes/${eid}`);
  expect(res.code).toBe(0);
  return res.data.storyboards as Array<Record<string, unknown>>;
}

beforeAll(async () => {
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
  await app.register(cookie as never);
  app.setGlobalPrefix("v1");
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  token = await login(phone);
  otherToken = await login(otherPhone);
});

afterAll(async () => {
  const cleanup = (query: Parameters<typeof db.execute>[0]) => db.execute(query).catch(() => {});
  const scope = sql`select id from script_projects where title like ${`%${stamp}%`}`;
  await cleanup(sql`delete from storyboard_assets where storyboard_id in (
    select id from storyboards where episode_id in (select id from episodes where project_id in (${scope}))
  )`);
  await cleanup(sql`delete from storyboards where episode_id in (
    select id from episodes where project_id in (${scope})
  )`);
  await cleanup(sql`delete from episode_resources where episode_id in (
    select id from episodes where project_id in (${scope})
  )`);
  await cleanup(sql`delete from episodes where project_id in (${scope})`);
  await cleanup(sql`delete from script_projects where id in (${scope})`);
  await app.close();
  await pool.end();
});

describe("剧集与分镜的单点/批量形状（第 91 批）", () => {
  it("准备：一个项目 + 三集，第一集两条分镜", async () => {
    const created = await inject("POST", "/projects", {
      title: `单点形状-${stamp}`,
      source_type: 1,
      source_text: "第一章：雨夜的信。第二章：旧仓库。第三章：名单。",
    });
    expect(created.code).toBe(0);
    projectId = created.data.id;
    const outline = await inject("POST", `/projects/${projectId}/outline/generate`);
    expect(outline.code).toBe(0);
    episodeIds = (outline.data as Array<{ id: string }>).map((item) => item.id);
    expect(episodeIds.length).toBeGreaterThanOrEqual(3);
    const added = await inject(
      "POST",
      `/projects/${projectId}/episodes/${episodeIds[0]}/storyboards/batch-add`,
      { items: [{ shot_desc: "开头" }, { shot_desc: "结尾", duration_s: 8 }] },
    );
    expect(added.code).toBe(0);
    expect(added.data.count).toBe(2);
    expect((added.data.storyboards as Array<{ shot_no: number }>).map((s) => s.shot_no)).toEqual([1, 2]);
  });

  it("单条分镜：与整集详情里的同一行完全同形；跨集/非法/不存在都被拒", async () => {
    const list = await storyboards(episodeIds[0]!);
    expect(list.length).toBe(2);
    const target = list[1]!;
    const res = await inject(
      "GET",
      `/projects/${projectId}/episodes/${episodeIds[0]}/storyboards/${String(target.id)}`,
    );
    expect(res.code).toBe(0);
    // 键集合与值都必须一致：单条读与列表读是同一个 DTO
    expect(Object.keys(res.data.storyboard).sort()).toEqual(Object.keys(target).sort());
    expect(res.data.storyboard).toEqual(target);

    // 不存在 → 400102；非法 id → 400101
    const missing = await inject(
      "GET",
      `/projects/${projectId}/episodes/${episodeIds[0]}/storyboards/999999999999999999`,
    );
    expect(missing.code).toBe(400102);
    const bad = await inject("GET", `/projects/${projectId}/episodes/${episodeIds[0]}/storyboards/abc`);
    expect(bad.code).toBe(400101);
    // 借用别集的 sid：分镜必须属于本集（否则等于跨集读）
    const crossEpisode = await inject(
      "GET",
      `/projects/${projectId}/episodes/${episodeIds[1]}/storyboards/${String(target.id)}`,
    );
    expect(crossEpisode.code).toBe(400102);
    // 跨空间 → 不是 0，且不 5xx（用原始响应才能看 HTTP 码）
    const foreignRaw = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/episodes/${episodeIds[0]}/storyboards/${String(target.id)}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(foreignRaw.statusCode).toBeLessThan(500);
    expect((foreignRaw.json() as Envelope).code).not.toBe(0);
  });

  it("批量加分镜：只在末尾追加，body 里夹带的 shot_no 被剥掉", async () => {
    const before = await storyboards(episodeIds[0]!);
    const res = await inject(
      "POST",
      `/projects/${projectId}/episodes/${episodeIds[0]}/storyboards/batch-add`,
      { items: [{ shot_desc: "第三条", shot_no: 99 }, { shot_desc: "第四条" }, { shot_desc: "第五条" }] },
    );
    expect(res.code).toBe(0);
    expect(res.data.count).toBe(3);
    const after = await storyboards(episodeIds[0]!);
    expect(after.map((s) => s.shot_no)).toEqual([1, 2, 3, 4, 5]);
    // 夹带的 shot_no=99 被剥掉：第三条落在 3 而不是 99
    expect(after[2]!.shot_desc).toBe("第三条");
    expect(after.length).toBe(before.length + 3);
    // 空 items → 400101
    const empty = await inject("POST", `/projects/${projectId}/episodes/${episodeIds[0]}/storyboards/batch-add`, {
      items: [],
    });
    expect(empty.code).toBe(400101);
  });

  it("集状态：PATCH 只能写 1/2，写别的 400101", async () => {
    const ok = await inject("PATCH", `/projects/${projectId}/episodes/${episodeIds[1]}`, { status: 2 });
    expect(ok.code).toBe(0);
    const detail = await inject("GET", `/projects/${projectId}/episodes/${episodeIds[1]}`);
    expect(detail.data.episode.status).toBe(2);
    const bad = await inject("PATCH", `/projects/${projectId}/episodes/${episodeIds[1]}`, { status: 3 });
    expect(bad.code).toBe(400101);
  });

  it("批量删集：有任何一个 id 不属于本项目就整批拒绝（不出现半批）", async () => {
    // 先建第二集的分镜，验证子表被一起清掉
    await inject("POST", `/projects/${projectId}/episodes/${episodeIds[2]}/storyboards/batch-add`, {
      items: [{ shot_desc: "第三集镜头" }],
    });
    const rejected = await inject("POST", `/projects/${projectId}/episodes/batch-delete`, {
      episode_ids: [episodeIds[0], "999999999999999999"],
    });
    expect(rejected.code).toBe(400102);
    expect(rejected.msg).toContain("episode not found");
    // 整批拒绝后第一集仍在
    const stillThere = await inject("GET", `/projects/${projectId}/episodes/${episodeIds[0]}`);
    expect(stillThere.code).toBe(0);

    // 空数组 → 400101
    const empty = await inject("POST", `/projects/${projectId}/episodes/batch-delete`, { episode_ids: [] });
    expect(empty.code).toBe(400101);

    const removed = await inject("POST", `/projects/${projectId}/episodes/batch-delete`, {
      episode_ids: [episodeIds[0], episodeIds[2]],
    });
    expect(removed.code).toBe(0);
    expect(removed.data.deleted).toBe(2);
    expect(removed.data.cleared.storyboards).toBeGreaterThanOrEqual(4);
    // 被删的集读不到；剩下的第三集（episodeIds[1]）还在
    expect((await inject("GET", `/projects/${projectId}/episodes/${episodeIds[0]}`)).code).toBe(400102);
    expect((await inject("GET", `/projects/${projectId}/episodes/${episodeIds[2]}`)).code).toBe(400102);
    expect((await inject("GET", `/projects/${projectId}/episodes/${episodeIds[1]}`)).code).toBe(0);
  });
});
