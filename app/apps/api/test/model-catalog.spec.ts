/**
 * 模型目录 46 条的数据库侧验收（对齐竞品 cli-out/model-all.json）。
 *
 * 为什么断言落在**数据库**而不是只断言 seed.ts 的字面量：
 * 目录的消费方（`GET /models`、`credits.price`、画布节点派生、分镜出片）读的都是 DB 行。
 * seed 字面量对但没落库、或落库时被 upsert 弄丢字段，只有查库能发现。
 *
 * 另有**非竞品**的行不进这 46 条：`toolbox-*`（工具箱单点能力）与 `jianying-draw`
 * （剪影生图网关，第三方通道，见文末独立 describe）。它们的档位/价格同样要验，
 * 只是"对齐竞品目录"这个断言不能把它们算进去。
 *
 * 前置：`pnpm --filter @app/api db:seed` 已跑过（scripts/verify-model-catalog.mjs 会自动跑）。
 */
import { describe, expect, it, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, modelPrices, models } from "@app/db";

interface ModeRow {
  endpoint: string;
  ratios?: string[];
  durations?: number[];
  resolution_options: Array<{ value: string; label: string }>;
  resolutions: string[];
  default_resolution?: string;
  default_ratio?: string;
  default_duration?: number;
  media_limits?: Record<string, number>;
  mouth_drive?: string;
}

type ModelRow = typeof models.$inferSelect;

let rows: ModelRow[] = [];
let byName: Map<string, ModelRow> = new Map();
/** 全表（含 toolbox-* 与第三方通道），供非竞品行单独验收 */
let allRows: ModelRow[] = [];
let jianyingRow: ModelRow | undefined;
let jianyingPrices: Array<typeof modelPrices.$inferSelect> = [];

beforeAll(async () => {
  const { db, pool } = createDb(process.env.DATABASE_URL ?? "");
  try {
    const all = await db.select().from(models);
    /**
     * 只统计**竞品对齐的模型目录**（46 条），排除我方内部能力行 `toolbox-*`。
     *
     * 为什么排除：第 3 批工具箱的单点能力（对口型/超分/去字幕/切片/TTS/音乐…）
     * 不是竞品模型目录里的条目，但它们必须有 `models` 行——`tasks.model_id` 与
     * `model_prices.model_id` 都是 NOT NULL + FK，任务和价目都要挂在这张表上。
     * 这些行以 `visible=false` 存在（不进 `GET /models`，不出现在模型选择器），
     * 但 `db.select().from(models)` 是直读全表，会把它们算进来。
     * 因此**在本 spec 的取数层面**限定到竞品目录；46 这个数字与它的全部断言不动。
     */
    allRows = all;
    rows = all.filter((row) => !row.name.startsWith("toolbox-") && row.vendor !== "jianying");
    byName = new Map(rows.map((row) => [row.name, row]));
    jianyingRow = all.find((row) => row.name === "jianying-draw");
    if (jianyingRow) {
      jianyingPrices = await db.select().from(modelPrices).where(eq(modelPrices.modelId, jianyingRow.id));
    }
  } finally {
    await pool.end();
  }
}, 60_000);

const modesOf = (row: ModelRow): Record<string, ModeRow> => row.modes as Record<string, ModeRow>;
const sceneModesOf = (row: ModelRow): Record<string, ModeRow> =>
  row.sceneModes as Record<string, ModeRow>;

describe("模型目录 46 条（对齐竞品真实目录）", () => {
  it("总数 46、全部 visible、协议名与 id 均唯一", () => {
    expect(rows).toHaveLength(46);
    expect(rows.every((row) => row.visible)).toBe(true);
    expect(new Set(rows.map((row) => row.name)).size).toBe(46);
    expect(new Set(rows.map((row) => String(row.id))).size).toBe(46);
  });

  it("vendor 分布与竞品一致（11 家，tomoviee 13 自营最多）", () => {
    const counts = rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.vendor] = (acc[row.vendor] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({
      tomoviee: 13,
      jimeng: 8,
      kling: 7,
      hailuo: 5,
      "happy-horse": 3,
      vidu: 3,
      wan: 3,
      deepseek: 1,
      google: 1,
      midjourney: 1,
      openai: 1,
    });
  });

  it("capability 分布：video 30 / image 13 / text 3", () => {
    const counts = rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.capability] = (acc[row.capability] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ video: 30, image: 13, text: 3 });
  });

  it("types 含 file 的是那 3 个 LLM（DeepSeek / Gemini / TG Chat）", () => {
    const fileModels = rows.filter((row) => row.types.includes("file")).map((row) => row.name).sort();
    expect(fileModels).toEqual(["deepseek-v4-pro", "gemini-3.1-pro-preview", "tg-chat-5.5"]);
  });
});

