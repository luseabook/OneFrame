import { afterAll, beforeAll, describe, expect, it } from "vitest";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq, inArray } from "drizzle-orm";
import { adminUsers, models, spaces, tasks, users } from "@app/db";
import { newId } from "@app/shared";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { db } from "../src/db/database";

/**
 * P2 AI 标识审计 e2e（契约 §2.4）：`GET /ops/admin/ai-labels` 与 `.csv`。
 *
 * 覆盖的**行为契约**：
 * 1. 基集是 `tasks.status=3` + `results is not null` + `finished_at` 落在 [from,to]；
 * 2. `ai_label` 从 `results[0].meta.ai_label` 解析：`has_ai_label` 与 `enabled/explicit/implicit` 分开；
 * 3. `only_missing=1` 只留没有标签的行；
 * 4. 内存分页：`total` 是过滤后的总数，越界 page 归一；
 * 5. CSV 表头列顺序固定、`text/csv`、`model` 列是人可读模型名（不是 model_id）；
 * 6. 非法时间/分页 → 400101。
 *
 * 本机没有 PG 时直接失败（与其余 admin e2e 同口径）。契约 §5 规定本文件**只写不跑**，
 * 由 CI 执行；本机门禁是 `admin-invite-code.unit.spec.ts`（纯函数）。
 */
