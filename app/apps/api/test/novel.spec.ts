import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { sql } from "drizzle-orm";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { db, pool } from "../src/db/database";
import { NovelAgentService } from "../src/modules/novel/novel-agent.service";
import { NovelService } from "../src/modules/novel/novel.service";
import { AppError, ErrorCode } from "@app/shared";

/**
 * 小说改编链（`/v1/novel/*`）契约测试。
 *
 * 覆盖口径（对应 task-2 的子链 1→10）：
 *   分章 → 内容分析（世界观/角色卡）→ 章节大纲 → 分集大纲 → 核心角色
 *   → 分集剧本 → **剧本编辑 Agent（逐集 diff）** → 定稿 → 裂变 → 海外 → 拆集契约
 *
 * 断言重点（为什么这么断言，而不是复述代码）：
 *
 * 1. **确定性**：无 LLM Key 时全部走 mock，同一输入必须得到同一输出。
 *    所以多处断言"重跑一次结果不变"——这既验证 mock 的确定性，也验证 upsert 的幂等性。
 * 2. **幂等/重放**：创建同名 → 400100；重复 apply → 746002（而不是再写一遍正文）；
 *    重复 finalize/confirm/enter → `replayed: true` 且不产生第二份数据。
 * 3. **逐集 diff 是产品核心**：pending 必须同时给出 original_text / proposed_text /
 *    change_summary，且 reject 后 `novel_episodes.script_text` **一个字节都不变**。
 * 4. **状态机边界**：定稿（16）后写正文必须被拒；跨 space 一律 403；
 *    同一会话并发 chat 必须 746005（不能两个都成功、也不能静默丢一个）。
 */

const SOURCE_TEXT = [
  "第一章 雨夜来客",
  "",
  "雨下了一整夜。林晚站在巷口，手里攥着一张泛黄的当票。",
  "她知道自己不该来，但那张当票上的字迹是父亲的。",
  "",
  "第二章 旧账",
  "",
  "顾沉把账本推过来的时候，苏禾已经在门口站了十分钟。",
  "三个人谁也没有先开口，只有雨水敲在铁皮棚上。",
  "",
  "第三章 关隘之外",
  "",
  "天亮之后，他们把车开上了旧公路。",
  "关隘的轮廓出现在地平线上，像一个没有答案的问题。",
].join("\n");

