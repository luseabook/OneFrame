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
 * 第 68 批：分镜手动增删改（竞品 `storyboard-add` / `storyboard/delete` / `storyboard/num-update`）。
 *
 * 竞品证据（`_acceptance/competitor_endpoints.tsv`）：
 * - `POST /web/v1/df/episode/:ep_id/storyboard-add`
 * - `POST /web/v1/df//episode/:ep_id/storyboard/delete`（竞品路径自身有个双斜杠笔误）
 * - `POST /web/v1/df/episode/:ep_id/storyboard/num-update`
 * 三者 `requestDataJsonSchema` 都是空对象 → 入参字段名是我方自定的（已在
 * `packages/shared/src/schemas/pipeline.ts` 的注释里登记「待取证」）。
 *
 * 本 spec 只打 API、不 mock 服务层，重点是三条不变量：
 * ① `uq_storyboards_episode_shot` 不会被"腾号/插队"这一步撞到（负数两段式改号）；
 * ② 插队/重排之后 `shot_no` 仍然是从 1 开始的紧密序列；
 * ③ 跨项目/跨空间的 id 一律 400102，不会被"刚好同号"混过去。
 */
let app: NestFastifyApplication;
const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const phone = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
let token = "";
let projectId = "";
let episodeId = "";
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
): Promise<Envelope> {
  const res = await app.inject({
    method,
    url: `/v1${url}`,
    payload,
    headers: { authorization: `Bearer ${token}` },
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

/** 读一集的当前分镜序列（按 shot_no 升序，接口本身就是这个顺序） */
async function shotNumbers(eid = episodeId): Promise<number[]> {
  const res = await inject("GET", `/projects/${projectId}/episodes/${eid}`);
  expect(res.code).toBe(0);
  return (res.data.storyboards as Array<{ shot_no: number }>).map((shot) => shot.shot_no);
}

async function shotIds(eid = episodeId): Promise<string[]> {
  const res = await inject("GET", `/projects/${projectId}/episodes/${eid}`);
  expect(res.code).toBe(0);
  return (res.data.storyboards as Array<{ id: string }>).map((shot) => shot.id);
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
  await cleanup(sql`delete from episodes where project_id in (${scope})`);
  await cleanup(sql`delete from script_projects where id in (${scope})`);
  await app.close();
  await pool.end();
});

describe("分镜手动增删改（第 68 批）", () => {
  it("准备一个项目与两集", async () => {
    const created = await inject("POST", "/projects", {
      title: `分镜编辑-${stamp}`,
      source_type: 1,
      source_text: "第一章：林晚在雨夜收到匿名信。第二章：旧仓库的真相。",
    });
    expect(created.code).toBe(0);
    projectId = created.data.id;
    const outline = await inject("POST", `/projects/${projectId}/outline/generate`);
    expect(outline.code).toBe(0);
    episodeId = outline.data[0].id;
    otherEpisodeId = outline.data[1].id;
    expect(episodeId).toBeTruthy();
    expect(otherEpisodeId).toBeTruthy();
    expect(await shotNumbers()).toEqual([]);
  });

  it("追加三条：不给号就依次排到末尾，字段回落项目默认", async () => {
    for (const desc of ["镜头一", "镜头二", "镜头三"]) {
      const res = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/storyboards`, {
        shot_desc: desc,
      });
      expect(res.code).toBe(0);
      expect(res.data.shot_desc).toBe(desc);
    }
    expect(await shotNumbers()).toEqual([1, 2, 3]);
    const [first] = (await inject("GET", `/projects/${projectId}/episodes/${episodeId}`)).data.storyboards;
    // 没给 video_prompt 时用 shot_desc 兜底（与 parse.service 的解析口径一致）
    expect(first.video_prompt).toBe("镜头一");
    expect(first.duration_s).toBe(5);
  });

  it("插队：insert_after 插到指定分镜之后，其余自动顺延", async () => {
    const ids = await shotIds();
    const res = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/storyboards`, {
      shot_desc: "插在镜头一之后",
      insert_after: ids[0],
    });
    expect(res.code).toBe(0);
    expect(await shotNumbers()).toEqual([1, 2, 3, 4]);
    const refreshed = (await inject("GET", `/projects/${projectId}/episodes/${episodeId}`)).data
      .storyboards as Array<{ id: string; shot_no: number; shot_desc: string }>;
    expect(refreshed[1]!.id).toBe(res.data.id);
    expect(refreshed[1]!.shot_desc).toBe("插在镜头一之后");
    // 插队不能静默把别人的号改乱：原第 2/3 条顺延成 3/4
    expect(refreshed[2]!.shot_desc).toBe("镜头二");
    expect(refreshed[3]!.shot_desc).toBe("镜头三");
  });

  it("指定 shot_no：空号可以占、重复号与非法组合被拒", async () => {
    const ids = await shotIds();
    const taken = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/storyboards`, {
      shot_desc: "撞号",
      shot_no: 2,
    });
    expect(errCode(taken)).toBe(400101);
    expect(String(taken.msg)).toContain("already used");

    const both = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/storyboards`, {
      shot_desc: "两个都给了",
      shot_no: 9,
      insert_after: ids[0],
    });
    expect(errCode(both)).toBe(400101);
    expect(String(both.msg)).toContain("mutually exclusive");

    const unknown = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/storyboards`, {
      shot_desc: "插在不存在的分镜后",
      insert_after: "9999999999",
    });
    expect(errCode(unknown)).toBe(400102);

    // 占末尾之后的一个空号：应插到该位置并把后面压紧
    const tail = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/storyboards`, {
      shot_desc: "指定 5 号",
      shot_no: 5,
    });
    expect(tail.code).toBe(0);
    expect(await shotNumbers()).toEqual([1, 2, 3, 4, 5]);
  });

  it("删除：单条路径与批量路径都走事务硬删，跨集 id 不生效", async () => {
    const ids = await shotIds();
    // 别的集的分镜 id 塞进来：接口返回 deleted=0，不会误删本条目的行
    const cross = await inject(
      "POST",
      `/projects/${projectId}/episodes/${otherEpisodeId}/storyboards/batch-delete`,
      { shot_ids: ids.slice(0, 2) },
    );
    expect(cross.code).toBe(0);
    expect(cross.data.deleted).toBe(0);
    expect((await shotNumbers()).length).toBe(5);

    const single = await inject(
      "DELETE",
      `/projects/${projectId}/episodes/${episodeId}/storyboards/${ids[0]}`,
    );
    expect(single.code).toBe(0);
    expect(single.data.deleted).toBe(1);
    expect(await shotNumbers()).toEqual([2, 3, 4, 5]);

    const batch = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/storyboards/batch-delete`, {
      shot_ids: [ids[1], ids[2]],
    });
    expect(batch.code).toBe(0);
    expect(batch.data.deleted).toBe(2);
    expect(await shotNumbers()).toEqual([4, 5]);

    const bad = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/storyboards/batch-delete`, {
      shot_ids: ["not-a-id"],
    });
    expect(errCode(bad)).toBe(400101);

    const empty = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/storyboards/batch-delete`, {
      shot_ids: [],
    });
    expect(errCode(empty)).toBe(400101);
  });

  it("重排：给 shot_ids 按给定顺序重排，不给就按现有号压实", async () => {
    const ids = await shotIds();
    expect(ids.length).toBe(2);
    const reversed = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/storyboards/num-update`, {
      shot_ids: [ids[1], ids[0]],
    });
    expect(reversed.code).toBe(0);
    expect(reversed.data.list.map((item: { id: string }) => item.id)).toEqual([ids[1], ids[0]]);
    expect(reversed.data.list.map((item: { shot_no: number }) => item.shot_no)).toEqual([1, 2]);

    const spaced = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/storyboards/num-update`, {
      step: 10,
    });
    expect(spaced.code).toBe(0);
    expect(await shotNumbers()).toEqual([10, 20]);

    // 回到紧密序列，避免影响后续断言
    expect(
      (await inject("POST", `/projects/${projectId}/episodes/${episodeId}/storyboards/num-update`, {})).code,
    ).toBe(0);
    expect(await shotNumbers()).toEqual([1, 2]);
  });

  it("重排的拒绝路径：漏项、重复、跨集、超上限", async () => {
    const ids = await shotIds();
    const missing = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/storyboards/num-update`, {
      shot_ids: [ids[0]],
    });
    expect(errCode(missing)).toBe(400101);
    expect(String(missing.msg)).toContain("exactly once");

    const duplicated = await inject(
      "POST",
      `/projects/${projectId}/episodes/${episodeId}/storyboards/num-update`,
      { shot_ids: [ids[0], ids[0]] },
    );
    expect(errCode(duplicated)).toBe(400101);

    const foreign = await inject(
      "POST",
      `/projects/${projectId}/episodes/${otherEpisodeId}/storyboards/num-update`,
      { shot_ids: ids },
    );
    expect(errCode(foreign)).toBe(400101);

    const oversize = await inject(
      "POST",
      `/projects/${projectId}/episodes/${episodeId}/storyboards/num-update`,
      { step: 1000 },
    );
    expect(errCode(oversize)).toBe(400101);
  });

  it("隔离：别的项目/不存在的项目一律 400102", async () => {
    const ids = await shotIds();
    const unknownProject = await inject(
      "POST",
      `/projects/9999999999/episodes/${episodeId}/storyboards`,
      { shot_desc: "别的项目" },
    );
    expect(errCode(unknownProject)).toBe(400102);

    const unknownEpisode = await inject(
      "POST",
      `/projects/${projectId}/episodes/9999999999/storyboards`,
      { shot_desc: "别的剧集" },
    );
    expect(errCode(unknownEpisode)).toBe(400102);

    const unknownDelete = await inject(
      "DELETE",
      `/projects/${projectId}/episodes/${episodeId}/storyboards/9999999999`,
    );
    expect(unknownDelete.code).toBe(0);
    expect(unknownDelete.data.deleted).toBe(0);
    expect(await shotNumbers()).toEqual([1, 2]);
    expect(ids.length).toBe(2);
  });
});

/** 业务错误一律 HTTP 200 + 非零 code，这里只关心 code */
function errCode(res: Envelope): number {
  return res.code;
}
