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
 * 抽取流水线（extraction）契约测试 —— 对照 `cmd/resource.md:536-727`。
 *
 * 重点验证：
 * 1. **四态**：1 进行中 / 2 成功 / 3 失败 / 4 失效；`retryable` 只有 3/4 为真；
 * 2. **task_type 语义**：1 清单只要名单（prompt 为空）、3 只抽场景且带提示词、
 *    5 三合一 —— 选错会让「资产确认页」拿到不该有的数据类型；
 * 3. **eed_id 批次**：一次抽取一落一批草稿，`eed_id` 可用来筛；重做换新批次；
 * 4. **主子形态**：`parent_state_id` 指父 `eed_id`，默认只查主形态、`is_all=true` 平铺；
 *    混合类型/重复 state_id/一组多主/孤儿父 → 400101 且**零写入**；
 * 5. **redo 只在失败/失效允许**；成功任务重做 → 400101；源资产已删的失效任务 → 400101。
 *
 * 为什么断言"零写入"要数草稿条数：竞品 `draft-import` 明确写了"校验失败零写请求"，
 * 部分写入会让用户在资产确认页看到半批脏数据。
 */
describe("extraction e2e", () => {
  let app: NestFastifyApplication;
  let token = "";
  let tokenOther = "";
  let projectId = "";
  let episodeId = "";
  const stamp = `ext${Date.now()}`;

  interface Envelope {
    code: number;
    msg: string;
    data: any;
  }

  const raw = async (
    asToken: string,
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    payload?: Record<string, unknown>,
  ): Promise<Envelope> => {
    const res = await app.inject({
      method,
      url: `/v1${url}`,
      payload,
      headers: { authorization: `Bearer ${asToken}` },
    });
    return res.json() as Envelope;
  };
  const inject = (
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    payload?: Record<string, unknown>,
  ) => raw(token, method, url, payload);

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
    return body.data.access_token as string;
  };

  const draftCount = async (query = "") => {
    const res = await inject("GET", `/extraction/drafts?is_all=true${query}`);
    expect(res.code).toBe(0);
    return res.data.total as number;
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

    token = await login(`16${String(Math.floor(Math.random() * 900000000) + 100000000)}`);
    tokenOther = await login(`16${String(Math.floor(Math.random() * 900000000) + 100000000)}`);

    const project = await inject("POST", "/projects", {
      title: `抽取测试-${stamp}`,
      source_type: 1,
      source_text:
        "第一章：林晚在雨夜街头收到一封匿名信，她来到旧仓库，发现一只旧怀表。第二章：顾沉出现在出租屋天台，两人对峙。",
    });
    expect(project.code).toBe(0);
    projectId = project.data.id;
    const outline = await inject("POST", `/projects/${projectId}/outline/generate`);
    expect(outline.code).toBe(0);
    episodeId = outline.data[0].id;
    const draft = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/script-draft/generate`, {});
    expect(draft.code).toBe(0);
  });

  afterAll(async () => {
    // 只清自己造的行（随机后缀）。逐条 best-effort：项目被 tasks/episodes 外键引用时
    // 强删会连带失败，而遗留的带随机后缀的测试夹具对其它用例无影响。
    const cleanup = (query: Parameters<typeof db.execute>[0]) => db.execute(query).catch(() => {});
    await cleanup(sql`delete from extraction_drafts where task_id in (
      select id from extraction_tasks where project_id in (
        select id from script_projects where title like ${`%${stamp}%`}
      )
    )`);
    await cleanup(sql`delete from extraction_tasks where project_id in (
      select id from script_projects where title like ${`%${stamp}%`}
    )`);
    await cleanup(sql`delete from storyboard_assets where storyboard_id in (
      select id from storyboards where episode_id in (
        select id from episodes where project_id in (
          select id from script_projects where title like ${`%${stamp}%`}
        )
      )
    )`);
    await cleanup(sql`delete from storyboards where episode_id in (
      select id from episodes where project_id in (
        select id from script_projects where title like ${`%${stamp}%`}
      )
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

  let listTaskId = "";
  let sceneTaskId = "";

  it("creates a task_type=1 (list) task: succeeds, drafts have empty prompt, eed_id batch set", async () => {
    const created = await inject("POST", "/extraction/tasks", {
      project_id: projectId,
      episode_id: episodeId,
      task_type: 1,
      generate_mode: 2,
    });
    expect(created.code).toBe(0);
    expect(created.data.status).toBe(2);
    expect(created.data.status_name).toBe("succeeded");
    expect(created.data.task_type).toBe(1);
    expect(created.data.eed_id).toMatch(/^eed_/);
    expect(created.data.retryable).toBe(false); // 成功态不可重做
    expect(created.data.draft_count).toBeGreaterThan(0);
    // 清单提取只给名单，不写提示词（role 分工，resource.md:552-568）
    expect(created.data.drafts.every((draft: { payload: { prompt: unknown } }) => draft.payload.prompt === null)).toBe(true);
    listTaskId = created.data.id;

    // 批次（task_id）筛：同一次抽取的草稿都能按任务取回
    const byTask = await inject("GET", `/extraction/drafts?task_id=${created.data.id}`);
    expect(byTask.code).toBe(0);
    expect(byTask.data.total).toBe(created.data.draft_count);
    // 每条草稿有独立 eed_id（对外标识），同一批次共享 task_id/eed_id 批次号
    const eedIds = (byTask.data.list as Array<{ eed_id: string }>).map((row) => row.eed_id);
    expect(new Set(eedIds).size).toBe(eedIds.length);
    expect(created.data.eed_id).toMatch(/^eed_/);
  });

  it("creates a task_type=3 (scene prompts) task: only scenes, prompt present", async () => {
    const created = await inject("POST", "/extraction/tasks", {
      project_id: projectId,
      episode_id: episodeId,
      task_type: 3,
    });
    expect(created.code).toBe(0);
    expect(created.data.status).toBe(2);
    expect(created.data.drafts.length).toBeGreaterThan(0);
    expect(created.data.drafts.every((draft: { kind: number }) => draft.kind === 2)).toBe(true);
    expect(created.data.drafts.every((draft: { payload: { prompt: string } }) => draft.payload.prompt.length > 0)).toBe(
      true,
    );
    sceneTaskId = created.data.id;
  });

  it("rejects invalid task_type (400101) and unfinished project (400101)", async () => {
    const bad = await inject("POST", "/extraction/tasks", { project_id: projectId, task_type: 9 });
    expect(bad.code).toBe(400101);
    const noText = await inject("POST", "/projects", { title: `空项目-${stamp}`, source_type: 1, source_text: "" });
    expect(noText.code).toBe(0);
    const empty = await inject("POST", "/extraction/tasks", { project_id: noText.data.id, task_type: 1 });
    // 没有可抽取内容 → 任务创建但因内容缺失失败(3)，不是静默成功
    expect(empty.code).toBe(0);
    expect(empty.data.status).toBe(3);
    expect(empty.data.error.code).toBe(400101);
  });

  it("gets task detail and isolates by space (400102, no leak)", async () => {
    const detail = await inject("GET", `/extraction/tasks/${listTaskId}`);
    expect(detail.code).toBe(0);
    expect(detail.data.id).toBe(listTaskId);
    expect(detail.data.et_id).toBe(listTaskId);
    expect(detail.data.episode_id).toBe(episodeId);
    expect(detail.data.sub_draft_count).toBe(0);

    const cross = await raw(tokenOther, "GET", `/extraction/tasks/${listTaskId}`);
    // 跨 space 连"任务是否存在"都不泄露
    expect(cross.code).toBe(400102);
  });

  it("lists drafts: main forms only by default, flattened with is_all=true", async () => {
    const main = await inject("GET", `/extraction/drafts?task_id=${listTaskId}`);
    expect(main.code).toBe(0);
    expect(main.data.list.every((draft: { parent_state_id: string | null }) => draft.parent_state_id === null)).toBe(
      true,
    );
    expect(main.data.list.every((draft: { is_sub: boolean }) => draft.is_sub === false)).toBe(true);
  });

  it("imports drafts with main+sub forms (parent_state_id points at parent eed_id)", async () => {
    const before = await draftCount(`&project_id=${projectId}`);
    const imported = await inject("POST", "/extraction/drafts/import", {
      project_id: projectId,
      episode_id: episodeId,
      items: [
        {
          type: "character",
          name: `${stamp}-林晚`,
          prompt: "人物主形态提示词",
          group_id: "g-linwan",
          state_id: "s-main",
        },
        {
          type: "character",
          name: `${stamp}-林晚-微笑`,
          prompt: "人物微笑子形态提示词",
          group_id: "g-linwan",
          state_id: "s-sub",
          parent_state_id: "s-main",
        },
      ],
    });
    expect(imported.code).toBe(0);
    expect(imported.data.task_id).toBeTruthy();
    expect(imported.data.succeeded).toHaveLength(2);
    const main = imported.data.succeeded.find((item: { is_sub: boolean }) => !item.is_sub);
    const sub = imported.data.succeeded.find((item: { is_sub: boolean }) => item.is_sub);
    expect(main.operation).toBe("create");
    expect(main.parent_eed_id).toBeNull();
    // 子形态的 parent 必须是父形态的 eed_id（不是 state_id，也不是 resource_id）
    expect(sub.parent_eed_id).toBe(main.eed_id);
    expect(sub.eed_id).not.toBe(main.eed_id);

    // 默认查询看不到子形态；is_all=true 时平铺且 main_eed_id 指父 eed_id
    const mainsOnly = await inject("GET", `/extraction/drafts?task_id=${imported.data.task_id}`);
    expect(mainsOnly.data.total).toBe(1);
    const all = await inject("GET", `/extraction/drafts?task_id=${imported.data.task_id}&is_all=true`);
    expect(all.data.total).toBe(2);
    const subRow = all.data.list.find((row: { eed_id: string }) => row.eed_id === sub.eed_id);
    expect(subRow.main_eed_id).toBe(main.eed_id);

    // 带 eed_id 再次导入 = 更新而不是新建
    const afterImport = await draftCount(`&project_id=${projectId}`);
    const updated = await inject("POST", "/extraction/drafts/import", {
      task_id: imported.data.task_id,
      items: [{ type: "character", name: `${stamp}-林晚-v2`, prompt: "更新后的提示词", eed_id: main.eed_id }],
    });
    expect(updated.code).toBe(0);
    expect(updated.data.succeeded[0].operation).toBe("update");
    expect(updated.data.succeeded[0].eed_id).toBe(main.eed_id);
    // 更新不新增行
    expect(await draftCount(`&project_id=${projectId}`)).toBe(afterImport);
  });

  it("rejects invalid draft imports with 400101 and writes nothing", async () => {
    const before = await draftCount(`&project_id=${projectId}`);

    // 同一调用混合类型
    const mixed = await inject("POST", "/extraction/drafts/import", {
      project_id: projectId,
      items: [
        { type: "character", name: "A" },
        { type: "scene", name: "B" },
      ],
    });
    expect(mixed.code).toBe(400101);

    // 重复 state_id
    const dup = await inject("POST", "/extraction/drafts/import", {
      project_id: projectId,
      items: [
        { type: "scene", name: "C", state_id: "same" },
        { type: "scene", name: "D", state_id: "same" },
      ],
    });
    expect(dup.code).toBe(400101);

    // 一组两个主形态（既没有父，又有两个）
    const twoMains = await inject("POST", "/extraction/drafts/import", {
      project_id: projectId,
      items: [
        { type: "scene", name: "E", group_id: "g1", state_id: "e1" },
        { type: "scene", name: "F", group_id: "g1", state_id: "e2" },
      ],
    });
    expect(twoMains.code).toBe(400101);

    // 孤儿父引用
    const orphan = await inject("POST", "/extraction/drafts/import", {
      project_id: projectId,
      items: [{ type: "scene", name: "G", group_id: "g2", state_id: "g2-sub", parent_state_id: "missing" }],
    });
    expect(orphan.code).toBe(400101);

    // 校验失败零写请求：条数完全不变
    expect(await draftCount(`&project_id=${projectId}`)).toBe(before);
  });

  it("redo only for failed tasks; redo on succeeded → 400101", async () => {
    const notAllowed = await inject("POST", "/extraction/tasks/redo", { task_id: listTaskId });
    expect(notAllowed.code).toBe(400101);

    // 造一条失败态（供应商失败是真实形态：LLM 挂了/超时）
    await db.execute(sql`
      update extraction_tasks set status = 3, error = '{"code":745901,"message":"vendor timeout"}'::jsonb
      where id = ${BigInt(sceneTaskId)}
    `);
    const failed = await inject("GET", `/extraction/tasks/${sceneTaskId}`);
    expect(failed.data.status).toBe(3);
    expect(failed.data.retryable).toBe(true);

    const redone = await inject("POST", "/extraction/tasks/redo", { task_id: sceneTaskId });
    expect(redone.code).toBe(0);
    expect(redone.data.redo).toBe(true);
    expect(redone.data.status).toBe(2);
    expect(redone.data.eed_id).not.toBe(failed.data.eed_id); // 重做换新批次
  });

  it("marks a task invalid when its source asset is deleted, and refuses redo (retryable=false)", async () => {
    const upload = await app.inject({
      method: "POST",
      url: "/v1/assets/upload",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: JSON.stringify({
        filename: `src-${stamp}.png`,
        content_type: "image/png",
        data_base64:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      }),
    });
    const asset = upload.json() as Envelope;
    expect(asset.code).toBe(0);

    const task = await inject("POST", "/extraction/tasks", {
      source_asset_id: String(asset.data.id),
      task_type: 1,
    });
    expect(task.code).toBe(0);
    expect(task.data.source_asset_id).toBe(String(asset.data.id));

    expect((await inject("DELETE", `/assets/${asset.data.id}`)).code).toBe(0);

    // 源资产被删 → 失效(4)，不是失败(3)：失败可重试，失效重试只会一直失败
    const invalid = await inject("GET", `/extraction/tasks/${task.data.id}`);
    expect(invalid.data.status).toBe(4);
    expect(invalid.data.status_name).toBe("invalid");

    const redo = await inject("POST", "/extraction/tasks/redo", { task_id: task.data.id });
    expect(redo.code).toBe(400101);
    expect(redo.msg).toContain("source asset was deleted");
  });

  it("promotes drafts into project assets (draft → unfinalized asset, no double insert)", async () => {
    const list = await inject("GET", `/extraction/drafts?task_id=${listTaskId}`);
    expect(list.code).toBe(0);
    const eedIds = (list.data.list as Array<{ eed_id: string }>).map((row) => row.eed_id);
    expect(eedIds.length).toBeGreaterThan(0);

    const promoted = await inject("POST", "/extraction/drafts/promote", {
      project_id: projectId,
      eed_ids: eedIds,
    });
    expect(promoted.code).toBe(0);
    expect(promoted.data.items).toHaveLength(eedIds.length);
    // 提升出来的资产是草稿态（status=1），必须再定稿才能用于生成
    const assets = await inject("GET", `/projects/${projectId}/assets`);
    const created = assets.data.list.filter((asset: { id: string }) =>
      promoted.data.items.some((item: { asset_id: string }) => item.asset_id === asset.id),
    );
    expect(created.every((asset: { status: number }) => asset.status === 1)).toBe(true);

    // 幂等：再提升一次不新建资产
    const again = await inject("POST", "/extraction/drafts/promote", {
      project_id: projectId,
      eed_ids: eedIds,
    });
    expect(again.code).toBe(0);
    expect(again.data.items.every((item: { created: boolean }) => item.created === false)).toBe(true);
  });
});
