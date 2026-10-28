import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { sql } from "drizzle-orm";
import { newId } from "@app/shared";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { db, pool } from "../src/db/database";

/**
 * 第 90 批：竞品 102 条 novel 路由里「我方原先只有集合/批量版本」的 13 条单点形状。
 *
 * 这些端点**不是新能力**，是同一能力的另一种调用形状，所以断言重点不是"跑通"，
 * 而是「形状必须与集合版本自洽」：
 * 1. 单条读取 = 列表里同一行的**同一个 dto**（多一个字段就等于两套契约）；
 * 2. 单条写入只改它声明的字段（批量改名不能顺手改角色描述）；
 * 3. 导出是纯函数（同样的库给同样的文本），`only_episodes` 只去掉章节段；
 * 4. 探针 `script_edit_agent` 在**没有**活动会话时回 200 + `active:false`，
 *    而不是让客户端把 400 当状态（这是它与 heartbeat 的分工）；
 * 5. 裂变链的总纲/创意方案存在 `novels.meta.fission`，手工改只允许标量，
 *    `beats` 被 schema 剥掉（不能用 PATCH 悄悄重划分集边界）。
 */

const SOURCE_TEXT = [
  "第1章 旧信",
  "她把父亲的旧信摊在桌上，发现寄信日期在他失踪之后。",
  "",
  "第2章 名单",
  "名单上第三个名字是她自己，职业一栏写着「代笔」。",
].join("\n");

