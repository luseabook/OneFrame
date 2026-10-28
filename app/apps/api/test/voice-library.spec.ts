import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { db, pool } from "../src/db/database";
import { tasks } from "@app/db";

/**
 * 第 93 批：音色库（#6 工具箱补的支撑面）。
 *
 * 竞品证据（`_acceptance/competitor_endpoints.tsv`）：
 * - `GET /web/v1/ai/voice-clone-list`、`GET|DELETE /web/v1/ai/voice-clone/:task_id`、
 *   `POST /web/v1/ai/voice-clone/rename`（id 在 body）
 * - `POST /web/v1/ai/timbre/collect`、`GET /web/v1/ai/timbre/list`、
 *   `GET /web/v1/ai/timbre-category/list`、`GET /web/v1/ai/text-to-speech/voice/list`
 *
 * 四条不变量（每一条都对应一种「看起来能用、实际会错」的写法）：
 * ① 克隆记录 = `tasks` 的投影（`mode=voice_clone`），不是第二张表 —— 所以列表/详情/改名/删除
 *    都必须与任务状态一致：运行中的任务不能被删，改的名字要和 `GET /tasks/:id` 同源；
 * ② 收藏键只有两种合法形状（`builtin:<id>` / `clone:<task_id>`），且 `clone:` 必须指向
 *    **本空间**的克隆任务 —— 否则可以收藏（并探测到）别人的音色；
 * ③ 收藏幂等：`collect` 省略=取反、显式 true/false 幂等，`collect_count` 是重算值不是累加；
 * ④ 目录分页作用在「内置 + 克隆」合并后的全集上（分两块各分页会让 total 对不上）。
 */
