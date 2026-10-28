import { CliError } from "./errors";
import type { TransformName } from "./registry";

/**
 * 响应整形（纯函数，可单测）。
 *
 * 只做「换个取景框」的事：从既有响应里取出竞品文档写明的字段，或在客户端做
 * 一次过滤（`model search`）。**不做**业务计算、不补假字段。
 */
export interface TransformContext {
  /** `node get` 的目标节点 ID（位置参数或 --node） */
  nodeId?: string;
  /** `model search` 的关键词 */
  keyword?: string;
  /** `model params` 的模型展示名 */
  modelName?: string;
  /** `storyboard get` 的目标分镜 ID */
  storyboardId?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** 统一分页视图（竞品所有列表命令同口径，见 commands/task.md:58） */
export function paginatedView(
  list: unknown[],
  total: number,
  page = 1,
  pageSize = list.length,
): Record<string, unknown> {
  const hasMore = page * pageSize < total;
  return {
    count: total,
    page,
    page_size: pageSize,
    has_more: hasMore,
    next_page: hasMore ? page + 1 : null,
    list,
  };
}

function modelMatches(entry: Record<string, unknown>, keyword: string): boolean {
  const haystack = [entry.name, entry.display_name, entry.description, entry.vendor]
    .filter((v): v is string => typeof v === "string")
    .join(" ")
    .toLowerCase();
  return haystack.includes(keyword.toLowerCase());
}

export function applyTransform(
  name: TransformName | undefined,
  data: unknown,
  ctx: TransformContext = {},
): unknown {
  switch (name) {
    case undefined:
    case "none":
      return data;

    // `credits balance` 取 GET /me 的 credits 段（auth.service.ts:242）
    case "credits":
      return asRecord(data).credits ?? data;

    case "modelSearch": {
      if (!Array.isArray(data)) throw new CliError("internal", "model search expects a list");
      const keyword = ctx.keyword?.trim();
      if (!keyword) throw new CliError("usage", "model search 需要 KEYWORD");
      return (data as Record<string, unknown>[]).filter((entry) => modelMatches(entry, keyword));
    }

    case "modelByName": {
      if (!Array.isArray(data)) throw new CliError("internal", "model params expects a list");
      const wanted = ctx.modelName?.trim();
      if (!wanted) throw new CliError("usage", "model params 需要 MODEL_NAME");
      const hit = (data as Record<string, unknown>[]).find(
        (entry) => entry.display_name === wanted || entry.name === wanted,
      );
      if (!hit) {
        throw new CliError("not_found", `model not found: ${wanted}`, {
          raw: { model: wanted },
        });
      }
      // 竞品 model params 输出 `generation.<mode>`；我方 /models 的等价字段是 `modes`
      return { name: hit.name, display_name: hit.display_name, types: hit.types, params: hit.modes };
    }

    // `episode list` 取矩阵端点的 episodes 段（script.service projectMatrix）
    case "episodesOfProject": {
      const record = asRecord(data);
      const episodes = Array.isArray(record.episodes) ? record.episodes : [];
      return { project: record.project ?? null, episodes, count: episodes.length };
    }

    // `storyboard list/get` 取剧集详情里的 storyboards 段（script.service episodeDetail）
    case "storyboardsOfEpisode": {
      const record = asRecord(data);
      const shots = Array.isArray(record.storyboards) ? record.storyboards : [];
      if (!ctx.storyboardId) {
        return { episode: record.episode ?? null, storyboards: shots, count: shots.length };
      }
      const hit = (shots as Record<string, unknown>[]).find(
        (shot) => String(shot.id ?? "") === String(ctx.storyboardId),
      );
      if (!hit) {
        throw new CliError("not_found", `storyboard not found: ${ctx.storyboardId}`, {
          raw: { storyboard_id: ctx.storyboardId },
        });
      }
      return hit;
    }

    // `node get`：我方无 GET /nodes/:id，客户端按 id 过滤 node_list（commands/node.md:210）
    case "nodeById": {
      const record = asRecord(data);
      const nodes = Array.isArray(record.list)
        ? (record.list as Record<string, unknown>[])
        : Array.isArray(data)
          ? (data as Record<string, unknown>[])
          : [];
      const wanted = ctx.nodeId?.trim();
      if (!wanted) throw new CliError("usage", "node get 需要 NODE_ID（位置参数或 --node）");
      const hit = nodes.find((node) => String(node.id ?? "") === wanted);
      if (!hit) {
        throw new CliError("not_found", `node not found: ${wanted}`, { raw: { node_id: wanted } });
      }
      return hit;
    }

    case "taskList": {
      if (Array.isArray(data)) return paginatedView(data, data.length);
      const record = asRecord(data);
      const list = Array.isArray(record.list) ? record.list : [];
      return paginatedView(
        list,
        Number(record.total ?? list.length),
        Number(record.page ?? 1),
        Number(record.page_size ?? list.length),
      );
    }

    /**
     * `credits log`：把带符号 `delta` 派生成竞品**旧接口**的语义。
     *
     * 竞品文档（`commands/credits.md:68`）自己写明 `credits log`（`/user/credits-log`）与
     * `credits flows`（`/user/credits-dashboard/flows`）字段语义不同、不能混用：
     * 旧接口是 `event_type`（1 获取 / 2 消耗）+ **无符号** `val`，新接口才是带符号 `points`。
     *
     * 我方账本只有一份带符号真值（`credit_flows.delta`），所以这里做的是**纯展示换算**：
     * `event_type = delta >= 0 ? 1 : 2`、`val = |delta|`。不新增后端端点，也不改 `credits flows` 的带符号口径。
     *
     * `delta === 0` 的行（冻结/解冻时 `delta` 可能为 0、变动全在 `frozen_delta`）归入 1（获取）——
     * 这类行在旧接口里没有对应概念，宁可归到"不是消耗"，也不把冻结误报成扣分。
     */
    case "creditsLog": {
      const record = asRecord(data);
      const rows = Array.isArray(record.list)
        ? (record.list as Record<string, unknown>[])
        : Array.isArray(data)
          ? (data as Record<string, unknown>[])
          : [];
      const list = rows.map((row) => {
        const delta = Number(row.delta ?? 0);
        return {
          id: row.id,
          event_type: delta >= 0 ? 1 : 2,
          val: Math.abs(delta),
          kind: row.kind,
          balance_after: row.balance_after,
          task_id: row.task_id ?? null,
          memo: row.memo ?? null,
          created_at: row.created_at,
        };
      });
      return paginatedView(
        list,
        Number(record.total ?? list.length),
        Number(record.page ?? 1),
        Number(record.page_size ?? list.length),
      );
    }
  }
}