describe("novel e2e", () => {
  let app: NestFastifyApplication;
  let seq = 0;
  /** 本文件创建的 space，afterAll 按 FK 依赖倒序清理 */
  const createdSpaceIds: string[] = [];

  interface Session {
    token: string;
    spaceId: string;
    userId: string;
  }

  let userA: Session;
  let userB: Session;
  /** 主链本子（会被定稿） */
  let novelA = "";
  /** 编辑 Agent / 裂变用的未定稿本子 */
  let novelA2 = "";
  let novelBSession = "";

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
      body,
      data: (body as { data?: never }).data,
    };
  };

  async function loginNewUser(prefix: string): Promise<Session> {
    const tail = String(Date.now()).slice(-7);
    const tag = String(prefix).replace(/\D/g, "").slice(-2).padStart(2, "0");
    // 11 位手机号 = 1 + 7 位时间戳 + 2 位标签 + 1 位序号；
    // 序号必须保留，否则同一毫秒内连续登录会落到同一个手机号（拿到同一个用户）
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

  /** 取某会话当前全部未决 diff（走 GET sessions/:sid，顺带验证该端点返回的 pending 与 chat 一致） */
  async function pendingOf(sid: string) {
    const res = await inject("GET", `/novel/${novelA2}/script_edit_agent/sessions/${sid}`, undefined, userA);
    expect(res.code).toBe(0);
    return (
      res.data as {
        pending: Array<{
          id: string;
          episode_id: string;
          episode_no: number;
          original_text: string;
          proposed_text: string;
          change_summary: string;
          status: number;
        }>;
      }
    ).pending;
  }

  beforeAll(async () => {    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: true }), {
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
    // 按 FK 依赖倒序清理（schema 里没有 onDelete cascade，顺序错了会直接报外键冲突）
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
  // 1. 创建 / 列表 / 详情 / 校验
  // ══════════════════════════════════════════════════════════════

  it("创建本子：粘贴即分章；空 title 400101；同名 400100（竞品 748201 语义）", async () => {
    userA = await loginNewUser("71");
    userB = await loginNewUser("72");
    expect(userA.token).not.toBe("");
    expect(userB.spaceId).not.toBe(userA.spaceId);

    const created = await inject(
      "POST",
      "/novel",
      { title: `雨夜当票-${Date.now()}`, source_text: SOURCE_TEXT, ratio: "9:16" },
      userA,
    );
    expect(created.code).toBe(0);
    const novel = created.data as {
      id: string;
      title: string;
      status: number;
      source_type: number;
      ratio: string;
      chapter_count: number;
    };
    novelA = novel.id;
    expect(novel.status).toBe(1);
    expect(novel.source_type).toBe(1);
    expect(novel.ratio).toBe("9:16");
    // 三处「第N章」标题 → 三章（切章是规则任务，不交给 LLM，见 service.splitChapters 注释）
    expect(novel.chapter_count).toBe(3);

    // 同名冲突：竞品返回 748201；我方不新造码，用 400100 + reason=duplicate_title
    const dup = await inject("POST", "/novel", { title: novel.title, source_text: "" }, userA);
    expect(dup.code).toBe(ErrorCode.BAD_REQUEST);
    expect((dup.msg || "").toLowerCase()).toContain("already exists");

    // 参数校验：title 为空 → 400101（zod min(1) 直接拦在控制器）
    const bad = await inject("POST", "/novel", { title: "   " }, userA);
    expect(bad.code).toBe(ErrorCode.INVALID_PARAM);
  });

  it("列表：默认只返回未归档本子，q 按标题字面量过滤，分页字段完整", async () => {
    const listed = await inject("GET", "/novel/list?page=1&page_size=10", undefined, userA);
    expect(listed.code).toBe(0);
    const data = listed.data as { list: Array<{ id: string; title: string }>; total: number; page: number; page_size: number };
    expect(data.total).toBeGreaterThanOrEqual(1);
    expect(data.list.some((row) => row.id === novelA)).toBe(true);
    expect(data.page).toBe(1);
    expect(data.page_size).toBe(10);

    const searched = await inject("GET", `/novel/list?q=${encodeURIComponent("雨夜当票")}`, undefined, userA);
    const searchedData = searched.data as { list: Array<{ id: string }> };
    expect(searchedData.list.some((row) => row.id === novelA)).toBe(true);

    // 非法 page_size 必须被拒（100 上限），而不是"静默按默认值返回"
    const badPage = await inject("GET", "/novel/list?page_size=1000", undefined, userA);
    expect(badPage.code).toBe(ErrorCode.INVALID_PARAM);
  });

  it("详情 / 章节列表（不含正文）/ 单章正文", async () => {
    const detail = await inject("GET", `/novel/${novelA}`, undefined, userA);
    expect(detail.code).toBe(0);
    const data = detail.data as {
      novel: { id: string; title: string; archived_at: string | null };
      counts: { chapters: number };
      llm_mode: string;
    };
    expect(data.novel.id).toBe(novelA);
    expect(data.counts.chapters).toBe(3);
    // 无 Key 时必须走 mock（本批"CI 可跑"的判据）
    expect(["mock", "real"]).toContain(data.llm_mode);

    const chapters = await inject("GET", `/novel/${novelA}/chapters`, undefined, userA);
    expect(chapters.code).toBe(0);
    const chapterList = chapters.data as { list: Array<{ id: string; chapter_no: number; word_count: number; content?: string }>; total: number };
    expect(chapterList.total).toBe(3);
    expect(chapterList.list.map((row) => row.chapter_no)).toEqual([1, 2, 3]);
    // 列表不带正文：列表页拉全书正文是列表变慢的经典原因
    expect(chapterList.list[0]!.content).toBeUndefined();
    expect(chapterList.list[0]!.word_count).toBeGreaterThan(0);

    const chapter = await inject("GET", `/novel/${novelA}/chapters/1`, undefined, userA);
    expect(chapter.code).toBe(0);
    const chapterData = chapter.data as { chapter_no: number; content: string; title: string };
    expect(chapterData.chapter_no).toBe(1);
    expect(chapterData.content).toContain("当票");
    expect(chapterData.title).toContain("第一章");

    // 不存在的章号 → 400102；非法章号 → 400101
    expect((await inject("GET", `/novel/${novelA}/chapters/99`, undefined, userA)).code).toBe(ErrorCode.NOT_FOUND);
    expect((await inject("GET", `/novel/${novelA}/chapters/0`, undefined, userA)).code).toBe(ErrorCode.INVALID_PARAM);
  });

  it("重新分章：显式章数覆盖标题切分；重复调用 id 稳定（upsert 而非全删重建）", async () => {
    const first = await inject("POST", `/novel/${novelA}/split`, { chapter_count: 2 }, userA);
    expect(first.code).toBe(0);
    const firstData = first.data as { count: number; list: Array<{ id: string; chapter_no: number }> };
    expect(firstData.count).toBe(2);

    const second = await inject("POST", `/novel/${novelA}/split`, { chapter_count: 2 }, userA);
    const secondData = second.data as { count: number; list: Array<{ id: string; chapter_no: number }> };
    expect(secondData.count).toBe(2);
    // 幂等：同一批章号复用同一行 —— 前端正打开着 chapter 详情时不会因为"点了两次分章"而 404
    expect(secondData.list.map((row) => row.id)).toEqual(firstData.list.map((row) => row.id));

    // 恢复成 3 章（后续步骤按 3 章断言章纲条数）
    const restored = await inject("POST", `/novel/${novelA}/split`, {}, userA);
    expect((restored.data as { count: number }).count).toBe(3);
  });

  // ══════════════════════════════════════════════════════════════
  // 2. 内容分析：世界观 + 角色卡
  // ══════════════════════════════════════════════════════════════

  it("内容分析：世界观字段完整、关系边不自指；重复分析不产生重复角色卡", async () => {
    const analyzed = await inject("POST", `/novel/${novelA}/content-analysis`, { character_count: 4 }, userA);
    expect(analyzed.code).toBe(0);
    const data = analyzed.data as {
      worldview: { id: string; era: string; geography: string; factions: unknown[]; rules: unknown[]; relations: Array<{ from: string; to: string }>; summary: string };
      characters: Array<{ id: string; name: string; role_type: number; is_core: boolean }>;
    };
    expect(data.worldview.era.length).toBeGreaterThan(0);
    expect(data.worldview.geography.length).toBeGreaterThan(0);
    expect(data.worldview.factions.length).toBeGreaterThan(0);
    expect(data.worldview.rules.length).toBeGreaterThan(0);
    expect(data.worldview.relations.length).toBeGreaterThan(0);
    // 自指关系会让关系图渲染出环，属于模型高频幻觉，schema refine 已拦
    for (const relation of data.worldview.relations) expect(relation.from).not.toBe(relation.to);
    expect(data.characters.length).toBe(4);
    const firstNames = data.characters.map((row) => row.name).sort();

    const again = await inject("POST", `/novel/${novelA}/content-analysis`, { character_count: 4 }, userA);
    expect(again.code).toBe(0);
    const againData = again.data as { characters: Array<{ id: string; name: string }> };
    // 同名合并：重跑不会变成 8 张卡（这是最容易被当成"生成质量差"的静默缺陷）
    expect(againData.characters.length).toBe(4);
    expect(againData.characters.map((row) => row.name).sort()).toEqual(firstNames);

    const detail = await inject("GET", `/novel/${novelA}/content-analysis/detail`, undefined, userA);
    expect(detail.code).toBe(0);
    const detailData = detail.data as { worldview: { id: string } | null; characters: unknown[]; counts: { characters: number } };
    expect(detailData.worldview).not.toBeNull();
    expect(detailData.characters.length).toBe(4);
    expect(detailData.counts.characters).toBe(4);
  });

  it("世界观 GET/PUT：写入后结构可读回；空世界观返回 null 而不是 404", async () => {
    const got = await inject("GET", `/novel/${novelA}/content-analysis/worldview`, undefined, userA);
    expect(got.code).toBe(0);
    expect((got.data as { worldview: unknown }).worldview).not.toBeNull();

    const put = await inject(
      "PUT",
      `/novel/${novelA}/content-analysis/worldview`,
      {
        era: "民国上海（人工修订）",
        geography: "弄堂与码头并存",
        factions: [{ name: "清源会", description: "掌握批文" }],
        rules: ["禁械斗"],
        relations: [{ from: "林晚", to: "顾沉", kind: "同盟", note: "互相利用" }],
        summary: "人工改写后的世界观总述。",
      },
      userA,
    );
    expect(put.code).toBe(0);
    const putData = put.data as { worldview: { era: string; summary: string } };
    expect(putData.worldview.era).toBe("民国上海（人工修订）");
    expect(putData.worldview.summary).toBe("人工改写后的世界观总述。");

    // 覆盖写不是新增行：再读一次仍是修订后的值
    const reread = await inject("GET", `/novel/${novelA}/content-analysis/worldview`, undefined, userA);
    expect((reread.data as { worldview: { era: string } }).worldview.era).toBe("民国上海（人工修订）");
  });

  it("角色卡：新建同名即覆盖（replayed）；PATCH/DELETE；重生成；批量 confirm 跳过同名", async () => {
    const created = await inject(
      "POST",
      `/novel/${novelA}/content-analysis/novel_character_cards`,
      { name: "程九", role_type: 3, description: "反派", appearance: "旧呢帽", personality: "多疑", prompt: "反派肖像" },
      userA,
    );
    expect(created.code).toBe(0);
    const card = created.data as { character: { id: string; name: string }; replayed: boolean };
    expect(card.replayed).toBe(false);

    const replayed = await inject(
      "POST",
      `/novel/${novelA}/content-analysis/novel_character_cards`,
      { name: "程九", role_type: 3, description: "反派（改）" },
      userA,
    );
    expect(replayed.code).toBe(0);
    const replayedData = replayed.data as { character: { id: string; description: string }; replayed: boolean };
    // 同名即覆盖 → 幂等：同一次请求重放不会多出一张卡
    expect(replayedData.replayed).toBe(true);
    expect(replayedData.character.id).toBe(card.character.id);
    expect(replayedData.character.description).toBe("反派（改）");

    const patched = await inject(
      "PATCH",
      `/novel/${novelA}/content-analysis/novel_character_cards/${card.character.id}`,
      { personality: "多疑但守信", is_core: true },
      userA,
    );
    expect(patched.code).toBe(0);
    expect((patched.data as { personality: string }).personality).toBe("多疑但守信");

    // 重生成：避开已有名字
    const regenerated = await inject(
      "POST",
      `/novel/${novelA}/content-analysis/novel_character_cards/generate`,
      { count: 2 },
      userA,
    );
    expect(regenerated.code).toBe(0);
    expect((regenerated.data as { characters: unknown[] }).characters.length).toBe(2);

    const confirmed = await inject(
      "POST",
      `/novel/${novelA}/content-analysis/novel_character_cards/confirm`,
      {
        characters: [
          { name: "程九", role_type: 3, description: "不应覆盖", appearance: "x", personality: "x", prompt: "x", is_core: false },
          // 名字刻意不取自 mock 候选池，保证"新增 1 张"这条断言不会因为生成器恰好用过该名而翻车
          { name: "测试新人", role_type: 2, description: "新增配角", appearance: "长发", personality: "冷静", prompt: "配角肖像", is_core: false },
        ],
        overwrite: false,
      },
      userA,
    );
    expect(confirmed.code).toBe(0);
    const confirmedData = confirmed.data as { created: number; updated: number; skipped: number };
    // overwrite=false 时同名跳过：避免把用户手改过的卡冲掉
    expect(confirmedData.skipped).toBe(1);
    expect(confirmedData.created).toBe(1);
    expect(confirmedData.updated).toBe(0);

    const deleted = await inject(
      "DELETE",
      `/novel/${novelA}/content-analysis/novel_character_cards/${card.character.id}`,
      undefined,
      userA,
    );
    expect(deleted.code).toBe(0);
    expect((deleted.data as { ok: boolean }).ok).toBe(true);
  });

  // ══════════════════════════════════════════════════════════════
  // 3. 章节大纲 / 分集大纲 / 核心角色
  // ══════════════════════════════════════════════════════════════

  it("章节大纲：生成条数=章数且从 1 递增；单条编辑；整体替换会删掉多余章号", async () => {
    const generated = await inject("POST", `/novel/${novelA}/chapter_outline/generate`, {}, userA);
    expect(generated.code).toBe(0);
    const generatedData = generated.data as { list: Array<{ id: string; chapter_no: number }>; count: number };
    expect(generatedData.count).toBe(3);
    expect(generatedData.list.map((row) => row.chapter_no)).toEqual([1, 2, 3]);

    const listed = await inject("GET", `/novel/${novelA}/chapter_outline/list`, undefined, userA);
    expect((listed.data as { total: number }).total).toBe(3);

    const ncoId = generatedData.list[0]!.id;
    const patched = await inject(
      "PATCH",
      `/novel/${novelA}/chapter_outline/${ncoId}`,
      { title: "第一章 雨夜来客（修订）" },
      userA,
    );
    expect(patched.code).toBe(0);
    expect((patched.data as { title: string }).title).toContain("修订");

    const replaced = await inject(
      "POST",
      `/novel/${novelA}/chapter_outline`,
      {
        chapters: [
          { chapter_no: 1, title: "只留两章 A", synopsis: "梗概 A" },
          { chapter_no: 2, title: "只留两章 B", synopsis: "梗概 B" },
        ],
      },
      userA,
    );
    expect(replaced.code).toBe(0);
    expect((replaced.data as { count: number }).count).toBe(2);

    // 恢复 3 章（分集大纲按 3 章映射更自然）
    const restored = await inject("POST", `/novel/${novelA}/chapter_outline/generate`, {}, userA);
    expect((restored.data as { count: number }).count).toBe(3);
  });

  it("分集大纲：按指定集数生成；单条编辑；整体替换；回写 novel.episode_count", async () => {
    const generated = await inject(
      "POST",
      `/novel/${novelA}/episode_outline/generate`,
      { episode_count: 3 },
      userA,
    );
    expect(generated.code).toBe(0);
    const data = generated.data as { list: Array<{ id: string; episode_no: number; synopsis: string }>; count: number };
    expect(data.count).toBe(3);
    expect(data.list.map((row) => row.episode_no)).toEqual([1, 2, 3]);
    // 大纲里点明覆盖了哪几章，便于人工核对是否漏章
    expect(data.list[0]!.synopsis).toContain("覆盖第");

    const neoId = data.list[1]!.id;
    const patched = await inject(
      "PATCH",
      `/novel/${novelA}/episode_outline/${neoId}`,
      { synopsis: "人工改写：第二集改为悲剧结局。" },
      userA,
    );
    expect(patched.code).toBe(0);
    expect((patched.data as { synopsis: string }).synopsis).toContain("悲剧结局");

    const listed = await inject("GET", `/novel/${novelA}/episode_outline/list`, undefined, userA);
    expect((listed.data as { total: number }).total).toBe(3);

    const replaced = await inject(
      "POST",
      `/novel/${novelA}/episode_outline`,
      {
        episodes: [
          { episode_no: 1, title: "第1集 入局", synopsis: "开局" },
          { episode_no: 2, title: "第2集 试探", synopsis: "中段" },
        ],
      },
      userA,
    );
    expect(replaced.code).toBe(0);
    expect((replaced.data as { count: number }).count).toBe(2);

    const detail = await inject("GET", `/novel/${novelA}`, undefined, userA);
    expect((detail.data as { novel: { episode_count: number } }).novel.episode_count).toBe(2);

    // 恢复成 3 集（后续"只生成前两集并回显缺失第 3 集"依赖 3 集大纲）
    const restored = await inject("POST", `/novel/${novelA}/episode_outline/generate`, { episode_count: 3 }, userA);
    expect((restored.data as { count: number }).count).toBe(3);
  });

  it("核心角色：生成即标记 is_core，列表只返回核心；新建/编辑走角色卡同一批行", async () => {
    const generated = await inject("POST", `/novel/${novelA}/core_character/generate`, { count: 2 }, userA);
    expect(generated.code).toBe(0);
    const data = generated.data as { list: Array<{ id: string; is_core: boolean; role_type: number }>; count: number };
    expect(data.count).toBeGreaterThanOrEqual(2);
    expect(data.list.every((row) => row.is_core)).toBe(true);
    // 排序按 role_type：主角（1）在前
    expect(data.list[0]!.role_type).toBeLessThanOrEqual(data.list[1]!.role_type);

    const listed = await inject("GET", `/novel/${novelA}/core_character/list`, undefined, userA);
    const listedData = listed.data as { total: number };
    expect(listedData.total).toBeGreaterThanOrEqual(2);

    const created = await inject(
      "POST",
      `/novel/${novelA}/core_character`,
      { name: "沈川", role_type: 1, description: "新增主角", prompt: "主角肖像" },
      userA,
    );
    expect(created.code).toBe(0);
    const createdCard = created.data as { character: { id: string; is_core: boolean } };
    // 走 core_character 建卡必须自动 is_core=true，否则"核心角色列表"与实际不符
    expect(createdCard.character.is_core).toBe(true);

    const patched = await inject(
      "PATCH",
      `/novel/${novelA}/core_character/${createdCard.character.id}`,
      { prompt: "主角肖像（暖光）" },
      userA,
    );
    expect(patched.code).toBe(0);
    expect((patched.data as { prompt: string }).prompt).toContain("暖光");
  });

  // ══════════════════════════════════════════════════════════════
  // 4. 分集剧本
  // ══════════════════════════════════════════════════════════════

  it("剧本生成：只生成指定集并回显缺失集；单集详情/编辑产生新版本/确认幂等", async () => {
    const generated = await inject("POST", `/novel/${novelA}/script-generate`, { episode_nos: [1, 2] }, userA);
    expect(generated.code).toBe(0);
    const data = generated.data as {
      list: Array<{ id: string; episode_no: number; script_text: string; version: number; status: number }>;
      count: number;
      missing: number[];
    };
    expect(data.count).toBe(2);
    expect(data.list.map((row) => row.episode_no)).toEqual([1, 2]);
    expect(data.list[0]!.script_text).toContain("场景");
    expect(data.list[0]!.version).toBe(1);
    // 指定集号生成时，未生成的集必须显式回显，避免前端以为整本好了
    expect(data.missing).toEqual([3]);

    const listed = await inject("GET", `/novel/${novelA}/episode/list`, undefined, userA);
    const listedData = listed.data as { list: Array<{ episode_no: number; chars: number; script_text?: string }>; total: number };
    expect(listedData.total).toBe(2);
    expect(listedData.list[0]!.script_text).toBeUndefined();
    expect(listedData.list[0]!.chars).toBeGreaterThan(0);

    const episodeId = data.list[0]!.id;
    const got = await inject("GET", `/novel/${novelA}/episode/${episodeId}`, undefined, userA);
    expect(got.code).toBe(0);
    const before = (got.data as { script_text: string; version: number }).script_text;

    // 只改标题不产生版本
    const titlePatch = await inject("PATCH", `/novel/${novelA}/episode/${episodeId}`, { title: "第1集 改名" }, userA);
    expect(titlePatch.code).toBe(0);
    expect((titlePatch.data as { version: number }).version).toBe(1);

    // 改正文 → 新版本（人工编辑同样要留痕，否则"回滚上一稿"无处可取）
    const textPatch = await inject(
      "PATCH",
      `/novel/${novelA}/episode/${episodeId}`,
      { script_text: `${before}\n（人工补写一场）` },
      userA,
    );
    expect(textPatch.code).toBe(0);
    const textPatched = textPatch.data as { version: number; status: number };
    expect(textPatched.version).toBe(2);
    // 被改动后回落草稿态（1），需要重新确认
    expect(textPatched.status).toBe(1);

    const confirmed = await inject("POST", `/novel/${novelA}/episode/${episodeId}/confirm`, {}, userA);
    expect(confirmed.code).toBe(0);
    expect((confirmed.data as { episode: { status: number }; replayed: boolean }).episode.status).toBe(2);
    expect((confirmed.data as { replayed: boolean }).replayed).toBe(false);

    const reconfirmed = await inject("POST", `/novel/${novelA}/episode/${episodeId}/confirm`, {}, userA);
    expect((reconfirmed.data as { replayed: boolean }).replayed).toBe(true);

    // 不存在的集号生成 → 400101 + unknown（客户端与服务端大纲不同步必须暴露）
    const unknownEpisode = await inject("POST", `/novel/${novelA}/script-generate`, { episode_nos: [9] }, userA);
    expect(unknownEpisode.code).toBe(ErrorCode.INVALID_PARAM);

    // 空数组违反 min(1) → 400101
    const emptyList = await inject("POST", `/novel/${novelA}/script-generate`, { episode_nos: [] }, userA);
    expect(emptyList.code).toBe(ErrorCode.INVALID_PARAM);
  });

  it("补生成第 3 集后 → 汇总步进器全部 done；定稿 status=16 并生成整本快照", async () => {
    const third = await inject("POST", `/novel/${novelA}/script-generate`, { episode_nos: [3] }, userA);
    expect(third.code).toBe(0);
    expect((third.data as { count: number }).count).toBe(1);

    const summary = await inject("GET", `/novel/${novelA}/summary`, undefined, userA);
    expect(summary.code).toBe(0);
    const summaryData = summary.data as {
      steps: Record<string, { done: boolean }>;
      finalized: boolean;
      counts: { chapters: number; episodes: number; episode_outlines: number };
    };
    expect(summaryData.finalized).toBe(false);
    expect(summaryData.steps.split!.done).toBe(true);
    expect(summaryData.steps.content_analysis!.done).toBe(true);
    expect(summaryData.steps.chapter_outline!.done).toBe(true);
    expect(summaryData.steps.episode_outline!.done).toBe(true);
    expect(summaryData.steps.script!.done).toBe(true);
    expect(summaryData.steps.finalize!.done).toBe(false);

    const finalized = await inject("POST", `/novel/${novelA}/finalize`, { memo: "第一版定稿" }, userA);
    expect(finalized.code).toBe(0);
    const finalizedData = finalized.data as {
      status: number;
      replayed: boolean;
      snapshot_version_id: string | null;
      novel: { status: number };
    };
    expect(finalizedData.status).toBe(16);
    expect(finalizedData.novel.status).toBe(16);
    expect(finalizedData.replayed).toBe(false);
    expect(finalizedData.snapshot_version_id).toBeTruthy();

    // 重复定稿幂等：不再造一份整本快照
    const replay = await inject("POST", `/novel/${novelA}/finalize`, {}, userA);
    expect(replay.code).toBe(0);
    expect((replay.data as { replayed: boolean }).replayed).toBe(true);

    const versions = await inject("GET", `/novel/${novelA}/version/list?page_size=50`, undefined, userA);
    expect(versions.code).toBe(0);
    const versionData = versions.data as { list: Array<{ episode_id: string | null; version_no: number; finalized_at: string | null }>; total: number };
    // 3 集 + 每集定稿快照 3 条 + 1 条整本快照 ≥ 7；整本快照 episode_id 为 null
    expect(versionData.total).toBeGreaterThanOrEqual(7);
    expect(versionData.list.some((row) => row.episode_id === null && row.finalized_at !== null)).toBe(true);
  });

  it("定稿后写正文一律被拒（分章/剧本生成/单集编辑/世界观），但读与版本操作仍可用", async () => {
    // 定稿 = 正文冻结。若允许继续改，已按本子拆出去的剧集会与本子对不上（§3.3 契约）
    expect((await inject("POST", `/novel/${novelA}/split`, {}, userA)).code).toBe(ErrorCode.BAD_REQUEST);
    expect((await inject("POST", `/novel/${novelA}/script-generate`, {}, userA)).code).toBe(ErrorCode.BAD_REQUEST);
    expect(
      (await inject("PUT", `/novel/${novelA}/content-analysis/worldview`, {
        era: "改动",
        geography: "改动",
        factions: [],
        rules: [],
        relations: [],
        summary: "改动",
      }, userA)).code,
    ).toBe(ErrorCode.BAD_REQUEST);

    const episodes = await inject("GET", `/novel/${novelA}/episode/list`, undefined, userA);
    const firstEpisode = (episodes.data as { list: Array<{ id: string }> }).list[0]!;
    // 单集 PATCH（哪怕只改标题）也要拒，否则 status=16 的本子会悄悄变成 16+改动
    expect(
      (await inject("PATCH", `/novel/${novelA}/episode/${firstEpisode.id}`, { title: "改标题" }, userA)).code,
    ).toBe(ErrorCode.BAD_REQUEST);

    // 读接口不受影响（定稿本子仍要能被预览/导出/拆集）
    expect((await inject("GET", `/novel/${novelA}`, undefined, userA)).code).toBe(0);
    expect((await inject("GET", `/novel/${novelA}/summary`, undefined, userA)).code).toBe(0);
  });

  // ══════════════════════════════════════════════════════════════
  // 5. §3.3 衔接契约：assertSplittable
  // ══════════════════════════════════════════════════════════════

  it("assertSplittable：未定稿 400100；定稿返回 title/sourceText/episodeCount 且逐集脚本齐全", async () => {
    const novelSvc = app.get(NovelService);

    // 未定稿的本子（新造一个，走到有剧本但没定稿）
    const draft = await inject("POST", "/novel", { title: `未定稿-${Date.now()}`, source_text: SOURCE_TEXT }, userA);
    const draftId = (draft.data as { id: string }).id;
    await inject("POST", `/novel/${draftId}/episode_outline/generate`, { episode_count: 1 }, userA);
    await inject("POST", `/novel/${draftId}/script-generate`, {}, userA);

    let rejected: unknown;
    try {
      await novelSvc.assertSplittable(userA.spaceId, draftId);
    } catch (error) {
      rejected = error;
    }
    expect(rejected).toBeInstanceOf(AppError);
    expect((rejected as AppError).code).toBe(ErrorCode.BAD_REQUEST);
    expect(((rejected as AppError).details as { reason?: string }).reason).toBe("not_finalized");

    // 定稿本子：可拆集
    const result = await novelSvc.assertSplittable(userA.spaceId, novelA);
    expect(result.title.length).toBeGreaterThan(0);
    expect(result.episodeCount).toBe(3);
    expect(result.episodeScripts.length).toBe(3);
    expect(result.episodeScripts.map((row) => row.epNo)).toEqual([1, 2, 3]);
    expect(result.sourceText).toContain("第1集");

    // 越权：B 用户拿 A 的 space/id 调 → 403
    let forbidden: unknown;
    try {
      await novelSvc.assertSplittable(userB.spaceId, novelA);
    } catch (error) {
      forbidden = error;
    }
    expect((forbidden as AppError).code).toBe(ErrorCode.FORBIDDEN);

    // 不存在 → 404（不是空对象）
    let notFound: unknown;
    try {
      await novelSvc.assertSplittable(userA.spaceId, "999999999999");
    } catch (error) {
      notFound = error;
    }
    expect((notFound as AppError).code).toBe(ErrorCode.NOT_FOUND);
  });

  // ══════════════════════════════════════════════════════════════
  // 6. 权限（跨 space 一律 403）
  // ══════════════════════════════════════════════════════════════

  it("跨 space 一律 403；非法 id 400101；未登录 401101", async () => {
    expect((await inject("GET", `/novel/${novelA}`, undefined, userB)).code).toBe(ErrorCode.FORBIDDEN);
    expect((await inject("GET", `/novel/${novelA}/chapters`, undefined, userB)).code).toBe(ErrorCode.FORBIDDEN);
    expect((await inject("POST", `/novel/${novelA}/split`, {}, userB)).code).toBe(ErrorCode.FORBIDDEN);
    expect((await inject("PATCH", `/novel/${novelA}`, { title: "x" }, userB)).code).toBe(ErrorCode.FORBIDDEN);
    expect(
      (await inject("POST", `/novel/${novelA}/script_edit_agent/enter`, {}, userB)).code,
    ).toBe(ErrorCode.FORBIDDEN);

    // 非法 id：参数错误，不是"不存在"
    expect((await inject("GET", "/novel/not-a-number", undefined, userA)).code).toBe(ErrorCode.INVALID_PARAM);
    // 不存在
    expect((await inject("GET", "/novel/999999999999", undefined, userA)).code).toBe(ErrorCode.NOT_FOUND);
    // 未登录
    expect((await inject("GET", "/novel/list")).code).toBe(ErrorCode.UNAUTHORIZED);

    // B 自己的 space 里看不到 A 的本子（列表隔离）
    const bList = await inject("GET", "/novel/list", undefined, userB);
    expect((bList.data as { list: Array<{ id: string }> }).list.every((row) => row.id !== novelA)).toBe(true);
  });

  // ══════════════════════════════════════════════════════════════
  // 7. 剧本编辑 Agent（13 语义端点 / 16 路由）
  // ══════════════════════════════════════════════════════════════

  it("编辑 Agent 前置：enter 幂等 / heartbeat / 会话 CRUD / switch / 详情", async () => {
    // 造一个"有 3 集剧本、未定稿"的本子，编辑 Agent 链路在它上面跑
    const created = await inject("POST", "/novel", { title: `编辑Agent-${Date.now()}`, source_text: SOURCE_TEXT }, userA);
    novelA2 = (created.data as { id: string }).id;
    await inject("POST", `/novel/${novelA2}/content-analysis`, {}, userA);
    await inject("POST", `/novel/${novelA2}/chapter_outline/generate`, {}, userA);
    await inject("POST", `/novel/${novelA2}/episode_outline/generate`, { episode_count: 3 }, userA);
    const scripts = await inject("POST", `/novel/${novelA2}/script-generate`, {}, userA);
    expect(scripts.code).toBe(0);
    expect((scripts.data as { count: number }).count).toBe(3);

    // enter：首次新建
    const entered = await inject("POST", `/novel/${novelA2}/script_edit_agent/enter`, { instructions: "保持第一人称" }, userA);
    expect(entered.code).toBe(0);
    const enterData = entered.data as { session: { id: string; status: number; instructions: string }; replayed: boolean };
    expect(enterData.replayed).toBe(false);
    expect(enterData.session.status).toBe(1);
    expect(enterData.session.instructions).toBe("保持第一人称");
    novelBSession = enterData.session.id;

    // enter 第二次：复用同一会话（重复点击不应产生第二个 ACTIVE 会话）
    const reEntered = await inject("POST", `/novel/${novelA2}/script_edit_agent/enter`, {}, userA);
    expect(reEntered.code).toBe(0);
    expect((reEntered.data as { replayed: boolean }).replayed).toBe(true);
    expect((reEntered.data as { session: { id: string } }).session.id).toBe(novelBSession);

    // heartbeat：有 ACTIVE 会话 → ok
    const heartbeat = await inject("POST", `/novel/${novelA2}/script_edit_agent/heartbeat`, { dirty: true }, userA);
    expect(heartbeat.code).toBe(0);
    const heartbeatData = heartbeat.data as { ok: boolean; heartbeat_at: string; client_dirty: boolean; sessions: unknown[] };
    expect(heartbeatData.ok).toBe(true);
    expect(heartbeatData.client_dirty).toBe(true);
    expect(heartbeatData.sessions.length).toBe(1);

    // 新建第二个会话 + 列表 + 切换 + 详情
    const second = await inject("POST", `/novel/${novelA2}/script_edit_agent/sessions`, { title: "第二会话" }, userA);
    expect(second.code).toBe(0);
    const secondId = (second.data as { session: { id: string } }).session.id;

    const sessions = await inject("GET", `/novel/${novelA2}/script_edit_agent/sessions`, undefined, userA);
    expect(sessions.code).toBe(0);
    const sessionList = sessions.data as { list: Array<{ id: string; message_count: number; pending_count: number }>; total: number };
    expect(sessionList.total).toBe(2);
    expect(sessionList.list.some((row) => row.id === secondId)).toBe(true);

    const switched = await inject(
      "POST",
      `/novel/${novelA2}/script_edit_agent/sessions/switch`,
      { session_id: secondId },
      userA,
    );
    expect(switched.code).toBe(0);
    const switchedData = switched.data as { switched: boolean; session: { id: string; is_current: boolean } };
    expect(switchedData.switched).toBe(true);
    expect(switchedData.session.is_current).toBe(true);

    const detail = await inject("GET", `/novel/${novelA2}/script_edit_agent/sessions/${secondId}`, undefined, userA);
    expect(detail.code).toBe(0);
    const detailData = detail.data as { session: { id: string }; messages: unknown[]; pending: unknown[] };
    expect(detailData.session.id).toBe(secondId);
    expect(detailData.messages).toEqual([]);
    expect(detailData.pending).toEqual([]);

    // 切到不存在的会话 → 400102
    expect(
      (await inject("POST", `/novel/${novelA2}/script_edit_agent/sessions/switch`, { session_id: "999999999999" }, userA)).code,
    ).toBe(ErrorCode.NOT_FOUND);
  });

  it("chat 产出逐集 diff：original/proposed/change_summary 齐全，且 chat 不改正文", async () => {
    const episodeList = await inject("GET", `/novel/${novelA2}/episode/list`, undefined, userA);
    const episodes = (episodeList.data as { list: Array<{ id: string; episode_no: number }> }).list;
    const before = await inject("GET", `/novel/${novelA2}/episode/${episodes[0]!.id}`, undefined, userA);
    const beforeText = (before.data as { script_text: string }).script_text;

    const chat = await inject(
      "POST",
      `/novel/${novelA2}/script_edit_agent/sessions/${novelBSession}/chat`,
      { content: "把第 1 集结尾改成悲剧结局" },
      userA,
    );
    expect(chat.code).toBe(0);
    const chatData = chat.data as {
      reply: string;
      message: { role: number; content: string };
      pending: Array<{
        id: string;
        episode_id: string;
        episode_no: number;
        original_text: string;
        proposed_text: string;
        change_summary: string;
        status: number;
      }>;
    };
    expect(chatData.reply.length).toBeGreaterThan(0);
    expect(chatData.message.role).toBe(2);
    expect(chatData.pending.length).toBeGreaterThan(0);

    const diff = chatData.pending.find((row) => row.episode_no === 1) ?? chatData.pending[0]!;
    // 三件套是"逐集确认"的前提：原文 / 建议文 / 变更说明都必须非空
    expect(diff.original_text.length).toBeGreaterThan(0);
    expect(diff.proposed_text.length).toBeGreaterThan(0);
    expect(diff.change_summary.length).toBeGreaterThan(0);
    expect(diff.proposed_text).not.toBe(diff.original_text);
    expect(diff.status).toBe(1);

    // chat 只产出 diff，不改正文 —— 这是"逐集 apply"能成立的根本
    const after = await inject("GET", `/novel/${novelA2}/episode/${episodes[0]!.id}`, undefined, userA);
    expect((after.data as { script_text: string }).script_text).toBe(beforeText);

    // pending 端点单集回读：内容与 chat 返回一致
    const pending = await inject(
      "GET",
      `/novel/${novelA2}/script_edit_agent/sessions/${novelBSession}/episodes/${diff.episode_id}/pending`,
      undefined,
      userA,
    );
    expect(pending.code).toBe(0);
    const pendingData = pending.data as {
      episode: { episode_no: number };
      pending: { id: string; proposed_text: string } | null;
    };
    expect(pendingData.episode.episode_no).toBe(diff.episode_no);
    expect(pendingData.pending?.id).toBe(diff.id);
    expect(pendingData.pending?.proposed_text).toBe(diff.proposed_text);
  });

  it("apply 写正文 + 落版本；重复 apply → 746002（不重写正文）", async () => {
    const pendingList = await pendingOf(novelBSession);
    const target = pendingList[0]!;
    const beforeVersion = (await inject("GET", `/novel/${novelA2}/episode/${target.episode_id}`, undefined, userA)).data as {
      version: number;
    };

    const applied = await inject(
      "POST",
      `/novel/${novelA2}/script_edit_agent/sessions/${novelBSession}/episodes/${target.episode_id}/apply`,
      {},
      userA,
    );
    expect(applied.code).toBe(0);
    const appliedData = applied.data as {
      applied: boolean;
      pending: { status: number };
      episode: { script_text: string; version: number; status: number };
    };
    expect(appliedData.applied).toBe(true);
    expect(appliedData.pending.status).toBe(2);
    expect(appliedData.episode.script_text).toBe(target.proposed_text);
    // 新版本号 = 旧 + 1（apply 必须留痕，否则"回到上一稿"无处可取）
    expect(appliedData.episode.version).toBe(beforeVersion.version + 1);
    // apply 后该集视为已确认
    expect(appliedData.episode.status).toBe(2);

    // 重放：同一 pending 再 apply → 746002，且正文不再变化
    const replay = await inject(
      "POST",
      `/novel/${novelA2}/script_edit_agent/sessions/${novelBSession}/episodes/${target.episode_id}/apply`,
      {},
      userA,
    );
    expect(replay.code).toBe(ErrorCode.VERSION_CONFLICT);
    const afterReplay = (await inject("GET", `/novel/${novelA2}/episode/${target.episode_id}`, undefined, userA)).data as {
      script_text: string;
      version: number;
    };
    expect(afterReplay.script_text).toBe(target.proposed_text);
    expect(afterReplay.version).toBe(appliedData.episode.version);

    // 已 apply 的集：pending 端点返回 null（不是 404，前端不该把"没事"渲染成错误）
    const pendingNow = await inject(
      "GET",
      `/novel/${novelA2}/script_edit_agent/sessions/${novelBSession}/episodes/${target.episode_id}/pending`,
      undefined,
      userA,
    );
    expect((pendingNow.data as { pending: unknown }).pending).toBeNull();
  });

  it("reject 只改 pending 状态：正文与版本都不动", async () => {
    const chat = await inject(
      "POST",
      `/novel/${novelA2}/script_edit_agent/sessions/${novelBSession}/chat`,
      { content: "第 2 集压缩过场", episode_nos: [2] },
      userA,
    );
    expect(chat.code).toBe(0);
    const pendingList = (chat.data as { pending: Array<{ episode_id: string; episode_no: number; proposed_text: string }> }).pending;
    expect(pendingList.length).toBeGreaterThan(0);
    const target = pendingList[0]!;
    const before = (await inject("GET", `/novel/${novelA2}/episode/${target.episode_id}`, undefined, userA)).data as {
      script_text: string;
      version: number;
      status: number;
    };

    const rejected = await inject(
      "POST",
      `/novel/${novelA2}/script_edit_agent/sessions/${novelBSession}/episodes/${target.episode_id}/reject`,
      { reason: "这版改动太激进" },
      userA,
    );
    expect(rejected.code).toBe(0);
    const rejectedData = rejected.data as {
      rejected: boolean;
      pending: { status: number };
      reason: string;
      episode_text_changed: boolean;
      episode: { script_text: string; version: number };
    };
    expect(rejectedData.rejected).toBe(true);
    expect(rejectedData.pending.status).toBe(3);
    expect(rejectedData.reason).toBe("这版改动太激进");
    // 契约级断言：驳回 = 正文一字节都不动、版本不涨
    expect(rejectedData.episode_text_changed).toBe(false);
    expect(rejectedData.episode.script_text).toBe(before.script_text);
    expect(rejectedData.episode.version).toBe(before.version);

    // 重复 reject → 746002
    const replay = await inject(
      "POST",
      `/novel/${novelA2}/script_edit_agent/sessions/${novelBSession}/episodes/${target.episode_id}/reject`,
      {},
      userA,
    );
    expect(replay.code).toBe(ErrorCode.VERSION_CONFLICT);

    // 同一集刚被驳回后再 apply → 746002 pending_already_rejected
    // （比"无 pending"更准确：不是没有变更，而是这条变更已经被决定过）
    const applyAfterReject = await inject(
      "POST",
      `/novel/${novelA2}/script_edit_agent/sessions/${novelBSession}/episodes/${target.episode_id}/apply`,
      {},
      userA,
    );
    expect(applyAfterReject.code).toBe(ErrorCode.VERSION_CONFLICT);

    // 真正"从没有过 pending"的会话里 apply → 400100 no_pending（不是静默成功）
    const freshSession = await inject(
      "POST",
      `/novel/${novelA2}/script_edit_agent/sessions`,
      { title: "空会话用于 no_pending 校验" },
      userA,
    );
    const freshSid = (freshSession.data as { session: { id: string } }).session.id;
    const emptyApply = await inject(
      "POST",
      `/novel/${novelA2}/script_edit_agent/sessions/${freshSid}/episodes/${target.episode_id}/apply`,
      {},
      userA,
    );
    expect(emptyApply.code).toBe(ErrorCode.BAD_REQUEST);
    expect((emptyApply.msg || "").toLowerCase()).toContain("no pending");
  });

  it("apply_all / reject_all 批量；abort 显式回显；版本 finalize/delete", async () => {
    // 造一批 pending（对所有集）
    const chat = await inject(
      "POST",
      `/novel/${novelA2}/script_edit_agent/sessions/${novelBSession}/chat`,
      { content: "整体加强悬念" },
      userA,
    );
    expect(chat.code).toBe(0);
    expect((chat.data as { pending: unknown[] }).pending.length).toBeGreaterThan(0);

    // 取真实存在的待确认集号，再按集号批量应用（不假设 mock 一定挑中了第 1 集）
    const pendings = await pendingOf(novelBSession);
    const targetNo = pendings[0]!.episode_no;

    // apply_all 只处理指定集
    const applyAll = await inject(
      "POST",
      `/novel/${novelA2}/script_edit_agent/sessions/${novelBSession}/apply_all`,
      { episode_nos: [targetNo] },
      userA,
    );
    expect(applyAll.code).toBe(0);
    const applyAllData = applyAll.data as { applied: number; list: Array<{ episode_no: number }>; remaining: number };
    expect(applyAllData.applied).toBeGreaterThanOrEqual(1);
    expect(applyAllData.list.every((row) => row.episode_no === targetNo)).toBe(true);

    // 再 apply_all 同一集：**不能重复应用**。两种结果都合法，取决于此刻会话里是否还有别的集待确认：
    //   a) 还有其它集的 pending → 400101（明确告诉调用方"这批集没有可处理的"）
    //   b) 已经没有任何 pending → 200 + applied:0（批量重放的幂等语义，见 applyAll 注释：
    //      "批量操作被前端重试命中是常态，报错只会制造假告警"）
    // 这里原先硬断言 400101，在 mock 只产出一集 diff 时会假红（同一份代码跑两次结果不同）。
    const applyAllAgain = await inject(
      "POST",
      `/novel/${novelA2}/script_edit_agent/sessions/${novelBSession}/apply_all`,
      { episode_nos: [targetNo] },
      userA,
    );
    expect([ErrorCode.INVALID_PARAM, 0]).toContain(applyAllAgain.code);
    if (applyAllAgain.code === 0) {
      expect((applyAllAgain.data as { applied: number }).applied).toBe(0);
    }

    // reject_all 处理剩余。
    // ⚠️ 不能假设"此时一定还有 pending"：mock 每轮产出几集 diff 由内容哈希决定（1 或 2 集），
    // 上面的 apply_all 有可能刚好把唯一一集应用掉 —— 那样这里 rejected=0 是正确行为、断言却假红。
    // 所以先补一轮 chat 把待确认变更造出来，再验证 reject_all。
    if ((await pendingOf(novelBSession)).length === 0) {
      const refill = await inject(
        "POST",
        `/novel/${novelA2}/script_edit_agent/sessions/${novelBSession}/chat`,
        { content: "再给一版更冷的开场，把信息压到最少的台词里" },
        userA,
      );
      expect(refill.code).toBe(0);
    }
    const rejectAll = await inject(
      "POST",
      `/novel/${novelA2}/script_edit_agent/sessions/${novelBSession}/reject_all`,
      { reason: "整批否掉" },
      userA,
    );
    expect(rejectAll.code).toBe(0);
    const rejectAllData = rejectAll.data as { rejected: number; remaining: number };
    expect(rejectAllData.rejected).toBeGreaterThanOrEqual(1);
    expect(rejectAllData.remaining).toBe(0);

    // 没有在途轮次时 abort：不假装成功
    const abortIdle = await inject(
      "POST",
      `/novel/${novelA2}/script_edit_agent/sessions/${novelBSession}/abort`,
      {},
      userA,
    );
    expect(abortIdle.code).toBe(0);
    const abortData = abortIdle.data as { aborted: boolean; in_flight: boolean; reason: string };
    expect(abortData.aborted).toBe(false);
    expect(abortData.in_flight).toBe(false);
    expect(abortData.reason).toBe("no_turn_in_flight");

    // 版本 finalize（幂等）/ delete
    const versions = await inject("GET", `/novel/${novelA2}/version/list?page_size=50`, undefined, userA);
    const versionList = (versions.data as { list: Array<{ id: string; finalized_at: string | null; episode_id: string | null }> }).list;
    const unfinalized = versionList.find((row) => row.finalized_at === null && row.episode_id !== null) ?? versionList[0]!;

    const finalized = await inject(
      "POST",
      `/novel/${novelA2}/script_edit_agent/version/${unfinalized.id}/finalize`,
      {},
      userA,
    );
    expect(finalized.code).toBe(0);
    expect((finalized.data as { replayed: boolean }).replayed).toBe(false);
    expect((finalized.data as { version: { finalized_at: string | null } }).version.finalized_at).not.toBeNull();

    const reFinalized = await inject(
      "POST",
      `/novel/${novelA2}/script_edit_agent/version/${unfinalized.id}/finalize`,
      {},
      userA,
    );
    expect((reFinalized.data as { replayed: boolean }).replayed).toBe(true);

    const deleted = await inject(
      "DELETE",
      `/novel/${novelA2}/script_edit_agent/version/${unfinalized.id}/delete`,
      undefined,
      userA,
    );
    expect(deleted.code).toBe(0);
    expect((deleted.data as { ok: boolean }).ok).toBe(true);

    // 已删除的版本再 finalize → 400102
    expect(
      (
        await inject(
          "POST",
          `/novel/${novelA2}/script_edit_agent/version/${unfinalized.id}/finalize`,
          {},
          userA,
        )
      ).code,
    ).toBe(ErrorCode.NOT_FOUND);
  });

  it("同一会话并发 chat：一个成功、另一个 746005（不排队也不静默丢弃）", async () => {
    // 直接打服务层：两次 chat 在同一 tick 发起，才能稳定复现"同一会话同时两轮"
    const agentSvc = app.get(NovelAgentService);
    const first = agentSvc.chat(userA.spaceId, novelA2, novelBSession, { content: "并发测试 A" });
    const second = agentSvc.chat(userA.spaceId, novelA2, novelBSession, { content: "并发测试 B" });

    const results = await Promise.allSettled([first, second]);
    const fulfilled = results.filter((row) => row.status === "fulfilled");
    const rejected = results.filter((row): row is PromiseRejectedResult => row.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0]!.reason as AppError).code).toBe(ErrorCode.AGENT_TURN_IN_FLIGHT);

    // 锁释放后可以继续用（不是一次并发就把会话卡死）
    const after = await inject(
      "POST",
      `/novel/${novelA2}/script_edit_agent/sessions/${novelBSession}/chat`,
      { content: "并发结束后继续" },
      userA,
    );
    expect(after.code).toBe(0);
  });

  it("exit 关闭会话并把未确认 diff 作废；exit 后 chat 400100 session_closed", async () => {
    const chatted = await inject(
      "POST",
      `/novel/${novelA2}/script_edit_agent/sessions/${novelBSession}/chat`,
      { content: "退出前留一批待确认" },
      userA,
    );
    expect(chatted.code).toBe(0);

    const exited = await inject("POST", `/novel/${novelA2}/script_edit_agent/exit`, {}, userA);
    expect(exited.code).toBe(0);
    const exitedData = exited.data as { ok: boolean; closed: string[]; discarded_pending: number; replayed: boolean };
    expect(exitedData.ok).toBe(true);
    expect(exitedData.closed.length).toBeGreaterThanOrEqual(1);
    expect(exitedData.discarded_pending).toBeGreaterThanOrEqual(0);

    // 退出后再 chat：会话已关闭，必须显式报错
    const chatAfterExit = await inject(
      "POST",
      `/novel/${novelA2}/script_edit_agent/sessions/${novelBSession}/chat`,
      { content: "还能聊吗" },
      userA,
    );
    expect(chatAfterExit.code).toBe(ErrorCode.BAD_REQUEST);

    // 心跳：已无 ACTIVE 会话 → 400100 no_active_session（不静默返回 ok）
    const heartbeat = await inject("POST", `/novel/${novelA2}/script_edit_agent/heartbeat`, {}, userA);
    expect(heartbeat.code).toBe(ErrorCode.BAD_REQUEST);
    expect((heartbeat.msg || "").toLowerCase()).toContain("active edit session");

    // 再 exit 一次：幂等（closed 为空，replayed=true）
    const exitAgain = await inject("POST", `/novel/${novelA2}/script_edit_agent/exit`, {}, userA);
    expect((exitAgain.data as { replayed: boolean }).replayed).toBe(true);
  });

  // ══════════════════════════════════════════════════════════════
  // 8. 创意裂变（9 端点）
  // ══════════════════════════════════════════════════════════════

  it("创意裂变：从已定稿本子派生 → idea/角色/总纲/集纲/剧本（9 端点全通）", async () => {
    // 未定稿的本子不能裂变（竞品 derive 的库来源只接受已定稿）
    const fromDraft = await inject("POST", `/novel/${novelA2}/fission_script`, {}, userA);
    expect(fromDraft.code).toBe(ErrorCode.BAD_REQUEST);
    expect((fromDraft.msg || "").toLowerCase()).toContain("finalized");

    const created = await inject(
      "POST",
      `/novel/${novelA}/fission_script`,
      { episode_count: 3, direction: "换成女性视角" },
      userA,
    );
    expect(created.code).toBe(0);
    const createdData = created.data as {
      novel: { id: string; source_type: number; status: number };
      ideas: Array<{ ni_id: string; title: string; logline: string; selected: boolean }>;
      count: number;
    };
    expect(createdData.count).toBe(3);
    expect(createdData.novel.source_type).toBe(4);
    expect(createdData.novel.status).toBe(1);
    expect(createdData.ideas.every((idea) => idea.selected === false)).toBe(true);
    expect(createdData.ideas[0]!.logline).toContain("女性视角");
    const fissionId = createdData.novel.id;

    const ideas = await inject("GET", `/novel/${fissionId}/fission_script/idea`, undefined, userA);
    expect(ideas.code).toBe(0);
    expect((ideas.data as { total: number }).total).toBe(3);

    // 未选方案就生成总纲 → 400101（顺序不能跳）
    const summaryTooEarly = await inject("POST", `/novel/${fissionId}/fission_script/summary_outline`, {}, userA);
    expect(summaryTooEarly.code).toBe(ErrorCode.INVALID_PARAM);

    const selected = await inject(
      "POST",
      `/novel/${fissionId}/fission_script/idea/select-op`,
      { ni_id: createdData.ideas[1]!.ni_id },
      userA,
    );
    expect(selected.code).toBe(0);
    expect((selected.data as { selected_ni_id: string }).selected_ni_id).toBe(createdData.ideas[1]!.ni_id);

    const badSelect = await inject(
      "POST",
      `/novel/${fissionId}/fission_script/idea/select-op`,
      { ni_id: "ni_does_not_exist" },
      userA,
    );
    expect(badSelect.code).toBe(ErrorCode.NOT_FOUND);

    const chars = await inject("POST", `/novel/${fissionId}/fission_script/characters`, { count: 2 }, userA);
    expect(chars.code).toBe(0);
    expect((chars.data as { count: number }).count).toBe(2);

    const charList = await inject("GET", `/novel/${fissionId}/fission_script/characters`, undefined, userA);
    expect((charList.data as { total: number }).total).toBe(2);

    const summary = await inject("POST", `/novel/${fissionId}/fission_script/summary_outline`, {}, userA);
    expect(summary.code).toBe(0);
    const summaryData = summary.data as { summary_outline: { beats: unknown[]; title: string } };
    expect(summaryData.summary_outline.beats.length).toBeGreaterThan(0);

    const outline = await inject(
      "POST",
      `/novel/${fissionId}/fission_script/episodes_outline`,
      { episode_count: 3 },
      userA,
    );
    expect(outline.code).toBe(0);
    expect((outline.data as { count: number }).count).toBe(3);

    const outlineList = await inject("GET", `/novel/${fissionId}/fission_script/episodes_outline`, undefined, userA);
    expect((outlineList.data as { total: number }).total).toBe(3);

    const episodes = await inject("POST", `/novel/${fissionId}/fission_script/episodes`, {}, userA);
    expect(episodes.code).toBe(0);
    expect((episodes.data as { count: number }).count).toBe(3);
  });

  // ══════════════════════════════════════════════════════════════
  // 9. 海外改编（2 端点）
  // ══════════════════════════════════════════════════════════════

  it("海外改编：派生 source_type=5 新本子 + 本地化集纲；重复请求幂等返回同一本", async () => {
    const first = await inject(
      "POST",
      `/novel/${novelA}/overseas`,
      { lang: "en", region: "US", episode_count: 3 },
      userA,
    );
    expect(first.code).toBe(0);
    const firstData = first.data as {
      novel: { id: string; source_type: number; title: string };
      replayed: boolean;
      episode_outline_count: number;
    };
    expect(firstData.novel.source_type).toBe(5);
    expect(firstData.replayed).toBe(false);
    expect(firstData.episode_outline_count).toBe(3);

    // 幂等键 = 源本子 + lang + region：重试不该产生第二个海外本
    const second = await inject(
      "POST",
      `/novel/${novelA}/overseas`,
      { lang: "en", region: "US", episode_count: 3 },
      userA,
    );
    expect(second.code).toBe(0);
    expect((second.data as { replayed: boolean }).replayed).toBe(true);
    expect((second.data as { novel: { id: string } }).novel.id).toBe(firstData.novel.id);

    const listed = await inject("GET", `/novel/${novelA}/overseas`, undefined, userA);
    expect(listed.code).toBe(0);
    const listedData = listed.data as { list: Array<{ id: string }>; total: number; last: { id: string } | null };
    expect(listedData.total).toBe(1);
    expect(listedData.last?.id).toBe(firstData.novel.id);
    expect(listedData.list[0]!.id).toBe(firstData.novel.id);

    // 换语言 → 新本子（幂等键区分 lang）
    const otherLang = await inject("POST", `/novel/${novelA}/overseas`, { lang: "es" }, userA);
    expect(otherLang.code).toBe(0);
    expect((otherLang.data as { replayed: boolean }).replayed).toBe(false);
  });

  // ══════════════════════════════════════════════════════════════
  // 10. 归档（删除语义）
  // ══════════════════════════════════════════════════════════════

  it("归档：archive 后默认列表不再返回，archived=1 可查；重复归档幂等", async () => {
    const draft = await inject("POST", "/novel", { title: `待归档-${Date.now()}` }, userA);
    const id = (draft.data as { id: string }).id;

    const archived = await inject("DELETE", `/novel/${id}`, undefined, userA);
    expect(archived.code).toBe(0);
    expect((archived.data as { archived: boolean; replayed: boolean }).archived).toBe(true);
    expect((archived.data as { replayed: boolean }).replayed).toBe(false);

    const again = await inject("DELETE", `/novel/${id}`, undefined, userA);
    expect((again.data as { replayed: boolean }).replayed).toBe(true);

    const defaultList = await inject("GET", "/novel/list?page_size=100", undefined, userA);
    expect((defaultList.data as { list: Array<{ id: string }> }).list.every((row) => row.id !== id)).toBe(true);

    const archivedList = await inject("GET", "/novel/list?archived=1&page_size=100", undefined, userA);
    expect((archivedList.data as { list: Array<{ id: string }> }).list.some((row) => row.id === id)).toBe(true);

    // PATCH 取消归档
    const restored = await inject("PATCH", `/novel/${id}`, { archived: false }, userA);
    expect(restored.code).toBe(0);
    expect((restored.data as { archived_at: string | null }).archived_at).toBeNull();
  });
});
