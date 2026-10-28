import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { newId } from "@app/shared";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { db, pool } from "../src/db/database";

/**
 * 第 92 批：项目级导出日志（#5 全部项目）。
 *
 * 竞品证据（`_acceptance/competitor_endpoints.tsv`）：
 * - `GET /web/v1/df/script_project/export-log`（query `page / page_size / sp_id / scene_type / scene_id`）
 * - `GET /web/v1/df/script_project/export-log/:export_id`
 *
 * 我方原先只有 episode 级的 `GET …/episodes/:eid/exports/:xid`，运营在项目页看不到跨集导出历史。
 * 这两条是**读取型投影**（不建新表）：分镜导出落 `exports`（按 episode，经 `episodes.project_id` 反查），
 * 成片合成落 `timeline_exports`（自带 project_id），两条链在 API 层合并成一份按时间倒序的日志。
 *
 * 三条不变量：
 * ① 两条链混排按 created_at 倒序，且分页稳定（同毫秒用 kind + export_id 兜底）；
 * ② `scene_id` 必须属于本项目（别的项目的集 → 400102，而不是返回空列表）；
 * ③ 两张表 id 各自自增，撞号时单条读返回 400101 `ambiguous_export_id` 要求带 `?kind=` —— 不猜。
 */
let app: NestFastifyApplication;
const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const phone = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
const otherPhone = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
let token = "";
let otherToken = "";
let spaceId = "";
let projectId = "";
let otherProjectId = "";
let episodeIds: string[] = [];
let otherEpisodeId = "";

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

async function login(phoneValue: string): Promise<{ token: string; spaceId: string }> {
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
  return { token: body.data.access_token as string, spaceId: String(body.data.space_id) };
}

/** 造一条分镜导出（`exports` 表，按 episode 归属） */
async function seedStoryboardExport(
  ownerSpaceId: string,
  eid: string,
  opts: { status: number; fileUri?: string | null; createdAt: string; error?: unknown },
): Promise<string> {
  const id = newId();
  await db.execute(sql`
    insert into exports (id, space_id, episode_id, status, file_uri, error, created_at, updated_at)
    values (
      ${id}, ${BigInt(ownerSpaceId)}, ${BigInt(eid)}, ${opts.status},
      ${opts.fileUri ?? null},
      ${opts.error === undefined ? null : JSON.stringify(opts.error)}::jsonb,
      ${opts.createdAt}::timestamptz, ${opts.createdAt}::timestamptz
    )
  `);
  return String(id);
}

/** 造成片合成导出（`timeline_exports` 表，自带 project_id） */
async function seedTimelineExport(
  ownerSpaceId: string,
  pid: string,
  eid: string,
  opts: { status: number; fileUri?: string | null; createdAt: string; clipCount?: number },
): Promise<string> {
  const id = newId();
  await db.execute(sql`
    insert into timeline_exports
      (id, space_id, project_id, episode_id, status, file_uri, clip_count, skipped, duration_s, watermarked, created_at, updated_at)
    values (
      ${id}, ${BigInt(ownerSpaceId)}, ${BigInt(pid)}, ${BigInt(eid)}, ${opts.status},
      ${opts.fileUri ?? null}, ${opts.clipCount ?? 3}, 0, 12, false,
      ${opts.createdAt}::timestamptz, ${opts.createdAt}::timestamptz
    )
  `);
  return String(id);
}

beforeAll(async () => {
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
  await app.register(cookie as never);
  app.setGlobalPrefix("v1");
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const mine = await login(phone);
  token = mine.token;
  spaceId = mine.spaceId;
  otherToken = (await login(otherPhone)).token;

  // 本项目：一个三集（含）以上的本子
  const created = await inject("POST", "/projects", {
    title: `导出日志-${stamp}`,
    source_type: 1,
    source_text: "第一章：雨夜的信。第二章：旧仓库。第三章：名单。第四章：回声。",
  });
  expect(created.code).toBe(0);
  projectId = created.data.id;
  const outline = await inject("POST", `/projects/${projectId}/outline/generate`);
  expect(outline.code).toBe(0);
  episodeIds = (outline.data as Array<{ id: string }>).map((item) => item.id);
  expect(episodeIds.length).toBeGreaterThanOrEqual(3);

  // 另一个项目：只用来验「scene_id 跨项目必须 400102」
  const other = await inject("POST", "/projects", {
    title: `导出日志-别的项目-${stamp}`,
    source_type: 1,
    source_text: "第一章：无关内容。第二章：还是无关。",
  });
  expect(other.code).toBe(0);
  otherProjectId = other.data.id;
  const otherOutline = await inject("POST", `/projects/${otherProjectId}/outline/generate`);
  expect(otherOutline.code).toBe(0);
  otherEpisodeId = (otherOutline.data as Array<{ id: string }>)[0]!.id;
});

