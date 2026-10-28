import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { createDb, modelPrices, models, tasks } from "@app/db";
import { GenerationMode } from "@app/shared";
import {
  AudioSeparationAdapter,
  AutoBgmAdapter,
  FpsDurationUnifyAdapter,
  ImageInpaintAdapter,
  POSTPROCESS_CODES,
  resolveAdapter,
  TextRepaintAdapter,
  TimbreModifyAdapter,
  VideoEffectsAdapter,
  type HttpPostprocessAdapter,
} from "@app/model-adapters";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import {
  TOOL_CARDS,
  TOOL_MODES,
  ensureToolCatalog,
  publicToolCatalog,
} from "../src/modules/generations/tool-catalog";

/**
 * 第 3 批工具箱 e2e（20 卡 + 后处理族；第 93 批 +1 张「声音克隆」卡）。
 *
 * 这组用例锁的是**会静默腐化的四处接缝**：
 * 1. 目录（`tool-catalog.ts`）是 20 卡与工具 mode 的单一数据源——
 *    卡与 mode 一旦漂移（卡能点但没人接），只能靠这里断言"每张卡都有 route、
 *    每个 mode 都在 GenerationMode 闭包内"来兜；
 * 2. 报价链路：工具模型/价目是**幂等 ensure** 进 `models`/`model_prices` 的，
 *    任何一处（mode 名、resolution 哨兵值、per_call 约定）写错都会变成
 *    "点了立即生成才报 no price"，前端体验是空白，只能靠价格断言发现；
 * 3. 投递前的输入前置校验：缺素材必须在**冻结积分之前**拦（否则用户等一次失败-退冻）；
 * 4. 适配器分派：新补的 7 个后处理 code 必须解析出正确适配器，且自带的 mock 形状
 *    与产物媒体类型一致（音频不能产出 .mp4，否则前端 <audio> 静默不播）。
 */
let app: NestFastifyApplication;
let token = "";
let otherToken = "";
const createdTaskIds: string[] = [];

interface Envelope {
  code: number;
  msg: string;
  data: any;
}

async function inject(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: Record<string, unknown>,
  authToken?: string,
  headers?: Record<string, string>,
): Promise<Envelope> {
  const bearer = authToken === undefined ? token : authToken;
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

async function loginNewUser(tag: number): Promise<string> {
  const tail = String(Date.now()).slice(-7);
  const phone = `13${tail}${String(tag).padStart(2, "0")}`;
  const sms = await app.inject({ method: "POST", url: "/v1/auth/sms-code", payload: { phone } });
  const smsBody = sms.json() as Envelope;
  const login = (
    await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { phone, code: smsBody.data.debug_code, age_confirmed: true },
    })
  ).json() as Envelope;
  const accessToken = login.data?.access_token as string;
  if (!accessToken) throw new Error(`login failed: ${JSON.stringify(login).slice(0, 200)}`);
  return accessToken;
}

async function readTask(taskId: string) {
  const { db, pool } = createDb(process.env.DATABASE_URL ?? "");
  try {
    const [row] = await db.select().from(tasks).where(eq(tasks.id, BigInt(taskId)));
    return row;
  } finally {
    await pool.end();
  }
}

/** 取目录里某个工具的定义（前端也是这么读的：GET /generations/tools） */
function toolByKey(key: string) {
  const found = TOOL_MODES.find((tool) => tool.key === key);
  if (!found) throw new Error(`tool not found: ${key}`);
  return found;
}

function quoteBody(key: string): Record<string, unknown> {
  const tool = toolByKey(key);
  return {
    mode: tool.mode,
    model: tool.model.name,
    input: { prompt: "工具箱报价用例", reference_uris: [] },
    options: { resolution: tool.modeConfig.default_resolution },
  };
}

beforeAll(async () => {
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
  await app.register(cookie as never);
  app.setGlobalPrefix("v1");
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  token = await loginNewUser(1);
  otherToken = await loginNewUser(2);
  // 目录幂等落库（GET /generations/tools 也会做，这里显式跑一次让后续断言不依赖调用顺序）
  await ensureToolCatalog();
}, 120_000);

afterAll(async () => {
  // 任务跑不到终态（测试环境没有 worker）：用 cancel 把冻结积分退回，避免污染共享 dev 库的余额
  for (const id of createdTaskIds) {
    await inject("POST", `/tasks/${id}/cancel`).catch(() => undefined);
  }
  await app.close();
});

