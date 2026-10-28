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
 * 第 73 批：项目资产的「单条详情 / 批量详情 / 批量定稿」（竞品 resource 域三条端点）。
 *
 * 竞品证据（`_acceptance/competitor_endpoints.tsv`）：
 * - `GET /web/v1/df/resources/:sp_id/:resource_id/info`（params `sp_id,resource_id`）= 单个资源详情
 * - `POST /web/v1/df/resources/batch-info` = 批量详情
 * - `POST /web/v1/df/resources/batch-confirm` = 批量定稿
 * 竞品 CLI `commands/resource.md:92` `resource get`、`:96` `resource batch-info`、`:100` `resource batch-confirm`
 * 三个动词，而我方三条都只停留在 CLI 骨架（reason 写着「我方无端点」）。
 *
 * 本 spec 钉住四条不变量：
 * ① 详情读的是「本项目内」的资产：跨空间 / 别的项目一律 400102，坏 id 一律 400101 而不是 500；
 * ② 批量**读**宽松：查不到的 id 进 `missing`，不让整屏变错误页；
 * ③ 批量**写**严格：任一 id 不属于本项目即整批 400102 且一条都不落库（不做部分成功）；
 * ④ 定稿幂等：重复定稿不刷新 `finalized_at`（与 `PATCH assets/:assetId {status:2}` 同一规则）。
 */
let app: NestFastifyApplication;
const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const phone = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
const otherPhone = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
let token = "";
let otherToken = "";
let projectId = "";
let sceneId = "";
let propId = "";
let otherId = "";

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

/** 单条详情（断言用：拿 status/finalized_at 这类会变的字段） */
async function detail(assetId: string) {
  const res = await inject("GET", `/projects/${projectId}/assets/${assetId}`);
  expect({ code: res.code, msg: res.msg }).toEqual({ code: 0, msg: "" });
  return res.data as { id: string; kind: string; status: number; finalized_at: string | null };
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
  // 顺序与外键依赖一致：叶子 → 根
  await cleanup(sql`delete from project_assets where project_id in (${scope})`);
  await cleanup(sql`delete from episodes where project_id in (${scope})`);
  await cleanup(sql`delete from script_projects where id in (${scope})`);
  await app.close();
  await pool.end();
});