describe("场景隔离：资产生图 4 条 ∩ 画布生图 9 条 = 空", () => {
  /**
   * 这是竞品最刻意的设计：自营模型守流水线必经环节（控成本），聚合模型守效果决胜点（保质量）。
   * 二者共用「text2image 可提交」但**成员必须互斥**——这是成本结构而不是数据巧合。
   */
  const assetNames = () =>
    rows
      .filter((row) => Object.hasOwn(modesOf(row), "studio_asset_image"))
      .map((row) => row.name)
      .sort();
  const canvasImageNames = () =>
    rows
      .filter(
        (row) =>
          row.capability === "image" &&
          Object.hasOwn(modesOf(row), "text2image") &&
          !Object.hasOwn(modesOf(row), "studio_asset_image"),
      )
      .map((row) => row.name)
      .sort();

  it("资产生图恰 4 条，且全为自营（tomoviee）", () => {
    const names = assetNames();
    expect(names).toEqual(["sky-media-realistic", "tgi-2.5-flare", "tgi-2.5-sunburst", "tnb"]);
    for (const name of names) {
      expect(byName.get(name)!.vendor).toBe("tomoviee");
    }
  });

  it("画布生图恰 9 条，且与资产生图互斥", () => {
    const names = canvasImageNames();
    expect(names).toHaveLength(9);
    // 9 条 = 「有 text2image 且没有 studio_asset_image」的图像模型全集。
    // 注意这批里**既有聚合模型也有自营**（TGI 2 / TNB 2 / TNB Pro / TNB Pro-Beta 是 tomoviee）：
    // 竞品的隔离是「资产生图那 4 条不参与画布」，不是「画布只准聚合」。
    // 隔离的真实含义是**同一次生成的选型不同**，不是供应商阵营划分。
    const expected = rows
      .filter(
        (row) =>
          row.capability === "image" &&
          Object.hasOwn(modesOf(row), "text2image") &&
          !Object.hasOwn(modesOf(row), "studio_asset_image"),
      )
      .map((row) => row.name)
      .sort();
    expect(names).toEqual(expected);
    expect(names).toEqual([
      "jimeng-4.0",
      "jimeng-4.5",
      "jimeng-5.0",
      "jimeng-5.0-pro",
      "midjourney-v8.2",
      "tgi-2",
      "tnb-2",
      "tnb-pro",
      "tnb-pro-beta",
    ]);
  });

  it("交集为空", () => {
    const asset = assetNames();
    const canvas = canvasImageNames();
    expect(asset.filter((name) => canvas.includes(name))).toEqual([]);
  });
});