describe("工具箱目录：20 卡 + 16 个工具 mode 的单一数据源", () => {
  it("目录端点返回 20 张卡 / 16 个工具，且每张卡都有落地页", async () => {
    const res = await inject("GET", "/generations/tools");
    expect(res.code).toBe(0);
    const cards = res.data.cards as Array<{ key: string; route: string; surface: string; title: string }>;
    const tools = res.data.tools as Array<{ key: string; mode: string }>;

    /**
     * 20 张卡的数量依据（ADR-013 以竞品证据为准，不凑数）：
     * 17 条 `/create/*`（routes.txt:25-41）+ 灵感成片（routes.txt:42 /creation-agent）
     * + 音色修改（reelmate-feature-map §3.5 报告点名、无独立路由）。
     */
    expect(cards.length).toBe(20);
    expect(TOOL_CARDS.length).toBe(20);
    expect(tools.length).toBe(TOOL_MODES.length);

    // 每张卡都必须有可点的落地页（本批 DoD：不允许"点了提示开发中"的静默态卡）
    for (const card of cards) {
      expect(card.route.startsWith("/create/"), `card ${card.key} route=${card.route}`).toBe(true);
      expect(card.title.length).toBeGreaterThan(0);
    }
    expect(new Set(cards.map((card) => card.key)).size).toBe(20);
    // 卡只有三种形态：复用既有工作台 / Agent 编排 / 目录驱动工具页
    for (const card of cards) expect(["legacy", "agent", "tool"]).toContain(card.surface);
  });

  it("每个工具 mode 都在 GenerationMode 闭包内（否则 /credits/quote 直接 400）", () => {
    const allowed = new Set<string>(GenerationMode as readonly string[]);
    for (const tool of TOOL_MODES) {
      expect(allowed.has(tool.mode), `mode ${tool.mode} 不在 GenerationMode 里`).toBe(true);
    }
    // 本批必须补齐的 6 个后处理 mode 逐个点名，防止"少加一个枚举"却被总数掩盖
    for (const mode of [
      "de_subtitle_auto",
      "de_subtitle_region",
      "video_slicing",
      "fps_duration_unify",
      "video_audio_separation",
      "audio_timbre_modify",
    ]) {
      expect(allowed.has(mode), `缺少 mode ${mode}`).toBe(true);
    }
  });

  it("目录是幂等的：重复 ensure 不会插出第二条 model / price", async () => {
    const before = publicToolCatalog();
    await ensureToolCatalog();
    const { db, pool } = createDb(process.env.DATABASE_URL ?? "");
    try {
      const names = TOOL_MODES.map((tool) => tool.model.name);
      const modelRows = await db
        .select({ id: models.id })
        .from(models)
        .where(inArray(models.name, names));
      // 一个工具 mode 对应一条目录行：多一条就会出现"同名模型随机命中两条价目"
      expect(modelRows.length).toBe(names.length);

      const priceRows = await db
        .select({ id: modelPrices.id })
        .from(modelPrices)
        .where(
          inArray(
            modelPrices.modelId,
            modelRows.map((row) => row.id),
          ),
        );
      // 价目行数 = 各工具声明的档位数之和（超清 3 档、其余按次 1 档）
      const expectedPrices = TOOL_MODES.reduce((sum, tool) => sum + tool.prices.length, 0);
      expect(priceRows.length).toBe(expectedPrices);
    } finally {
      await pool.end();
    }
    expect(publicToolCatalog().cards.length).toBe(before.cards.length);
  });
});

describe("工具箱报价：每个 mode 都能报出目录价", () => {
  it("16 个工具 mode 逐个报价，金额等于目录里的初始价", async () => {
    for (const tool of TOOL_MODES) {
      const res = await inject("POST", "/credits/quote", quoteBody(tool.key));
      expect(res.code, `${tool.mode} quote: ${res.msg}`).toBe(0);
      // 按次能力的价目在 resolution=per_call 档；超清按真实画质档（1080p/2K/4K）
      const expected =
        tool.mode === "video_upscale"
          ? tool.prices.find((price) => price.resolution === tool.modeConfig.default_resolution)!.credits
          : tool.prices.find((price) => price.resolution === "per_call")!.credits;
      expect(res.data.credits, `${tool.mode} credits`).toBe(expected);
      expect(res.data.quote_id).toBeTruthy();
    }
  });

  it("未登录既拿不到目录、也报不了价（全局 AuthGuard 覆盖到新端点）", async () => {
    const catalog = await inject("GET", "/generations/tools", undefined, "");
    expect(catalog.code).not.toBe(0);
    const quote = await inject("POST", "/credits/quote", quoteBody("text-to-speech"), "");
    expect(quote.code).not.toBe(0);
  });
});

