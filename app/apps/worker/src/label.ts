import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GenResult } from "@app/model-adapters";
import type { StorageDriver } from "@app/storage";

const run = promisify(execFile);

export interface AiLabelConfig {
  enabled: boolean;
  text: string;
  fontPath?: string;
  ffmpegPath?: string;
  maxBytes?: number;
}

export interface LabelTaskRef {
  id: string;
  capability: string;
}

const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

// 《AI 生成合成内容标识办法》+ GB 45438：显式（画面水印，不可关闭）+ 隐式（元数据/旁车清单）。
// 无 ffmpeg 或媒体不可解码时降级为仅隐式标识，并记录 explicit_reason，便于抽验。
export async function labelResults(
  storage: StorageDriver,
  task: LabelTaskRef,
  results: GenResult[],
  config: AiLabelConfig,
  log?: (obj: Record<string, unknown>, msg: string) => void,
): Promise<GenResult[]> {
  if (!config.enabled) {
    return results.map((result) => ({
      ...result,
      meta: { ...(result.meta ?? {}), ai_label: { enabled: false } },
    }));
  }

  const labeled: GenResult[] = [];
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index]!;
    const label: Record<string, unknown> = {
      enabled: true,
      ai_generated: true,
      text: config.text,
      generator: "OneFrame AI",
      task_id: task.id,
      generated_at: new Date().toISOString(),
      explicit: false,
      implicit: false,
    };

    if (result.uri) {
      try {
        const sidecarKey = `${result.uri}.ai.json`;
        await storage.put(
          sidecarKey,
          Buffer.from(JSON.stringify(label, null, 2)),
          "application/json",
        );
        label.implicit = true;
        label.sidecar_uri = sidecarKey;
      } catch (error) {
        label.implicit_reason = error instanceof Error ? error.message : String(error);
      }

      try {
        if (task.capability === "video" || task.capability === "image") {
          const data = await storage.read(result.uri);
          if (data.byteLength <= (config.maxBytes ?? DEFAULT_MAX_BYTES)) {
            const out = await watermark(data, task.capability, config);
            if (out) {
              await storage.put(result.uri, out, task.capability === "video" ? "video/mp4" : "image/png");
              label.explicit = true;
            }
          } else {
            label.explicit_reason = "media_too_large";
          }
        }
      } catch (error) {
        label.explicit_reason = error instanceof Error ? error.message.slice(0, 200) : String(error);
      }
    }

    labeled.push({ ...result, meta: { ...(result.meta ?? {}), ai_label: label } });
    log?.({ task_id: task.id, index, explicit: label.explicit, implicit: label.implicit }, "ai label applied");
  }
  return labeled;
}

function watermarkFilter(text: string, fontPath?: string): string {
  const font = fontPath ? `fontfile='${fontPath.replace(/\\/g, "/").replace(":", "\\:")}':` : "";
  const safe = text.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");
  return `drawtext=${font}text='${safe}':x=w-tw-16:y=h-th-16:fontsize=max(20\\,h/40):fontcolor=white@0.85:box=1:boxcolor=black@0.45`;
}

async function watermark(
  data: Buffer,
  capability: string,
  config: AiLabelConfig,
): Promise<Buffer | null> {
  const dir = await mkdtemp(join(tmpdir(), "ai-label-"));
  const input = join(dir, `in.${capability === "video" ? "mp4" : "png"}`);
  const output = join(dir, `out.${capability === "video" ? "mp4" : "png"}`);
  try {
    await writeFile(input, data);
    const args = [
      "-y",
      "-i",
      input,
      "-vf",
      watermarkFilter(config.text, config.fontPath),
      "-metadata",
      "comment=AI-generated content (OneFrame AI)",
      "-metadata",
      "artist=OneFrame AI",
      "-metadata",
      "ai_generated=true",
    ];
    if (capability === "video") {
      args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-c:a", "copy");
    } else {
      args.push("-frames:v", "1");
    }
    args.push(output);
    await run(config.ffmpegPath ?? "ffmpeg", args, { timeout: 30_000, windowsHide: true });
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