describe("五个场景键的成员数", () => {
  it("studio_asset_image 4 / script_to_scene_refer 4 / storyboard_reference_video 10", () => {
    const asset = rows.filter((row) => Object.hasOwn(modesOf(row), "studio_asset_image"));
    const script = rows.filter((row) => Object.hasOwn(sceneModesOf(row), "script_to_scene_refer"));
    const storyboard = rows.filter((row) => Object.hasOwn(sceneModesOf(row), "storyboard_reference_video"));
    expect(asset).toHaveLength(4);
    expect(script).toHaveLength(4);
    expect(storyboard).toHaveLength(10);
  });

  it("script_to_scene_refer 的 4 条全为聚合模型（Seedance×3 + Wan 3.0）", () => {
    const names = rows
      .filter((row) => Object.hasOwn(sceneModesOf(row), "script_to_scene_refer"))
      .map((row) => row.name)
      .sort();
    expect(names).toEqual(["seedance-2.0-mini", "seedance-2.0-vip", "seedance-2.5", "wan-3.0"]);
  });

  it("storyboard_reference_video 的 10 条 = 上面 4 条 + 6 条分镜专用", () => {
    const names = rows
      .filter((row) => Object.hasOwn(sceneModesOf(row), "storyboard_reference_video"))
      .map((row) => row.name)
      .sort();
    expect(names).toEqual([
      "happy-horse-1.0",
      "happy-horse-1.1",
      "kling-o3",
      "minimax-h3",
      "minimax-h3-sale",
      "seedance-2.0-mini",
      "seedance-2.0-vip",
      "seedance-2.5",
      "vidu-q2",
      "wan-3.0",
    ]);
    // script_to_scene_refer 是它的子集（剧本转场景后才轮到分镜出片）
    const script = new Set(
      rows
        .filter((row) => Object.hasOwn(sceneModesOf(row), "script_to_scene_refer"))
        .map((row) => row.name),
    );
    for (const name of script) expect(names).toContain(name);
  });

  it("storyboard_reference_video 场景档位带 mode / durations / resolution_options", () => {
    /**
     * 已知且**有意保留**的竞品不一致：Wan 3.0 的场景档比背后 mode 多一个 `480p`。
     *
     * 证据：`rea-reelmate/cli-out/model-all.json` 的 Wan 3.0 ——
     *   `params.generation.universal_reference.resolution_options` = 720p / 720p_sale / 1080p
     *   `params.storyboard_reference_video.resolution_options`   = 480p / 720p / 720p_sale / 1080p
     * 按 ADR-013「已取证即照做」，seed 原样保留这条差异（不是我们的 bug）。
     * price 侧已按场景档补了 480p 的价目（seed 的 required 集合包含场景档），
     * 所以出片不会 400——这条断言只为把它**显式登记**，避免以后有人"顺手修平"。
     */
    const SCENE_ONLY_TIERS: Record<string, string[]> = { "wan-3.0": ["480p"] };

    for (const row of rows.filter((item) => Object.hasOwn(sceneModesOf(item), "storyboard_reference_video"))) {
      const scene = sceneModesOf(row).storyboard_reference_video!;
      expect(scene.mode, `${row.name} 场景缺 mode`).toBe("universal_reference");
      expect(Array.isArray(scene.durations), `${row.name} 场景缺 durations`).toBe(true);
      expect(scene.durations!.length).toBeGreaterThan(0);
      expect(scene.resolution_options.length).toBeGreaterThan(0);

      const allowedExtra = new Set(SCENE_ONLY_TIERS[row.name] ?? []);
      const base = modesOf(row).universal_reference;
      if (base) {
        for (const resolution of scene.resolutions) {
          if (allowedExtra.has(resolution)) continue;
          expect(base.resolutions, `${row.name} 场景档 ${resolution} 不在 mode 档位内（非登记例外）`).toContain(
            resolution,
          );
        }
      }
    }
  });
});

describe("generation.<mode> 覆盖数（与竞品一致）", () => {
  it("11 个 mode 的成员数与竞品逐项对齐", () => {
    const count = (mode: string) => rows.filter((row) => Object.hasOwn(modesOf(row), mode)).length;
    expect({
      text2image: count("text2image"),
      image2image: count("image2image"),
      multi_reference: count("multi_reference"),
      studio_asset_image: count("studio_asset_image"),
      text2video: count("text2video"),
      image2video: count("image2video"),
      first_frame: count("first_frame"),
      first_last_frame: count("first_last_frame"),
      universal_reference: count("universal_reference"),
      video_edit: count("video_edit"),
      video_extend: count("video_extend"),
    }).toEqual({
      text2image: 9,
      image2image: 9,
      multi_reference: 2,
      studio_asset_image: 4,
      text2video: 7,
      image2video: 16,
      first_frame: 16,
      first_last_frame: 8,
      universal_reference: 10,
      video_edit: 6,
      video_extend: 2,
    });
  });
});