describe("工具箱投递：成功路径 + 输入前置校验 + 幂等", () => {
  it("文生语音：建任务成功，任务行 mode/capability 与冻结积分正确", async () => {
    // 报价指纹包含整个请求体（除 quote_id）：必须用**同一个 body** 报价，否则必然 745702
    const body: Record<string, unknown> = {
      mode: "tts",
      model: "toolbox-tts",
      input: { prompt: "夜色像一块未洗的蓝布，慢慢沉下来。" },
      options: { resolution: "per_call", duration: 5, count: 1, voice: "zh_female_shuangkuaisisi", speed: 1 },
    };
    const quoted = await inject("POST", "/credits/quote", body);
    expect(quoted.code, `quote: ${quoted.msg}`).toBe(0);
    const res = await inject("POST", "/generations", { ...body, quote_id: quoted.data.quote_id }, token, {
      "idempotency-key": `tools-tts-${Date.now()}`,
    });
    expect(res.code, res.msg).toBe(0);
    createdTaskIds.push(res.data.task_id);

    const row = await readTask(res.data.task_id);
    expect(row?.mode).toBe("tts");
    // capability 决定产物 Content-Type（speech → audio/mpeg），错了会存成 .bin 播不了
    expect(row?.capability).toBe("speech");
    expect(row?.creditsFrozen).toBe(quoted.data.credits);
    // 工具专有参数必须落到 tasks.options（适配器在 worker 里读它）
    expect((row?.options as Record<string, unknown>).voice).toBe("zh_female_shuangkuaisisi");

    const detail = await inject("GET", `/tasks/${res.data.task_id}`);
    expect(detail.code).toBe(0);
    expect(detail.data.mode).toBe("tts");
  });

  it("视频对口型缺音频：在冻结之前拦住，且不落任务行", async () => {
    const before = await inject("GET", "/tasks?page=1&page_size=1");
    const res = await inject(
      "POST",
      "/generations",
      {
        mode: "lip_sync",
        model: "toolbox-lip-sync",
        input: { prompt: "", reference_uris: ["https://example.test/a.mp4"] },
        options: { resolution: "source" },
      },
      token,
      { "idempotency-key": `tools-lip-missing-${Date.now()}` },
    );
    expect(res.code).not.toBe(0);
    // 业务错误的 details 不进信封（AllExceptionsFilter 只暴露 code+msg），
    // 因此断言 msg 里带字段路径：客户端要能靠它把提示挂到对应上传框上
    expect(String(res.msg)).toContain("reference_uris");
    const after = await inject("GET", "/tasks?page=1&page_size=1");
    expect(after.data.total).toBe(before.data.total);
  });

  it("文字重绘缺替换文字：报参数错误并指到 options.text", async () => {
    const res = await inject(
      "POST",
      "/generations",
      {
        mode: "text_repaint",
        model: "toolbox-text-repaint",
        input: { prompt: "", reference_uris: ["https://example.test/a.png"] },
        options: { resolution: "per_call" },
      },
      token,
      { "idempotency-key": `tools-repaint-missing-${Date.now()}` },
    );
    expect(res.code).not.toBe(0);
    expect(String(res.msg)).toContain("options.text");
  });

  it("同 Idempotency-Key 重放：返回同一 task_id，且库里只有一条任务", async () => {
    const key = `tools-idem-${Date.now()}`;
    const body = {
      mode: "text2music",
      model: "toolbox-text-to-music",
      input: { prompt: "温暖钢琴，缓慢推进" },
      options: { resolution: "per_call", duration: 15, count: 1, instrumental: true },
    };
    const first = await inject("POST", "/generations", body, token, { "idempotency-key": key });
    expect(first.code, first.msg).toBe(0);
    createdTaskIds.push(first.data.task_id);

    const second = await inject("POST", "/generations", body, token, { "idempotency-key": key });
    expect(second.code).toBe(0);
    expect(second.data.task_id).toBe(first.data.task_id);

    const { db, pool } = createDb(process.env.DATABASE_URL ?? "");
    try {
      const rows = await db.select().from(tasks).where(eq(tasks.idempotencyKey, key));
      expect(rows.length).toBe(1);
    } finally {
      await pool.end();
    }
  });

  it("跨空间隔离：别人的任务读不到", async () => {
    const mine = createdTaskIds[0];
    if (!mine) return;
    const res = await inject("GET", `/tasks/${mine}`, undefined, otherToken);
    expect(res.code).not.toBe(0);
  });
});

