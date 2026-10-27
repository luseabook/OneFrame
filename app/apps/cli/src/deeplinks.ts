import { CliError } from "./errors";
import type { ParsedArgs } from "./args";
import { flagString } from "./args";

/**
 * 离线深链拼接（`commands/deeplink.md`；不读凭据、不发请求、不含 token，deeplink.md:4）。
 *
 * **已知偏离（必须诚实登记）**：竞品深链指向 ReelMate 网页路由
 * （`/series-manage/<sp_id>?tab=workshop|canvas`、`/episode-list`、`/series-manage/asset-confirm` …），
 * 我方 Web 路由不同（`app/apps/web/pages/` 实际是 `/projects/[id]`、`/canvas/[id]`、
 * `/assets`、`/tasks`、`/credits`、`/pricing`）。因此这里按**我方真实路由**生成，
 * 并保留竞品的 query 语义（`tab` / `episode` / `resource_type`）。逐条对应关系写进
 * README 与回报的「已知偏离」。
 */
export interface DeeplinkContext {
  parsed: ParsedArgs;
  webBaseUrl: string;
}

function need(value: string | undefined, key: string, missing: string[]): string {
  if (value && value.trim() !== "") return value;
  missing.push(key);
  throw new CliError("usage", `deeplink 缺少 ${key}`, {
    raw: { kind: "usage", needs_input: true, missing: [...missing, key] },
  });
}

export function buildDeeplink(cmd: string, ctx: DeeplinkContext): string {
  const { parsed, webBaseUrl } = ctx;
  const web = webBaseUrl.replace(/\/+$/, "");
  const setString = (key: string): string | undefined => {
    const value = parsed.sets[key];
    return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
  };
  const spId = () => setString("sp_id") ?? flagString(parsed, "workspace");
  const missing: string[] = [];

  switch (cmd) {
    case "canvas": {
      const canvas = flagString(parsed, "canvas") ?? setString("canvas_id");
      const id = need(canvas, "canvas_id", missing);
      const episode = flagString(parsed, "episode") ?? setString("episode_id");
      const query = new URLSearchParams();
      if (episode) query.set("episode", episode);
      const navigation = flagString(parsed, "navigation-source");
      if (navigation) query.set("navigationSource", navigation);
      const qs = query.toString();
      return `${web}/canvas/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`;
    }
    case "task": {
      const taskId = flagString(parsed, "task-id") ?? setString("task_id");
      const id = need(taskId, "task_id", missing);
      return `${web}/tasks?task_id=${encodeURIComponent(id)}`;
    }
    case "pricing":
      // 竞品带 device_id/client_source/plugin_ver；我方无插件版本概念，只保留入口
      return `${web}/pricing`;
    case "credits":
      return `${web}/credits`;
    case "project": {
      const id = need(spId(), "sp_id", missing);
      const explicitTab = setString("tab");
      const creationMode = setString("creation_mode");
      // 显式 tab 优先于 creation_mode 推导（deeplink.md:132）
      const tab =
        explicitTab === "canvas" || explicitTab === "无限画布"
          ? "canvas"
          : explicitTab === "workshop" || explicitTab === "制片工坊"
            ? "workshop"
            : creationMode === "2"
              ? "canvas"
              : "workshop";
      return `${web}/projects/${encodeURIComponent(id)}?tab=${tab}`;
    }
    case "episode": {
      const id = need(spId(), "sp_id", missing);
      const ep = flagString(parsed, "episode") ?? setString("ep_id");
      if (!ep) return `${web}/projects/${encodeURIComponent(id)}?tab=workshop&episode_list=1`;
      return `${web}/projects/${encodeURIComponent(id)}?tab=workshop&episode=${encodeURIComponent(ep)}`;
    }
    case "asset": {
      const id = need(spId(), "sp_id", missing);
      const resourceType = setString("resource_type") ?? "1";
      return `${web}/projects/${encodeURIComponent(id)}?tab=assets&resource_type=${encodeURIComponent(resourceType)}`;
    }
    case "asset-confirm":
    case "asset-extract":
    case "asset-result": {
      const id = need(spId(), "sp_id", missing);
      const name = flagString(parsed, "name") ?? setString("name");
      need(name, "name", missing);
      const total = setString("episode_total") ?? setString("episodeTotal");
      need(total, "episode_total", missing);
      const page = cmd === "asset-result" ? "asset_result" : "assets";
      return `${web}/projects/${encodeURIComponent(id)}?tab=${page}&name=${encodeURIComponent(String(name))}&episodeTotal=${encodeURIComponent(String(total))}`;
    }
    case "asset-lib":
      // 资产库是跨项目页面，不接受项目 ID（deeplink.md:246）
      return `${web}/assets`;
    default:
      throw new CliError("usage", `deeplink 子命令不存在：${cmd}`, { raw: { missing: [cmd] } });
  }
}
