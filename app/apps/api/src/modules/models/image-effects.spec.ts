import { describe, expect, it, vi } from "vitest";
import {
  ImageEffectsCatalog,
  IMAGE_EFFECT_FALLBACK,
  normalizeGatewayEffects,
} from "./image-effects";

/** 网关 `GET /v1/effects` 的真实形状（app/main.py 第 3 段：object=list + data[]） */
const gatewayPayload = {
  object: "list",
  data: [
    { id: "aliyun_tongyi_1", title: "3D Fairy Tale", need_face: true },
    { id: "cartoon", title: "Cartoon", need_face: true },
    { id: "brand_new_effect", title: "Brand New", need_face: false },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("normalizeGatewayEffects", () => {
  it("把网关形状翻译成我方 DTO：中文名优先取静态表，未知效果回落英文名", () => {
    const items = normalizeGatewayEffects(gatewayPayload);

    expect(items).toEqual([
      { id: "aliyun_tongyi_1", title: "3D Fairy Tale", title_zh: "3D 童话", need_face: true },
      { id: "cartoon", title: "Cartoon", title_zh: "卡通", need_face: true },
      // 网关新增、我方静态表没有的效果：照收，不隐藏（否则前端少一个可用效果）
      { id: "brand_new_effect", title: "Brand New", title_zh: "Brand New", need_face: false },
    ]);
  });

  it("丢掉没有 id 的条目与重复 id（没有 id 的效果发出去只会是 400）", () => {
    const items = normalizeGatewayEffects({
      data: [{ id: "a", title: "A" }, { title: "no-id" }, { id: "a", title: "A again" }, null, 42],
    });
    expect(items.map((item) => item.id)).toEqual(["a"]);
  });

  it("非法载荷返回空数组（由调用方决定回落）", () => {
    expect(normalizeGatewayEffects(null)).toEqual([]);
    expect(normalizeGatewayEffects({ data: "nope" })).toEqual([]);
    expect(normalizeGatewayEffects({})).toEqual([]);
  });
});

describe("ImageEffectsCatalog", () => {
  it("未配置网关地址时直接返回静态表（18 项），且不打网络", async () => {
    const fetchImpl = vi.fn();
    const catalog = new ImageEffectsCatalog({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const items = await catalog.list();

    expect(items).toHaveLength(IMAGE_EFFECT_FALLBACK.length);
    expect(items.map((item) => item.id)).toEqual(IMAGE_EFFECT_FALLBACK.map((item) => item.id));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("空字符串地址按未配置处理（.env.example 留空是常态）", async () => {
    const fetchImpl = vi.fn();
    const catalog = new ImageEffectsCatalog({
      baseUrl: "   ",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await catalog.list();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("网关在线时以网关为准，并去掉末尾斜杠拼接路径", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(gatewayPayload));
    const catalog = new ImageEffectsCatalog({
      baseUrl: "http://127.0.0.1:8788/",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const items = await catalog.list();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:8788/v1/effects", expect.anything());
    expect(items).toHaveLength(3);
  });

  it("网关 5xx 回落静态表（目录断供不该让前端选择器白屏）", async () => {
    const catalog = new ImageEffectsCatalog({
      baseUrl: "http://gw",
      fetchImpl: vi.fn(async () => jsonResponse({ error: { message: "boom" } }, 503)) as unknown as typeof fetch,
    });
    expect(await catalog.list()).toHaveLength(IMAGE_EFFECT_FALLBACK.length);
  });

  it("网络异常 / 超时同样回落，不抛错", async () => {
    const catalog = new ImageEffectsCatalog({
      baseUrl: "http://gw",
      fetchImpl: vi.fn(async () => {
        throw new Error("aborted");
      }) as unknown as typeof fetch,
    });
    expect(await catalog.list()).toHaveLength(IMAGE_EFFECT_FALLBACK.length);
  });

  it("网关返回空列表视为异常，回落静态表", async () => {
    const catalog = new ImageEffectsCatalog({
      baseUrl: "http://gw",
      fetchImpl: vi.fn(async () => jsonResponse({ object: "list", data: [] })) as unknown as typeof fetch,
    });
    expect(await catalog.list()).toHaveLength(IMAGE_EFFECT_FALLBACK.length);
  });

  it("TTL 内复用缓存：两次 list 只打一次网关", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(gatewayPayload));
    const catalog = new ImageEffectsCatalog({
      baseUrl: "http://gw",
      ttlMs: 60_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await catalog.list();
    await catalog.list();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("静态表里每个效果都有 id + 中文名 + 布尔 need_face（前端胶囊的契约）", () => {
    for (const item of IMAGE_EFFECT_FALLBACK) {
      expect(item.id).toMatch(/\S/);
      expect(item.title).toMatch(/\S/);
      expect(item.title_zh).toMatch(/\S/);
      expect(typeof item.need_face).toBe("boolean");
    }
    expect(new Set(IMAGE_EFFECT_FALLBACK.map((item) => item.id)).size).toBe(IMAGE_EFFECT_FALLBACK.length);
  });
});