describe("工具箱适配器分派（model-adapters）", () => {
  const apiKeyConfig = { apiKey: "test-key", baseUrl: "http://127.0.0.1:1" };

  it("7 个新补 code 在 real 模式解析出对应适配器", () => {
    const options = { mode: "real" as const, postprocess: apiKeyConfig };
    expect(resolveAdapter(POSTPROCESS_CODES.videoEffects, options)).toBeInstanceOf(VideoEffectsAdapter);
    expect(resolveAdapter(POSTPROCESS_CODES.fpsUnify, options)).toBeInstanceOf(FpsDurationUnifyAdapter);
    expect(resolveAdapter(POSTPROCESS_CODES.audioSeparation, options)).toBeInstanceOf(AudioSeparationAdapter);
    expect(resolveAdapter(POSTPROCESS_CODES.timbreModify, options)).toBeInstanceOf(TimbreModifyAdapter);
    expect(resolveAdapter(POSTPROCESS_CODES.autoBgm, options)).toBeInstanceOf(AutoBgmAdapter);
    expect(resolveAdapter(POSTPROCESS_CODES.inpaint, options)).toBeInstanceOf(ImageInpaintAdapter);
    expect(resolveAdapter(POSTPROCESS_CODES.textRepaint, options)).toBeInstanceOf(TextRepaintAdapter);
  });

  it("real 模式缺 Key 硬失败（既有安全约定：绝不静默回落 mock 让用户以为真出片）", () => {
    for (const code of [
      POSTPROCESS_CODES.videoEffects,
      POSTPROCESS_CODES.fpsUnify,
      POSTPROCESS_CODES.audioSeparation,
      POSTPROCESS_CODES.timbreModify,
      POSTPROCESS_CODES.autoBgm,
      POSTPROCESS_CODES.inpaint,
      POSTPROCESS_CODES.textRepaint,
    ]) {
      expect(() => resolveAdapter(code, { mode: "real" })).toThrow(/requires apiKey in real mode/);
    }
  });

  it("各能力自带的 mock 形状与产物媒体类型一致（音频 .mp3 / 视频 .mp4 / 图 .png）", async () => {
    /**
     * 直接构造适配器并开 `mock: true`，而不是走 registry 的 `mode: "mock"`
     * ——后者返回的是**共享 MockAdapter**，它不知道"音色修改必须产 .mp3"这类能力差异，
     * 也就测不到这里真正要防的事：产物媒体类型与能力不一致（前端 <audio> 静默不播）。
     */
    const request = (mode: string) =>
      ({
        task_id: `t-${mode}`,
        model: { name: "m", vendor: "self", adapter_code: "x" },
        request: {
          mode,
          model: "m",
          scene: null,
          input: { prompt: "test", reference_uris: ["https://example.test/a.mp4", "https://example.test/b.mp3"] },
          options: {
            ratio: "9:16",
            resolution: "per_call",
            duration: 5,
            count: 1,
            // 各适配器的必填/可选参数（缺了会在 validate 阶段被拦，这里是正例）
            effect: "cinematic",
            intensity: 0.8,
            target_fps: 30,
            timbre: "warm_female",
            style: "warm",
            text: "深夜食堂",
            font: "sans",
          },
        },
      }) as never;

    const cases: Array<{ adapter: HttpPostprocessAdapter; mode: string; ext: string; count: number }> = [
      { adapter: new VideoEffectsAdapter({ mock: true }), mode: "video_effects", ext: ".mp4", count: 1 },
      { adapter: new FpsDurationUnifyAdapter({ mock: true }), mode: "fps_duration_unify", ext: ".mp4", count: 1 },
      { adapter: new AudioSeparationAdapter({ mock: true }), mode: "video_audio_separation", ext: ".mp4", count: 2 },
      { adapter: new TimbreModifyAdapter({ mock: true }), mode: "audio_timbre_modify", ext: ".mp3", count: 1 },
      { adapter: new AutoBgmAdapter({ mock: true }), mode: "auto_bgm", ext: ".mp4", count: 1 },
      { adapter: new ImageInpaintAdapter({ mock: true }), mode: "inpaint", ext: ".png", count: 1 },
      { adapter: new TextRepaintAdapter({ mock: true }), mode: "text_repaint", ext: ".png", count: 1 },
    ];

    for (const item of cases) {
      const submitted = await item.adapter.submit(request(item.mode));
      expect(submitted.vendor_task_id, item.mode).toBeTruthy();
      const state = await item.adapter.poll(submitted.vendor_task_id!);
      expect(state.status, item.mode).toBe("succeeded");
      expect(state.results?.length, `${item.mode} 产物数量`).toBe(item.count);
      expect(state.results![0]!.uri.endsWith(item.ext), `${item.mode} 扩展名`).toBe(true);
    }
  });
});

