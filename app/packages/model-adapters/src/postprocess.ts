import {
  classifyVendorHttpError,
  classifyVendorNetworkError,
  isRetryableVendorError,
  looksLikeContentRejection,
  readVendorJson,
  VendorError,
  vendorParamError,
  vendorProtocolError,
} from "./errors";
import type { GenResult, ModelAdapter, NormalizedGenRequest, VendorTaskState } from "./types";

type Json = Record<string, unknown>;

export type ResultMedia = "audio" | "video" | "image";

const EXT_BY_MEDIA: Record<ResultMedia, string> = { audio: "mp3", video: "mp4", image: "png" };

/**
 * 后处理/单点能力适配器的公共 HTTP 配置。
 *
 * 这类能力（TTS、音乐、对口型、超分、去字幕、切片）在供应商侧几乎都是同一个形状：
 * 「提交任务 → 拿 task_id → 轮询 → 取产物 URL」，差异只在**请求体字段**与**产物字段**。
 * 因此把协议骨架收敛到一个基类，子类只声明「请求怎么拼 / 产物从哪取 / mock 什么形状」。
 * 这样第 3 批接新供应商只需加一个几十行的子类，不必再抄一遍重试与错误映射。
 */
export interface PostprocessHttpConfig {
  /** 真实调用必填。缺 Key 必须硬失败（绝不静默回落 mock）：mock 产物会让业务以为出片了。 */
  apiKey?: string;
  baseUrl?: string;
  submitPath?: string;
  /** 含 `{id}` 占位符的轮询路径 */
  pollPath?: string;
  /** 含 `{id}` 占位符的取消路径；不配则 cancel 为无操作 */
  cancelPath?: string;
  /** 我方模型名 → 供应商模型名；未命中时用 defaultModel，再缺省用我方 name */
  modelMap?: Record<string, string>;
  defaultModel?: string;
  timeoutMs?: number;
  /** 仅重试 429/5xx/超时/网络（4xx 业务错误不重试） */
  maxRetries?: number;
  retryBaseMs?: number;
  /**
   * 本地/CI 的确定性 mock（不发网络请求）。
   *
   * 与 `MockAdapter` 的区别：`MockAdapter` 是「所有 adapter_code 共用一个假供应商」，
   * 用来跑通端到端；这里是**单个适配器自己的形状契约测试**（音频必须 .mp3、切片必须多产物），
   * 所以由适配器自己给出与真实响应同形的结果。同样要求「同输入同输出」。
   */
  mock?: boolean;
  /** mock 下第一次轮询返回 running 的次数（测轮询用；默认 0 = 第一次就成功） */
  mockPendingRounds?: number;
}

/** 从嵌套对象里按顺序挑第一个非空字符串 */
export function pickString(obj: unknown, keys: string[]): string | undefined {
  const record = asRecord(obj);
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

export function asRecord(value: unknown): Json | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined;
}

