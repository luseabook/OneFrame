import { and, eq } from "drizzle-orm";
import { assets, canvasNodes, models, projectAssets, releaseFrozen, storyboards, taskEvents, tasks } from "@app/db";
import type { Db } from "@app/db";
import type { GenResult, AdapterRuntimeOptions, ModelAdapter } from "@app/model-adapters";
import { resolveAdapter } from "@app/model-adapters";
import type { StorageDriver } from "@app/storage";
import { newId, TaskStatus, type GenerationRequest } from "@app/shared";
import { labelResults, type AiLabelConfig } from "./label";
import { resolveOutboundUris } from "./outbound-uri";
import { mockPngBuffer } from "./mock-media";

export type TaskRow = typeof tasks.$inferSelect;

export interface ExecutorDeps {
  db: Db;
  storage: StorageDriver;
  adapterOptions: AdapterRuntimeOptions;
  log?: (obj: Record<string, unknown>, msg: string) => void;
  aiLabel?: AiLabelConfig;
  pollIntervalMs?: number;
  maxPollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** 出站素材 URI 签名有效期（秒）；默认 21600，由 ADAPTER_URI_TTL_SECONDS 覆盖 */
  outboundUriTtlSeconds?: number;
  /** 适配器解析注入点（仅测试用；默认走 model-adapters 的 resolveAdapter） */
  resolveAdapter?: (adapterCode: string, options: AdapterRuntimeOptions) => ModelAdapter;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 轮询上游生成结果的最长等待（P1-16）。
 *
 * 为什么是 15 分钟：真实视频生成 2–10 分钟是常态（5s/1080p 起步 3–6 分钟），
 * 原来 120s 的默认值意味着「按默认配置上线，绝大多数视频任务都会在超时后被判失败」——
 * 虽然会解冻不扣费，但用户体验是「点了没反应然后失败」，并会污染失败率告警。
 * 15 分钟覆盖 P99 并留余量；供应商更慢时可以调 `POLL_MAX_MS`。
 */
export const DEFAULT_MAX_POLL_MS = 15 * 60_000;

/**
 * 任务产物落库的 Content-Type / 扩展名。
 *
 * 第 3 批补 `speech` / `music`：工具箱的配音、音乐、音效、音色修改产出的都是音轨，
 * 若不单独映射会被当成 `application/octet-stream` 存成 `.bin`——前端 `<audio>` 拿到的
 * 是 `.bin`，浏览器按内容类型拒绝播放，看起来像"生成失败"，实际是文件类型错了。
 */
function contentTypeFor(task: TaskRow): string {
  if (task.capability === "video") return "video/mp4";
  if (task.capability === "image") return "image/png";
  if (task.capability === "text") return "text/plain; charset=utf-8";
  if (task.capability === "speech" || task.capability === "music") return "audio/mpeg";
  return "application/octet-stream";
}

/** 产物扩展名必须跟 Content-Type 一致（见 contentTypeFor 的注释） */
function extFor(contentType: string): string {
  if (contentType.startsWith("video")) return "mp4";
  if (contentType.startsWith("image")) return "png";
  if (contentType.startsWith("audio")) return "mp3";
  if (contentType.startsWith("text")) return "txt";
  return "bin";
}

export async function transferResult(
  deps: ExecutorDeps,
  task: TaskRow,
  index: number,
  result: GenResult,
  contentType: string,
): Promise<GenResult> {
  if (result.text || !result.uri) return result;
  try {
    let data: Buffer;
    if (result.uri.startsWith("mock://")) {
      /**
       * mock 产物必须**能被子类型解码器渲染**：
       * - 图片 → 真 PNG（`mockPngBuffer`，纯 Node 生成，颜色由 taskId 派生）
       * - 其它（音视频）→ 保留文本占位，但打 `mock_placeholder` 标记，
       *   让前端显示"mock 占位（未接真实供应商）"而不是裂图/静默不播。
       */
      if (contentType.startsWith("image/")) {
        data = mockPngBuffer(`${String(task.id)}#${index}`);
      } else {
        data = Buffer.from(`mock result for task ${task.id} #${index}\n`);
      }
    } else if (/^https?:\/\//.test(result.uri)) {
      const res = await fetch(result.uri);
      if (!res.ok) throw new Error(`download result failed: ${res.status}`);
      data = Buffer.from(await res.arrayBuffer());
    } else {
      // 已经是存储 key（适配器/上游已转存）
      return result;
    }
    const ext = extFor(contentType);
    const key = `u/${task.spaceId}/tasks/${task.id}/r${index}.${ext}`;
    const stored = await deps.storage.put(key, data, contentType);
    const isMockPlaceholder = result.uri.startsWith("mock://") && !contentType.startsWith("image/");
    return {
      ...result,
      uri: stored.key,
      meta: {
        ...(result.meta ?? {}),
        storage: deps.storage.driver,
        original_uri: result.uri,
        ...(isMockPlaceholder ? { mock_placeholder: true } : {}),
      },
    };
  } catch (error) {
    // ADR-005 降级：转存失败保留供应商 URL，并标记，便于人工补转
    deps.log?.(
      { task_id: String(task.id), err: error instanceof Error ? error.message : String(error) },
      "result transfer failed, degrade to origin uri",
    );
    return { ...result, meta: { ...(result.meta ?? {}), transfer_failed: true } };
  }
}

async function succeed(deps: ExecutorDeps, task: TaskRow, results: GenResult[]): Promise<void> {
  const contentType = contentTypeFor(task);
  const transferred: GenResult[] = [];
  for (let i = 0; i < results.length; i += 1) {
    transferred.push(await transferResult(deps, task, i, results[i]!, contentType));
  }
  const labeled = deps.aiLabel
    ? await labelResults(
        deps.storage,
        { id: String(task.id), capability: task.capability },
        transferred,
        deps.aiLabel,
        deps.log,
      )
    : transferred;

  await deps.db.transaction(async (tx) => {
    const [fresh] = await tx.select().from(tasks).where(eq(tasks.id, task.id)).for("update");
    if (!fresh) return;
    if (
      fresh.status === TaskStatus.CANCELED ||
      fresh.status === TaskStatus.SUCCEEDED ||
      fresh.status === TaskStatus.FAILED
    ) {
      return;
    }
    await tx
      .update(tasks)
      .set({
        status: TaskStatus.SUCCEEDED,
        progress: 100,
        results: labeled,
        creditsSettled: fresh.creditsFrozen,
        finishedAt: new Date(),
        expireAt: new Date(Date.now() + 90 * 24 * 3600 * 1000),
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, task.id));
    // 冻结收尾（PR-03）：成功后是 **settle**，额度按 credit_flows 的 outstanding 算，
    // 并按同一口径把 tasks.credits_frozen 归零（此前全仓 0 处归零，导致该字段恒 >0）。
    // 这里**不能**换成 unfreeze：赠送额度是 delta=0/frozen_delta=-N，换成解冻会凭空多出可用余额。
    await releaseFrozen(tx, {
      spaceId: fresh.spaceId,
      taskId: fresh.id,
      disposition: "settle",
      memo: "task succeeded settle",
    });
    // 定妆图任务：成功结果自动资产化并置角色定稿（未定稿角色不得被分镜引用）
    if (fresh.capability === "image" && labeled[0]?.uri) {
      const [portrait] = await tx
        .select()
        .from(projectAssets)
        .where(eq(projectAssets.sourceTaskId, fresh.id));
      if (portrait && !portrait.portraitAssetId) {
        const assetId = newId();
        await tx.insert(assets).values({
          id: assetId,
          spaceId: fresh.spaceId,
          kind: "image",
          uri: labeled[0].uri,
          previewUri: labeled[0].preview_uri ?? null,
          sourceTaskId: fresh.id,
          name: portrait.name,
          tags: ["portrait"],
          meta: { project_id: String(portrait.projectId), project_asset_id: String(portrait.id) },
        });
        await tx
          .update(projectAssets)
          .set({
            portraitAssetId: assetId,
            refImageUri: labeled[0].uri,
            status: 2,
            finalizedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(projectAssets.id, portrait.id)));
        await tx.insert(taskEvents).values({
          id: newId(),
          taskId: fresh.id,
          type: "asset.finalized",
          payload: { project_asset_id: String(portrait.id), asset_id: String(assetId) },
        });
      }
    }

    // 分镜任务回写：视频成功 → status=5（出片）；出图成功 → status=4（出图）
    await tx
      .update(storyboards)
      .set({ status: 5, updatedAt: new Date() })
      .where(eq(storyboards.videoTaskId, fresh.id));
    await tx
      .update(storyboards)
      .set({ status: 4, updatedAt: new Date() })
      .where(eq(storyboards.imageTaskId, fresh.id));

    /**
     * 画布节点回写：任务成功 → 节点 status=3（就绪/完成），并把结果第一个 URI
     * 写进 params.result_uri，让画布节点能直接渲染缩略图/播放。
     *
     * 为什么必须在这里做：画布节点的 task_id 是"派生任务"的引用，
     * 任务终态如果不回写节点，画布上会永远显示"生成中"——
     * 用户只能刷新页面才看到结果，且刷新也还是生成中（因为没人写这个字段）。
     * 失败路径同理（见 fail()）。
     */
    const canvasNodeRows = await tx
      .select()
      .from(canvasNodes)
      .where(eq(canvasNodes.taskId, fresh.id));
    for (const cn of canvasNodeRows) {
      const first = labeled[0];
      const nextParams = {
        ...(cn.params as Record<string, unknown>),
        ...(first?.uri
          ? {
              result_uri: first.uri,
              result_preview_uri: first.preview_uri ?? first.uri,
              // 保留整批结果，便于画布节点做多候选切换
              result_uris: labeled.map((l) => l.uri).filter(Boolean),
            }
          : {}),
        /**
         * 文本类派生（剧本优化 / 拆解分镜）没有 uri，只有 text。
         * 不写这一段的话，任务成功了但节点上什么都不显示——用户以为没跑成功。
         */
        ...(first?.text
          ? {
              result_text: first.text,
              result_texts: labeled.map((l) => l.text).filter(Boolean),
            }
          : {}),
      };
      await tx
        .update(canvasNodes)
        .set({ status: 3, params: nextParams, updatedAt: new Date() })
        .where(eq(canvasNodes.id, cn.id));
      await tx.insert(taskEvents).values({
        id: newId(),
        taskId: fresh.id,
        type: "canvas.node.completed",
        payload: { node_id: String(cn.id), results: labeled.length },
      });
    }

    await tx.insert(taskEvents).values({
      id: newId(),
      taskId: fresh.id,
      type: "task.succeeded",
      payload: { results: labeled.length },
    });
  });
}

async function fail(
  deps: ExecutorDeps,
  task: TaskRow,
  status: typeof TaskStatus.FAILED | typeof TaskStatus.REVIEW_REJECTED,
  error: { kind: string; message: string },
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const [fresh] = await tx.select().from(tasks).where(eq(tasks.id, task.id)).for("update");
    if (!fresh) return;
    // 三个终态都要挡：漏掉 CANCELED 会让「用户取消 → 已解冻」之后又被这里再退一次
    //（凭空造积分）。与 succeed() 的守卫保持同一集合，不许只改一处。
    if (
      fresh.status === TaskStatus.CANCELED ||
      fresh.status === TaskStatus.SUCCEEDED ||
      fresh.status === TaskStatus.FAILED
    ) {
      return;
    }
    // 失败/审核拒绝 → 按流水 unfreeze（幂等：已释放过的任务不会再退一次）
    await releaseFrozen(tx, {
      spaceId: fresh.spaceId,
      taskId: fresh.id,
      disposition: "unfreeze",
      memo: "task failed refund",
    });
    // PRD F7：审核拒绝 → 输出审核错误码 745802；其余失败 → 供应商错误 745900
    const errorCode =
      status === TaskStatus.REVIEW_REJECTED || error.kind === "output_rejected" ? 745802 : 745900;
    await tx
      .update(tasks)
      .set({ status, error: { ...error, code: errorCode }, finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(tasks.id, task.id));
    // 视频失败/审核拒绝：分镜退回“确认”，允许重新投递
    await tx
      .update(storyboards)
      .set({ status: 2, updatedAt: new Date() })
      .where(eq(storyboards.videoTaskId, task.id));

    // 画布节点回写：失败 → 节点回到 status=1（就绪），并把错误码写进 params.last_error，
    // 让画布上能显示失败原因并允许重投。积分已在上方 unfreeze 退回，用户不会白付。
    const canvasNodeRows = await tx.select().from(canvasNodes).where(eq(canvasNodes.taskId, task.id));
    for (const cn of canvasNodeRows) {
      await tx
        .update(canvasNodes)
        .set({
          status: 1,
          params: { ...(cn.params as Record<string, unknown>), last_error: { code: errorCode, ...error } },
          updatedAt: new Date(),
        })
        .where(eq(canvasNodes.id, cn.id));
      await tx.insert(taskEvents).values({
        id: newId(),
        taskId: fresh.id,
        type: "canvas.node.failed",
        payload: { node_id: String(cn.id), code: errorCode },
      });
    }

    await tx.insert(taskEvents).values({
      id: newId(),
      taskId: fresh.id,
      type: status === TaskStatus.REVIEW_REJECTED ? "task.review_rejected" : "task.failed",
      payload: error,
    });
  });
}