let app: NestFastifyApplication;
const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const phone = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
const otherPhone = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
let token = "";
let otherToken = "";
const createdTaskIds: string[] = [];
let cloneTaskId = "";

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
  headers?: Record<string, string>,
): Promise<Envelope> {
  const res = await app.inject({
    method,
    url: `/v1${url}`,
    headers: {
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(headers ?? {}),
    },
    payload: payload === undefined ? undefined : JSON.stringify(payload),
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

/** 走 `POST /generations` 真正投一个克隆任务（提交侧就是工具箱那张卡，不另开路由） */
async function createClone(prompt: string): Promise<string> {
  const body: Record<string, unknown> = {
    mode: "voice_clone",
    model: "toolbox-voice-clone",
    input: { prompt, reference_uris: ["https://example.test/ref-sample.mp3"] },
    options: { resolution: "per_call", count: 1, voice_name: "我的音色", speed: 1 },
  };
  const quoted = await inject("POST", "/credits/quote", body);
  expect(quoted.code, `quote: ${quoted.msg}`).toBe(0);
  const res = await inject("POST", "/generations", { ...body, quote_id: quoted.data.quote_id }, token, {
    "idempotency-key": `voice-${stamp}-${prompt.slice(0, 6)}-${Date.now()}`,
  });
  expect(res.code, res.msg).toBe(0);
  createdTaskIds.push(res.data.task_id as string);
  return res.data.task_id as string;
}

/** 把任务推到终态（列表/删除用例需要；worker 在测试里不跑） */
async function finishTask(taskId: string, status = 3): Promise<void> {
  await db
    .update(tasks)
    .set({
      status,
      creditsFrozen: 0,
      results: status === 3 ? [{ uri: `u/voice/${taskId}/r0.mp3` }] : [],
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, BigInt(taskId)));
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
  for (const taskId of createdTaskIds) {
    await cleanup(sql`delete from task_events where task_id = ${taskId}::bigint`);
    await cleanup(sql`delete from voice_favorites where timbre_key = ${`clone:${taskId}`}`);
    await cleanup(sql`delete from tasks where id = ${taskId}::bigint`);
  }
  await cleanup(sql`delete from credit_flows where ref_task_id in (${sql.join(createdTaskIds.map((id) => sql`${id}::bigint`), sql`, `)})`);
  await app.close();
  await pool.end();
});

describe("音色库：我的音色 / 目录 / 收藏（第 93 批）", () => {
  it("提交侧：克隆任务走 POST /generations 落 mode=voice_clone；缺参考音频被拦在冻结之前", async () => {
    // 缺参考音频：卡上 audio 槽是 required，必须在冻结积分前拦住
    const missing = await inject(
      "POST",
      "/generations",
      {
        mode: "voice_clone",
        model: "toolbox-voice-clone",
        input: { prompt: "缺少参考音频", reference_uris: [] },
        options: { resolution: "per_call", count: 1 },
      },
      token,
      { "idempotency-key": `voice-missing-${stamp}` },
    );
    expect(missing.code).not.toBe(0);
    expect(String(missing.msg)).toContain("reference_uris");

    cloneTaskId = await createClone("这是克隆出来的第一个音色");
    const [row] = await db.select().from(tasks).where(eq(tasks.id, BigInt(cloneTaskId)));
    expect(row?.mode).toBe("voice_clone");
    expect(row?.capability).toBe("speech");
  });

  it("我的音色列表：只投影本空间的克隆任务，名字缺省「我的音色」", async () => {
    const mine = await inject("GET", "/ai/voice-clone-list");
    expect(mine.code, mine.msg).toBe(0);
    const ids = (mine.data.list as Array<{ task_id: string }>).map((item) => item.task_id);
    expect(ids).toContain(cloneTaskId);
    expect(mine.data.total).toBeGreaterThanOrEqual(1);

    // 别的空间看不到（克隆记录是任务行，任务按 space 隔离）
    const other = await inject("GET", "/ai/voice-clone-list", undefined, otherToken);
    expect(other.code).toBe(0);
    expect((other.data.list as Array<{ task_id: string }>).map((item) => item.task_id)).not.toContain(cloneTaskId);
  });

  it("详情：与列表行同源；非克隆任务/非法 id/跨空间都报没找到", async () => {
    await finishTask(cloneTaskId);
    const list = await inject("GET", "/ai/voice-clone-list");
    const row = (list.data.list as Array<Record<string, unknown>>).find((item) => item.task_id === cloneTaskId)!;
    const detail = await inject("GET", `/ai/voice-clone/${cloneTaskId}`);
    expect(detail.code, detail.msg).toBe(0);
    // 同一份数据的两个入口：名字/状态/试听地址必须一致，否则前端要写两套
    expect(detail.data.name).toBe(row.name);
    expect(detail.data.status).toBe(row.status);
    expect(detail.data.preview_url).toBe(row.preview_url);
    expect(detail.data.result_count).toBe(1);

    // 非克隆任务（tts）不是音色
    const ttsBody: Record<string, unknown> = {
      mode: "tts",
      model: "toolbox-tts",
      input: { prompt: "一段普通配音" },
      options: { resolution: "per_call", count: 1, voice: "zh_female_shuangkuaisisi", speed: 1 },
    };
    const quoted = await inject("POST", "/credits/quote", ttsBody);
    const tts = await inject("POST", "/generations", { ...ttsBody, quote_id: quoted.data.quote_id }, token, {
      "idempotency-key": `voice-tts-${stamp}`,
    });
    expect(tts.code, tts.msg).toBe(0);
    createdTaskIds.push(tts.data.task_id as string);
    const wrongType = await inject("GET", `/ai/voice-clone/${String(tts.data.task_id)}`);
    expect(wrongType.code).toBe(400102);

    const illegal = await inject("GET", "/ai/voice-clone/abc");
    expect(illegal.code).toBe(400101);

    const crossSpace = await inject("GET", `/ai/voice-clone/${cloneTaskId}`, undefined, otherToken);
    expect(crossSpace.code).toBe(400102);
  });

  it("改名：写的是 tasks.title，列表立刻同步；空名被拒、非克隆任务报没找到", async () => {
    const renamed = await inject("POST", "/ai/voice-clone/rename", { task_id: cloneTaskId, name: "旁白男声" });
    expect(renamed.code, renamed.msg).toBe(0);
    expect(renamed.data.name).toBe("旁白男声");

    const list = await inject("GET", "/ai/voice-clone-list");
    const row = (list.data.list as Array<{ task_id: string; name: string }>).find(
      (item) => item.task_id === cloneTaskId,
    );
    expect(row?.name).toBe("旁白男声");

    // 与任务详情同源（同一条 tasks.title 列）
    const task = await inject("GET", `/tasks/${cloneTaskId}`);
    expect(task.data.title).toBe("旁白男声");

    const empty = await inject("POST", "/ai/voice-clone/rename", { task_id: cloneTaskId, name: "   " });
    expect(empty.code).toBe(400101);

    const crossSpace = await inject(
      "POST",
      "/ai/voice-clone/rename",
      { task_id: cloneTaskId, name: "抢改名" },
      otherToken,
    );
    expect(crossSpace.code).toBe(400102);
  });

  it("收藏：builtin 键可收藏/取消，省略 collect=取反，计数是重算值", async () => {
    const key = "builtin:zh_female_shuangkuaisisi";
    const first = await inject("POST", "/ai/timbre/collect", { timbre_key: key });
    expect(first.code, first.msg).toBe(0);
    expect(first.data.collected).toBe(true);
    expect(first.data.collect_count).toBeGreaterThanOrEqual(1);

    // 幂等：显式 true 再来一次 → 不会变两行
    const again = await inject("POST", "/ai/timbre/collect", { timbre_key: key, collect: true });
    expect(again.data.collected).toBe(true);
    expect(again.data.collect_count).toBe(first.data.collect_count);

    // 省略 = 取反
    const toggled = await inject("POST", "/ai/timbre/collect", { timbre_key: key });
    expect(toggled.data.collected).toBe(false);
    expect(toggled.data.collect_count).toBe(first.data.collect_count - 1);

    // 恢复收藏状态给后续用例用
    await inject("POST", "/ai/timbre/collect", { timbre_key: key, collect: true });
  });

  it("收藏：键形状与归属都要校验 —— 未知内置音色/格式错/别人的克隆都拒绝", async () => {
    const unknownBuiltin = await inject("POST", "/ai/timbre/collect", { timbre_key: "builtin:no_such_voice" });
    expect(unknownBuiltin.code).toBe(400101);
    expect(String(unknownBuiltin.msg)).toContain("builtin");

    const badShape = await inject("POST", "/ai/timbre/collect", { timbre_key: "whatever" });
    expect(badShape.code).toBe(400101);
    expect(String(badShape.msg)).toContain("timbre_key");

    // 别人的克隆任务不能被收藏（否则等于确认了对方那个 id 存在且是克隆）
    const foreign = await inject(
      "POST",
      "/ai/timbre/collect",
      { timbre_key: `clone:${cloneTaskId}` },
      otherToken,
    );
    expect(foreign.code).toBe(400102);

    // 自己的克隆可以收藏，且目录里会带 is_collected
    const own = await inject("POST", "/ai/timbre/collect", { timbre_key: `clone:${cloneTaskId}` });
    expect(own.code, own.msg).toBe(0);
    expect(own.data.collected).toBe(true);
  });

  it("音色目录：内置 + 我的克隆合并分页；category/lang/only_collected 过滤生效", async () => {
    const all = await inject("GET", "/ai/timbre/list?page=1&page_size=100");
    expect(all.code, all.msg).toBe(0);
    const rows = all.data.list as Array<Record<string, unknown>>;
    expect(rows.some((item) => item.timbre_key === "builtin:zh_female_shuangkuaisisi")).toBe(true);
    expect(rows.some((item) => item.timbre_key === `clone:${cloneTaskId}`)).toBe(true);
    expect(rows.find((item) => item.timbre_key === `clone:${cloneTaskId}`)?.task_id).toBe(cloneTaskId);
    // total 是合并后的全集，不是某一页的长度
    expect(all.data.total).toBe(rows.length);

    const clones = await inject("GET", "/ai/timbre/list?page=1&page_size=100&category=clone");
    expect((clones.data.list as Array<Record<string, unknown>>).every((item) => item.source === "clone")).toBe(true);
    expect(clones.data.total).toBe(1);

    const english = await inject("GET", "/ai/timbre/list?page=1&page_size=100&lang=en");
    expect((english.data.list as Array<Record<string, unknown>>).every((item) => item.lang === "en")).toBe(true);

    const collected = await inject("GET", "/ai/timbre/list?page=1&page_size=100&only_collected=1");
    expect((collected.data.list as Array<Record<string, unknown>>).every((item) => item.is_collected === true)).toBe(
      true,
    );
    expect(collected.data.total).toBeGreaterThanOrEqual(2);

    // 分页作用在全集上：第二页与第一页无重叠
    const p1 = await inject("GET", "/ai/timbre/list?page=1&page_size=3");
    const p2 = await inject("GET", "/ai/timbre/list?page=2&page_size=3");
    const keys1 = (p1.data.list as Array<{ timbre_key: string }>).map((item) => item.timbre_key);
    const keys2 = (p2.data.list as Array<{ timbre_key: string }>).map((item) => item.timbre_key);
    expect(keys1.length).toBe(3);
    expect(keys1.filter((key) => keys2.includes(key))).toEqual([]);
    expect(p1.data.total).toBe(p2.data.total);
  });

  it("音色分类：内置按性别/语种分组，有克隆时多出 clone 组", async () => {
    const res = await inject("GET", "/ai/timbre-category/list");
    expect(res.code, res.msg).toBe(0);
    const categories = (res.data.list as Array<{ category: string; count: number }>).map((item) => item.category);
    expect(categories).toContain("female");
    expect(categories).toContain("male");
    expect(categories).toContain("english");
    expect(categories).toContain("preset");
    expect(categories).toContain("clone");
    expect(res.data.collected_count).toBeGreaterThanOrEqual(2);
  });

  it("文生语音音色清单：只出 TTS 内置音色（不含改造预设与克隆），支持 lang_code", async () => {
    const res = await inject("GET", "/ai/text-to-speech/voice/list");
    expect(res.code, res.msg).toBe(0);
    const list = res.data.list as Array<{ voice_id: string; is_default: boolean; lang: string }>;
    expect(list.map((item) => item.voice_id)).toContain("zh_female_shuangkuaisisi");
    expect(list.some((item) => item.is_default)).toBe(true);
    // 改造预设与克隆音色不能出现在 tts 的 voice 参数里（供应商会拒）
    expect(list.map((item) => item.voice_id)).not.toContain("warm_female");
    expect(list.map((item) => item.voice_id)).not.toContain(cloneTaskId);

    const enOnly = await inject("GET", "/ai/text-to-speech/voice/list?lang_code=en");
    expect((enOnly.data.list as Array<{ lang: string }>).every((item) => item.lang === "en")).toBe(true);
  });

  it("删除：软删后列表与详情都查不到；重复删报没找到", async () => {
    const removed = await inject("DELETE", `/ai/voice-clone/${cloneTaskId}`);
    expect(removed.code, removed.msg).toBe(0);
    expect(removed.data.deleted).toBe(true);

    const list = await inject("GET", "/ai/voice-clone-list?page=1&page_size=100");
    expect((list.data.list as Array<{ task_id: string }>).map((item) => item.task_id)).not.toContain(cloneTaskId);

    const detail = await inject("GET", `/ai/voice-clone/${cloneTaskId}`);
    expect(detail.code).toBe(400102);

    const repeat = await inject("DELETE", `/ai/voice-clone/${cloneTaskId}`);
    expect(repeat.code).toBe(400102);
  });

  it("删除：运行中的克隆任务不能删（与 DELETE /tasks/:id 同一套前置）", async () => {
    const runningId = await createClone("运行中的克隆");
    const res = await inject("DELETE", `/ai/voice-clone/${runningId}`);
    expect(res.code).toBe(400101);
    expect(String(res.msg)).toContain("running");
    await finishTask(runningId, 5);
  });
});