afterAll(async () => {
  const cleanup = (query: Parameters<typeof db.execute>[0]) => db.execute(query).catch(() => {});
  const scope = sql`select id from script_projects where title like ${`%${stamp}%`}`;
  const episodesOfScope = sql`select id from episodes where project_id in (${scope})`;
  await cleanup(sql`delete from exports where episode_id in (${episodesOfScope})`);
  await cleanup(sql`delete from timeline_exports where episode_id in (${episodesOfScope})`);
  await cleanup(sql`delete from project_timelines where episode_id in (${episodesOfScope})`);
  await cleanup(sql`delete from storyboards where episode_id in (${episodesOfScope})`);
  await cleanup(sql`delete from episodes where project_id in (${scope})`);
  await cleanup(sql`delete from script_projects where id in (${scope})`);
  await app.close();
  await pool.end();
});

describe("项目级导出日志（第 92 批 · #5 全部项目）", () => {
  // 混排顺序（created_at 倒序）：tl-newest → sb-mid → sb-old → tl-oldest
  let storyboardNewId = "";
  let storyboardFailedId = "";
  let timelineNewestId = "";
  let timelineOldestId = "";
  let ambiguousId = "";

  it("准备：两条分镜导出 + 两条成片合成导出，时间刻意交错", async () => {
    storyboardNewId = await seedStoryboardExport(spaceId, episodeIds[0]!, {
      status: 3,
      fileUri: `u/test/r92-sb-${stamp}.zip`,
      createdAt: "2024-03-03T00:00:00Z",
    });
    storyboardFailedId = await seedStoryboardExport(spaceId, episodeIds[1]!, {
      status: 4,
      error: { code: 500000, msg: "packaging failed" },
      createdAt: "2024-03-02T00:00:00Z",
    });
    timelineNewestId = await seedTimelineExport(spaceId, projectId, episodeIds[2]!, {
      status: 3,
      fileUri: `u/test/r92-tl-${stamp}.mp4`,
      createdAt: "2024-03-04T00:00:00Z",
      clipCount: 4,
    });
    timelineOldestId = await seedTimelineExport(spaceId, projectId, episodeIds[0]!, {
      status: 1,
      createdAt: "2024-03-01T00:00:00Z",
      clipCount: 2,
    });
    expect(
      new Set([storyboardNewId, storyboardFailedId, timelineNewestId, timelineOldestId]).size,
    ).toBe(4);
  });

  it("两条链混排：按 created_at 倒序，字段按 kind 各自完整，成功导出才签下载链接", async () => {
    const res = await inject("GET", `/projects/${projectId}/exports`);
    expect(res.code).toBe(0);
    expect(res.data.total).toBe(4);
    expect(res.data.page).toBe(1);
    expect(res.data.page_size).toBe(20);
    expect(res.data.truncated).toBe(false);
    expect(res.data.scene_types).toEqual(["storyboard", "timeline"]);
    const list = res.data.list as Array<Record<string, unknown>>;
    expect(list.map((item) => item.export_id)).toEqual([
      timelineNewestId,
      storyboardNewId,
      storyboardFailedId,
      timelineOldestId,
    ]);
    expect(list.map((item) => item.kind)).toEqual(["timeline", "storyboard", "storyboard", "timeline"]);

    const timeline = list[0]!;
    expect(timeline.status).toBe(3);
    expect(timeline.clip_count).toBe(4);
    expect(timeline.skipped).toBe(0);
    expect(timeline.duration_s).toBe(12);
    expect(timeline.watermarked).toBe(false);
    expect(String(timeline.download_url)).toContain("r92-tl-");
    // 成片合成没有过期时间（产物常驻），分镜导出才有
    expect(timeline.expires_at).toBeNull();

    const storyboard = list[1]!;
    expect(storyboard.status).toBe(3);
    expect(String(storyboard.download_url)).toContain("r92-sb-");
    // 分镜导出的行不带成片字段（同一份 DTO 里按 kind 出现，前端不用猜）
    expect("clip_count" in storyboard).toBe(false);
    expect("watermarked" in storyboard).toBe(false);

    // 失败的那条：没有下载链接，error 原样带出（运营要知道为什么失败）
    const failed = list[2]!;
    expect(failed.status).toBe(4);
    expect(failed.download_url).toBeNull();
    expect(failed.error).toEqual({ code: 500000, msg: "packaging failed" });

    // 排队中的那条：没有产物就没有链接
    expect(list[3]!.status).toBe(1);
    expect(list[3]!.download_url).toBeNull();

    // episode_no 来自 episodes.epNo，用于「哪一集」的可读定位
    for (const item of list) {
      expect(typeof item.episode_no).toBe("number");
      expect(item.episode_no as number).toBeGreaterThanOrEqual(1);
    }
  });

  it("scene_type 只筛一条链；scene_id 只筛一集；两者可叠加", async () => {
    const storyboardOnly = await inject("GET", `/projects/${projectId}/exports?scene_type=storyboard`);
    expect(storyboardOnly.code).toBe(0);
    expect(storyboardOnly.data.total).toBe(2);
    expect((storyboardOnly.data.list as Array<{ kind: string }>).every((i) => i.kind === "storyboard")).toBe(
      true,
    );

    const timelineOnly = await inject("GET", `/projects/${projectId}/exports?scene_type=timeline`);
    expect(timelineOnly.data.total).toBe(2);
    expect((timelineOnly.data.list as Array<{ kind: string }>).every((i) => i.kind === "timeline")).toBe(true);

    // 第一集有两条（一条分镜 + 一条成片），这是「跨链但同集」
    const firstEpisode = await inject("GET", `/projects/${projectId}/exports?scene_id=${episodeIds[0]}`);
    expect(firstEpisode.code).toBe(0);
    expect(firstEpisode.data.total).toBe(2);
    expect((firstEpisode.data.list as Array<{ episode_id: string }>).every((i) => i.episode_id === episodeIds[0])).toBe(
      true,
    );

    const firstEpisodeStoryboard = await inject(
      "GET",
      `/projects/${projectId}/exports?scene_id=${episodeIds[0]}&scene_type=storyboard`,
    );
    expect(firstEpisodeStoryboard.data.total).toBe(1);
    expect(firstEpisodeStoryboard.data.list[0]!.export_id).toBe(storyboardNewId);

    // 竞品的非法枚举不被静默忽略
    const bad = await inject("GET", `/projects/${projectId}/exports?scene_type=scene`);
    expect(bad.code).toBe(400101);
  });

  it("scene_id 跨项目 → 400102（不是「空列表」，否则调用方以为这集没导出过）", async () => {
    const res = await inject("GET", `/projects/${projectId}/exports?scene_id=${otherEpisodeId}`);
    expect(res.code).toBe(400102);
    expect(res.msg).toContain("episode not found");
    const bad = await inject("GET", `/projects/${projectId}/exports?scene_id=abc`);
    expect(bad.code).toBe(400101);
  });

  it("分页：page_size 切片的 total 仍是全量，越界页返回空列表", async () => {
    const first = await inject("GET", `/projects/${projectId}/exports?page=1&page_size=3`);
    expect(first.code).toBe(0);
    expect(first.data.total).toBe(4);
    expect(first.data.page_size).toBe(3);
    expect((first.data.list as unknown[]).length).toBe(3);
    const second = await inject("GET", `/projects/${projectId}/exports?page=2&page_size=3`);
    expect(second.data.total).toBe(4);
    expect(second.data.list.map((item: { export_id: string }) => item.export_id)).toEqual([timelineOldestId]);
    const beyond = await inject("GET", `/projects/${projectId}/exports?page=9&page_size=3`);
    expect(beyond.data.total).toBe(4);
    expect(beyond.data.list).toEqual([]);
    // page_size 上限 60，越过就 400101
    expect((await inject("GET", `/projects/${projectId}/exports?page_size=61`)).code).toBe(400101);
  });

  it("单条：两条链各按 kind 命中；非法 id 400101、不存在 400102", async () => {
    const storyboard = await inject("GET", `/projects/${projectId}/exports/${storyboardNewId}`);
    expect(storyboard.code).toBe(0);
    expect(storyboard.data.export.kind).toBe("storyboard");
    expect(storyboard.data.export.export_id).toBe(storyboardNewId);

    const timeline = await inject("GET", `/projects/${projectId}/exports/${timelineNewestId}`);
    expect(timeline.code).toBe(0);
    expect(timeline.data.export.kind).toBe("timeline");
    expect(timeline.data.export.clip_count).toBe(4);

    expect((await inject("GET", `/projects/${projectId}/exports/abc`)).code).toBe(400101);
    const notFound = await inject("GET", `/projects/${projectId}/exports/999999999999999999`);
    expect(notFound.code).toBe(400102);
    expect(notFound.msg).toContain("export not found");

    // 别的项目下的导出 id：在本项目上下文里查不到
    const foreign = await inject("GET", `/projects/${otherProjectId}/exports/${storyboardNewId}`);
    expect(foreign.code).toBe(400102);
  });

  it("两张表 id 撞号：单条读不猜，返回 400101 要求带 kind；带 kind 就能取到", async () => {
    ambiguousId = await seedStoryboardExport(spaceId, episodeIds[0]!, {
      status: 3,
      fileUri: `u/test/r92-amb-sb-${stamp}.zip`,
      createdAt: "2024-03-05T00:00:00Z",
    });
    // 同一个 id 也塞进 timeline_exports（两张表主键各自独立，撞号是真实可能发生的）
    await db.execute(sql`
      insert into timeline_exports
        (id, space_id, project_id, episode_id, status, file_uri, clip_count, skipped, duration_s, watermarked, created_at, updated_at)
      values (
        ${BigInt(ambiguousId)}, ${BigInt(spaceId)}, ${BigInt(projectId)}, ${BigInt(episodeIds[1]!)},
        3, ${`u/test/r92-amb-tl-${stamp}.mp4`}, 5, 0, 20, true,
        ${"2024-03-05T00:00:00Z"}::timestamptz, ${"2024-03-05T00:00:00Z"}::timestamptz
      )
    `);

    const ambiguous = await inject("GET", `/projects/${projectId}/exports/${ambiguousId}`);
    expect(ambiguous.code).toBe(400101);
    // 文案必须点明「带 kind」——信封不携带 details（§1），可执行的提示只能写在 msg 里
    expect(ambiguous.msg).toContain("ambiguous");
    expect(ambiguous.msg).toContain("kind");

    const asStoryboard = await inject(
      "GET",
      `/projects/${projectId}/exports/${ambiguousId}?kind=storyboard`,
    );
    expect(asStoryboard.code).toBe(0);
    expect(asStoryboard.data.export.kind).toBe("storyboard");
    expect(String(asStoryboard.data.export.download_url)).toContain("r92-amb-sb-");

    const asTimeline = await inject("GET", `/projects/${projectId}/exports/${ambiguousId}?kind=timeline`);
    expect(asTimeline.code).toBe(0);
    expect(asTimeline.data.export.kind).toBe("timeline");
    expect(asTimeline.data.export.clip_count).toBe(5);
    expect(asTimeline.data.export.watermarked).toBe(true);

    const badKind = await inject("GET", `/projects/${projectId}/exports/${ambiguousId}?kind=video`);
    expect(badKind.code).toBe(400101);

    // 撞号那条也进了列表（列表不需要消歧：kind 就在行里）
    const list = await inject("GET", `/projects/${projectId}/exports?page_size=60`);
    expect((list.data.list as Array<{ export_id: string }>).filter((i) => i.export_id === ambiguousId).length).toBe(
      2,
    );
  });

  it("sp_id 与路径 id 冲突时 400101，不一致就不猜是哪个项目", async () => {
    const ok = await inject("GET", `/projects/${projectId}/exports?sp_id=${projectId}`);
    expect(ok.code).toBe(0);

    const conflict = await inject("GET", `/projects/${projectId}/exports?sp_id=999999999999999999`);
    expect(conflict.code).toBe(400101);
    expect(conflict.msg).toContain("sp_id");
  });

  it("空项目（没有分集）返回 total 0 而不是报错；跨空间读不到本项目", async () => {
    const empty = await inject("POST", "/projects", {
      title: `导出日志-空-${stamp}`,
      source_type: 1,
      source_text: "第一章：还没拆集。",
    });
    expect(empty.code).toBe(0);
    const emptyList = await inject("GET", `/projects/${empty.data.id}/exports`);
    expect(emptyList.code).toBe(0);
    expect(emptyList.data.total).toBe(0);
    expect(emptyList.data.list).toEqual([]);
    // 空项目单条读：没有分集 → 直接 400102（不是 500）
    expect((await inject("GET", `/projects/${empty.data.id}/exports/${storyboardNewId}`)).code).toBe(400102);
    await db.execute(sql`delete from script_projects where id = ${BigInt(empty.data.id)}`);

    const foreignRaw = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/exports`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(foreignRaw.statusCode).toBeLessThan(500);
    expect((foreignRaw.json() as Envelope).code).not.toBe(0);

    // 不存在的项目 → 400102
    expect((await inject("GET", `/projects/999999999999999999/exports`)).code).toBe(400102);
  });
});