export function pickNumber(obj: unknown, keys: string[]): number | undefined {
  const record = asRecord(obj);
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

/**
 * 供应商状态码归一化。
 *
 * 审核驳回必须单独识别成 `review_rejected`：归到 running 会无限轮询、积分永久冻结；
 * 归到 failed 会丢掉 745802（前端要提示「改提示词重试」而不是「供应商故障」）。
 */
export function normalizeStatus(raw: unknown): VendorTaskState["status"] {
  if (typeof raw === "number") {
    return (
      ({ 0: "pending", 1: "running", 2: "succeeded", 3: "failed", 4: "review_rejected" } as const)[raw] ??
      "running"
    );
  }
  const value = String(raw ?? "").trim().toLowerCase();
  if (["pending", "queued", "submitted", "created", "waiting"].includes(value)) return "pending";
  if (["running", "processing", "in_progress", "generating", "doing"].includes(value)) return "running";
  if (["succeeded", "success", "completed", "done", "finished", "ok"].includes(value)) return "succeeded";
  if (["review_rejected", "rejected", "audit_failed", "blocked"].includes(value)) return "review_rejected";
  if (["failed", "error", "cancelled", "canceled", "timeout"].includes(value)) return "failed";
  return "running";
}

export interface ExtractSpec {
  /** 产物数组字段名（如 `results` / `audios` / `segments`）；会在 data / data.data / data.output 三处都找 */
  arrayKeys: string[];
  /** 单个产物对象里的 URL 字段名（按顺序取第一个非空） */
  mediaKeys: string[];
}

/** 收集候选产物条目：字符串直接算 URL，对象按 mediaKeys 取 */
function collectCandidates(data: Json, arrayKeys: string[]): unknown[] {
  const scopes: Json[] = [data];
  const nested = asRecord(data.data);
  if (nested) scopes.push(nested);
  const output = asRecord(data.output);
  if (output) scopes.push(output);

  const items: unknown[] = [];
  for (const scope of scopes) {
    for (const key of arrayKeys) {
      const value = scope[key];
      if (Array.isArray(value)) items.push(...value);
      else if (value && typeof value === "object") items.push(value);
    }
  }
  return items;
}

/**
 * 把供应商响应归一化成 `GenResult[]`（去重保序）。
 *
 * 去重是必要的：多数网关会把同一产物同时放在 `data` 与 `output` 两处，
 * 不去重会让一次生成返回 2 个结果、结算按 2 份扣——用户只拿到 1 个产物。
 */
export function extractMediaResults(data: Json, spec: ExtractSpec): GenResult[] {
  const results: GenResult[] = [];
  const seen = new Set<string>();
  for (const item of collectCandidates(data, spec.arrayKeys)) {
    let result: GenResult | undefined;
    if (typeof item === "string") {
      result = item.length > 0 ? { uri: item } : undefined;
    } else {
      const record = asRecord(item);
      const uri = record ? pickString(record, spec.mediaKeys) : undefined;
      if (record && uri) {
        result = {
          uri,
          preview_uri: pickString(record, ["preview_uri", "cover_url", "poster_url", "thumbnail_url"]),
          duration_s: pickNumber(record, ["duration", "duration_s", "audio_duration"]),
          width: pickNumber(record, ["width"]),
          height: pickNumber(record, ["height"]),
        };
      }
    }
    if (!result || seen.has(result.uri)) continue;
    seen.add(result.uri);
    results.push(result);
  }
  return results;
}

/**
 * 后处理能力适配器基类：submit → poll → results 的通用骨架。
 *
 * 子类只需回答三件事：
 *   1. `buildSubmitBody`：请求体怎么拼（各供应商字段差异都在这）
 *   2. `extractSpec`：产物从哪个字段取
 *   3. `mockShape`：mock 下的产物形状（扩展名/数量/时长）
 */
export abstract class HttpPostprocessAdapter implements ModelAdapter {
  abstract readonly vendor: string;
  /** 产物媒体类型：决定 mock 扩展名与「成功但无产物」判定的期望字段 */
  protected abstract readonly resultMedia: ResultMedia;
  /** 产物字段抽取规则 */
  protected abstract get extractSpec(): ExtractSpec;

  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  /** mock 任务形状（由 submit 时的请求决定，poll 时按 id 取回）*/
  private readonly mockJobs = new Map<string, { ext: string; count: number; durationS?: number }>();
  private readonly mockPolls = new Map<string, number>();

  constructor(protected readonly config: PostprocessHttpConfig) {
    if (!config.mock && !config.apiKey) {
      // 这条硬失败是本模块的既有约定（见 registry.ts 顶部注释）：真实模式缺 Key 时
      // 宁可启动/提交失败，也不能静默回落 mock——否则业务以为真的出片了。
      throw new Error(`${this.constructor.name} requires apiKey in real mode (use mock: true for local)`);
    }
    this.baseUrl = (config.baseUrl ?? "").replace(/\/$/, "");
    this.maxRetries = config.maxRetries ?? 2;
    this.retryBaseMs = config.retryBaseMs ?? 400;
  }

  /**
   * 路径必须是**惰性**的（getter 而不是构造函数里算好再存字段）。
   *
   * 原因：子类用 TS 参数属性声明 `private readonly kind`，那些字段在 `super()` 返回**之后**
   * 才赋值。若基类构造函数里调 `this.defaultSubmitPath()`，子类此时 `kind` 还是 undefined，
   * 路径会静默算错（实测：text2sfx 打到了 /v1/music/tasks）。惰性求值没有这个顺序陷阱。
   */
  private get submitPath(): string {
    return this.config.submitPath ?? this.defaultSubmitPath();
  }

  private get pollPath(): string {
    return this.config.pollPath ?? this.defaultPollPath();
  }

  private get cancelPath(): string | undefined {
    return this.config.cancelPath;
  }

  protected abstract defaultSubmitPath(): string;
  protected abstract defaultPollPath(): string;
  protected abstract buildSubmitBody(req: NormalizedGenRequest): Json;
  /** 输入校验失败要抛 vendorParamError（不可重试，也不该扣费） */
  protected abstract validate(req: NormalizedGenRequest): void;
  protected abstract mockShape(req: NormalizedGenRequest): { ext: string; count: number; durationS?: number };

  async submit(req: NormalizedGenRequest): Promise<{ vendor_task_id?: string; sync_results?: GenResult[] }> {
    this.validate(req);
    if (this.config.mock) {
      const id = `mock-${this.vendor}-${req.task_id}`;
      this.mockJobs.set(id, this.mockShape(req));
      return { vendor_task_id: id };
    }

    const data = await this.request("POST", this.submitPath, this.buildSubmitBody(req));
    const syncResults = extractMediaResults(data, this.extractSpec);
    if (syncResults.length > 0) return { sync_results: syncResults };

    const nested = asRecord(data.data);
    const taskId =
      pickString(data, ["task_id", "taskId", "id"]) ??
      (nested ? pickString(nested, ["task_id", "taskId", "id"]) : undefined);
    if (!taskId) {
      throw vendorProtocolError(`${this.vendor} response missing task id`, {
        vendor: this.vendor,
        operation: `POST ${this.submitPath}`,
        status: 200,
      });
    }
    return { vendor_task_id: taskId };
  }

  async poll(vendorTaskId: string): Promise<VendorTaskState> {
    if (this.config.mock) return this.mockPoll(vendorTaskId);

    const path = this.pollPath.replace("{id}", encodeURIComponent(vendorTaskId));
    const data = await this.request("GET", path);
    const inner = asRecord(data.data) ?? data;
    const status = normalizeStatus(inner.status ?? data.status ?? inner.state ?? data.state);

    if (status === "review_rejected") {
      const message = pickString(inner, ["error_message", "message"]) ?? "content review rejected";
      return { status, error: { code: "output_rejected", message }, raw: data };
    }
    if (status === "failed") {
      const message = pickString(inner, ["error_message", "message"]) ?? `${this.vendor} task failed`;
      const code = pickString(inner, ["error_code", "code"]);
      // 失败原因里带审核信号时按审核驳回处理（745802），前端才能提示「改提示词」
      if (looksLikeContentRejection(`${code ?? ""} ${message}`)) {
        return { status: "review_rejected", error: { code: "output_rejected", message }, raw: data };
      }
      return { status: "failed", error: { code: code ?? "vendor_error", message }, raw: data };
    }
    if (status !== "succeeded") return { status, raw: data };

    const results = extractMediaResults(data, this.extractSpec);
    if (results.length === 0) {
      // 「成功但没有产物」必须当失败：否则任务落 SUCCEEDED 却没有 URI，
      // 前端拿到空结果、积分已结算，只能靠人工补单。
      return {
        status: "failed",
        error: {
          code: "vendor_error",
          message: `${this.vendor} task succeeded without ${this.resultMedia} result`,
        },
        raw: data,
      };
    }
    return { status: "succeeded", results, raw: data };
  }

  async cancel(vendorTaskId: string): Promise<void> {
    if (this.config.mock) {
      this.mockJobs.delete(vendorTaskId);
      this.mockPolls.delete(vendorTaskId);
      return;
    }
    if (!this.cancelPath) return;
    const path = this.cancelPath.replace("{id}", encodeURIComponent(vendorTaskId));
    await this.request("POST", path, {}).catch(() => undefined);
  }

  /**
   * 取已完成任务的产物。
   *
   * 为什么单独有这个入口：调用方（工具箱/后处理编排）常常只关心「结果拿来干什么」，
   * 不希望自己写一遍「poll → 判状态 → 取 results」。未完成时显式报错而不是返回空数组：
   * 空数组会让调用方误以为「任务成功但没产物」。
   */
  async fetchResults(vendorTaskId: string): Promise<GenResult[]> {
    const state = await this.poll(vendorTaskId);
    if (state.status === "succeeded") return state.results ?? [];
    if (state.status === "review_rejected" || state.status === "failed") {
      throw new VendorError(
        state.status === "review_rejected" ? "output_rejected" : "vendor_error",
        state.error?.message ?? `${this.vendor} task failed`,
        { vendor: this.vendor, retryable: false },
      );
    }
    throw vendorProtocolError(`${this.vendor} task ${vendorTaskId} not finished (${state.status})`, {
      vendor: this.vendor,
    });
  }

  protected modelFor(req: NormalizedGenRequest): string {
    return (
      this.config.modelMap?.[req.model.name] ?? this.config.defaultModel ?? req.model.name
    );
  }

  /**
   * 供应商私有可选参数（voice / speed / start_s / region / sub_mode…）。
   *
   * 这些字段属于「第 3 批工具箱」的参数面，尚未进入 `generationOptionsSchema`
   * （本批只交付适配器层，不改共享 schema 的公开契约）。适配器按**可选**读取并给默认值，
   * 缺失不报错；等 schema 扩容后把这里换成直接读类型字段即可，调用方无需改。
   */
  protected providerOptions(req: NormalizedGenRequest): Json {
    return (req.request.options ?? {}) as unknown as Json;
  }

  private mockPoll(vendorTaskId: string): VendorTaskState {
    const job = this.mockJobs.get(vendorTaskId);
    if (!job) {
      return { status: "failed", error: { code: "mock_not_found", message: "mock job not found" } };
    }
    const rounds = (this.mockPolls.get(vendorTaskId) ?? 0) + 1;
    this.mockPolls.set(vendorTaskId, rounds);
    if (rounds <= (this.config.mockPendingRounds ?? 0)) return { status: "running" };

    // 产物 URI 只由 vendor_task_id 决定 → 同输入同输出（测试可断言，不需要冻结时间）
    const suffix = (index: number): string => (job.count === 1 ? "" : `-${index}`);
    const results: GenResult[] = Array.from({ length: job.count }, (_, index) => ({
      uri: `mock://results/${vendorTaskId}${suffix(index)}.${job.ext}`,
      preview_uri: `mock://results/${vendorTaskId}-${index}.jpg`,
      ...(job.durationS === undefined ? {} : { duration_s: job.durationS }),
      meta: { mock: true, vendor: this.vendor, media: this.resultMedia, candidate_index: index },
    }));
    return { status: "succeeded", results };
  }

  /** 指数退避重试：只重试 VendorError.retryable（429/5xx/超时/网络） */
  private async request(method: "GET" | "POST", path: string, body?: Json): Promise<Json> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.requestOnce(method, path, body);
      } catch (err) {
        lastError = err;
        if (!isRetryableVendorError(err) || attempt === this.maxRetries) break;
        await new Promise((resolve) => setTimeout(resolve, this.retryBaseMs * 2 ** attempt));
      }
    }
    throw lastError;
  }

  private async requestOnce(method: "GET" | "POST", path: string, body?: Json): Promise<Json> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 120_000);
    const operation = `${method} ${path}`;
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw classifyVendorHttpError(res.status, text, { vendor: this.vendor, operation });
      }
      return await readVendorJson(res, { vendor: this.vendor, operation });
    } catch (err) {
      if (err instanceof VendorError) throw err;
      if (
        err instanceof Error &&
        (err.name === "AbortError" || err.name === "TimeoutError" || err.name === "TypeError")
      ) {
        throw classifyVendorNetworkError(err, { vendor: this.vendor, operation });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 校验辅助：文本类能力要求 prompt 非空 */
  protected requirePrompt(req: NormalizedGenRequest): string {
    const prompt = (req.request.input.prompt ?? "").trim();
    if (!prompt) {
      throw vendorParamError(`${this.vendor} adapter requires input.prompt`, {
        vendor: this.vendor,
        operation: `POST ${this.submitPath}`,
      });
    }
    return prompt;
  }

  /** 校验辅助：要求至少 N 个参考素材（按顺序解释，如 [视频, 音频]） */
  protected requireReferences(req: NormalizedGenRequest, count: number, labels: string[]): string[] {
    const refs = req.request.input.reference_uris ?? [];
    if (refs.length < count) {
      throw vendorParamError(
        `${this.vendor} adapter requires ${count} reference uris (${labels.join(" + ")}), got ${refs.length}`,
        { vendor: this.vendor, operation: `POST ${this.submitPath}` },
      );
    }
    return refs;
  }

  protected ext(): string {
    return EXT_BY_MEDIA[this.resultMedia];
  }
}