describe("项目资产：详情 / 批量详情 / 批量定稿（第 73 批）", () => {
  it("准备一个项目与三类资产（scene / prop / other）", async () => {
    const created = await inject("POST", "/projects", {
      title: `资产批量-${stamp}`,
      source_type: 1,
      source_text: "第一场：客厅，夜。桌上一把钥匙。",
    });
    expect(created.code).toBe(0);
    projectId = created.data.id;

    const mk = async (kind: string, name: string): Promise<string> => {
      const res = await inject("POST", `/projects/${projectId}/assets`, { kind, name: `${name}-${stamp}` });
      expect({ code: res.code, msg: res.msg }).toEqual({ code: 0, msg: "" });
      return res.data.id as string;
    };
    sceneId = await mk("scene", "客厅");
    propId = await mk("prop", "钥匙");
    otherId = await mk("other", "杂物");

    const [scene, prop, other] = await Promise.all([detail(sceneId), detail(propId), detail(otherId)]);
    expect([scene.kind, prop.kind, other.kind]).toEqual(["scene", "prop", "other"]);
    // 新建即草稿，尚未定稿
    expect([scene.status, prop.status, other.status]).toEqual([1, 1, 1]);
    expect([scene.finalized_at, prop.finalized_at, other.finalized_at]).toEqual([null, null, null]);
  });

  it("GET assets/:assetId：本项目内可读、跨空间/不存在/坏 id 分别是 400102 与 400101", async () => {
    const res = await inject("GET", `/projects/${projectId}/assets/${sceneId}`);
    expect(res.code).toBe(0);
    expect(res.data.id).toBe(sceneId);
    expect(res.data.kind).toBe("scene");
    expect(res.data.name).toContain(stamp);
    // DTO 契约：绑定计数从 0 起（本 spec 不建分镜），且带 finalized_at 字段
    expect(res.data.bound_shot_count).toBe(0);
    expect(res.data).toHaveProperty("finalized_at", null);

    const bad = await inject("GET", `/projects/${projectId}/assets/abc`);
    expect(bad.code).toBe(400101);
    expect(bad.msg).toContain("invalid asset id");

    const missing = await inject("GET", `/projects/${projectId}/assets/9999999999`);
    expect(missing.code).toBe(400102);
    expect(missing.msg).toContain("asset not found");

    // 别的空间拿同一个 projectId 也读不到（findProject 先按 spaceId 收口）
    const cross = await inject("GET", `/projects/${projectId}/assets/${sceneId}`, undefined, otherToken);
    expect(cross.code).toBe(400102);

    const badProject = await inject("GET", `/projects/9999999999/assets/${sceneId}`);
    expect(badProject.code).toBe(400102);
  });

  it("POST assets/batch-info：命中全量返回、查不到的进 missing（读宽松）", async () => {
    const all = await inject("POST", `/projects/${projectId}/assets/batch-info`, {
      asset_ids: [sceneId, propId, otherId],
    });
    expect(all.code).toBe(0);
    expect(all.data.list).toHaveLength(3);
    expect(all.data.missing).toEqual([]);
    expect(all.data.list.map((row: { id: string }) => row.id).sort()).toEqual(
      [sceneId, propId, otherId].sort(),
    );

    const partial = await inject("POST", `/projects/${projectId}/assets/batch-info`, {
      asset_ids: [sceneId, "9999999999"],
    });
    expect(partial.code).toBe(0);
    expect(partial.data.list).toHaveLength(1);
    expect(partial.data.list[0].id).toBe(sceneId);
    expect(partial.data.missing).toEqual(["9999999999"]);

    // 参数校验：空数组不是「全部」；非数字 id 说明是哪一个字段；上限 100
    for (const [payload, needle] of [
      [{ asset_ids: [] }, "asset_ids"],
      [{ asset_ids: ["abc"] }, "asset_ids must be numeric ids"],
      [
        { asset_ids: Array.from({ length: 101 }, (_, i) => String(i + 1)) },
        "asset_ids",
      ],
    ] as Array<[Record<string, unknown>, string]>) {
      const res = await inject("POST", `/projects/${projectId}/assets/batch-info`, payload);
      expect(res.code).toBe(400101);
      expect(res.msg).toContain(needle);
    }

    // 跨空间：项目先被 findProject 挡掉
    const cross = await inject("POST", `/projects/${projectId}/assets/batch-info`, { asset_ids: [sceneId] }, otherToken);
    expect(cross.code).toBe(400102);
  });

  it("POST assets/batch-confirm：批量定稿、幂等、且绝不部分成功（写严格）", async () => {
    const confirmed = await inject("POST", `/projects/${projectId}/assets/batch-confirm`, {
      asset_ids: [sceneId, propId],
    });
    expect({ code: confirmed.code, msg: confirmed.msg }).toEqual({ code: 0, msg: "" });
    expect(confirmed.data.confirmed).toBe(2);
    expect(confirmed.data.asset_ids.sort()).toEqual([sceneId, propId].sort());

    const afterFirst = await Promise.all([detail(sceneId), detail(propId)]);
    expect(afterFirst.map((row) => row.status)).toEqual([2, 2]);
    for (const row of afterFirst) expect(row.finalized_at).not.toBeNull();
    const firstFinalizedAt = afterFirst[0]!.finalized_at;

    // 幂等：再次定稿不刷新时间戳
    const again = await inject("POST", `/projects/${projectId}/assets/batch-confirm`, { asset_ids: [sceneId] });
    expect(again.code).toBe(0);
    expect((await detail(sceneId)).finalized_at).toBe(firstFinalizedAt);

    // 严格：混入一个不属于本项目的 id → 整批 400102，合法的那个也不许被改
    const poisoned = await inject("POST", `/projects/${projectId}/assets/batch-confirm`, {
      asset_ids: [otherId, "9999999999"],
    });
    expect(poisoned.code).toBe(400102);
    expect(poisoned.msg).toContain("asset not found in this project");
    expect((await detail(otherId)).status).toBe(1); // 仍是草稿：没有部分成功
    expect((await detail(otherId)).finalized_at).toBeNull();

    // 坏 id 与跨空间
    const bad = await inject("POST", `/projects/${projectId}/assets/batch-confirm`, { asset_ids: ["abc"] });
    expect(bad.code).toBe(400101);
    expect(bad.msg).toContain("asset_ids must be numeric ids");

    const cross = await inject(
      "POST",
      `/projects/${projectId}/assets/batch-confirm`,
      { asset_ids: [otherId] },
      otherToken,
    );
    expect(cross.code).toBe(400102);
    expect((await detail(otherId)).status).toBe(1);
  });

  it("批量接口不跨项目串号：拿别的项目的资产 id 也不行", async () => {
    const other = await inject("POST", "/projects", {
      title: `资产批量-另一项目-${stamp}`,
      source_type: 1,
      source_text: "外项目文本。",
    });
    expect(other.code).toBe(0);
    const otherProjectId = other.data.id as string;
    const foreignAsset = await inject("POST", `/projects/${otherProjectId}/assets`, {
      kind: "scene",
      name: `外项目场景-${stamp}`,
    });
    expect(foreignAsset.code).toBe(0);
    const foreignId = foreignAsset.data.id as string;

    const info = await inject("POST", `/projects/${projectId}/assets/batch-info`, {
      asset_ids: [foreignId],
    });
    expect(info.code).toBe(0);
    expect(info.data.list).toEqual([]);
    expect(info.data.missing).toEqual([foreignId]);

    const confirm = await inject("POST", `/projects/${projectId}/assets/batch-confirm`, {
      asset_ids: [foreignId],
    });
    expect(confirm.code).toBe(400102);

    // 外项目资产本身没被改
    const foreignDetail = await inject("GET", `/projects/${otherProjectId}/assets/${foreignId}`);
    expect(foreignDetail.code).toBe(0);
    expect(foreignDetail.data.status).toBe(1);
  });
});