describe("目录字段完整性（前端全靠这些字段渲染表单）", () => {
  it("每个非文本模型：mode 有 endpoint / 默认档位 / 分辨率 label 与提交值分离", () => {
    for (const row of rows.filter((item) => item.capability !== "text")) {
      const modes = modesOf(row);
      expect(Object.keys(modes).length, `${row.name} 没有任何 mode`).toBeGreaterThan(0);
      for (const [mode, cfg] of Object.entries(modes)) {
        expect(cfg.endpoint, `${row.name}.${mode} 缺 endpoint`).toBeTruthy();
        expect(cfg.resolution_options.length, `${row.name}.${mode} 缺分辨率档`).toBeGreaterThan(0);
        expect(cfg.default_resolution, `${row.name}.${mode} 缺默认分辨率`).toBeTruthy();
        // 默认值必须在声明档位内，否则「选完模型即报价」第一次请求就 400
        expect(cfg.resolutions, `${row.name}.${mode} 默认分辨率不在档位内`).toContain(
          cfg.default_resolution,
        );
        for (const option of cfg.resolution_options) {
          expect(option.value, `${row.name}.${mode} 分辨率缺提交值`).toBeTruthy();
          expect(option.label, `${row.name}.${mode} 分辨率 ${option.value} 缺展示名`).toBeTruthy();
        }
      }
    }
  });

  it("有 durations 的 mode：default_duration 在声明档位内（否则时长校验必失败）", () => {
    for (const row of rows.filter((item) => item.capability === "video")) {
      for (const [mode, cfg] of Object.entries(modesOf(row))) {
        if (!cfg.durations || cfg.durations.length === 0) continue;
        expect(cfg.default_duration, `${row.name}.${mode} 缺默认时长`).toBeTruthy();
        expect(cfg.durations, `${row.name}.${mode} 默认时长不在档位内`).toContain(cfg.default_duration);
      }
    }
  });

  it("modeOrder 覆盖该模型所有可提交 mode（前端按它排序，缺项会排到末尾）", () => {
    // 资产生图 4 条在竞品里没有 mode_order（单 mode 模型不需要排序），允许空
    for (const row of rows.filter((item) => item.capability !== "text")) {
      const modes = Object.keys(modesOf(row));
      const order = Object.keys(row.modeOrder as Record<string, number>);
      if (modes.length === 1) continue;
      for (const mode of modes) {
        expect(order, `${row.name}.${mode} 未出现在 modeOrder 中`).toContain(mode);
      }
    }
  });

  it("name 是英文协议标识、displayName 是中文/品牌展示名（两者不能混）", () => {
    for (const row of rows) {
      expect(row.name, `${row.name} 协议名不应含空格`).not.toMatch(/\s/);
      expect(row.displayName.length).toBeGreaterThan(0);
    }
    // 抽查：协议名与展示名确实不同（改展示名不该动协议）
    expect(byName.get("seedance-2.5")!.displayName).toBe("Seedance 2.5");
    expect(byName.get("tgi-2")!.displayName).toBe("TGI 2");
    expect(byName.get("wan-3.0")!.displayName).toBe("Wan 3.0");
  });
});

/**
 * 第三方通道 `jianying-draw`：**不计入竞品对齐的 46 条**（它不对应任何竞品 SKU），
 * 但同样必须落库且档位自洽——否则运营在后台点了上架，用户看得见模型却永远报
 * 「no price for requested model/mode/options」。
 *
 * 这条模型是剪影生图网关的入口（docs/02-architecture/jianying-gateway-integration.md）：
 * 上游只有 3 张画布，所以 ratios 必须恰好是 1:1/4:3/3:4；蒙版重绘本批未接线，所以
 * image2image 的 media_limits.image 必须是 1（多传一张会被适配器判成"要重绘"而报错）。
 */
describe("第三方通道 jianying-draw（非竞品目录，单独验收）", () => {
  it("已落库、可见、图像能力、adapter_code 指向新协议族", () => {
    expect(jianyingRow, "seeded model jianying-draw not found（先跑 db:seed）").toBeDefined();
    const row = jianyingRow!;
    expect(row.visible).toBe(true);
    expect(row.vendor).toBe("jianying");
    expect(row.capability).toBe("image");
    expect(row.adapterCode).toBe("jianying:image");
  });

  it("只暴露 3 个上游原生画幅（16:9 之类是裁切产物，不许进目录骗构图）", () => {
    const modes = modesOf(jianyingRow!);
    expect(modes.text2image!.ratios).toEqual(["1:1", "4:3", "3:4"]);
    expect(modes.image2image!.ratios).toEqual(["1:1", "4:3", "3:4"]);
    expect(modes.text2image!.resolution_options.map((option) => option.value)).toEqual(["1K", "2K"]);
    expect(modes.text2image!.counts).toEqual([1, 2, 3, 4]);
  });

  it("图生图参考图上限 1（第 2 张是我方约定的蒙版位，本批未接线）", () => {
    expect(modesOf(jianyingRow!).image2image!.media_limits?.image).toBe(1);
  });

  it("每个可提交档位都有价（缺价即 745701，用户永远下不了单）", () => {
    const modes = modesOf(jianyingRow!);
    for (const [mode, cfg] of Object.entries(modes)) {
      for (const option of cfg.resolution_options) {
        const hit = jianyingPrices.find((price) => price.mode === mode && price.resolution === option.value);
        expect(hit, `jianying-draw ${mode}/${option.value} 无价`).toBeDefined();
      }
    }
  });

  it("全表里「可提文生图」的图像模型 = 竞品 9 条 + 这条第三方 = 10 条", () => {
    const canvasCapable = allRows
      .filter(
        (row) =>
          row.capability === "image" &&
          Object.hasOwn(modesOf(row), "text2image") &&
          !Object.hasOwn(modesOf(row), "studio_asset_image"),
      )
      .map((row) => row.name)
      .sort();
    // 竞品那 9 条仍然互斥且一条不少（见上方「场景隔离」describe）；多出的正是第三方通道
    expect(canvasCapable).toHaveLength(10);
    expect(canvasCapable).toContain("jianying-draw");
  });
});
