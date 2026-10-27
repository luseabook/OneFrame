import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { sql } from "drizzle-orm";
import { models, timelineExports, timelinePublications, tasks } from "@app/db";
import { newId } from "@app/shared";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { db, pool } from "../src/db/database";
import { RedisService } from "../src/redis/redis.service";

/**
 * ReelFlow 切片发布 + 片段资产绑定契约测试。
 *
 * 竞品证据：`rea-reelmate/routes.txt:906`（`wf/clip-bind-asset`）、`:917`（`wf/publish`）、
 * `:923`（`wf/video-slicing`）；`_acceptance/_gap/fullsite-route-inventory.md:81` 把我方差距
 * 明确写成「缺切片/发布/clip 资产绑定」。
 *
 * 状态机：1 排队 → 2 转码中 → 3 可播放（发 shareToken）/ 4 失败（落 error）；
 * 下架 = 5。发布不是导出：产物复制一份到 `publications/<id>.mp4`，删导出文件不影响已发布作品。
 */
describe("reelflow timeline publish + clip assets e2e", () => {
  let app: NestFastifyApplication;
  let token = "";
  let tokenOther = "";
  let spaceId = "";
  let userId = "";
  const stamp = `pub${Date.now()}`;

  interface Envelope {
    code: number;
    msg: string;
    data: any;
  }

  const raw = async (
    asToken: string,
    method: "GET" | "POST" | "PUT" | "DELETE",
    url: string,
    payload?: unknown,
  ): Promise<Envelope> => {
    const res = await app.inject({
      method,
      url: `/v1${url}`,
      payload: payload as Record<string, unknown> | undefined,
      headers: { authorization: `Bearer ${asToken}` },
    });
    return res.json() as Envelope;
  };
  const inject = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) =>
    raw(token, method, url, payload);

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
    return {
      token: body.data.access_token as string,
      spaceId: String(body.data.space_id),
      userId: String(body.data.user.id),
    };
  };

  const uploadOnce = async (filename: string, contentType: "image/png" | "video/mp4") => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/assets/upload",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: JSON.stringify({
        filename,
        content_type: contentType,
        data_base64:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      }),
    });
    const body = res.json() as Envelope;
    expect(body.code).toBe(0);
    return body.data as { id: string; uri: string; url: string };
  };

  let projectId = "";
  let episodeId = "";
  let otherEpisodeId = "";
  let shotIds: string[] = [];
  let taskAId = "";
  let taskBId = "";
  let otherEpisodeTaskId = "";
  let clipAId = "";
  let clipBId = "";
  let exportSourceUri = "";
  let exportId = "";

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

    const a = await login(`14${String(Math.floor(Math.random() * 900000000) + 100000000)}`);
    token = a.token;
    spaceId = a.spaceId;
    userId = a.userId;
    tokenOther = (await login(`14${String(Math.floor(Math.random() * 900000000) + 100000000)}`)).token;

    const created = await inject("POST", "/projects", {
      title: `切片发布-${stamp}`,
      source_type: 1,
      source_text: "第一章：开端。第二章：转折。",
    });
    expect(created.code).toBe(0);
    projectId = created.data.id;
    const outline = await inject("POST", `/projects/${projectId}/outline/generate`);
    expect(outline.code).toBe(0);
    episodeId = outline.data[0].id;
    otherEpisodeId = outline.data[1].id;
    const shots = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/storyboards/generate`, {
      shot_count: 4,
    });
    expect(shots.code).toBe(0);
    shotIds = shots.data.map((shot: { id: string }) => shot.id);

    const [model] = await db.select().from(models).limit(1);
    if (!model) throw new Error("models table empty; run seed first");
    const base = {
      spaceId: BigInt(spaceId),
      userId: BigInt(userId),
      capability: "video",
      mode: "text2video",
      modelId: model.id,
      input: {},
      options: {},
      status: 3,
    } as const;
    taskAId = String(newId());
    taskBId = String(newId());
    otherEpisodeTaskId = String(newId());
    await db.insert(tasks).values([
      {
        ...base,
        id: BigInt(taskAId),
        episodeId: BigInt(episodeId),
        shotId: BigInt(shotIds[0]!),
        results: [{ uri: `u/test/pub-a-${stamp}.mp4` }],
      },
      {
        ...base,
        id: BigInt(taskBId),
        episodeId: BigInt(episodeId),
        shotId: BigInt(shotIds[1]!),
        results: [{ uri: `u/test/pub-b-${stamp}.mp4` }],
      },
      {
        ...base,
        id: BigInt(otherEpisodeTaskId),
        episodeId: BigInt(otherEpisodeId),
        results: [{ uri: `u/test/pub-other-${stamp}.mp4` }],
      },
    ]);

    const timeline = await inject("PUT", `/projects/${projectId}/episodes/${episodeId}/timeline`, {
      clips: [
        { clip_id: "clip-a", shot_id: shotIds[0], task_id: taskAId, name: "开场", duration: 2 },
        { clip_id: "clip-b", shot_id: shotIds[1], task_id: taskBId, name: "冲突", duration: 3 },
      ],
    });
    expect(timeline.code).toBe(0);
    clipAId = "clip-a";
    clipBId = "clip-b";

    // 可播放的成片产物：先上传一份字节（发布只做产物复制，不解码）
    const uploaded = await uploadOnce(`episode-${stamp}.mp4`, "video/mp4");
    exportSourceUri = uploaded.uri;
  });

  afterAll(async () => {
    const cleanup = (query: Parameters<typeof db.execute>[0]) => db.execute(query).catch(() => {});
    await cleanup(sql`delete from timeline_publications where episode_id in (
      select id from episodes where project_id = ${BigInt(projectId || "0")}
    )`);
    await cleanup(sql`delete from timeline_exports where episode_id in (
      select id from episodes where project_id = ${BigInt(projectId || "0")}
    )`);
    await cleanup(sql`delete from project_timelines where project_id = ${BigInt(projectId || "0")}`);
    await cleanup(sql`delete from storyboard_assets where storyboard_id in (
      select id from storyboards where episode_id in (
        select id from episodes where project_id = ${BigInt(projectId || "0")}
      )
    )`);
    await cleanup(sql`delete from storyboards where episode_id in (
      select id from episodes where project_id = ${BigInt(projectId || "0")}
    )`);
    await cleanup(sql`delete from episodes where project_id = ${BigInt(projectId || "0")}`);
    await cleanup(sql`delete from project_assets where project_id = ${BigInt(projectId || "0")}`);
    await cleanup(sql`delete from script_projects where title like ${`%${stamp}%`}`);
    await app.close();
    await pool.end().catch(() => {});
  });

  it("publish requires a successfully rendered episode video (400105 before any synthesis)", async () => {
    const res = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/timeline/publish`, {
      title: `切片-${stamp}`,
    });
    expect(res.code).toBe(400105);
    expect(res.msg).toContain("no rendered episode video");
  });

  it("publishes a slice: 1 queued → 3 ready with share token + download url", async () => {
    // 造一条已成功的成片合成记录（生产环境由 worker 写，测试直接落库）
    exportId = String(newId());
    await db.insert(timelineExports).values({
      id: BigInt(exportId),
      spaceId: BigInt(spaceId),
      projectId: BigInt(projectId),
      episodeId: BigInt(episodeId),
      status: 3,
      fileUri: exportSourceUri,
      clipCount: 2,
      durationS: 5,
      watermarked: true,
    });

    const published = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/timeline/publish`, {
      title: `切片-${stamp}`,
      slice: { start_ms: 0, end_ms: 4000, clip_ids: [clipAId] },
    });
    expect(published.code).toBe(0);
    expect(published.data.status).toBe(1);
    expect(published.data.status_label).toBe("queued");
    expect(published.data.share_token).toBeNull();
    expect(published.data.slice).toMatchObject({ start_ms: 0, end_ms: 4000, duration_ms: 4000 });
    const publicationId = published.data.publication_id as string;

    // 轮询到终态（转码是异步的，最多等 5s）
    let status = published.data.status as number;
    let detail: Record<string, unknown> | null = null;
    for (let i = 0; i < 50 && status !== 3; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const list = await inject("GET", `/projects/${projectId}/episodes/${episodeId}/timeline/publications`);
      expect(list.code).toBe(0);
      detail = (list.data.list as Array<Record<string, unknown>>).find(
        (item) => item.publication_id === publicationId,
      ) ?? null;
      status = Number(detail?.status ?? 0);
    }
    expect(status).toBe(3);
    expect(detail?.status_label).toBe("ready");
    expect(String(detail?.share_token)).toMatch(/^[0-9a-f]{32}$/);
    expect(String(detail?.download_url)).toContain("files/local");
    expect(detail?.published_at).toBeTruthy();
  });

  it("lists publications with status filter and dry-run creates nothing", async () => {
    const all = await inject("GET", `/projects/${projectId}/episodes/${episodeId}/timeline/publications`);
    expect(all.code).toBe(0);
    const before = all.data.total as number;
    expect(before).toBeGreaterThanOrEqual(1);

    const ready = await inject(
      "GET",
      `/projects/${projectId}/episodes/${episodeId}/timeline/publications?status=3`,
    );
    expect(ready.code).toBe(0);
    expect(ready.data.list.every((item: { status: number }) => item.status === 3)).toBe(true);

    const dry = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/timeline/publish`, {
      title: `dry-${stamp}`,
      dry_run: true,
    });
    expect(dry.code).toBe(0);
    expect(dry.data.dry_run).toBe(true);
    expect(dry.data.would_status).toBe(1);
    const after = await inject("GET", `/projects/${projectId}/episodes/${episodeId}/timeline/publications`);
    expect(after.data.total).toBe(before);
  });

  it("validates slice inputs with 400101", async () => {
    const base = `/projects/${projectId}/episodes/${episodeId}/timeline/publish`;
    expect((await inject("POST", base, { slice: { clip_ids: ["not-a-clip"] } })).code).toBe(400101);
    expect((await inject("POST", base, { slice: { start_ms: 3000, end_ms: 2000 } })).code).toBe(400101);
    expect((await inject("POST", base, { slice: { start_ms: 0, end_ms: 999_999 } })).code).toBe(400101);
  });

  it("unpublish sets status=5, hides the token, and is not repeatable", async () => {
    const list = await inject("GET", `/projects/${projectId}/episodes/${episodeId}/timeline/publications`);
    const readyItem = (list.data.list as Array<{ publication_id: string; status: number }>).find(
      (item) => item.status === 3,
    );
    expect(readyItem).toBeTruthy();
    const del = await inject(
      "DELETE",
      `/projects/${projectId}/episodes/${episodeId}/publications/${readyItem!.publication_id}`,
    );
    expect(del.code).toBe(0);
    expect(del.data.status).toBe(5);

    const after = await inject("GET", `/projects/${projectId}/episodes/${episodeId}/timeline/publications`);
    const removed = (after.data.list as Array<{ publication_id: string; status: number; share_token: string | null }>).find(
      (item) => item.publication_id === readyItem!.publication_id,
    );
    expect(removed?.status).toBe(5);
    // 下架后不再发 shareToken（否则链接仍然有效，等于没下架）
    expect(removed?.share_token).toBeNull();

    const again = await inject(
      "DELETE",
      `/projects/${projectId}/episodes/${episodeId}/publications/${readyItem!.publication_id}`,
    );
    expect(again.code).toBe(400102);
  });

  it("binds space asset / project asset / shot product to a clip and keeps it across timeline PUT", async () => {
    const spaceAsset = await uploadOnce(`clip-asset-${stamp}.png`, "image/png");
    const projectAsset = await inject("POST", `/projects/${projectId}/assets`, {
      kind: "scene",
      name: `片段场景-${stamp}`,
      ref_image_uri: `u/test/clip-scene-${stamp}.png`,
    });
    expect(projectAsset.code).toBe(0);

    const bound = await inject(
      "POST",
      `/projects/${projectId}/episodes/${episodeId}/timeline/clips/${clipAId}/assets`,
      { asset_ids: [spaceAsset.id, projectAsset.data.id], task_id: taskAId },
    );
    expect(bound.code).toBe(0);
    expect(bound.data.clip_id).toBe(clipAId);
    const assets = bound.data.assets as Array<{ source: string; id: string; uri: string; task_id?: string | null }>;
    expect(assets).toHaveLength(3);
    expect(assets.map((item) => item.source).sort()).toEqual(["asset", "project_asset", "shot_product"]);
    expect(assets.find((item) => item.source === "shot_product")?.task_id).toBe(taskAId);

    // GET timeline 能读回绑定（只在有绑定时出现该字段，保持既有 clip 键集合）
    const timeline = await inject("GET", `/projects/${projectId}/episodes/${episodeId}/timeline`);
    const clipA = (timeline.data.clips as Array<{ clip_id: string; assets?: unknown[] }>).find(
      (clip) => clip.clip_id === clipAId,
    );
    const clipB = (timeline.data.clips as Array<{ clip_id: string; assets?: unknown[] }>).find(
      (clip) => clip.clip_id === clipBId,
    );
    expect(clipA?.assets).toHaveLength(3);
    expect(clipB?.assets).toBeUndefined();

    // 保存时间线（整体覆盖）不应把绑定清掉
    const saved = await inject("PUT", `/projects/${projectId}/episodes/${episodeId}/timeline`, {
      clips: [
        { clip_id: clipAId, shot_id: shotIds[0], task_id: taskAId, name: "开场", duration: 2 },
        { clip_id: clipBId, shot_id: shotIds[1], task_id: taskBId, name: "冲突", duration: 3 },
      ],
    });
    expect(saved.code).toBe(0);
    const afterSave = await inject("GET", `/projects/${projectId}/episodes/${episodeId}/timeline`);
    const clipAAfter = (afterSave.data.clips as Array<{ clip_id: string; assets?: unknown[] }>).find(
      (clip) => clip.clip_id === clipAId,
    );
    expect(clipAAfter?.assets).toHaveLength(3);

    // clear 清空
    const cleared = await inject(
      "POST",
      `/projects/${projectId}/episodes/${episodeId}/timeline/clips/${clipAId}/assets`,
      { clear: true },
    );
    expect(cleared.code).toBe(0);
    expect(cleared.data.assets).toEqual([]);
  });

  it("rejects unknown assets / cross-episode tasks / unknown clips with 400101 or 400102", async () => {
    const clipBase = `/projects/${projectId}/episodes/${episodeId}/timeline/clips`;
    expect((await inject("POST", `${clipBase}/${clipAId}/assets`, { asset_ids: ["999999999999999999"] })).code).toBe(
      400101,
    );
    // 其它分集的任务不能挂到本集片段
    expect((await inject("POST", `${clipBase}/${clipAId}/assets`, { task_id: otherEpisodeTaskId })).code).toBe(400101);
    // 不存在的 clip
    expect((await inject("POST", `${clipBase}/nope/assets`, { clear: true })).code).toBe(400102);
    expect((await inject("POST", `${clipBase}/${clipAId}/assets`, { asset_ids: ["not-a-number"] })).code).toBe(400101);
  });

  it("isolates publish/publications/clip-assets by space (cross-space → 400102)", async () => {
    expect(
      (
        await raw(tokenOther, "POST", `/projects/${projectId}/episodes/${episodeId}/timeline/publish`, {
          title: "越权发布",
        })
      ).code,
    ).toBe(400102);
    expect(
      (await raw(tokenOther, "GET", `/projects/${projectId}/episodes/${episodeId}/timeline/publications`)).code,
    ).toBe(400102);
    expect(
      (
        await raw(
          tokenOther,
          "DELETE",
          `/projects/${projectId}/episodes/${episodeId}/publications/999999999999999999`,
        )
      ).code,
    ).toBe(400102);
    expect(
      (
        await raw(
          tokenOther,
          "POST",
          `/projects/${projectId}/episodes/${episodeId}/timeline/clips/${clipAId}/assets`,
          { clear: true },
        )
      ).code,
    ).toBe(400102);
  });

  // ────────────────────────────────────────────────────────────────────
  // 公开播放页（/watch/:token）—— 本批新增
  // ────────────────────────────────────────────────────────────────────

  /** 真的不带任何凭证的请求（`inject` 会带 `Bearer `，公开端点必须用这个） */
  const publicInject = async (method: "GET" | "POST", url: string, payload?: unknown): Promise<Envelope> => {
    const res = await app.inject({
      method,
      url: `/v1${url}`,
      payload: payload as Record<string, unknown> | undefined,
      headers: {},
    });
    return res.json() as Envelope;
  };

  /** 发布一条切片并轮询到终态，返回它的 share_token */
  const publishAndWaitReady = async (title: string): Promise<{ publicationId: string; shareToken: string }> => {
    const published = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/timeline/publish`, {
      title,
      slice: { start_ms: 0, end_ms: 4000 },
    });
    expect(published.code).toBe(0);
    const publicationId = published.data.publication_id as string;
    let shareToken = "";
    for (let i = 0; i < 60; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const list = await inject("GET", `/projects/${projectId}/episodes/${episodeId}/timeline/publications`);
      const item = (list.data.list as Array<{ publication_id: string; status: number; share_token: string | null }>).find(
        (row) => row.publication_id === publicationId,
      );
      if (item?.status === 3 && item.share_token) {
        shareToken = item.share_token;
        break;
      }
    }
    expect(shareToken).toMatch(/^[0-9a-f]{32}$/);
    return { publicationId, shareToken };
  };

  it("public watch: 可播放态返回播放信息（现签 url + 时长 + 集号），且不含 space/user/积分等内部字段", async () => {
    const { shareToken } = await publishAndWaitReady(`公开播放-${stamp}`);

    // 关键：不带 Authorization（未登录的外部访客也能看），只凭 token
    const res = await publicInject("GET", `/watch/${shareToken}`);
    expect(res.code).toBe(0);
    const data = res.data as Record<string, unknown>;
    expect(data.status).toBe(3);
    expect(String(data.title)).toContain("公开播放");
    expect(Number(data.episode_no)).toBeGreaterThanOrEqual(1);
    expect(String(data.file_url)).toContain("files/local"); // 现签 1h 下载/播放地址
    expect(Number(data.duration_ms)).toBe(4000);
    expect(data.published_at).toBeTruthy();
    expect(Number(data.view_count)).toBeGreaterThanOrEqual(0);

    // 越权不可见：响应里不得出现内部标识
    const forbidden = [
      "space_id",
      "user_id",
      "project_id",
      "episode_id",
      "publication_id",
      "share_token",
      "created_by",
      "slice",
      "error",
    ];
    for (const key of forbidden) {
      expect(data).not.toHaveProperty(key);
    }
    // 键集合收敛（多一个字段都可能泄露内部信息）
    expect(Object.keys(data).sort()).toEqual(
      ["duration_ms", "episode_no", "file_url", "published_at", "status", "title", "view_count"].sort(),
    );
  });

  it("public watch: 转码中(1/2)/失败(4) 分别给 400105+transcoding / transcode_failed；不返回播放地址", async () => {
    const makeRow = async (status: number) => {
      // share token 必须是 32 位 hex（端点先做形状校验，畸形 token 直接 not_found）
      const token = randomBytes(16).toString("hex");
      await db.insert(timelinePublications).values({
        id: BigInt(newId()),
        spaceId: BigInt(spaceId),
        projectId: BigInt(projectId),
        episodeId: BigInt(episodeId),
        title: `状态-${status}-${stamp}`,
        slice: { unit: "ms", start_ms: 0, end_ms: 1000, duration_ms: 1000 },
        status,
        shareToken: token,
      });
      return token;
    };
    const queued = await makeRow(1);
    const transcoding = await makeRow(2);
    const failed = await makeRow(4);

    const r1 = await publicInject("GET", `/watch/${queued}`);
    expect(r1.code).toBe(400105);
    expect(r1.msg).toContain("transcoding");
    expect(r1.data).toBeNull();

    const r2 = await publicInject("GET", `/watch/${transcoding}`);
    expect(r2.code).toBe(400105);
    expect(r2.msg).toContain("transcoding");

    const r4 = await publicInject("GET", `/watch/${failed}`);
    expect(r4.code).toBe(400105);
    expect(r4.msg).toContain("transcode_failed");
  });

  it("public watch: 已下架 → 400102+off_shelf；不存在/非法 token → 400102+not_found（不泄露存在性）", async () => {
    // 造一条"曾经可播放、现已下架"的记录（先真发布→再下架，走真实状态机）
    const { publicationId, shareToken } = await publishAndWaitReady(`待下架-${stamp}`);
    expect((await publicInject("GET", `/watch/${shareToken}`)).code).toBe(0);
    const del = await inject(
      "DELETE",
      `/projects/${projectId}/episodes/${episodeId}/publications/${publicationId}`,
    );
    expect(del.code).toBe(0);

    const offShelf = await publicInject("GET", `/watch/${shareToken}`);
    expect(offShelf.code).toBe(400102);
    expect(offShelf.msg).toContain("off_shelf");
    expect(offShelf.data).toBeNull();

    // 随机 32 位 hex（形状合法但不存在）与畸形 token 都是 not_found
    const missing = await publicInject("GET", `/watch/${"0123456789abcdef".repeat(2)}`);
    expect(missing.code).toBe(400102);
    expect(missing.msg).toContain("not_found");

    const malformed = await publicInject("GET", "/watch/not-a-real-token");
    expect(malformed.code).toBe(400102);
    expect(malformed.msg).toContain("not_found");

    // 计数端点对同一 token 也应是 off_shelf（下架后不能再刷量）
    const viewOffShelf = await publicInject("POST", `/watch/${shareToken}/view`);
    expect(viewOffShelf.code).toBe(400102);
    expect(viewOffShelf.msg).toContain("off_shelf");
  });

  it("view 计数：同 IP 5 分钟内只算一次（counted 诚实），播放量单调不减", async () => {
    const { shareToken } = await publishAndWaitReady(`计数-${stamp}`);

    const first = await publicInject("POST", `/watch/${shareToken}/view`);
    expect(first.code).toBe(0);
    const firstData = first.data as { counted: boolean; view_count: number };
    expect(firstData.counted).toBe(true);
    expect(firstData.view_count).toBeGreaterThanOrEqual(1);

    // 同一 IP 立刻再点：不重复计数，但返回当前播放量（幂等语义）
    const second = await publicInject("POST", `/watch/${shareToken}/view`);
    expect(second.code).toBe(0);
    const secondData = second.data as { counted: boolean; view_count: number };
    expect(secondData.counted).toBe(false);
    expect(secondData.view_count).toBe(firstData.view_count);

    // GET 里也能看到这个数（页面首屏就能显示播放量）
    const watch = await publicInject("GET", `/watch/${shareToken}`);
    expect((watch.data as { view_count: number }).view_count).toBe(firstData.view_count);
  });

  it("view 计数持久化：落 view_count 列；清空 Redis（模拟重启）后仍可读，同 IP 第二次不再 +1", async () => {
    const { shareToken } = await publishAndWaitReady(`持久计数-${stamp}`);
    const idRows = (await db.execute(
      sql`select id::text as id from timeline_publications where share_token = ${shareToken} limit 1`,
    )) as { rows?: Array<{ id: string }> };
    const publicationId = idRows.rows?.[0]?.id ?? "";
    expect(publicationId).not.toBe("");

    const columnValue = async (): Promise<number> => {
      const rows = (await db.execute(
        sql`select view_count from timeline_publications where id = ${BigInt(publicationId)}`,
      )) as { rows?: Array<{ view_count: number }> };
      return Number(rows.rows?.[0]?.view_count ?? -1);
    };

    // 新发布的行从 0 开始；GET 读的是列（不是 Redis 计数）
    const baseline = await publicInject("GET", `/watch/${shareToken}`);
    expect((baseline.data as { view_count: number }).view_count).toBe(0);

    const first = await publicInject("POST", `/watch/${shareToken}/view`);
    expect((first.data as { counted: boolean }).counted).toBe(true);
    expect((first.data as { view_count: number }).view_count).toBe(1);
    expect(await columnValue()).toBe(1); // 列里真的写了（双写的"落库"那一半）

    // 同 IP 5 分钟内第二次：不重复计数，列值不变
    const second = await publicInject("POST", `/watch/${shareToken}/view`);
    expect((second.data as { counted: boolean }).counted).toBe(false);
    expect((second.data as { view_count: number }).view_count).toBe(1);
    expect(await columnValue()).toBe(1);

    // 清空 Redis（模拟进程/缓存重启）：去重闸丢失，但**历史播放量不能丢**
    const redis = app.get(RedisService);
    const dedupeKeys = await redis.client.keys(`watch:view:${publicationId}:*`);
    if (dedupeKeys.length > 0) await redis.client.del(...dedupeKeys);
    await redis.client.del(`watch:views:${publicationId}`); // 旧实现旁路键，存在也清掉
    const afterFlush = await publicInject("GET", `/watch/${shareToken}`);
    expect((afterFlush.data as { view_count: number }).view_count).toBe(1);

    // 去重闸被清空后再点一次：重新计数，并从**持久值**继续 +1（不是从 0 重来）
    const third = await publicInject("POST", `/watch/${shareToken}/view`);
    expect((third.data as { counted: boolean }).counted).toBe(true);
    expect((third.data as { view_count: number }).view_count).toBe(2);
    expect(await columnValue()).toBe(2);
  });

  it("watch 只需 token：跨 space 的另一账号拿同一链接也能看（能力式授权），但内部端点仍 400102", async () => {
    const { shareToken } = await publishAndWaitReady(`跨空间-${stamp}`);

    // 另一个 space 的登录用户访问公开播放：允许（链接即凭据），且回复里仍无内部字段
    const asOther = await raw(tokenOther, "GET", `/watch/${shareToken}`);
    expect(asOther.code).toBe(0);
    expect(asOther.data).not.toHaveProperty("space_id");
    expect(asOther.data).not.toHaveProperty("project_id");

    // 但内部发布端点对该账号依旧不可见（越权不泄露存在性）
    expect(
      (await raw(tokenOther, "GET", `/projects/${projectId}/episodes/${episodeId}/timeline/publications`)).code,
    ).toBe(400102);
  });
});


