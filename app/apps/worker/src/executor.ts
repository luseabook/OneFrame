import { and, eq } from "drizzle-orm";
import { assets, models, projectAssets, settleCredits, storyboards, taskEvents, tasks, unfreezeCredits } from "@app/db";
import type { Db } from "@app/db";
import type { GenResult, AdapterRuntimeOptions } from "@app/model-adapters";
import { resolveAdapter } from "@app/model-adapters";
import type { StorageDriver } from "@app/storage";
import { newId, TaskStatus, type GenerationRequest } from "@app/shared";
import { labelResults, type AiLabelConfig } from "./label";

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
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function contentTypeFor(task: TaskRow): string {
  if (task.capability === "video") return "video/mp4";
  if (task.capability === "image") return "image/png";
  if (task.capability === "text") return "text/plain; charset=utf-8";
  return "application/octet-stream";
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
      data = Buffer.from(`mock result for task ${task.id} #${index}\n`);
    } else if (/^https?:\/\//.test(result.uri)) {
      const res = await fetch(result.uri);
      if (!res.ok) throw new Error(`download result failed: ${res.status}`);
      data = Buffer.from(await res.arrayBuffer());
    } else {
      // 已经是存储 key（适配器/上游已转存）
      return result;
    }
    const ext = contentType.startsWith("video") ? "mp4" : contentType.startsWith("image") ? "png" : "bin";
    const key = `u/${task.spaceId}/tasks/${task.id}/r${index}.${ext}`;
    const stored = await deps.storage.put(key, data, contentType);
    return {
      ...result,
      uri: stored.key,
      meta: { ...(result.meta ?? {}), storage: deps.storage.driver, original_uri: result.uri },
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
    if (fresh.creditsFrozen > 0) {
      await settleCredits(tx, {
        spaceId: fresh.spaceId,
        cost: fresh.creditsFrozen,
        taskId: fresh.id,
        memo: "task succeeded settle",
      });
    }
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
    if (fresh.status === TaskStatus.SUCCEEDED || fresh.status === TaskStatus.FAILED) return;
    if (fresh.creditsFrozen > 0) {
      await unfreezeCredits(tx, {
        spaceId: fresh.spaceId,
        cost: fresh.creditsFrozen,
        taskId: fresh.id,
        memo: "task failed refund",
      });
    }
    // PRD F7：审核拒绝 → 输出审核错误码 745802；其余失败 → 供应商错误
    const errorCode =
      status === TaskStatus.REVIEW_REJECTED || error.kind === "output_rejected"
        ? 745802
        : 745901;
    await tx
      .update(tasks)
      .set({ status, error: { ...error, code: errorCode }, finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(tasks.id, task.id));
    // 视频失败/审核拒绝：分镜退回“确认”，允许重新投递
    await tx
      .update(storyboards)
      .set({ status: 2, updatedAt: new Date() })
      .where(eq(storyboards.videoTaskId, task.id));
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

    const request: GenerationRequest = {
      mode: task.mode as GenerationRequest["mode"],
      model: model.name,
      scene: (task.scene as GenerationRequest["scene"]) ?? null,
      input: task.input as GenerationRequest["input"],
      options: task.options as GenerationRequest["options"],
    };
    const adapter = resolveAdapter(model.adapterCode, deps.adapterOptions);
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
    const deadline = Date.now() + (deps.maxPollMs ?? 120_000);
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
