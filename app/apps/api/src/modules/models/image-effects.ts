/**
 * 图像风格迁移效果目录（剪影生图网关 `GET /v1/effects` 的我方投影）。
 *
 * 为什么放在 API 侧而不是让浏览器直连网关：
 * 1. 网关监听在内网/回环（`127.0.0.1:8788`），浏览器根本打不到；
 * 2. 把上游 id/文案直接透给前端等于把供应商细节写进前端契约，换供应商要改前端；
 * 3. 网关断供（上游密钥随 App 版本轮换）时前端不能白屏——这里内置同一份静态表回落。
 *
 * 与 docs/02-architecture/jianying-gateway-integration.md §5 的「效果清单」一一对应：
 * 网关 `EFFECTS_FALLBACK` 的 18 项 + 我方中文名。网关 `title` 是英文原名，只用作 tooltip，
 * 展示用 `title_zh`。
 */

export interface ImageEffectDto {
  id: string;
  /** 网关英文原名（保持与上游一致，用作 tooltip / aria-label） */
  title: string;
  /** 中文展示名（前端胶囊按钮文案） */
  title_zh: string;
  /** 该效果对输入图的人脸有要求（前端只做轻提示，不做硬拦截） */
  need_face: boolean;
}

/**
 * 静态回落表：来源为网关 `app/main.py` 的 `EFFECTS_FALLBACK`（18 项，字段 id/title/need_face）。
 * 网关在线时以其 `/v1/effects` 返回为准（运营商可增删），这份只做「网关不可达」兜底与中文名映射。
 */
export const IMAGE_EFFECT_FALLBACK: readonly ImageEffectDto[] = [
  { id: "aliyun_tongyi_1", title: "3D Fairy Tale", title_zh: "3D 童话", need_face: true },
  { id: "aliyun_5", title: "Painting", title_zh: "绘画", need_face: true },
  { id: "aliyun_0", title: "Retro comics", title_zh: "复古漫画", need_face: true },
  { id: "aliyun_tongyi_36", title: "2D Anime World", title_zh: "2D 动画", need_face: true },
  { id: "color_image", title: "Colorizer", title_zh: "黑白上色", need_face: false },
  { id: "cartoon", title: "Cartoon", title_zh: "卡通", need_face: true },
  { id: "pixarEffect", title: "Disney", title_zh: "迪士尼", need_face: true },
  { id: "img2img_pretty_style_ink", title: "Ink", title_zh: "水墨", need_face: true },
  { id: "img2img_style_light", title: "Light", title_zh: "光影", need_face: true },
  { id: "game_3d", title: "3D Game", title_zh: "3D 游戏", need_face: true },
  { id: "enhancer_image", title: "Photo Enhancer", title_zh: "画质增强", need_face: false },
  { id: "eraser", title: "Eraser", title_zh: "橡皮擦", need_face: false },
  { id: "134", title: "Impasto hand painting", title_zh: "厚涂手绘", need_face: false },
  { id: "107", title: "Cartoon illustration", title_zh: "卡通插画", need_face: false },
  { id: "121", title: "Clay", title_zh: "黏土", need_face: false },
  { id: "age_image", title: "Old Me", title_zh: "老年相", need_face: true },
  { id: "avatar", title: "Avatar", title_zh: "头像", need_face: true },
  { id: "angel_plus", title: "Switch Angel", title_zh: "天使", need_face: true },
];

const ZH_BY_ID = new Map(IMAGE_EFFECT_FALLBACK.map((item) => [item.id, item.title_zh]));

/**
 * 解析网关 `{ object: "list", data: [{ id, title, need_face }] }`。
 *
 * 口径：
 * - 缺 `id` 的条目直接丢（没有 id 的效果发不出去，留着只会在前端点出一个 400）；
 * - `title` 缺失时用 id 顶替，`title_zh` 优先取我方静态表的中文名，再退回 `title`；
 * - 网关新增了我们没见过的效果：照收，中文名回落英文——宁可显示英文，也不要静默隐藏一个可用的效果。
 */
export function normalizeGatewayEffects(payload: unknown): ImageEffectDto[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];

  const out: ImageEffectDto[] = [];
  const seen = new Set<string>();
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const title =
      (typeof record.title === "string" && record.title.trim()) ||
      (typeof record.title_zh === "string" && record.title_zh.trim()) ||
      id;
    out.push({
      id,
      title,
      title_zh: (typeof record.title_zh === "string" && record.title_zh.trim()) || ZH_BY_ID.get(id) || title,
      need_face: record.need_face === true,
    });
  }
  return out;
}

export interface ImageEffectsCatalogOptions {
  /** 网关根地址（如 http://127.0.0.1:8788）；未配置时只返回静态表 */
  baseUrl?: string;
  /** 结果缓存毫秒，默认 1h（网关自身也缓存 1h） */
  ttlMs?: number;
  /** 单次上游超时，默认 2s：目录是辅助数据，不能拖慢页面首屏 */
  timeoutMs?: number;
  /** 测试注入点 */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TTL_MS = 60 * 60_000;
const DEFAULT_TIMEOUT_MS = 2_000;

/**
 * 效果目录：网关优先 + 静态回落 + TTL 缓存。
 *
 * 为什么失败回落而不是报错：这是一个**选择器数据源**，网关断供时用户仍然应该能进图生图页
 * （列表来自静态表，与网关在线时基本一致），真正提交时的上游故障由适配器与任务状态暴露。
 */
export class ImageEffectsCatalog {
  private cache: { at: number; items: ImageEffectDto[] } | null = null;
  private readonly baseUrl: string | undefined;
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ImageEffectsCatalogOptions = {}) {
    // 空字符串按未配置处理：`.env.example` 里留空是常态
    this.baseUrl = options.baseUrl?.trim() ? options.baseUrl.trim().replace(/\/+$/, "") : undefined;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async list(): Promise<ImageEffectDto[]> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < this.ttlMs) return this.cache.items;

    const items = (await this.fromGateway()) ?? [...IMAGE_EFFECT_FALLBACK];
    this.cache = { at: now, items };
    return items;
  }

  /** 网关不可达/返回非法时返回 undefined（调用方回落到静态表），不抛错 */
  private async fromGateway(): Promise<ImageEffectDto[] | undefined> {
    if (!this.baseUrl) return undefined;
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/v1/effects`, {
        method: "GET",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) return undefined;
      const payload: unknown = await res.json();
      const items = normalizeGatewayEffects(payload);
      // 网关返回空列表视为异常（宁可回落，也不要把风格位变成空白）
      return items.length > 0 ? items : undefined;
    } catch {
      return undefined;
    }
  }
}

/**
 * 进程级单例。
 *
 * 为什么不用 Nest DI：本目录是**只读辅助数据**，不参与任何业务事务；放进 module 会让
 * `models.module.ts` 的依赖图多一条「供应商网关」边，而 `models` 模块的既有铁律是
 * 「只读目录、不接 adapters」（system-design §2）。配置也只读一次 `process.env`。
 */
export const imageEffectsCatalog = new ImageEffectsCatalog({
  baseUrl: process.env.JIANYING_GATEWAY_BASE_URL,
});