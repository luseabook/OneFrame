import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  episodeResources,
  projectAssets,
  scriptProjects,
  storyboardAssets,
  storyboards,
} from "@app/db";
import { newId } from "@app/shared";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { db, pool } from "../src/db/database";

/**
 * 第 71 批：剧集删除 + 批量建集（竞品 `POST /df/episode/delete`、`POST /df/episode/batch-create`）。
 *
 * 竞品证据：
 * - `_acceptance/competitor_endpoints.tsv` 里 `ApiDfEpisodeDeletePOST`（path 无 `:ep_id`，id 在 body）
 *   与 `ApiDfEpisodeBatchCreatePOST`；两者 `requestDataJsonSchema` 都是空对象 → 字段名我方自定。
 * - 竞品 CLI `commands/episode.md:21` `reelmate episode delete EPISODE_ID`；
 *   `:142` `reelmate episode batch-create --set @episodes.json`，items 每项
 *   `{"sort":1,"name":"第1集","s_script_id":"…"}`，返回 `succeeded`/`failed`/`unconfirmed`。
 *
 * 本 spec 钉住四条不变量：
 * ① 删集必须连带清子表 —— 指向 `episodes.id` 的外键共 8 张表，漏一张就会 500（RESTRICT）；
 * ② 删集**不重排集号**（竞品文档没这条语义，重排会让外部引用的「第 N 集」漂移）；
 * ③ 批量建集：不给 `sort` 就排到最大集号之后（不回收空洞），给了撞号必须 400101 而不是静默改号；
 * ④ 跨空间 / 坏 id / 已删 id 一律 400101 或 400102，不出现 500。
 *
 * 注意：`outline/generate` 建几集取决于源文本（本例 3 集），所以断言一律按「当前集号序列」推算，
 * 不写死 1/2/3 —— 写死会让 spec 随 mock LLM 的拆分口径变化而假红。
 */
let app: NestFastifyApplication;
const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const phone = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
const otherPhone = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
let token = "";
let otherToken = "";
let projectId = "";
let firstEpisodeId = "";
let secondEpisodeId = "";
let spaceId = "";
/** outline 生成后的集号序列（后续断言都以它为基线推算） */
let baseNos: number[] = [];
/** 批量建集之后的集号序列 */
let afterCreates: number[] = [];

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

/** 项目的剧集号序列（接口本身就是按 ep_no 升序） */
async function epNos(): Promise<number[]> {
  const res = await inject("GET", `/projects/${projectId}`);
  expect(res.code).toBe(0);
  return (res.data.episodes as Array<{ ep_no: number }>).map((ep) => ep.ep_no);
}

async function episodeTitles(): Promise<Map<number, string>> {
  const res = await inject("GET", `/projects/${projectId}`);
  expect(res.code).toBe(0);
  return new Map((res.data.episodes as Array<{ ep_no: number; title: string }>).map((ep) => [ep.ep_no, ep.title]));
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
  const episodesOfScope = sql`select id from episodes where project_id in (${scope})`;
  // 顺序与外键依赖一致：叶子 → 根
  await cleanup(sql`delete from storyboard_assets where storyboard_id in (
    select id from storyboards where episode_id in (${episodesOfScope})
  )`);
  await cleanup(sql`delete from storyboards where episode_id in (${episodesOfScope})`);
  await cleanup(sql`delete from episode_resources where episode_id in (${episodesOfScope})`);
  await cleanup(sql`delete from project_assets where project_id in (${scope})`);
  await cleanup(sql`delete from episodes where project_id in (${scope})`);
  await cleanup(sql`delete from script_projects where id in (${scope})`);
  await app.close();
  await pool.end();
});

