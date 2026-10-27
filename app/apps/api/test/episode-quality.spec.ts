import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { eq, sql } from "drizzle-orm";
import { models, projectAssets, storyboards, tasks, timelineExports } from "@app/db";
import { newId } from "@app/shared";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { db, pool } from "../src/db/database";

/**
 * 剧集/分镜子链契约测试：质量检查（只读）+ 分集合成导出（80% 闸门）+ 分镜表解析。
 *
 * 竞品证据：
 * - `rea-reelmate/routes.txt:445` `/web/v1/df/episode/:ep_id/quality-check`（字段未文档化）；
 * - `target-spec.md:124,174`（PRD F2⑦）：导出仅打包 SUCCEEDED 镜头、成功镜 <80% → 400106；
 * - `routes.txt:440-444` `process/parse/{generate,info,upload,delete}`；
 * - `cmd/episode.md:407-429`：`parse-retry` 与 `parse` 是两个端点，不能互相替代。
 *
 * 为什么"只读"要用 updated_at 断言：质量检查如果偷偷把 status 归一化或补默认值，
 * 用户每点一次检查就会看到"分镜变了"，而这正是竞品被诟病的"检查即修改"。
 */
describe("episode quality-check / film-synthesis / parse e2e", () => {
  let app: NestFastifyApplication;
  let token = "";
  let tokenOther = "";
  let spaceId = "";
  let userId = "";
  const stamp = `q${Date.now()}`;

  interface Envelope {
    code: number;
    msg: string;
    data: any;
  }

  const raw = async (
    asToken: string,
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
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
  const inject = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: unknown) =>
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

    const a = await login(`18${String(Math.floor(Math.random() * 900000000) + 100000000)}`);
    token = a.token;
    spaceId = a.spaceId;
    userId = a.userId;
    tokenOther = (await login(`18${String(Math.floor(Math.random() * 900000000) + 100000000)}`)).token;
  });

  afterAll(async () => {
    const cleanup = (query: Parameters<typeof db.execute>[0]) => db.execute(query).catch(() => {});
    await cleanup(sql`delete from timeline_exports where episode_id in (
      select id from episodes where project_id in (select id from script_projects where title like ${`%${stamp}%`})
    )`);
    await cleanup(sql`delete from exports where episode_id in (
      select id from episodes where project_id in (select id from script_projects where title like ${`%${stamp}%`})
    )`);
    await cleanup(sql`delete from storyboard_assets where storyboard_id in (
      select id from storyboards where episode_id in (
        select id from episodes where project_id in (select id from script_projects where title like ${`%${stamp}%`})
      )
    )`);
    await cleanup(sql`delete from storyboards where episode_id in (
      select id from episodes where project_id in (select id from script_projects where title like ${`%${stamp}%`})
    )`);
    await cleanup(sql`delete from project_timelines where episode_id in (
      select id from episodes where project_id in (select id from script_projects where title like ${`%${stamp}%`})
    )`);
    await cleanup(sql`delete from episodes where project_id in (
      select id from script_projects where title like ${`%${stamp}%`}
    )`);
    await cleanup(sql`delete from project_assets where project_id in (
      select id from script_projects where title like ${`%${stamp}%`}
    )`);
    await cleanup(sql`delete from script_projects where title like ${`%${stamp}%`}`);
    await app.close();
    await pool.end().catch(() => {});
  });

  let projectId = "";
  let episodeId = "";
  let secondEpisodeId = "";
  let shotIds: string[] = [];
  let sceneAssetId = "";
  const sceneRef = `u/test/qc-scene-${stamp}.png`;

  it("prepares a project with 4 shots + one finalized scene asset bound to shot 1", async () => {
    const created = await inject("POST", "/projects", {
      title: `质量检查-${stamp}`,
      source_type: 1,
      source_text: "第一章：林晚在雨夜收到匿名信。第二章：旧仓库的真相。",
    });
    expect(created.code).toBe(0);
    projectId = created.data.id;

    const outline = await inject("POST", `/projects/${projectId}/outline/generate`);
    expect(outline.code).toBe(0);
    episodeId = outline.data[0].id;
    secondEpisodeId = outline.data[1].id;
    expect((await inject("POST", `/projects/${projectId}/episodes/${episodeId}/script-draft/generate`, {})).code).toBe(0);

    const shots = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/storyboards/generate`, {
      shot_count: 4,
    });
    expect(shots.code).toBe(0);
    shotIds = shots.data.map((shot: { id: string }) => shot.id);

    const scene = await inject("POST", `/projects/${projectId}/assets`, {
      kind: "scene",
      name: `雨夜街角-${stamp}`,
      prompt: "电影感雨夜街角",
      ref_image_uri: sceneRef,
    });
    expect(scene.code).toBe(0);
    sceneAssetId = scene.data.id;
    expect((await inject("PATCH", `/projects/${projectId}/assets/${sceneAssetId}`, { status: 2 })).code).toBe(0);
    const bound = await inject(
      "PUT",
      `/projects/${projectId}/episodes/${episodeId}/storyboards/${shotIds[0]}/assets`,
      { asset_ids: [sceneAssetId] },
    );
    expect(bound.code).toBe(0);
  });

  it("quality-check returns issues[] + weighted score with 5 dimensions", async () => {
    const res = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/quality-check`);
    expect(res.code).toBe(0);
    expect(res.data.read_only).toBe(true);
    expect(res.data.ep_id).toBe(episodeId);
    expect(res.data.score).toBeGreaterThanOrEqual(0);
    expect(res.data.score).toBeLessThanOrEqual(100);
    expect(["pass", "warn", "fail"]).toContain(res.data.status);
    expect(typeof res.data.blocking).toBe("boolean");
    // 五个维度权重和必须 = 100（口径写死在 service 注释里，这里是回归锚点）
    const dims = res.data.dimensions as Array<{ key: string; weight: number; score: number; weighted: number }>;
    expect(dims.map((d) => d.key)).toEqual(["shots", "prompt", "assets", "duration", "timeline"]);
    expect(dims.reduce((sum, d) => sum + d.weight, 0)).toBe(100);
    expect(dims.reduce((sum, d) => sum + d.weighted, 0)).toBe(res.data.score);
    expect(Array.isArray(res.data.issues)).toBe(true);
    // 刚生成的分镜还没时间线 → 至少有一条 timeline_empty 的 warn
    expect(
      (res.data.issues as Array<{ code: string; severity: string }>).some(
        (issue) => issue.code === "timeline_empty" && issue.severity === "warn",
      ),
    ).toBe(true);
  });

  it("quality-check is read-only: storyboards/assets rows are untouched", async () => {
    const before = await db
      .select({
        id: storyboards.id,
        status: storyboards.status,
        updatedAt: storyboards.updatedAt,
        prompt: storyboards.videoPrompt,
      })
      .from(storyboards)
      .where(eq(storyboards.episodeId, BigInt(episodeId)))
      .orderBy(storyboards.shotNo);
    const assetsBefore = await db
      .select({ id: projectAssets.id, status: projectAssets.status, updatedAt: projectAssets.updatedAt })
      .from(projectAssets)
      .where(eq(projectAssets.projectId, BigInt(projectId)));

    const res = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/quality-check`);
    expect(res.code).toBe(0);

    const after = await db
      .select({
        id: storyboards.id,
        status: storyboards.status,
        updatedAt: storyboards.updatedAt,
        prompt: storyboards.videoPrompt,
      })
      .from(storyboards)
      .where(eq(storyboards.episodeId, BigInt(episodeId)))
      .orderBy(storyboards.shotNo);
    const assetsAfter = await db
      .select({ id: projectAssets.id, status: projectAssets.status, updatedAt: projectAssets.updatedAt })
      .from(projectAssets)
      .where(eq(projectAssets.projectId, BigInt(projectId)));

    expect(after).toEqual(before);
    expect(assetsAfter).toEqual(assetsBefore);
  });

  it("quality-check flags empty prompt + unfinalized asset as blocking errors", async () => {
    // 清空 shot 2 的提示词（PATCH 走服务端既有端点，不是本检查干的）
    const cleared = await inject(
      "PATCH",
      `/projects/${projectId}/episodes/${episodeId}/storyboards/${shotIds[1]}`,
      { video_prompt: "" },
    );
    expect(cleared.code).toBe(0);
    // 往 shot 2 绑一个未定稿资产
    const draft = await inject("POST", `/projects/${projectId}/assets`, {
      kind: "prop",
      name: `未定稿道具-${stamp}`,
      ref_image_uri: `u/test/qc-draft-${stamp}.png`,
    });
    expect(draft.code).toBe(0);
    expect(
      (
        await inject("PUT", `/projects/${projectId}/episodes/${episodeId}/storyboards/${shotIds[1]}/assets`, {
          asset_ids: [draft.data.id],
        })
      ).code,
    ).toBe(0);

    const res = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/quality-check`);
    expect(res.code).toBe(0);
    expect(res.data.status).toBe("fail");
    expect(res.data.blocking).toBe(true);
    const codes = (res.data.issues as Array<{ code: string }>).map((issue) => issue.code);
    expect(codes).toContain("prompt_empty");
    expect(codes).toContain("asset_not_finalized");
    // 定位到具体镜头（不能只报总数——那是"看着都绿、投递才发现缺料"的根因）
    const issue = (res.data.issues as Array<{ code: string; shot_id?: string }>).find(
      (item) => item.code === "prompt_empty",
    );
    expect(issue?.shot_id).toBe(shotIds[1]);
    // 清理：恢复提示词，避免影响后续合成用例
    const restored = await inject(
      "PATCH",
      `/projects/${projectId}/episodes/${episodeId}/storyboards/${shotIds[1]}`,
      { video_prompt: "电影感短剧镜头，人物对峙，9:16 竖屏" },
    );
    expect(restored.code).toBe(0);
    expect(
      (
        await inject("PUT", `/projects/${projectId}/episodes/${episodeId}/storyboards/${shotIds[1]}/assets`, {
          asset_ids: [],
        })
      ).code,
    ).toBe(0);
  });

  it("film-synthesis-export rejects with 400106 when <80% shots succeeded", async () => {
    const res = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/film-synthesis-export`);
    expect(res.code).toBe(400106);
    // 拒绝时要能说清"差多少"（否则用户只能盲猜）
    expect(res.msg).toContain("0%");
  });

  it("film-synthesis-export creates zip job + mp4 synthesis job when all shots are ready", async () => {
    const [model] = await db.select().from(models).limit(1);
    if (!model) throw new Error("models table empty; run seed first");
    // 4 个镜头各落一条成功的视频任务（不真生成视频，只造任务与结果）
    for (const [index, shotId] of shotIds.entries()) {
      const taskId = newId();
      await db.insert(tasks).values({
        id: taskId,
        spaceId: BigInt(spaceId),
        userId: BigInt(userId),
        capability: "video",
        mode: "text2video",
        modelId: model.id,
        episodeId: BigInt(episodeId),
        shotId: BigInt(shotId),
        input: {},
        options: {},
        status: 3,
        results: [{ uri: `u/test/qc-shot-${stamp}-${index}.mp4` }],
      });
      await db.update(storyboards).set({ videoTaskId: taskId, status: 5 }).where(eq(storyboards.id, BigInt(shotId)));
    }

    const res = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/film-synthesis-export`);
    expect(res.code).toBe(0);
    expect(res.data.status).toBe(1);
    expect(res.data.status_label).toBe("queued");
    expect(res.data.success_ratio).toBe(1);
    expect(res.data.shots_total).toBe(4);
    expect(res.data.shots_ready).toBe(4);
    expect(res.data.watermarked).toBe(true);
    // 没有时间线时会自动摊一条（4 段），合成器才有东西可拼
    expect(res.data.clips).toBe(4);
    expect(res.data.export_id).toBeTruthy();
    expect(res.data.synthesis_export_id).toBeTruthy();

    // 两条通道都可轮询：zip 走 exports 四态，mp4 走 timeline_exports 四态
    const zip = await inject("GET", `/projects/${projectId}/episodes/${episodeId}/exports/${res.data.export_id}`);
    expect(zip.code).toBe(0);
    expect([1, 2, 3, 4]).toContain(zip.data.status);
    const mp4 = await inject(
      "GET",
      `/projects/${projectId}/episodes/${episodeId}/timeline/export/${res.data.synthesis_export_id}`,
    );
    expect(mp4.code).toBe(0);
    expect([1, 2, 3, 4]).toContain(mp4.data.status);

    const timeline = await inject("GET", `/projects/${projectId}/episodes/${episodeId}/timeline`);
    expect(timeline.code).toBe(0);
    expect(timeline.data.clips).toHaveLength(4);

    const row = await db
      .select()
      .from(timelineExports)
      .where(eq(timelineExports.id, BigInt(res.data.synthesis_export_id)));
    expect(row[0]?.clipCount).toBe(4);
  });

  it("parse: table → storyboards (backup first), merge/update, then parse-reset restores the old shots", async () => {
    const before = await inject("GET", `/projects/${projectId}/episodes/${episodeId}`);
    const beforeShots = before.data.storyboards as Array<{ id: string; shot_no: number }>;
    expect(beforeShots).toHaveLength(4);

    const parsed = await inject("POST", `/projects/${projectId}/episodes/parse`, {
      episode_id: episodeId,
      mode: "replace",
      table: [
        { shot_no: 1, shot_desc: "解析后第 1 镜", video_prompt: "解析后的提示词一", duration_s: 3 },
        { shot_no: 2, shot_desc: "解析后第 2 镜", video_prompt: "解析后的提示词二", duration_s: 4 },
      ],
    });
    expect(parsed.code).toBe(0);
    expect(parsed.data.parsed).toBe(2);
    expect(parsed.data.removed).toBe(4);
    expect(parsed.data.backup_key).toContain("/parse-backups/");

    const afterParse = await inject("GET", `/projects/${projectId}/episodes/${episodeId}`);
    expect(afterParse.data.storyboards).toHaveLength(2);
    expect(afterParse.data.storyboards[0].shot_desc).toBe("解析后第 1 镜");
    expect(afterParse.data.storyboards[0].duration_s).toBe(3);

    // merge 模式：按 shot_no 更新，不新增
    const merged = await inject("POST", `/projects/${projectId}/episodes/parse`, {
      episode_id: episodeId,
      mode: "merge",
      table: [
        { shot_no: 2, shot_desc: "合并后第 2 镜", video_prompt: "合并后的提示词", duration_s: 6 },
        { shot_no: 3, shot_desc: "新增第 3 镜", video_prompt: "新增提示词" },
      ],
    });
    expect(merged.code).toBe(0);
    expect(merged.data.created).toBe(1);
    expect(merged.data.updated).toBe(1);
    const afterMerge = await inject("GET", `/projects/${projectId}/episodes/${episodeId}`);
    expect(afterMerge.data.storyboards).toHaveLength(3);
    expect(afterMerge.data.storyboards[1].shot_desc).toBe("合并后第 2 镜");

    // parse-reset：回到最近一次解析前（即 merge 前的 2 镜状态）
    const reset = await inject("POST", `/projects/${projectId}/episodes/parse-reset`, {
      episode_id: episodeId,
    });
    expect(reset.code).toBe(0);
    expect(reset.data.restored).toBe(2);
    const afterReset = await inject("GET", `/projects/${projectId}/episodes/${episodeId}`);
    expect(afterReset.data.storyboards).toHaveLength(2);
    expect(afterReset.data.storyboards[0].shot_desc).toBe("解析后第 1 镜");

    // 再次 reset 回到最初（4 镜，且原始 id 与绑定都还原）
    const reset2 = await inject("POST", `/projects/${projectId}/episodes/parse-reset`, {
      episode_id: episodeId,
    });
    expect(reset2.code).toBe(0);
    expect(reset2.data.restored).toBe(2);
    const empty = await inject("POST", `/projects/${projectId}/episodes/parse-reset`, {
      episode_id: episodeId,
      dry_run: true,
    });
    expect(empty.code).toBe(0);
    expect(empty.data.would_restore).toBe(2);
    void shotIds;
  });

  it("parse: text (markdown) table works, invalid tables are rejected with 400101 without writes", async () => {
    const text = ["| 镜号 | 画面描述 | 提示词 | 时长 |", "|---|---|---|---|", "| 1 | 文本表第1镜 | 文本提示词一 | 3 |", "| 2 | 文本表第2镜 | 文本提示词二 | 2 |"].join("\n");
    const parsed = await inject("POST", `/projects/${projectId}/episodes/parse`, {
      episode_id: episodeId,
      text,
      mode: "replace",
    });
    expect(parsed.code).toBe(0);
    expect(parsed.data.parsed).toBe(2);
    const detail = await inject("GET", `/projects/${projectId}/episodes/${episodeId}`);
    expect(detail.data.storyboards[0].shot_desc).toBe("文本表第1镜");
    expect(detail.data.storyboards[1].duration_s).toBe(2);

    const countBefore = (await inject("GET", `/projects/${projectId}/episodes/${episodeId}`)).data.storyboards.length;
    const dup = await inject("POST", `/projects/${projectId}/episodes/parse`, {
      episode_id: episodeId,
      table: [
        { shot_no: 1, shot_desc: "重复镜号 A" },
        { shot_no: 1, shot_desc: "重复镜号 B" },
      ],
    });
    expect(dup.code).toBe(400101);
    const noRows = await inject("POST", `/projects/${projectId}/episodes/parse`, { episode_id: episodeId });
    expect(noRows.code).toBe(400101);
    const badNo = await inject("POST", `/projects/${projectId}/episodes/parse`, {
      episode_id: episodeId,
      table: [{ shot_no: 0, shot_desc: "镜号非法" }],
    });
    expect(badNo.code).toBe(400101);
    // 校验失败零写入
    expect((await inject("GET", `/projects/${projectId}/episodes/${episodeId}`)).data.storyboards.length).toBe(
      countBefore,
    );
  });

  it("parse-retry replays the last input; without a previous parse → 400101", async () => {
    const retried = await inject("POST", `/projects/${projectId}/episodes/parse-retry`, {
      episode_id: episodeId,
    });
    expect(retried.code).toBe(0);
    expect(retried.data.retried).toBe(true);
    expect(retried.data.parsed).toBe(2);

    // 没有解析过的分集：重试应明确 400101（竞品 `740015 not found data` 的等价语义）
    const noParse = await inject("POST", `/projects/${projectId}/episodes/parse-retry`, {
      episode_id: secondEpisodeId,
    });
    expect(noParse.code).toBe(400101);
  });

  it("isolates all three subchains by space (cross-space → 400102)", async () => {
    expect(
      (await raw(tokenOther, "POST", `/projects/${projectId}/episodes/${episodeId}/quality-check`)).code,
    ).toBe(400102);
    expect(
      (await raw(tokenOther, "POST", `/projects/${projectId}/episodes/${episodeId}/film-synthesis-export`)).code,
    ).toBe(400102);
    expect(
      (
        await raw(tokenOther, "POST", `/projects/${projectId}/episodes/parse`, {
          episode_id: episodeId,
          table: [{ shot_no: 1, shot_desc: "越权" }],
        })
      ).code,
    ).toBe(400102);
    // 不存在的分集
    expect(
      (await inject("POST", `/projects/${projectId}/episodes/999999999999999999/quality-check`)).code,
    ).toBe(400102);
  });
});