describe("novel 第 90 批单点形状 e2e", () => {
  let app: NestFastifyApplication;
  let seq = 0;
  const createdSpaceIds: string[] = [];

  interface Session {
    token: string;
    spaceId: string;
  }

  let userA: Session;
  let userB: Session;
  /** 有章节的改编本（导出用） */
  let chapterNovelId = "";
  /** 手工素材/角色卡/集纲用的原创本 */
  let craftNovelId = "";
  /** 裂变本（只写 meta.fission，不走 createFission 的重链路） */
  let fissionNovelId = "";

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
      headers: res.headers,
      raw: res.body,
      code: (body as { code?: number }).code ?? -1,
      msg: (body as { msg?: string }).msg ?? "",
      data: (body as { data?: never }).data,
    };
  };

  async function loginNewUser(prefix: string): Promise<Session> {
    const tail = String(Date.now()).slice(-7);
    seq += 1;
    const phone = `1${tail}${prefix}${seq % 10}`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const code = (sms.data as { debug_code?: string } | undefined)?.debug_code;
    const login = await inject("POST", "/auth/login", { phone, code, age_confirmed: true });
    const data = login.data as { access_token?: string; space_id?: string } | undefined;
    const session = { token: data?.access_token ?? "", spaceId: String(data?.space_id ?? "") };
    if (session.spaceId) createdSpaceIds.push(session.spaceId);
    return session;
  }

  async function createNovel(title: string, sourceType: number, sourceText = SOURCE_TEXT): Promise<string> {
    const created = await inject("POST", "/novel", { title, source_type: sourceType, source_text: sourceText }, userA);
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

    userA = await loginNewUser("91");
    userB = await loginNewUser("92");
    chapterNovelId = await createNovel(`导出本-${Date.now()}`, 1);
    craftNovelId = await createNovel(`原创本-${Date.now()}`, 2, "一名替人写遗书的女孩，发现名单里有父亲的名字。");
    fissionNovelId = await createNovel(`裂变本-${Date.now()}`, 1);
  }, 90_000);

  afterAll(async () => {
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
  // 1. 导出（GET /novel/:ntId/download）
  // ══════════════════════════════════════════════════════════════

  it("导出整本：原始 markdown + UTF-8 文件名；only_episodes 只去掉章节段", async () => {
    const split = await inject("POST", `/novel/${chapterNovelId}/split`, { chapter_count: 2 }, userA);
    expect(split.code).toBe(0);

    const full = await inject("GET", `/novel/${chapterNovelId}/download`, undefined, userA);
    expect(full.status).toBe(200);
    expect(String(full.headers["content-type"])).toContain("text/markdown");
    // 中文标题不能用 filename="..."，必须 filename*=UTF-8''
    expect(String(full.headers["content-disposition"])).toContain("filename*=UTF-8''");
    expect(full.raw).toContain("## 章节正文");
    expect(full.raw).toContain("### 第 1 章");
    expect(full.raw).toContain("### 第 2 章");
    // 没有分集剧本时不出这一节：空标题比假内容更容易被发现
    expect(full.raw).not.toContain("## 分集剧本");

    const onlyEpisodes = await inject("GET", `/novel/${chapterNovelId}/download?only_episodes=1`, undefined, userA);
    expect(onlyEpisodes.status).toBe(200);
    expect(onlyEpisodes.raw).not.toContain("## 章节正文");

    // 越权：别人的本子连"存在性"都不该确认
    const foreign = await inject("GET", `/novel/${chapterNovelId}/download`, undefined, userB);
    expect(foreign.code).not.toBe(0);
    expect(foreign.status).toBeLessThan(500);
  });

  // ══════════════════════════════════════════════════════════════
  // 2. 编辑态探针（GET /novel/:ntId/script_edit_agent）
  // ══════════════════════════════════════════════════════════════

  it("编辑态探针：无会话 → 200 + active:false；enter 后 active:true；exit 后回 false", async () => {
    const idle = await inject("GET", `/novel/${craftNovelId}/script_edit_agent`, undefined, userA);
    expect(idle.code).toBe(0);
    const idleData = idle.data as { active: boolean; session: unknown; pending_count: number; in_flight: boolean };
    expect(idleData.active).toBe(false);
    expect(idleData.session).toBeNull();
    expect(idleData.pending_count).toBe(0);
    expect(idleData.in_flight).toBe(false);

    const enter = await inject("POST", `/novel/${craftNovelId}/script_edit_agent/enter`, {}, userA);
    expect(enter.code).toBe(0);

    const active = await inject("GET", `/novel/${craftNovelId}/script_edit_agent`, undefined, userA);
    const activeData = active.data as { active: boolean; session: { id: string } | null };
    expect(activeData.active).toBe(true);
    expect(activeData.session?.id).toBeTruthy();

    const exit = await inject("POST", `/novel/${craftNovelId}/script_edit_agent/exit`, {}, userA);
    expect(exit.code).toBe(0);
    const after = await inject("GET", `/novel/${craftNovelId}/script_edit_agent`, undefined, userA);
    expect((after.data as { active: boolean }).active).toBe(false);
  });

  // ══════════════════════════════════════════════════════════════
  // 3. 角色卡单点：读 / 批量改名 / 删
  // ══════════════════════════════════════════════════════════════

  it("角色卡单点读取：与列表同一 dto；批量改名只改 name；删一张后 404", async () => {
    const a = await inject("POST", `/novel/${craftNovelId}/original_script/characters`, { name: "阿岚" }, userA);
    expect(a.code).toBe(0);
    const b = await inject("POST", `/novel/${craftNovelId}/original_script/characters`, { name: "老周" }, userA);
    expect(b.code).toBe(0);
    const aId = (a.data as { character: { id: string } }).character.id;
    const bId = (b.data as { character: { id: string } }).character.id;

    const list = await inject("GET", `/novel/${craftNovelId}/original_script/characters`, undefined, userA);
    const listData = list.data as { list: Array<Record<string, unknown>> };
    const fromList = listData.list.find((row) => row.id === aId)!;
    const single = await inject("GET", `/novel/${craftNovelId}/original_script/characters/${aId}`, undefined, userA);
    expect(single.code).toBe(0);
    const singleCharacter = (single.data as { character: Record<string, unknown> }).character;
    // 单条与列表必须**字段集完全相同**：多一个少一个都等于两套契约
    expect(Object.keys(singleCharacter).sort()).toEqual(Object.keys(fromList).sort());
    expect(singleCharacter).toEqual(fromList);

    const renamed = await inject(
      "POST",
      `/novel/${craftNovelId}/original_script/characters/batch-rename`,
      { items: [{ nc_id: aId, name: "阿岚·改" }, { nc_id: bId, name: "老周·改" }] },
      userA,
    );
    expect(renamed.code).toBe(0);
    const renamedData = renamed.data as { count: number; renamed: Array<{ from: string; to: string }> };
    expect(renamedData.count).toBe(2);
    expect(renamedData.renamed[0]).toMatchObject({ from: "阿岚", to: "阿岚·改" });

    const afterRename = await inject("GET", `/novel/${craftNovelId}/original_script/characters`, undefined, userA);
    const names = (afterRename.data as { list: Array<{ name: string }> }).list.map((row) => row.name);
    expect(names).toContain("阿岚·改");
    expect(names).toContain("老周·改");

    // 未知 nc_id 整批拒绝：不能"改了几个算几个"
    const unknown = await inject(
      "POST",
      `/novel/${craftNovelId}/original_script/characters/batch-rename`,
      { items: [{ nc_id: "999999999999", name: "X" }] },
      userA,
    );
    expect(unknown.code).toBe(400102);

    const empty = await inject(
      "POST",
      `/novel/${craftNovelId}/original_script/characters/batch-rename`,
      { items: [] },
      userA,
    );
    expect(empty.code).toBe(400101);

    const deleted = await inject(
      "POST",
      `/novel/${craftNovelId}/original_script/characters/${aId}/delete`,
      {},
      userA,
    );
    expect(deleted.code).toBe(0);
    expect((deleted.data as { deleted: { id: string } }).deleted.id).toBe(aId);
    const gone = await inject("GET", `/novel/${craftNovelId}/original_script/characters/${aId}`, undefined, userA);
    expect(gone.code).toBe(400102);
    const goneDelete = await inject(
      "POST",
      `/novel/${craftNovelId}/original_script/characters/${aId}/delete`,
      {},
      userA,
    );
    expect(goneDelete.code).toBe(400102);

    // 越权读单卡：别人的本子 → 非 0，且不是 5xx
    const foreign = await inject("GET", `/novel/${craftNovelId}/original_script/characters/${bId}`, undefined, userB);
    expect(foreign.code).not.toBe(0);
    expect(foreign.status).toBeLessThan(500);
  });

  // ══════════════════════════════════════════════════════════════
  // 4. 素材：手工新增 + 单条读取
  // ══════════════════════════════════════════════════════════════

  it("素材手工新增：不调模型、manual=true；单条读取与列表一致；未知 id 404", async () => {
    const created = await inject(
      "POST",
      `/novel/${craftNovelId}/original_script/materials`,
      { title: "雨夜", content: "她站在雨里等一个不会来的人。" },
      userA,
    );
    expect(created.code).toBe(0);
    const material = (created.data as { material: { nm_id: string; manual: boolean; title: string } }).material;
    expect(material.manual).toBe(true);
    expect(material.title).toBe("雨夜");

    const list = await inject("GET", `/novel/${craftNovelId}/original_script/materials`, undefined, userA);
    const listData = list.data as { materials?: Array<Record<string, unknown>>; list?: Array<Record<string, unknown>> };
    const rows = listData.materials ?? listData.list ?? [];
    const fromList = rows.find((row) => row.nm_id === material.nm_id)!;
    expect(fromList).toBeTruthy();

    const single = await inject(
      "GET",
      `/novel/${craftNovelId}/original_script/materials/${material.nm_id}`,
      undefined,
      userA,
    );
    expect(single.code).toBe(0);
    expect((single.data as { material: Record<string, unknown> }).material).toEqual(fromList);

    const missing = await inject(
      "GET",
      `/novel/${craftNovelId}/original_script/materials/nm_not_exist`,
      undefined,
      userA,
    );
    expect(missing.code).toBe(400102);

    const blank = await inject(
      "POST",
      `/novel/${craftNovelId}/original_script/materials`,
      { content: "   " },
      userA,
    );
    expect(blank.code).toBe(400101);
  });

  // ══════════════════════════════════════════════════════════════
  // 5. 原创链集纲单条编辑（PATCH /original_script/episodes_outline/:neo_id）
  // ══════════════════════════════════════════════════════════════

  it("原创链集纲单条编辑：改标题与梗概，列表同步", async () => {
    const neoId = String(newId());
    await db.execute(
      sql`insert into novel_episode_outlines (id, novel_id, episode_no, title, synopsis, sort)
          values (${BigInt(neoId)}, ${BigInt(craftNovelId)}, 1, '旧标题', '旧梗概', 0)`,
    );

    const patched = await inject(
      "PATCH",
      `/novel/${craftNovelId}/original_script/episodes_outline/${neoId}`,
      { title: "新标题", synopsis: "新梗概" },
      userA,
    );
    expect(patched.code).toBe(0);

    const list = await inject("GET", `/novel/${craftNovelId}/original_script/episodes_outline`, undefined, userA);
    const rows = (list.data as { list: Array<{ id: string; title: string; synopsis: string }> }).list;
    const row = rows.find((item) => item.id === neoId)!;
    expect(row.title).toBe("新标题");
    expect(row.synopsis).toBe("新梗概");

    const missing = await inject(
      "PATCH",
      `/novel/${craftNovelId}/original_script/episodes_outline/999999999999`,
      { title: "X" },
      userA,
    );
    expect(missing.code).not.toBe(0);
  });

  // ══════════════════════════════════════════════════════════════
  // 6. 裂变链：总纲读/改、创意方案重生成/改、角色卡编辑
  // ══════════════════════════════════════════════════════════════

  it("裂变链总纲：读得到 meta.fission 的快照；PATCH 只改标量、beats 保留", async () => {
    const fissionState = {
      source_nt_id: "1",
      direction: "换视角",
      selected_ni_id: "ni_seed",
      ideas: [
        { ni_id: "ni_seed", title: "原方案", logline: "原始 logline", angle: "flip", selected: true },
      ],
      summary_outline: {
        title: "种子总纲",
        logline: "种子一句话",
        theme: "选择的代价",
        structure: "三幕式",
        beats: [
          { no: 1, beat: "开局钩子", summary: "旧信被摊开" },
          { no: 2, beat: "第一次反转", summary: "名单上有自己" },
        ],
      },
    };
    await db.execute(
      sql`update novels set meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{fission}', ${JSON.stringify(fissionState)}::jsonb)
          where id = ${BigInt(fissionNovelId)}`,
    );

    const got = await inject("GET", `/novel/${fissionNovelId}/fission_script/summary_outline`, undefined, userA);
    expect(got.code).toBe(0);
    const gotData = got.data as {
      summary_outline: { title: string; beats: unknown[] } | null;
      selected_ni_id: string | null;
      source_nt_id: string | null;
    };
    expect(gotData.summary_outline?.title).toBe("种子总纲");
    expect(gotData.selected_ni_id).toBe("ni_seed");
    expect(gotData.source_nt_id).toBe("1");

    const patched = await inject(
      "PATCH",
      `/novel/${fissionNovelId}/fission_script/summary_outline`,
      { theme: "忠诚的边界" },
      userA,
    );
    expect(patched.code).toBe(0);
    const patchedOutline = (patched.data as { summary_outline: { theme: string; beats: unknown[] } }).summary_outline;
    expect(patchedOutline.theme).toBe("忠诚的边界");
    // beats 不在可改范围，必须原样保留（不能被"整段替换"清掉）
    expect(patchedOutline.beats).toHaveLength(2);

    const emptyPatch = await inject(
      "PATCH",
      `/novel/${fissionNovelId}/fission_script/summary_outline`,
      {},
      userA,
    );
    expect(emptyPatch.code).toBe(400101);

    // beats 被 schema 剥掉 → 只剩 beats 的请求等于空请求
    const beatsOnly = await inject(
      "PATCH",
      `/novel/${fissionNovelId}/fission_script/summary_outline`,
      { beats: [] },
      userA,
    );
    expect(beatsOnly.code).toBe(400101);

    // 主链本子没有裂变状态：patch 时报"还没生成总纲"
    const notFission = await inject(
      "PATCH",
      `/novel/${craftNovelId}/fission_script/summary_outline`,
      { theme: "X" },
      userA,
    );
    expect(notFission.code).not.toBe(0);
  });

  it("裂变链创意方案：重生成清空选定、nonce 可复现；PATCH 只改文案字段", async () => {
    const first = await inject("POST", `/novel/${fissionNovelId}/fission_script/idea`, { nonce: "n-1" }, userA);
    expect(first.code).toBe(0);
    const firstData = first.data as { list: Array<{ ni_id: string; title: string }>; count: number };
    expect(firstData.count).toBe(3);

    const replay = await inject("POST", `/novel/${fissionNovelId}/fission_script/idea`, { nonce: "n-1" }, userA);
    expect((replay.data as { list: Array<{ ni_id: string }> }).list.map((row) => row.ni_id)).toEqual(
      firstData.list.map((row) => row.ni_id),
    );

    // 重生成后旧选定必须清空：否则后续 summary_outline 会读到不存在的方案
    const after = await inject("GET", `/novel/${fissionNovelId}/fission_script/summary_outline`, undefined, userA);
    expect((after.data as { selected_ni_id: string | null }).selected_ni_id).toBeNull();

    const niId = firstData.list[0]!.ni_id;
    const patched = await inject(
      "PATCH",
      `/novel/${fissionNovelId}/fission_script/idea/${niId}`,
      { title: "改过的方案名", logline: "改过的 logline" },
      userA,
    );
    expect(patched.code).toBe(0);
    const idea = (patched.data as { idea: { title: string; logline: string; ni_id: string; angle: string } }).idea;
    expect(idea.title).toBe("改过的方案名");
    expect(idea.logline).toBe("改过的 logline");
    // ni_id / angle 是身份字段，不在可改范围
    expect(idea.ni_id).toBe(niId);
    expect(idea.angle).toBeTruthy();

    const unknown = await inject(
      "PATCH",
      `/novel/${fissionNovelId}/fission_script/idea/ni_missing`,
      { title: "X" },
      userA,
    );
    expect(unknown.code).toBe(400102);

    // 主链本子重生成创意方案 → 400100（不是裂变本，是状态不匹配而非参数非法）
    const notFission = await inject("POST", `/novel/${craftNovelId}/fission_script/idea`, {}, userA);
    expect(notFission.code).toBe(400100);
  });

  it("裂变链角色卡编辑：与原创链同一实现（改名字后列表同步）", async () => {
    const created = await inject("POST", `/novel/${fissionNovelId}/content-analysis/novel_character_cards`, { name: "裂变角色" }, userA);
    expect(created.code).toBe(0);
    const ncId = (created.data as { character: { id: string } }).character.id;

    const patched = await inject(
      "PATCH",
      `/novel/${fissionNovelId}/fission_script/characters/${ncId}`,
      { name: "裂变角色·改" },
      userA,
    );
    expect(patched.code).toBe(0);

    const list = await inject("GET", `/novel/${fissionNovelId}/fission_script/characters`, undefined, userA);
    const names = (list.data as { list: Array<{ name: string }> }).list.map((row) => row.name);
    expect(names).toContain("裂变角色·改");
  });
});
