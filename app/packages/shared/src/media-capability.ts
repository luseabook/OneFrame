import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * 媒体能力的**探测**（而不是配置开关）。
 *
 * 为什么这样设计：`ffmpeg` 是部署环境决定的能力，不是产品开关。
 * 之前的做法是"代码里假设没有 ffmpeg → 切片用产物复制"，
 * 结果是**环境一旦装了 ffmpeg，也要改代码才能用上**。
 *
 * 这里改成运行时探测：
 *   · 探测成功 → `available: true`，带 `version` 与 `path`，上层据此走真裁剪；
 *   · 探测失败 → `available: false` + `reason`，上层**诚实降级**（复制而非裁剪），
 *     并把原因透出给 API/前端，而不是悄悄降级。
 *
 * 探测结果**进程内缓存**（默认 5 分钟）：`ffmpeg -version` 虽然只要几十毫秒，
 * 但每次请求都 spawn 一个进程既慢又吵；同时保留 TTL，装完 ffmpeg 不用重启服务。
 */
export interface MediaCapability {
  available: boolean;
  path: string;
  version: string | null;
  /** 不可用时的可读原因（供日志与 API 透出；可用时为 null） */
  reason: string | null;
  /** 探测时间（ISO），便于判断缓存是否新鲜 */
  checked_at: string;
}

interface CacheEntry {
  value: MediaCapability;
  at: number;
}

const CACHE = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60_000;

/** 从 `ffmpeg -version` 的首行里取版本号（`ffmpeg version 6.1.1-...`） */
export function parseFfmpegVersion(stdout: string): string | null {
  const m = /^ffmpeg version (\S+)/im.exec(stdout ?? "");
  return m?.[1] ?? null;
}

/**
 * 探测 ffmpeg 是否可用。`preferredPath` 为空时用 PATH 里的 `ffmpeg`。
 * 绝不抛异常：探测失败本身是**正常结果**（`available:false`）。
 */
export async function probeFfmpeg(
  preferredPath?: string,
  options: { force?: boolean } = {},
): Promise<MediaCapability> {
  const bin = (preferredPath ?? "").trim() || "ffmpeg";
  const cached = CACHE.get(bin);
  if (!options.force && cached && Date.now() - cached.at < TTL_MS) return cached.value;

  const checkedAt = new Date().toISOString();
  let value: MediaCapability;
  try {
    const { stdout } = await run(bin, ["-version"], { timeout: 5_000, windowsHide: true });
    const version = parseFfmpegVersion(stdout ?? "");
    value = { available: true, path: bin, version, reason: null, checked_at: checkedAt };
  } catch (error) {
    const err = error as { code?: string | number; message?: string };
    // ENOENT = 没装；其它（权限/超时）也要给出可读原因，不能笼统说"不可用"
    const reason =
      err.code === "ENOENT"
        ? `未找到可执行文件 ${bin}（PATH 里没有 ffmpeg）`
        : `执行 ${bin} -version 失败：${String(err.message ?? err.code ?? "unknown").slice(0, 160)}`;
    value = { available: false, path: bin, version: null, reason, checked_at: checkedAt };
  }
  CACHE.set(bin, { value, at: Date.now() });
  return value;
}

/** 测试用：清空探测缓存（生产不需要） */
export function resetFfmpegProbeCache(): void {
  CACHE.clear();
}
