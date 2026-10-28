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
 * 第 96 批：#2 小说改编链的 **query 字段级**对账。
 *
 * 背景：第 95 批把「query 参数被静默丢弃」做成了全站扫描器，但当时扫描器的
 * PAIRS 正则只认双引号、漏掉了第 90 批用单引号写的那批登记 —— 于是「98 条盲区」
 * 被高估了。修好正则后真实盲区是 77 条，本批按**剩余权重**取最大的一项 #2（0.24）。
 *
 * #2 的字段级很薄：102 条 `/df/novel/*` 里只有 **5 条**带 QUERY。逐条核完：
 * - `download?only_episodes` —— 第 90 批已接（本文件复验）；
 * - `novel_chapters/list?start_chat_num=&end_chat_num=` —— **此前被丢弃**，本批补；
 * - `point?step=&episode_count=…` —— 映射到 `POST /credits/quote`（POST + body），
 *   query 不适用，属映射口径问题而非缺口；
 * - `distribute/list?script_name=&page=&page_size=` —— 我方没有分发列表资源（B 类豁免）；
 * - `script_edit_agent/sessions/{session_id}?id=` —— id 在路径里，query 是冗余。
 *
 * 断言重点不是"跑通"，而是**筛选必须真的生效**（拿回整本 200 章 vs 只拿回第 2-3 章）。
 */
const SOURCE_TEXT = [
  "第1章 旧信",
  "她把父亲的旧信摊在桌上，发现寄信日期在他失踪之后。",
  "",
  "第2章 名单",
  "名单上第三个名字是她自己，职业一栏写着「代笔」。",
  "",
  "第3章 当票",
  "当票背面的字迹和旧信一模一样。",
  "",
  "第4章 尾音",
  "她终于听清了录音带最后那句话。",
].join("\n");

describe("novel query 字段级对账（第 96 批）", () => {
  let app: NestFastifyApplication;
  let seq = 0;
  const createdSpaceIds: string[] = [];

  interface Session {
    token: string;
    spaceId: string;
  }
  let userA: Session;
  let novelId = "";

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

    userA = await loginNewUser("96");
    const created = await inject("POST", "/novel", { title: `章节区间本-${Date.now()}`, source_type: 1, source_text: SOURCE_TEXT }, userA);
    expect(created.code).toBe(0);
    novelId = (created.data as { id: string }).id;
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

  it("章节列表的区间筛选真生效：竞品 start_chat_num/end_chat_num 被接住（不是静默丢弃）", async () => {
    type ChapterList = {
      list: Array<{ chapter_no: number }>;
      total: number;
      range: { start: number | null; end: number | null };
    };

    // 基线：不带区间 = 全书 4 章
    const all = await inject("GET", `/novel/${novelId}/chapters`, undefined, userA);
    expect(all.code).toBe(0);
    const allData = all.data as ChapterList;
    expect(allData.total).toBe(4);
    expect(allData.list.map((c) => c.chapter_no)).toEqual([1, 2, 3, 4]);
    expect(allData.range).toEqual({ start: null, end: null });

    // 竞品名：闭区间 [2,3]
    const mid = await inject(
      "GET",
      `/novel/${novelId}/chapters?start_chat_num=2&end_chat_num=3`,
      undefined,
      userA,
    );
    expect(mid.code).toBe(0);
    const midData = mid.data as ChapterList;
    expect(midData.list.map((c) => c.chapter_no)).toEqual([2, 3]);
    // total 必须是**筛选后**的条数，否则「共 4 章」与列出的 2 条对不上
    expect(midData.total).toBe(2);
    // 回显生效区间，客户端能确认筛选被接住了
    expect(midData.range).toEqual({ start: 2, end: 3 });

    // 只给下界：3、4
    const from = await inject("GET", `/novel/${novelId}/chapters?start_chat_num=3`, undefined, userA);
    expect((from.data as ChapterList).list.map((c) => c.chapter_no)).toEqual([3, 4]);
    expect((from.data as ChapterList).range).toEqual({ start: 3, end: null });

    // 只给上界：1、2
    const to = await inject("GET", `/novel/${novelId}/chapters?end_chat_num=2`, undefined, userA);
    expect((to.data as ChapterList).list.map((c) => c.chapter_no)).toEqual([1, 2]);
    expect((to.data as ChapterList).range).toEqual({ start: null, end: 2 });

    // 单章区间
    const one = await inject("GET", `/novel/${novelId}/chapters?start_chat_num=3&end_chat_num=3`, undefined, userA);
    expect((one.data as ChapterList).list.map((c) => c.chapter_no)).toEqual([3]);
    expect((one.data as ChapterList).total).toBe(1);

    // 我方别名也认（给不照竞品写的调用方）
    const alias = await inject("GET", `/novel/${novelId}/chapters?start_chapter_no=2&end_chapter_no=3`, undefined, userA);
    expect((alias.data as ChapterList).list.map((c) => c.chapter_no)).toEqual([2, 3]);

    // start > end → 400101（不静默返回空列表，那会让调用方以为"这本书没章节"）
    const bad = await inject("GET", `/novel/${novelId}/chapters?start_chat_num=3&end_chat_num=1`, undefined, userA);
    expect(bad.code).toBe(400101);
    expect(bad.msg).toContain("start_chat_num");

    // 越界区间（全书 4 章，问 10-20）→ 空列表但 total=0，不是报错
    const beyond = await inject("GET", `/novel/${novelId}/chapters?start_chat_num=10&end_chat_num=20`, undefined, userA);
    expect(beyond.code).toBe(0);
    expect((beyond.data as ChapterList).list).toEqual([]);
    expect((beyond.data as ChapterList).total).toBe(0);

    // 区间与分页组合：区间先收窄，分页再开窗
    const paged = await inject(
      "GET",
      `/novel/${novelId}/chapters?start_chat_num=1&end_chat_num=4&page=2&page_size=2`,
      undefined,
      userA,
    );
    const pagedData = paged.data as ChapterList;
    expect(pagedData.list.map((c) => c.chapter_no)).toEqual([3, 4]);
    // total 是区间内总数（4），不是当前页条数
    expect(pagedData.total).toBe(4);
  });

  it("only_episodes 导出：仍是纯函数且只去掉章节段（第 90 批行为的回归保护）", async () => {
    const full = await app.inject({
      method: "GET",
      url: `/v1/novel/${novelId}/download`,
      headers: { authorization: `Bearer ${userA.token}` },
    });
    expect(full.statusCode).toBe(200);
    expect(full.body).toContain("第1章");

    const onlyEp = await app.inject({
      method: "GET",
      url: `/v1/novel/${novelId}/download?only_episodes=1`,
      headers: { authorization: `Bearer ${userA.token}` },
    });
    expect(onlyEp.statusCode).toBe(200);
    // 只导分集时不该再有章节标题段
    const fullHasChapters = full.body.includes("旧信");
    const onlyHasChapters = onlyEp.body.includes("旧信");
    expect(fullHasChapters).toBe(true);
    expect(onlyHasChapters).toBe(false);

    // 纯函数：同样的库给同样的文本（两次调用逐字节相同）
    const again = await app.inject({
      method: "GET",
      url: `/v1/novel/${novelId}/download?only_episodes=1`,
      headers: { authorization: `Bearer ${userA.token}` },
    });
    expect(again.body).toBe(onlyEp.body);
  });
});