describe("ops admin P2 (ai-labels)", () => {
  let app: NestFastifyApplication;
  let token = "";
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const modelName = `p2-ai-label-model-${suffix}`;

  let userId = "";
  let spaceId = "";
  let modelId = "";
  let labeledTaskId = "";
  let missingTaskId = "";
  let disabledTaskId = "";
  let failedTaskId = "";
  let emptyResultsTaskId = "";
  const createdTaskIds: string[] = [];

  const inject = async (method: "GET" | "POST", url: string, payload?: unknown) => {
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await app.inject({
      method,
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
      data: (body as { data?: any }).data,
      raw: res.body,
      contentType: String(res.headers["content-type"] ?? ""),
    };
  };

  /** 相对当前时间的完成时间（任务按 finished_at desc 排序，用固定偏移让顺序可预期） */
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.register(cookie as never);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const login = await inject("POST", "/ops/admin/login", { username: "admin", password: "admin12345" });
    expect(login.code).toBe(0);
    token = login.data.token as string;
    expect((await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.username, "admin"))).length).toBe(1);

    // 自造模型/用户/空间，不依赖 seed（seed 的模型名在 CI 上可能变）
    userId = String(newId());
    spaceId = String(newId());
    modelId = String(newId());
    await db.insert(users).values({ id: BigInt(userId), nickname: `p2-ai-${suffix}` });
    await db.insert(spaces).values({ id: BigInt(spaceId), ownerUserId: BigInt(userId), type: 1, name: "p2 ai space" });
    await db.insert(models).values({
      id: BigInt(modelId),
      vendor: "self",
      name: modelName,
      displayName: `AI 标识模型 ${suffix}`,
      description: "",
      logo: "",
      capability: "video",
      types: [],
      tags: [],
      promotions: [],
      adapterCode: "mock-video",
      visible: true,
      needVip: false,
      audioVideoSupport: false,
      sort: 100,
      modeOrder: {},
      modes: {},
      sceneModes: {},
    });

    const base = {
      spaceId: BigInt(spaceId),
      userId: BigInt(userId),
      capability: "video",
      mode: "text2video",
      modelId: BigInt(modelId),
      input: {},
      options: {},
    };

    /**
     * 五个夹具对应五种真实形态（worker `label.ts` 的三种产出 + 两种不该进基集的行）：
     * - labeled：显式+隐式都成功；
     * - missing：老任务，`results` 里根本没有 meta.ai_label；
     * - disabled：开关关闭时写入的 `{enabled:false}`（有标签但没打）；
     * - failed：status=1（未成功），不该进基集；
     * - emptyResults：status=3 但 results 为 null，不该进基集。
     */
    labeledTaskId = String(newId());
    missingTaskId = String(newId());
    disabledTaskId = String(newId());
    failedTaskId = String(newId());
    emptyResultsTaskId = String(newId());
    createdTaskIds.push(labeledTaskId, missingTaskId, disabledTaskId, failedTaskId, emptyResultsTaskId);

    await db.insert(tasks).values([
      {
        ...base,
        id: BigInt(labeledTaskId),
        status: 3,
        finishedAt: minutesAgo(1),
        results: [
          {
            url: "s3://spec/labeled.mp4",
            meta: { ai_label: { enabled: true, ai_generated: true, explicit: true, implicit: true } },
          },
        ],
      },
      {
        ...base,
        id: BigInt(missingTaskId),
        status: 3,
        finishedAt: minutesAgo(2),
        results: [{ url: "s3://spec/missing.mp4" }],
      },
      {
        ...base,
        id: BigInt(disabledTaskId),
        status: 3,
        finishedAt: minutesAgo(3),
        results: [{ url: "s3://spec/disabled.mp4", meta: { ai_label: { enabled: false } } }],
      },
      {
        ...base,
        id: BigInt(failedTaskId),
        status: 1,
        finishedAt: null,
        results: [{ url: "s3://spec/failed.mp4", meta: { ai_label: { enabled: true, explicit: true, implicit: true } } }],
      },
      {
        ...base,
        id: BigInt(emptyResultsTaskId),
        status: 3,
        finishedAt: minutesAgo(4),
        results: null,
      },
    ]);
  });

  afterAll(async () => {
    try {
      // 外键顺序：任务 → 空间 → 用户 → 模型
      if (createdTaskIds.length > 0) {
        await db.delete(tasks).where(inArray(tasks.id, createdTaskIds.map((id) => BigInt(id))));
      }
      await db.delete(spaces).where(eq(spaces.id, BigInt(spaceId)));
      await db.delete(users).where(eq(users.id, BigInt(userId)));
      await db.delete(models).where(eq(models.id, BigInt(modelId)));
    } finally {
      await app.close();
    }
  });

  it("基集与解析：有标签/无标签/enabled=false 三种形态都能分辨", async () => {
    const res = await inject("GET", "/ops/admin/ai-labels?page_size=100");
    expect(res.code).toBe(0);
    expect(res.data.page).toBe(1);
    expect(res.data.page_size).toBe(100);
    expect(typeof res.data.total).toBe("number");

    const list = res.data.list as any[];
    const byId = new Map(list.map((row) => [row.task_id, row]));

    const labeled = byId.get(labeledTaskId);
    expect(labeled).toBeTruthy();
    expect(labeled).toMatchObject({
      space_id: spaceId,
      model_id: modelId,
      model_name: `AI 标识模型 ${suffix}`,
      mode: "text2video",
      status: 3,
      has_ai_label: true,
      enabled: true,
      explicit: true,
      implicit: true,
      explicit_reason: null,
      result_count: 1,
    });
    expect(typeof labeled.finished_at).toBe("string");
    expect(typeof labeled.created_at).toBe("string");
    expect(Object.keys(labeled).sort()).toEqual([
      "created_at",
      "enabled",
      "explicit",
      "explicit_reason",
      "finished_at",
      "has_ai_label",
      "implicit",
      "mode",
      "model_id",
      "model_name",
      "result_count",
      "space_id",
      "status",
      "task_id",
    ]);

    const missing = byId.get(missingTaskId);
    expect(missing.has_ai_label).toBe(false);
    // 没写标签时是 null 而不是 false：这两个语义不能混
    expect(missing.enabled).toBeNull();
    expect(missing.explicit).toBeNull();
    expect(missing.implicit).toBeNull();
    expect(missing.explicit_reason).toBeNull();

    const disabled = byId.get(disabledTaskId);
    expect(disabled.has_ai_label).toBe(true);
    expect(disabled.enabled).toBe(false);
    expect(disabled.explicit).toBeNull();

    // 非成功任务 / results 为 null：都不在基集里
    expect(byId.has(failedTaskId)).toBe(false);
    expect(byId.has(emptyResultsTaskId)).toBe(false);
  });

  it("only_missing=1 只留没有 ai_label 的行", async () => {
    const res = await inject("GET", "/ops/admin/ai-labels?only_missing=1&page_size=100");
    expect(res.code).toBe(0);
    const ids = (res.data.list as any[]).map((row) => row.task_id);
    expect(ids).toContain(missingTaskId);
    expect(ids).not.toContain(labeledTaskId);
    // enabled=false 也算"写了标签"，不该出现在漏标清单里
    expect(ids).not.toContain(disabledTaskId);
    for (const row of res.data.list) expect(row.has_ai_label).toBe(false);
  });

  it("from/to 时间范围按 finished_at 过滤", async () => {
    // 窗口必须**宽松地包住**夹具：夹具的 finished_at 是 beforeAll 时刻算的
    // （labeled=1min前、missing=2min前、disabled=3min前），而这里的时间是**跑用例时刻**算的，
    // 两者之间有 δ 秒差。原来写 from=2min前 正好压在 missing 的边界上，δ>0 就把它挤出去——
    // 那是夹具的边界抖动，不是过滤逻辑坏了（disabled 仍必须被排除，这条断言不能松）。
    const from = minutesAgo(2.5).toISOString();
    const to = minutesAgo(0.5).toISOString();
    const res = await inject("GET", `/ops/admin/ai-labels?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&page_size=100`);
    expect(res.code).toBe(0);
    const ids = (res.data.list as any[]).map((row) => row.task_id);
    expect(ids).toContain(labeledTaskId);
    expect(ids).toContain(missingTaskId);
    expect(ids).not.toContain(disabledTaskId);
  });

  it("内存分页：page/page_size 生效，total 是过滤后的总数", async () => {
    const first = await inject("GET", "/ops/admin/ai-labels?page=1&page_size=1");
    expect(first.code).toBe(0);
    expect(first.data.list).toHaveLength(1);
    expect(first.data.page_size).toBe(1);
    const total = first.data.total as number;
    expect(total).toBeGreaterThanOrEqual(3);

    const second = await inject("GET", "/ops/admin/ai-labels?page=2&page_size=1");
    expect(second.data.page).toBe(2);
    expect(second.data.list[0].task_id).not.toBe(first.data.list[0].task_id);

    // 越界页归一到最后一页
    const overflow = await inject("GET", "/ops/admin/ai-labels?page=9999&page_size=100");
    expect(overflow.code).toBe(0);
    expect(overflow.data.page).toBeGreaterThanOrEqual(1);

    expect((await inject("GET", "/ops/admin/ai-labels?page_size=999")).code).toBe(400101);
    expect((await inject("GET", "/ops/admin/ai-labels?from=not-a-time")).code).toBe(400101);
  });

  it("ai-labels.csv：表头固定、text/csv、model 列是可读模型名", async () => {
    const res = await inject("GET", "/ops/admin/ai-labels.csv");
    expect(res.status).toBe(200);
    expect(res.contentType).toContain("text/csv");
    const lines = res.raw.split("\n");
    expect(lines[0]).toBe(
      "task_id,space_id,model,mode,status,has_ai_label,enabled,explicit,implicit,explicit_reason,result_count,finished_at",
    );

    const labeledLine = lines.find((line) => line.startsWith(`${labeledTaskId},`));
    expect(labeledLine).toBeTruthy();
    const cells = labeledLine!.split(",");
    expect(cells[1]).toBe(spaceId);
    // model 列是人可读名（display_name），不是 model_id
    expect(cells[2]).toBe(`AI 标识模型 ${suffix}`);
    expect(cells[3]).toBe("text2video");
    expect(cells[4]).toBe("3");
    expect(cells[5]).toBe("true");
    expect(cells[6]).toBe("true");
    expect(cells[7]).toBe("true");
    expect(cells[8]).toBe("true");

    // 只有漏标 → CSV 只剩无标签的行
    const missingCsv = await inject("GET", "/ops/admin/ai-labels.csv?only_missing=1");
    expect(missingCsv.raw).toContain(`${missingTaskId},`);
    expect(missingCsv.raw).not.toContain(`${labeledTaskId},`);
    // 没有标签时四个布尔列导出空串（不是 false）
    const missingLine = missingCsv.raw.split("\n").find((line) => line.startsWith(`${missingTaskId},`));
    expect(missingLine!.split(",")[5]).toBe("false");
    expect(missingLine!.split(",")[6]).toBe("");
  });
});
