import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { sql } from "drizzle-orm";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { db, pool } from "../src/db/database";
import { RedisService } from "../src/redis/redis.service";
import { NovelAgentService } from "../src/modules/novel/novel-agent.service";
import { NovelService } from "../src/modules/novel/novel.service";
import { AppError, ErrorCode } from "@app/shared";

/**
 * 原创剧本链（`/v1/novel/:nt/original_script/*`）+ 撤回定稿（reopen）+ 4 条薄路径
 * + Redis 轮次锁 —— 契约测试。
 *
 * 行为证据：`_acceptance/_gap/cli-skill/reelmate-cli-skill/commands/novel.md`
 * 的 `novel create / idea set / material / outline / chapter / episode / script / finalize`
 * 七段（各用例注释里标了行号），路径形状见 `rea-reelmate/routes.txt:547-564`。
 *
 * 断言重点（为什么这么断言）：
 *
 * 1. **原创链不依赖源小说**：整条链跑在一个 `source_type=2`、只有一句灵感的本子上。
 *    任何一步回头去读章节都说明实现走错了链（改编链才是"从章节推大纲"）。
 * 2. **顺序闸门必须显式**：没选方案不能生成素材、没总纲不能生成章纲/集纲 ——
 *    这些不是"顺手校验"，而是竞品 CLI 的调用顺序（每个中间产物一条触发命令）。
 * 3. **reopen 的两种拒绝都要有**：未定稿 → 400100；已被拆集引用 → 400105 且回显项目。
 *    静默把 16 退回 1 会让"制片工坊里已拍的剧本"与"剧本工厂的剧本"永久分叉。
 * 4. **轮次锁在 Redis 里**：预占同一个 key（模拟另一个 API 副本正在跑）后 chat 必须 746005；
 *    释放后同一会话立刻可继续 —— 这条断言如果锁是进程内 Set，就会**假绿**（本进程看不见别人的锁）。
 */

const USER_INPUT = "一名替人写遗书的女孩，发现客户名单里有自己父亲的名字。";