export async function runGenerationTask(taskId: string, deps: ExecutorDeps): Promise<void> {
  const id = BigInt(taskId);
  const sleep = deps.sleep ?? defaultSleep;

  const [task] = await deps.db.select().from(tasks).where(eq(tasks.id, id));
  if (!task) throw new Error(`task not found: ${taskId}`);
  if (
    task.status === TaskStatus.SUCCEEDED ||
    task.status === TaskStatus.FAILED ||
    task.status === TaskStatus.CANCELED
  ) {
    return;
  }
  const [model] = await deps.db.select().from(models).where(eq(models.id, task.modelId));
  if (!model) {
    await fail(deps, task, TaskStatus.FAILED, { kind: "model_missing", message: "model not found" });
    return;
  }

  try {
    await deps.db.transaction(async (tx) => {
      const [fresh] = await tx.select().from(tasks).where(eq(tasks.id, id)).for("update");
      if (!fresh || fresh.status === TaskStatus.CANCELED) return;
      await tx
        .update(tasks)
        .set({ status: TaskStatus.RUNNING, progress: 10, updatedAt: new Date() })
        .where(eq(tasks.id, id));
      await tx.insert(taskEvents).values({
        id: newId(),
        taskId: id,
        type: "task.running",
        payload: { adapter: model.adapterCode },
      });
    });

    // P10：出站素材签名（real 模式 storage key → 公网签名 URL；mock 原样透传）。
    // 只改出站 payload；tasks.input 落库仍是 raw key（本函数不写 DB）。
    const outboundInput = await resolveOutboundUris(
      (task.input ?? {}) as GenerationRequest["input"],
      {
        adapterMode: deps.adapterOptions.mode === "real" ? "real" : "mock",
        sign: (key, ttlSeconds) => deps.storage.signDownload(key, ttlSeconds),
        ttlSeconds: deps.outboundUriTtlSeconds,
        logger: deps.log,
      },
    );
    const request: GenerationRequest = {
      mode: task.mode as GenerationRequest["mode"],
      model: model.name,
      scene: (task.scene as GenerationRequest["scene"]) ?? null,
      input: outboundInput,
      options: task.options as GenerationRequest["options"],
    };
    const adapter = (deps.resolveAdapter ?? resolveAdapter)(model.adapterCode, deps.adapterOptions);
    const submitted = await adapter.submit({
      task_id: String(task.id),
      request,
      model: { name: model.name, vendor: model.vendor, adapter_code: model.adapterCode },
    });

    if (submitted.sync_results) {
      await succeed(deps, task, submitted.sync_results);
      return;
    }
    if (!submitted.vendor_task_id) {
      throw new Error("adapter returned neither vendor_task_id nor sync_results");
    }

    await deps.db
      .update(tasks)
      .set({ vendorTaskId: submitted.vendor_task_id, updatedAt: new Date() })
      .where(eq(tasks.id, id));

    const interval = deps.pollIntervalMs ?? 1000;
    const deadline = Date.now() + (deps.maxPollMs ?? DEFAULT_MAX_POLL_MS);
    for (;;) {
      const state = await adapter.poll(submitted.vendor_task_id);
      if (state.status === "succeeded") {
        await succeed(deps, task, state.results ?? []);
        return;
      }
      if (state.status === "failed") {
        await fail(deps, task, TaskStatus.FAILED, {
          kind: state.error?.code ?? "vendor_error",
          message: state.error?.message ?? "vendor failed",
        });
        return;
      }
      if (state.status === "review_rejected") {
        await fail(deps, task, TaskStatus.REVIEW_REJECTED, {
          kind: state.error?.code ?? "review_rejected",
          message: state.error?.message ?? "review rejected",
        });
        return;
      }
      if (Date.now() > deadline) {
        await fail(deps, task, TaskStatus.FAILED, { kind: "vendor_timeout", message: "poll timeout" });
        return;
      }
      await sleep(interval);
    }
  } catch (error) {
    deps.log?.(
      { task_id: taskId, err: error instanceof Error ? error.message : String(error) },
      "generation task failed",
    );
    await fail(deps, task, TaskStatus.FAILED, {
      kind: "executor_error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