describe("剧集删除与批量建集（第 71 批）", () => {
  it("准备一个项目（outline 建出的集号作为基线）", async () => {
    const created = await inject("POST", "/projects", {
      title: `剧集编辑-${stamp}`,
      source_type: 1,
      source_text: "第一章：林晚在雨夜收到匿名信。第二章：旧仓库的真相。",
    });
    expect(created.code).toBe(0);
    projectId = created.data.id;
    const outline = await inject("POST", `/projects/${projectId}/outline/generate`);
    expect(outline.code).toBe(0);
    expect(outline.data.length).toBeGreaterThanOrEqual(2);
    firstEpisodeId = outline.data[0].id;
    secondEpisodeId = outline.data[1].id;

    const [row] = await db
      .select({ spaceId: scriptProjects.spaceId })
      .from(scriptProjects)
      .where(eq(scriptProjects.id, BigInt(projectId)));
    spaceId = String(row!.spaceId);
    baseNos = await epNos();
    // 集号从 1 开始且紧密（`uq_episodes_project_no` 的建集口径）
    expect(baseNos).toEqual(baseNos.map((_, index) => index + 1));
  });

  it("批量建集：给了 sort 就用，没给就排到末尾（不回收空洞）", async () => {
    const maxBase = baseNos[baseNos.length - 1]!;
    const sortGiven = maxBase + 4;
    const res = await inject("POST", `/projects/${projectId}/episodes/batch`, {
      items: [{ name: `广告一集-${stamp}` }, { name: `广告二集-${stamp}`, sort: sortGiven }],
    });
    expect(res.code).toBe(0);
    expect(res.data.created).toEqual([
      expect.objectContaining({ ep_no: maxBase + 1, title: `广告一集-${stamp}` }),
      expect.objectContaining({ ep_no: sortGiven, title: `广告二集-${stamp}` }),
    ]);
    expect(await epNos()).toEqual([...baseNos, maxBase + 1, sortGiven]);

    // 下一批不给 sort：排到 sortGiven 之后（中间的空洞不回收）——与「删集不重排」是同一套口径
    const again = await inject("POST", `/projects/${projectId}/episodes/batch`, { items: [{}, {}] });
    expect(again.code).toBe(0);
    expect(again.data.created.map((row: { ep_no: number }) => row.ep_no)).toEqual([
      sortGiven + 1,
      sortGiven + 2,
    ]);
    // 没给 name 时标题回落 `第N集`，不会留空
    const titles = await episodeTitles();
    expect(titles.get(sortGiven + 1)).toBe(`第${sortGiven + 1}集`);
    afterCreates = await epNos();
  });

  it("批量建集校验：撞号、空数组、超上限、空白标题都 400101", async () => {
    const dup = await inject("POST", `/projects/${projectId}/episodes/batch`, {
      items: [{ name: "撞号集", sort: baseNos[0] }],
    });
    expect(dup.code).toBe(400101);
    expect(dup.msg).toContain("already used");

    const empty = await inject("POST", `/projects/${projectId}/episodes/batch`, { items: [] });
    expect(empty.code).toBe(400101);

    const tooMany = await inject("POST", `/projects/${projectId}/episodes/batch`, {
      items: Array.from({ length: 11 }, (_, i) => ({ name: `超限-${i}` })),
    });
    expect(tooMany.code).toBe(400101);

    const blank = await inject("POST", `/projects/${projectId}/episodes/batch`, { items: [{ name: "   " }] });
    expect(blank.code).toBe(400101);

    // 失败不落库：集号序列没有变化
    expect(await epNos()).toEqual(afterCreates);
  });

  it("删集连带清子表：分镜、分镜资产关联、剧集资源一起消失，别集不受影响", async () => {
    // ① 两条分镜（走接口，顺带复用第 68 批的创建口径）
    for (const desc of ["镜头一", "镜头二"]) {
      const shot = await inject("POST", `/projects/${projectId}/episodes/${firstEpisodeId}/storyboards`, {
        shot_desc: desc,
      });
      expect(shot.code).toBe(0);
    }
    const shots = await db
      .select({ id: storyboards.id })
      .from(storyboards)
      .where(eq(storyboards.episodeId, BigInt(firstEpisodeId)));
    expect(shots).toHaveLength(2);

    // ② 分镜-资产关联（复合主键，必须先有 project_asset）
    const assetId = newId();
    await db.insert(projectAssets).values({
      id: assetId,
      projectId: BigInt(projectId),
      kind: "character",
      name: `角色-${stamp}`,
    });
    await db.insert(storyboardAssets).values({ storyboardId: shots[0]!.id, projectAssetId: assetId, sort: 0 });

    // ③ 剧集资源（第 8 张引用 episodes.id 的表，此前没有任何删除路径）
    await db.insert(episodeResources).values({
      id: newId(),
      episodeId: BigInt(firstEpisodeId),
      spaceId: BigInt(spaceId),
      kind: 1,
      name: `资源-${stamp}`,
    });

    const del = await inject("DELETE", `/projects/${projectId}/episodes/${firstEpisodeId}`);
    expect(del.code).toBe(0);
    expect(del.data).toMatchObject({ deleted: true, episode_id: firstEpisodeId, ep_no: baseNos[0] });
    // 清掉的子行数如实上报，便于调用方判断「删的是不是我以为的那一集」
    expect(del.data.cleared.storyboards).toBe(2);

    const leftShots = await db
      .select({ id: storyboards.id })
      .from(storyboards)
      .where(eq(storyboards.episodeId, BigInt(firstEpisodeId)));
    expect(leftShots).toHaveLength(0);
    const leftAssets = await db
      .select({ storyboardId: storyboardAssets.storyboardId })
      .from(storyboardAssets)
      .where(eq(storyboardAssets.storyboardId, shots[0]!.id));
    expect(leftAssets).toHaveLength(0);
    const leftResources = await db
      .select({ id: episodeResources.id })
      .from(episodeResources)
      .where(eq(episodeResources.episodeId, BigInt(firstEpisodeId)));
    expect(leftResources).toHaveLength(0);

    // 别集不受影响；被删的那集查不到了
    expect(await epNos()).toEqual(afterCreates.filter((no) => no !== baseNos[0]));
    const gone = await inject("GET", `/projects/${projectId}/episodes/${firstEpisodeId}`);
    expect(gone.code).toBe(400102);
    expect(await inject("GET", `/projects/${projectId}/episodes/${secondEpisodeId}`)).toMatchObject({ code: 0 });
  });

  it("删除边界：重复删 / 坏 id / 不存在 id / 跨空间都走错误码，不出 500", async () => {
    const again = await inject("DELETE", `/projects/${projectId}/episodes/${firstEpisodeId}`);
    expect(again.code).toBe(400102);

    const bad = await inject("DELETE", `/projects/${projectId}/episodes/abc`);
    expect(bad.code).toBe(400101);
    expect(bad.msg).toContain("invalid episode id");

    const missing = await inject("DELETE", `/projects/${projectId}/episodes/999999999999999999`);
    expect(missing.code).toBe(400102);

    // 另一空间的用户：项目先找不到（400102），且这一集必须还在
    const foreign = await inject("DELETE", `/projects/${projectId}/episodes/${secondEpisodeId}`, undefined, otherToken);
    expect(foreign.code).toBe(400102);
    expect(await inject("GET", `/projects/${projectId}/episodes/${secondEpisodeId}`)).toMatchObject({ code: 0 });
  });

  it("删集不重排集号：留下空洞，其余集号原样", async () => {
    const before = await epNos();
    const secondNo = before.find((no) => no === baseNos[1])!;
    const del = await inject("DELETE", `/projects/${projectId}/episodes/${secondEpisodeId}`);
    expect(del.code).toBe(0);
    expect(del.data.ep_no).toBe(secondNo);
    expect(await epNos()).toEqual(before.filter((no) => no !== secondNo));
    // 空洞不回收：再批量建集仍然从最大号往后排
    const maxNow = Math.max(...before);
    const again = await inject("POST", `/projects/${projectId}/episodes/batch`, { items: [{}] });
    expect(again.data.created[0].ep_no).toBe(maxNow + 1);
  });
});