describe("画布 video_upscale（CANVAS_MODE_MAP 补映射）", () => {
  it("视频节点用工具模型投递 → tasks.mode=video_upscale（不再「直接拒」）", async () => {
    const canvas = await inject("POST", "/canvas/canvases", { title: "video_upscale 测试画布" });
    expect(canvas.code).toBe(0);
    const canvasId = canvas.data.id as string;

    const node = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "video",
      name: "待超清视频",
      x: 0,
      y: 0,
      params: { settings: { resolution: "1080p" } },
    });
    expect(node.code).toBe(0);
    const nodeId = node.data.id as string;

    const generated = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${nodeId}/generate`,
      {
        mode: "video_upscale",
        model: "toolbox-video-upscale",
        input: { reference_uris: ["https://example.test/source.mp4"] },
        options: { resolution: "1080p" },
      },
    );
    expect(generated.code, generated.msg).toBe(0);
    createdTaskIds.push(generated.data.task_id);

    const row = await readTask(generated.data.task_id);
    expect(row?.mode).toBe("video_upscale");
    // 节点回写：task_id + status=2（生成中），画布上才能显示进度
    expect(String(generated.data.node.task_id)).toBe(generated.data.task_id);
    expect(generated.data.node.status).toBe(2);

    // 普通生成模型没有 video_upscale 档位：必须显式报错，不能静默跑成一次普通生成
    const catalog = await inject("GET", "/models?capability=video&visible=true");
    const plainModel = (catalog.data as Array<{ name: string; modes: Record<string, unknown> }>).find(
      (item) => !Object.prototype.hasOwnProperty.call(item.modes, "video_upscale"),
    );
    expect(plainModel, "目录里应有不支持 video_upscale 的普通视频模型").toBeTruthy();
    const wrongModel = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${nodeId}/generate`,
      {
        mode: "video_upscale",
        model: plainModel!.name,
        input: { reference_uris: ["https://example.test/source.mp4"] },
      },
    );
    expect(wrongModel.code).not.toBe(0);
    expect(String(wrongModel.msg)).toContain("video_upscale");
  });

  it("清理：取消本组任务 → 状态落 CANCELED（冻结积分已由 cancel 退回）", async () => {
    if (createdTaskIds.length === 0) return;
    for (const id of createdTaskIds) {
      const res = await inject("POST", `/tasks/${id}/cancel`);
      // 已经取消过的（afterAll 会再兜一次）不算失败
      if (res.code === 0) expect(res.data.status).toBe(5);
    }
    const { db, pool } = createDb(process.env.DATABASE_URL ?? "");
    try {
      const rows = await db
        .select({ id: tasks.id, status: tasks.status })
        .from(tasks)
        .where(inArray(tasks.id, createdTaskIds.map((id) => BigInt(id))));
      expect(rows.length).toBe(createdTaskIds.length);
      for (const row of rows) expect([1, 2, 5]).toContain(row.status);
    } finally {
      await pool.end();
    }
  });
});