describe("novel original_script e2e", () => {
  let app: NestFastifyApplication;
  let seq = 0;
  const createdSpaceIds: string[] = [];
  /** 造出来冒充"已拆集"的制片工坊项目，afterAll 要删 */
  const createdProjectIds: string[] = [];

  interface Session {
    token: string;
    spaceId: string;
    userId: string;
  }

  let userA: Session;
  let userB: Session;
  /** 原创链主本子（source_type=2） */
  let ntId = "";
  /** reopen 引用检测用的已定稿本子 */
  let refNtId = "";
  /** 裂变本子（薄路径用） */
  let fissionId = "";
  let lockSession = "";

  const inject = async (method: string, url: string, payload?: unknown, session?: Session) => {
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (session?.token) headers.authorization = `Bearer ${session.token}`;
    const res = await app.inject({
      method: method as "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
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
      data: (body as { data?: never }).data,
    };
  };

  async function loginNewUser(prefix: string): Promise<Session> {
    const tail = String(Date.now()).slice(-7);
    const tag = String(prefix).replace(/\D/g, "").slice(-2).padStart(2, "0");
    seq += 1;
    const phone = `1${tail}${tag}${seq % 10}`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const code = (sms.data as { debug_code?: string } | undefined)?.debug_code;
    const login = await inject("POST", "/auth/login", { phone, code, age_confirmed: true });
    const data = login.data as { access_token?: string; space_id?: string; user?: { id?: string } } | undefined;
    const session = {
      token: data?.access_token ?? "",
      spaceId: String(data?.space_id ?? ""),
      userId: String(data?.user?.id ?? ""),
    };
    if (session.spaceId) createdSpaceIds.push(session.spaceId);
    return session;
  }

  /** 建一个原创本子（source_type=2，source_text = 创作灵感） */
  async function createOriginal(prefix: string, sourceText = USER_INPUT): Promise<string> {
    const created = await inject(
      "POST",
      "/novel",
      { title: `原创-${prefix}-${Date.now()}`, source_type: 2, source_text: sourceText },
      userA,
    );
    expect(created.code).toBe(0);
    return (created.data as { id: string }).id;
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
  }, 90_000);

  afterAll(async () => {
    for (const projectId of createdProjectIds) {
      await db.execute(sql`delete from episodes where project_id = ${BigInt(projectId)}`);
      await db.execute(sql`delete from script_projects where id = ${BigInt(projectId)}`);
    }
    for (const spaceId of createdSpaceIds) {
      const space = BigInt(spaceId);
      const NOVELS_OF_SPACE = sql`select id from novels where space_id = ${space}`;
      await db.execute(
        sql`delete from novel_edit_pendings where session_id in (select id from novel_edit_sessions where novel_id in (${NOVELS_OF_SPACE}))`,
      );
      await db.execute(
        sql`delete from novel_edit_messages where session_id in (select id from novel_edit_sessions where novel_id in (${NOVELS_OF_SPACE}))`,
      );
      await db.execute(sql`delete from novel_edit_sessions where novel_id in (${NOVELS_OF_SPACE})`);
      await db.execute(sql`delete from novel_script_versions where novel_id in (${NOVELS_OF_SPACE})`);
      await db.execute(sql`delete from novel_episodes where novel_id in (${NOVELS_OF_SPACE})`);
      await db.execute(sql`delete from novel_episode_outlines where novel_id in (${NOVELS_OF_SPACE})`);
      await db.execute(sql`delete from novel_chapter_outlines where novel_id in (${NOVELS_OF_SPACE})`);
      await db.execute(sql`delete from novel_characters where novel_id in (${NOVELS_OF_SPACE})`);
      await db.execute(sql`delete from novel_worldviews where novel_id in (${NOVELS_OF_SPACE})`);
      await db.execute(sql`delete from novel_chapters where novel_id in (${NOVELS_OF_SPACE})`);
      await db.execute(sql`delete from novels where space_id = ${space}`);
    }
    await app.close();
    await pool.end().catch(() => {});
  });

  // ══════════════════════════════════════════════════════════════
  // 0. 建本子 + 链状态 + 前置校验
  // ══════════════════════════════════════════════════════════════

  it("创建原创本子（source_type=2）：灵感不分章；state 显示八步全未完成", async () => {
    userA = await loginNewUser("81");
    userB = await loginNewUser("82");
    expect(userA.spaceId).not.toBe(userB.spaceId);

    const created = await inject(
      "POST",
      "/novel",
      { title: `原创主本-${Date.now()}`, source_type: 2, source_text: USER_INPUT },
      userA,
    );
    expect(created.code).toBe(0);
    const novel = created.data as { id: string; source_type: number; status: number; chapter_count: number };
    ntId = novel.id;
    expect(novel.source_type).toBe(2);
    expect(novel.status).toBe(1);
    // 原创本子的 source_text 是"创作灵感"，不是小说正文 —— 不该被切成"第1章/第2章"的假进度
    expect(novel.chapter_count).toBe(0);

    const state = await inject("GET", `/novel/${ntId}/original_script/state`, undefined, userA);
    expect(state.code).toBe(0);
    const stateData = state.data as {
      source_type: number;
      user_input: string;
      steps: Record<string, { done: boolean; hint: string }>;
      counts: Record<string, number>;
    };
    expect(stateData.source_type).toBe(2);
    expect(stateData.user_input).toBe(USER_INPUT);
    expect(Object.keys(stateData.steps)).toEqual([
      "idea",
      "idea_selected",
      "materials",
      "summary_outline",
      "chapters_outline",
      "episodes_outline",
      "episodes",
      "finalize",
    ]);
    expect(Object.values(stateData.steps).every((step) => step.done === false)).toBe(true);

    // 改编链的本子不能走原创链（两条链的入口不同，混用会让两套内容在同一本子上打架）
    const adapted = await inject("POST", "/novel", { title: `改编本-${Date.now()}`, source_text: "第一章 起点\n正文" }, userA);
    const adaptedId = (adapted.data as { id: string }).id;
    const wrongChain = await inject("POST", `/novel/${adaptedId}/original_script/idea`, {}, userA);
    expect(wrongChain.code).toBe(ErrorCode.BAD_REQUEST);
    // 错误信封的 data 恒为 null（shared/envelope.ts 的 fail），所以这里断言文案而不是 details
    expect(wrongChain.msg).toContain("source_type=2");

    // 非法 nt_id → 400101（参数错误，不是"不存在"）
    expect((await inject("GET", "/novel/not-a-number/original_script/state", undefined, userA)).code).toBe(
      ErrorCode.INVALID_PARAM,
    );
    // 未登录 → 401101
    expect((await inject("GET", `/novel/${ntId}/original_script/state`)).code).toBe(ErrorCode.UNAUTHORIZED);
  });

  it("没有创作灵感时生成方案 → 400101（竞品 create 的 user_input 必填，novel.md:95）", async () => {
    const empty = await createOriginal("无灵感", "");
    const res = await inject("POST", `/novel/${empty}/original_script/idea`, {}, userA);
    expect(res.code).toBe(ErrorCode.INVALID_PARAM);
    // 传 user_input 补齐后同一条链可用（把一个"半成品"救回来的路径）
    const rescued = await inject(
      "POST",
      `/novel/${empty}/original_script/idea`,
      { user_input: USER_INPUT, count: 2 },
      userA,
    );
    expect(rescued.code).toBe(0);
    expect((rescued.data as { total: number }).total).toBe(2);
  });

  // ══════════════════════════════════════════════════════════════
  // 1. 创意方案（novel.md:433-480）
  // ══════════════════════════════════════════════════════════════

  it("idea：生成 3 个方案且重跑 id 稳定；列表可读；选定不存在的 ni_id → 404", async () => {
    const first = await inject("POST", `/novel/${ntId}/original_script/idea`, { count: 3 }, userA);
    expect(first.code).toBe(0);
    const firstData = first.data as { list: Array<{ ni_id: string; title: string; logline: string }>; total: number; selected_ni_id: string | null };
    expect(firstData.total).toBe(3);
    expect(firstData.selected_ni_id).toBeNull();
    for (const idea of firstData.list) {
      expect(idea.ni_id).toMatch(/^ni_[0-9a-f]+$/);
      expect(idea.title.length).toBeGreaterThan(0);
      expect(idea.logline.length).toBeGreaterThan(0);
    }

    // 重跑：同输入 → 同 ni_id（前端不需要因为"再生成一次"而丢弃正在看的方案）
    const second = await inject("POST", `/novel/${ntId}/original_script/idea`, { count: 3 }, userA);
    expect((second.data as { list: Array<{ ni_id: string }> }).list.map((row) => row.ni_id)).toEqual(
      firstData.list.map((row) => row.ni_id),
    );

    const listed = await inject("GET", `/novel/${ntId}/original_script/idea`, undefined, userA);
    expect(listed.code).toBe(0);
    const listedData = listed.data as { total: number; user_input: string; selected_ni_id: string | null };
    expect(listedData.total).toBe(3);
    expect(listedData.user_input).toBe(USER_INPUT);

    const missing = await inject("POST", `/novel/${ntId}/original_script/idea/select-op`, { ni_id: "ni_nope" }, userA);
    expect(missing.code).toBe(ErrorCode.NOT_FOUND);

    // 空 body 违反 min(1) → 400101
    expect((await inject("POST", `/novel/${ntId}/original_script/idea/select-op`, {}, userA)).code).toBe(
      ErrorCode.INVALID_PARAM,
    );
  });

  it("未选定方案就生成素材/总纲 → 400101（顺序闸门，不静默取第一条）", async () => {
    const materials = await inject("POST", `/novel/${ntId}/original_script/materials/generate`, {}, userA);
    expect(materials.code).toBe(ErrorCode.INVALID_PARAM);
    const outline = await inject("POST", `/novel/${ntId}/original_script/summary_outline`, {}, userA);
    expect(outline.code).toBe(ErrorCode.INVALID_PARAM);
    // 章纲/集纲在"没总纲"时也必须报错（而不是生成 0 条然后假装成功）
    expect((await inject("POST", `/novel/${ntId}/original_script/chapters_outline`, {}, userA)).code).toBe(
      ErrorCode.INVALID_PARAM,
    );
    expect((await inject("POST", `/novel/${ntId}/original_script/episodes_outline`, {}, userA)).code).toBe(
      ErrorCode.INVALID_PARAM,
    );
  });

  it("选定方案（idea/select-op）：状态与 state 同步", async () => {
    const listed = await inject("GET", `/novel/${ntId}/original_script/idea`, undefined, userA);
    const ideas = (listed.data as { list: Array<{ ni_id: string }> }).list;
    const chosen = await inject(
      "POST",
      `/novel/${ntId}/original_script/idea/select-op`,
      { ni_id: ideas[1]!.ni_id },
      userA,
    );
    expect(chosen.code).toBe(0);
    const chosenData = chosen.data as { selected_ni_id: string; idea: { ni_id: string; selected: boolean }; action: string };
    expect(chosenData.selected_ni_id).toBe(ideas[1]!.ni_id);
    expect(chosenData.idea.selected).toBe(true);
    expect(chosenData.action).toBe("selected");

    const state = await inject("GET", `/novel/${ntId}/original_script/state`, undefined, userA);
    const stateData = state.data as { steps: Record<string, { done: boolean }>; selected_ni_id: string };
    expect(stateData.steps.idea!.done).toBe(true);
    expect(stateData.steps.idea_selected!.done).toBe(true);
    expect(stateData.selected_ni_id).toBe(ideas[1]!.ni_id);
  });

  // ══════════════════════════════════════════════════════════════
  // 2. 素材（novel.md:504-573）
  // ══════════════════════════════════════════════════════════════

  it("materials：生成 3 条（标题素材N）→ 列表 → 勾选是加法 → 编辑 → 404/400101", async () => {
    const generated = await inject("POST", `/novel/${ntId}/original_script/materials/generate`, { count: 3 }, userA);
    expect(generated.code).toBe(0);
    const generatedData = generated.data as { list: Array<{ nm_id: string; title: string; content: string; selected: boolean }>; total: number };
    expect(generatedData.total).toBe(3);
    // 竞品表格里素材标题就是「素材1/素材2」（novel.md:541）——照做便于对照
    expect(generatedData.list.map((row) => row.title)).toEqual(["素材1", "素材2", "素材3"]);
    expect(generatedData.list.every((row) => row.selected === false)).toBe(true);

    const listed = await inject("GET", `/novel/${ntId}/original_script/materials`, undefined, userA);
    const listedData = listed.data as { total: number; selected_nm_ids: string[] };
    expect(listedData.total).toBe(3);
    expect(listedData.selected_nm_ids).toEqual([]);

    // 勾选语义 = 加法（竞品 material set 不取消其它已勾选项，novel.md:554）
    const [a, b] = generatedData.list;
    expect(
      (await inject("POST", `/novel/${ntId}/original_script/materials/select-op`, { nm_id: a!.nm_id }, userA)).code,
    ).toBe(0);
    const second = await inject(
      "POST",
      `/novel/${ntId}/original_script/materials/select-op`,
      { nm_id: b!.nm_id },
      userA,
    );
    expect(second.code).toBe(0);
    expect((second.data as { selected_nm_ids: string[] }).selected_nm_ids.sort()).toEqual(
      [a!.nm_id, b!.nm_id].sort(),
    );

    const patched = await inject(
      "PATCH",
      `/novel/${ntId}/original_script/materials/${a!.nm_id}`,
      { content: "人工改写：把遗书内容换成一张名单。", selected: false },
      userA,
    );
    expect(patched.code).toBe(0);
    const patchedMaterial = (patched.data as { material: { content: string; selected: boolean } }).material;
    expect(patchedMaterial.content).toContain("名单");
    expect(patchedMaterial.selected).toBe(false);

    expect(
      (await inject("PATCH", `/novel/${ntId}/original_script/materials/nm_nope`, { content: "x" }, userA)).code,
    ).toBe(ErrorCode.NOT_FOUND);
    // 空 body（没有任何可更新字段）→ 400101
    expect(
      (await inject("PATCH", `/novel/${ntId}/original_script/materials/${a!.nm_id}`, {}, userA)).code,
    ).toBe(ErrorCode.INVALID_PARAM);
    // 勾选不存在的素材 → 404
    expect(
      (await inject("POST", `/novel/${ntId}/original_script/materials/select-op`, { nm_id: "nm_nope" }, userA)).code,
    ).toBe(ErrorCode.NOT_FOUND);
  });

  // ══════════════════════════════════════════════════════════════
  // 3. 总纲及设定（novel.md:575-595）
  // ══════════════════════════════════════════════════════════════

  it("summary_outline：生成（beats≥3）→ 读 → 编辑（含节拍覆盖）", async () => {
    const generated = await inject("POST", `/novel/${ntId}/original_script/summary_outline`, {}, userA);
    expect(generated.code).toBe(0);
    const outline = (generated.data as {
      summary_outline: { title: string; logline: string; theme: string; beats: Array<{ no: number; beat: string; summary: string }>; structure: string };
      llm_mode: string;
      materials_used: number;
    }).summary_outline;
    expect(outline.beats.length).toBeGreaterThanOrEqual(3);
    expect(outline.beats.map((beat) => beat.no)).toEqual(outline.beats.map((_, i) => i + 1));
    expect(outline.logline.length).toBeGreaterThan(0);
    expect(["mock", "real"]).toContain((generated.data as { llm_mode: string }).llm_mode);

    const read = await inject("GET", `/novel/${ntId}/original_script/summary_outline`, undefined, userA);
    expect(read.code).toBe(0);
    expect((read.data as { summary_outline: { title: string } | null }).summary_outline?.title).toBe(outline.title);

    const patched = await inject(
      "PATCH",
      `/novel/${ntId}/original_script/summary_outline`,
      { theme: "人工改主题：名字的重量", beats: outline.beats.slice(0, 3) },
      userA,
    );
    expect(patched.code).toBe(0);
    const patchedOutline = (patched.data as { summary_outline: { theme: string; beats: unknown[] } }).summary_outline;
    expect(patchedOutline.theme).toContain("名字的重量");
    expect(patchedOutline.beats.length).toBe(3);

    // 没总纲的本子上 PATCH → 400101（不是静默创建一份空总纲）
    const other = await createOriginal("空总纲");
    expect(
      (await inject("PATCH", `/novel/${other}/original_script/summary_outline`, { theme: "x" }, userA)).code,
    ).toBe(ErrorCode.INVALID_PARAM);
  });

  // ══════════════════════════════════════════════════════════════
  // 4. 分卡章纲（novel.md:597-617）
  // ══════════════════════════════════════════════════════════════

  it("chapters_outline：由总纲节拍派生（章号对齐）→ 列表 → 单条编辑", async () => {
    const generated = await inject("POST", `/novel/${ntId}/original_script/chapters_outline`, {}, userA);
    expect(generated.code).toBe(0);
    const data = generated.data as {
      list: Array<{ id: string; chapter_no: number; title: string; synopsis: string }>;
      count: number;
      derived_from: string;
    };
    expect(data.count).toBe(3); // 上一步把 beats 改成 3 条
    expect(data.list.map((row) => row.chapter_no)).toEqual([1, 2, 3]);
    expect(data.derived_from).toBe("summary_outline.beats");
    // 节拍名直接成为章纲标题（保证"章纲与总纲永远一致"）
    expect(data.list[0]!.title.length).toBeGreaterThan(0);

    const listed = await inject("GET", `/novel/${ntId}/original_script/chapters_outline`, undefined, userA);
    expect((listed.data as { total: number }).total).toBe(3);

    const patched = await inject(
      "PATCH",
      `/novel/${ntId}/original_script/chapters_outline/${data.list[0]!.id}`,
      { synopsis: "人工改写：第一卡从遗书名单开始。" },
      userA,
    );
    expect(patched.code).toBe(0);
    expect((patched.data as { synopsis: string }).synopsis).toContain("遗书名单");

    // 不存在的 nco_id → 404；空 body → 400101
    expect(
      (await inject("PATCH", `/novel/${ntId}/original_script/chapters_outline/999999999999`, { title: "x" }, userA)).code,
    ).toBe(ErrorCode.NOT_FOUND);
    expect(
      (await inject("PATCH", `/novel/${ntId}/original_script/chapters_outline/${data.list[0]!.id}`, {}, userA)).code,
    ).toBe(ErrorCode.INVALID_PARAM);
  });

  // ══════════════════════════════════════════════════════════════
  // 5. 集纲 → 分集剧本（novel.md:619-661）
  // ══════════════════════════════════════════════════════════════

  it("episodes_outline + episodes：生成 3 集 → 剧本生成 → 编辑产生新版本 → 确认幂等", async () => {
    const outline = await inject(
      "POST",
      `/novel/${ntId}/original_script/episodes_outline`,
      { episode_count: 3 },
      userA,
    );
    expect(outline.code).toBe(0);
    const outlineData = outline.data as { list: Array<{ episode_no: number }>; count: number };
    expect(outlineData.count).toBe(3);
    expect(outlineData.list.map((row) => row.episode_no)).toEqual([1, 2, 3]);

    const listedOutline = await inject("GET", `/novel/${ntId}/original_script/episodes_outline`, undefined, userA);
    expect((listedOutline.data as { total: number }).total).toBe(3);

    const episodes = await inject("POST", `/novel/${ntId}/original_script/episodes`, {}, userA);
    expect(episodes.code).toBe(0);
    const episodesData = episodes.data as {
      list: Array<{ id: string; episode_no: number; script_text: string; version: number; status: number }>;
      count: number;
      missing: number[];
    };
    expect(episodesData.count).toBe(3);
    expect(episodesData.missing).toEqual([]);
    expect(episodesData.list[0]!.version).toBe(1);

    const target = episodesData.list[0]!;
    // 只改标题 → 不产生新版本
    const titleOnly = await inject(
      "PATCH",
      `/novel/${ntId}/original_script/episodes/${target.id}`,
      { title: "第1集 名单" },
      userA,
    );
    expect(titleOnly.code).toBe(0);
    expect((titleOnly.data as { version: number }).version).toBe(1);

    // 改正文 → 新版本（与改编链同一不变式：version == max(version_no)）
    const textPatch = await inject(
      "PATCH",
      `/novel/${ntId}/original_script/episodes/${target.id}`,
      { script_text: `${target.script_text}\n（原创链人工补写：多一场夜里烧名单的戏。）` },
      userA,
    );
    expect(textPatch.code).toBe(0);
    expect((textPatch.data as { version: number }).version).toBe(2);
    expect((textPatch.data as { status: number }).status).toBe(1);

    const confirmed = await inject("POST", `/novel/${ntId}/original_script/episodes/${target.id}/confirm`, {}, userA);
    expect(confirmed.code).toBe(0);
    expect((confirmed.data as { episode: { status: number }; replayed: boolean }).episode.status).toBe(2);
    expect((confirmed.data as { replayed: boolean }).replayed).toBe(false);
    const reconfirmed = await inject("POST", `/novel/${ntId}/original_script/episodes/${target.id}/confirm`, {}, userA);
    expect((reconfirmed.data as { replayed: boolean }).replayed).toBe(true);

    // 不存在的集 → 404
    expect(
      (await inject("PATCH", `/novel/${ntId}/original_script/episodes/999999999999`, { title: "x" }, userA)).code,
    ).toBe(ErrorCode.NOT_FOUND);
  });

  // ══════════════════════════════════════════════════════════════
  // 6. 定稿 → 撤回（reopen）
  // ══════════════════════════════════════════════════════════════

  it("finalize → status 16；reopen → status 1；未定稿再 reopen → 400100", async () => {
    const state = await inject("GET", `/novel/${ntId}/original_script/state`, undefined, userA);
    expect((state.data as { steps: Record<string, { done: boolean }> }).steps.episodes!.done).toBe(true);

    const finalized = await inject("POST", `/novel/${ntId}/original_script/finalize`, { memo: "原创链定稿" }, userA);
    expect(finalized.code).toBe(0);
    const finalizedData = finalized.data as { status: number; novel: { status: number }; snapshot_version_id: string | null };
    expect(finalizedData.status).toBe(16);
    expect(finalizedData.novel.status).toBe(16);
    expect(finalizedData.snapshot_version_id).toBeTruthy();

    // 定稿后写正文被拒（与改编链同一道墙）
    expect((await inject("POST", `/novel/${ntId}/script-generate`, {}, userA)).code).toBe(ErrorCode.BAD_REQUEST);

    const reopened = await inject("POST", `/novel/${ntId}/reopen`, { memo: "客户要改结局" }, userA);
    expect(reopened.code).toBe(0);
    const reopenedData = reopened.data as { status: number; previous_status: number; novel: { status: number }; references: unknown[] };
    expect(reopenedData.status).toBe(1);
    expect(reopenedData.previous_status).toBe(16);
    expect(reopenedData.novel.status).toBe(1);
    expect(reopenedData.references).toEqual([]);

    // 已是草稿再撤回 → 400100（明确"没有可撤回的定稿"，不静默 ok）
    const again = await inject("POST", `/novel/${ntId}/reopen`, {}, userA);
    expect(again.code).toBe(ErrorCode.BAD_REQUEST);
    expect(again.msg.toLowerCase()).toContain("not finalized");

    // 撤回后正文恢复可写（重定稿再撤回一次，验证往返不坏）
    const refinalize = await inject("POST", `/novel/${ntId}/original_script/finalize`, {}, userA);
    expect((refinalize.data as { replayed: boolean }).replayed).toBe(false);
    expect((await inject("POST", `/novel/${ntId}/reopen`, {}, userA)).code).toBe(0);
  });

  it("reopen 被拆集引用时 → 400105 且回显项目（不允许静默退回）", async () => {
    // 造一个走到"有剧本 + 已定稿"的改编本子（原创链与改编链都能定稿，这里用最小的路）
    const created = await inject(
      "POST",
      "/novel",
      { title: `被引用本-${Date.now()}`, source_text: "第一章 名单\n雨夜里，她把名单摊在桌上。" },
      userA,
    );
    refNtId = (created.data as { id: string }).id;
    await inject("POST", `/novel/${refNtId}/episode_outline/generate`, { episode_count: 1 }, userA);
    const scripts = await inject("POST", `/novel/${refNtId}/script-generate`, {}, userA);
    const episode = (scripts.data as { list: Array<{ id: string; script_text: string }> }).list[0]!;
    expect((await inject("POST", `/novel/${refNtId}/finalize`, {}, userA)).code).toBe(0);

    // 直接落一条"已拆集"的制片工坊项目：正文与上面那集完全相同（这正是 split 的产物形状）
    seq += 1;
    const idRow = (await db.execute(
      sql`select (extract(epoch from clock_timestamp())*1000000)::bigint as id`,
    )) as { rows?: Array<{ id: string }> };
    const base = BigInt(idRow.rows?.[0]?.id ?? Date.now()) * 1000n + BigInt(seq);
    const projectId = base;
    createdProjectIds.push(String(projectId));
    await db.execute(sql`
      insert into script_projects (id, space_id, title, drama_type, ratio, source_type, status, is_sample, created_at, updated_at)
      values (${projectId}, ${BigInt(userA.spaceId)}, 'E2E 拆集项目', 1, '9:16', 1, 1, 0, now(), now())
    `);
    await db.execute(sql`
      insert into episodes (id, project_id, ep_no, title, script_text, status, created_at, updated_at)
      values (${base + 1n}, ${projectId}, 1, '第1集', ${episode.script_text}, 1, now(), now())
    `);

    const refused = await inject("POST", `/novel/${refNtId}/reopen`, { memo: "想改" }, userA);
    expect(refused.code).toBe(ErrorCode.ASSET_NOT_READY);
    expect(refused.msg).toContain("split source");

    // details（reason/projects）只在 service 层可见（信封的 data 恒为 null）——
    // 这也是前端只能按 code 出文案的原因；这里直连 service 验内部契约。
    const novelSvc = app.get(NovelService);
    let refusal: unknown;
    try {
      await novelSvc.reopen(userA.spaceId, refNtId, { memo: "想改" });
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(AppError);
    expect((refusal as AppError).code).toBe(ErrorCode.ASSET_NOT_READY);
    const details = (refusal as AppError).details as { reason?: string; projects?: Array<{ project_id: string }> };
    expect(details.reason).toBe("referenced_by_split");
    // 这条项目**没有** source_novel_id（模拟迁移 0026 之前拆出的历史项目）→ 走回落判据
    const viaSnapshot = details.projects?.find((row) => row.project_id === String(projectId)) as
      | { matched_by?: string }
      | undefined;
    expect(viaSnapshot).toBeTruthy();
    expect(viaSnapshot?.matched_by).toBe("text_snapshot");

    // 状态没被改动（拒绝必须是"什么都没发生"）
    const detail = await inject("GET", `/novel/${refNtId}`, undefined, userA);
    expect((detail.data as { novel: { status: number } }).novel.status).toBe(16);
  });

  // ══════════════════════════════════════════════════════════════
  // 6b. reopen 的**精确判据**（迁移 0026：script_projects.source_novel_id）
  // ══════════════════════════════════════════════════════════════

  it("reopen 精确判据：source_novel_id 命中 → 400105（正文被改写也认）；无引用 → 允许 16→1", async () => {
    // —— A. 精确命中：项目记了来源外键，但正文被手工改写（快照比对**认不出来**的形态）
    const created = await inject(
      "POST",
      "/novel",
      { title: `外键引用本-${Date.now()}`, source_text: "第一章 旧信\n那封信在抽屉里放了十年。" },
      userA,
    );
    const fkNtId = (created.data as { id: string }).id;
    await inject("POST", `/novel/${fkNtId}/episode_outline/generate`, { episode_count: 1 }, userA);
    await inject("POST", `/novel/${fkNtId}/script-generate`, {}, userA);
    expect((await inject("POST", `/novel/${fkNtId}/finalize`, {}, userA)).code).toBe(0);

    seq += 1;
    const idRow = (await db.execute(
      sql`select (extract(epoch from clock_timestamp())*1000000)::bigint as id`,
    )) as { rows?: Array<{ id: string }> };
    const base = BigInt(idRow.rows?.[0]?.id ?? Date.now()) * 1000n + BigInt(seq);
    const fkProjectId = base;
    createdProjectIds.push(String(fkProjectId));
    await db.execute(sql`
      insert into script_projects (id, space_id, title, drama_type, ratio, source_type, source_novel_id, status, is_sample, created_at, updated_at)
      values (${fkProjectId}, ${BigInt(userA.spaceId)}, '外键引用项目', 1, '9:16', 1, ${BigInt(fkNtId)}, 1, 0, now(), now())
    `);
    // 刻意写成"被改写过的正文"：如果实现只做快照比对，这里会漏判 → reopen 会错误放行
    await db.execute(sql`
      insert into episodes (id, project_id, ep_no, title, script_text, status, created_at, updated_at)
      values (${base + 1n}, ${fkProjectId}, 1, '第1集（已改写）', '这段正文已经被导演改得面目全非，与剧本工厂里的那一稿完全不同。', 1, now(), now())
    `);

    const novelSvcFk = app.get(NovelService);
    let refused: unknown;
    try {
      await novelSvcFk.reopen(userA.spaceId, fkNtId, { memo: "想改外键引用本" });
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(AppError);
    expect((refused as AppError).code).toBe(ErrorCode.ASSET_NOT_READY);
    const fkDetails = (refused as AppError).details as {
      reason?: string;
      projects?: Array<{ project_id: string; matched_by?: string }>;
    };
    expect(fkDetails.reason).toBe("referenced_by_split");
    const preciseHit = fkDetails.projects?.find((row) => row.project_id === String(fkProjectId));
    expect(preciseHit).toBeTruthy();
    expect(preciseHit?.matched_by).toBe("source_novel_id");
    // HTTP 层同样是 400105，且状态没被改动
    expect((await inject("POST", `/novel/${fkNtId}/reopen`, {}, userA)).code).toBe(ErrorCode.ASSET_NOT_READY);
    expect((await inject("GET", `/novel/${fkNtId}`, undefined, userA)).data as { novel: { status: number } }).toMatchObject({
      novel: { status: 16 },
    });

    // —— B. 无任何引用：允许 16→1（并明确 references 为空）
    const clean = await inject(
      "POST",
      "/novel",
      { title: `无引用本-${Date.now()}`, source_text: "第一章 空屋\n屋里只剩一把椅子。" },
      userA,
    );
    const cleanId = (clean.data as { id: string }).id;
    await inject("POST", `/novel/${cleanId}/episode_outline/generate`, { episode_count: 1 }, userA);
    await inject("POST", `/novel/${cleanId}/script-generate`, {}, userA);
    expect((await inject("POST", `/novel/${cleanId}/finalize`, {}, userA)).code).toBe(0);
    const allowed = await inject("POST", `/novel/${cleanId}/reopen`, {}, userA);
    expect(allowed.code).toBe(0);
    const allowedData = allowed.data as { status: number; previous_status: number; references: unknown[] };
    expect(allowedData.status).toBe(1);
    expect(allowedData.previous_status).toBe(16);
    expect(allowedData.references).toEqual([]);
  });
  // ══════════════════════════════════════════════════════════════
  // 7. 4 条薄路径（裂变链，路径级 1:1）
  // ══════════════════════════════════════════════════════════════

  it("薄路径：fission chapters_outline / idea/:ni_id / characters/:nc_id / episodes_outline/:neo_id", async () => {
    // 裂变需要一个已定稿源本子 —— 复用上面那个 refNtId（它已定稿；被引用不影响裂变）
    const fission = await inject(
      "POST",
      `/novel/${refNtId}/fission_script`,
      { episode_count: 2, direction: "换成女性视角" },
      userA,
    );
    expect(fission.code).toBe(0);
    fissionId = (fission.data as { novel: { id: string } }).novel.id;
    const ideas = (fission.data as { ideas: Array<{ ni_id: string }> }).ideas;

    // idea/:ni_id —— 存在返回详情，不存在 404
    const ideaDetail = await inject("GET", `/novel/${fissionId}/fission_script/idea/${ideas[0]!.ni_id}`, undefined, userA);
    expect(ideaDetail.code).toBe(0);
    expect((ideaDetail.data as { idea: { ni_id: string }; selected: boolean }).idea.ni_id).toBe(ideas[0]!.ni_id);
    expect(
      (await inject("GET", `/novel/${fissionId}/fission_script/idea/ni_nope`, undefined, userA)).code,
    ).toBe(ErrorCode.NOT_FOUND);

    // chapters_outline：还没有总纲时是空投影（明确 hint，不给假 id）
    const emptyChapters = await inject("GET", `/novel/${fissionId}/fission_script/chapters_outline`, undefined, userA);
    expect(emptyChapters.code).toBe(0);
    const emptyData = emptyChapters.data as { total: number; derived_from: string; hint: string };
    expect(emptyData.total).toBe(0);
    expect(emptyData.derived_from).toBe("meta.fission.summary_outline.beats");
    expect(emptyData.hint.length).toBeGreaterThan(0);

    // 选方案 + 生成总纲 → 薄路径返回由节拍派生的只读投影
    await inject("POST", `/novel/${fissionId}/fission_script/idea/select-op`, { ni_id: ideas[0]!.ni_id }, userA);
    await inject("POST", `/novel/${fissionId}/fission_script/summary_outline`, {}, userA);
    const chapters = await inject("GET", `/novel/${fissionId}/fission_script/chapters_outline`, undefined, userA);
    expect(chapters.code).toBe(0);
    const chaptersData = chapters.data as {
      list: Array<{ id: string | null; chapter_no: number; readonly?: boolean }>;
      total: number;
      derived_from: string;
    };
    expect(chaptersData.total).toBeGreaterThan(0);
    expect(chaptersData.derived_from).toBe("meta.fission.summary_outline.beats");
    expect(chaptersData.list.every((row) => row.id === null && row.readonly === true)).toBe(true);

    // characters/:nc_id：先生成角色，再取单个
    const chars = await inject("POST", `/novel/${fissionId}/fission_script/characters`, { count: 2 }, userA);
    expect(chars.code).toBe(0);
    const charList = (chars.data as { characters: Array<{ id: string }> }).characters;
    const one = await inject(
      "GET",
      `/novel/${fissionId}/fission_script/characters/${charList[0]!.id}`,
      undefined,
      userA,
    );
    expect(one.code).toBe(0);
    expect((one.data as { character: { id: string } }).character.id).toBe(charList[0]!.id);
    expect(
      (await inject("GET", `/novel/${fissionId}/fission_script/characters/999999999999`, undefined, userA)).code,
    ).toBe(ErrorCode.NOT_FOUND);
    expect(
      (await inject("GET", `/novel/${fissionId}/fission_script/characters/not-a-number`, undefined, userA)).code,
    ).toBe(ErrorCode.INVALID_PARAM);

    // episodes_outline/:neo_id：GET 详情 + PATCH 编辑 + 不存在 404
    const outline = await inject(
      "POST",
      `/novel/${fissionId}/fission_script/episodes_outline`,
      { episode_count: 2 },
      userA,
    );
    expect(outline.code).toBe(0);
    const neoId = (outline.data as { list: Array<{ id: string }> }).list[0]!.id;
    const neoDetail = await inject(
      "GET",
      `/novel/${fissionId}/fission_script/episodes_outline/${neoId}`,
      undefined,
      userA,
    );
    expect(neoDetail.code).toBe(0);
    expect((neoDetail.data as { episode_outline: { id: string } }).episode_outline.id).toBe(neoId);
    const neoPatched = await inject(
      "PATCH",
      `/novel/${fissionId}/fission_script/episodes_outline/${neoId}`,
      { synopsis: "薄路径编辑：第一集结尾改成留白。" },
      userA,
    );
    expect(neoPatched.code).toBe(0);
    expect((neoPatched.data as { synopsis: string }).synopsis).toContain("留白");
    expect(
      (await inject(
        "GET",
        `/novel/${fissionId}/fission_script/episodes_outline/999999999999`,
        undefined,
        userA,
      )).code,
    ).toBe(ErrorCode.NOT_FOUND);
  });

  // ══════════════════════════════════════════════════════════════
  // 8. Redis 轮次锁（多副本语义）
  // ══════════════════════════════════════════════════════════════

  it("轮次锁在 Redis：别的副本持锁时 chat → 746005；释放后立刻可继续", async () => {
    const novelId = await createOriginal("锁测试");
    await inject("POST", `/novel/${novelId}/original_script/idea`, { count: 1 }, userA);
    const ideas = (await inject("GET", `/novel/${novelId}/original_script/idea`, undefined, userA)).data as {
      list: Array<{ ni_id: string }>;
    };
    await inject(
      "POST",
      `/novel/${novelId}/original_script/idea/select-op`,
      { ni_id: ideas.list[0]!.ni_id },
      userA,
    );
    await inject("POST", `/novel/${novelId}/original_script/summary_outline`, {}, userA);
    await inject("POST", `/novel/${novelId}/original_script/episodes_outline`, { episode_count: 1 }, userA);
    await inject("POST", `/novel/${novelId}/original_script/episodes`, {}, userA);

    const entered = await inject("POST", `/novel/${novelId}/script_edit_agent/enter`, {}, userA);
    expect(entered.code).toBe(0);
    lockSession = (entered.data as { session: { id: string } }).session.id;

    const redis = app.get(RedisService);
    const lockKey = `novel:agent:turn:${lockSession}`;

    // 用另一个"副本"占住锁：这条断言只有锁在 Redis 里才可能通过（进程内 Set 看不见）
    const acquiredElsewhere = await redis.setNx(lockKey, "other-replica", 60);
    expect(acquiredElsewhere).toBe(true);

    const blocked = await inject(
      "POST",
      `/novel/${novelId}/script_edit_agent/sessions/${lockSession}/chat`,
      { content: "把第 1 集结尾改成开放式" },
      userA,
    );
    expect(blocked.code).toBe(ErrorCode.AGENT_TURN_IN_FLIGHT);

    // 释放别人的锁（模拟那一轮结束）后，同一会话立刻可以继续
    await redis.del(lockKey);
    const ok = await inject(
      "POST",
      `/novel/${novelId}/script_edit_agent/sessions/${lockSession}/chat`,
      { content: "把第 1 集结尾改成开放式" },
      userA,
    );
    expect(ok.code).toBe(0);
    expect((ok.data as { pending: unknown[] }).pending.length).toBeGreaterThan(0);
    // 正常一轮结束后锁必须被释放（否则用户 60s 内无法再发）
    expect(await redis.get(lockKey)).toBeNull();

    // 轮次进行中锁必须**在 Redis 里可见**、结束后被释放 —— 这是跨副本互斥的事实依据。
    //
    // 这里刻意不再写"两轮 Promise.all 恰好一成一败"：mock LLM + 本地 PG 太快，
    // 两轮的 await 可能刚好错开（第一轮已释放后才轮到第二条 setNx），断言会偶发假红。
    // "两轮并发 → 恰好一成一败"的心智模型由 `test/novel.spec.ts` 覆盖（那里同样断言 746005），
    // 本用例负责证明互斥的**载体是 Redis**：先起一轮 → 轮询到锁 → 结束 → 锁消失。
    const agentSvc = app.get(NovelAgentService);
    const turn = agentSvc.chat(userA.spaceId, novelId, lockSession, { content: "锁可见性验证" });
    let observed: string | null = null;
    for (let i = 0; i < 300 && observed === null; i += 1) {
      observed = await redis.get(lockKey);
      if (observed === null) await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(observed).not.toBeNull();
    // 锁值必须带持有者 token（不是常量），否则"A 的 finally 删掉 B 的锁"无法防护
    expect(observed).toMatch(new RegExp(`^${process.pid}-`));
    await turn;
    expect(await redis.get(lockKey)).toBeNull();
  });

  // ══════════════════════════════════════════════════════════════
  // 9. 权限（跨 space 一律 403）
  // ══════════════════════════════════════════════════════════════

  it("跨 space 403：原创链/薄路径/reopen 都不能越权", async () => {
    expect((await inject("GET", `/novel/${ntId}/original_script/state`, undefined, userB)).code).toBe(ErrorCode.FORBIDDEN);
    expect(
      (await inject("POST", `/novel/${ntId}/original_script/idea`, { count: 1 }, userB)).code,
    ).toBe(ErrorCode.FORBIDDEN);
    expect(
      (await inject("POST", `/novel/${ntId}/original_script/summary_outline`, {}, userB)).code,
    ).toBe(ErrorCode.FORBIDDEN);
    expect((await inject("POST", `/novel/${ntId}/reopen`, {}, userB)).code).toBe(ErrorCode.FORBIDDEN);
    expect(
      (await inject("GET", `/novel/${fissionId}/fission_script/idea/ni_x`, undefined, userB)).code,
    ).toBe(ErrorCode.FORBIDDEN);
    expect(
      (await inject("GET", `/novel/${refNtId}/fission_script/chapters_outline`, undefined, userB)).code,
    ).toBe(ErrorCode.FORBIDDEN);
  });
});

