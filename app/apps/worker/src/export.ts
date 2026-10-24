import JSZip from "jszip";
import { and, eq, inArray } from "drizzle-orm";
import { episodes, exportJobs, storyboards, tasks } from "@app/db";
import type { Db } from "@app/db";
import type { StorageDriver } from "@app/storage";

export interface ExportDeps {
  db: Db;
  storage: StorageDriver;
  log?: (obj: Record<string, unknown>, msg: string) => void;
}

type TaskResult = { uri?: string };

async function readResult(storage: StorageDriver, uri: string): Promise<Buffer> {
  if (/^https?:\/\//.test(uri)) {
    const res = await fetch(uri);
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) throw new Error(`unsupported result uri: ${uri.slice(0, 20)}`);
  return storage.read(uri);
}

// 整集导出：只打包已成功的镜头；无可用视频 → FAILED 400106（前端提示补齐）
export async function runExport(exportId: string, deps: ExportDeps): Promise<void> {
  const id = BigInt(exportId);
  const [row] = await deps.db.select().from(exportJobs).where(eq(exportJobs.id, id));
  if (!row) throw new Error(`export not found: ${exportId}`);
  if (row.status === 3 || row.status === 4) return;

  await deps.db
    .update(exportJobs)
    .set({ status: 2, updatedAt: new Date() })
    .where(eq(exportJobs.id, id));

  try {
    const [episode] = await deps.db.select().from(episodes).where(eq(episodes.id, row.episodeId));
    if (!episode) throw new Error("episode not found");
    const shots = await deps.db
      .select()
      .from(storyboards)
      .where(eq(storyboards.episodeId, row.episodeId))
      .orderBy(storyboards.shotNo);
    const taskIds = shots.map((s) => s.videoTaskId).filter((v): v is bigint => v !== null);
    const taskRows =
      taskIds.length > 0
        ? await deps.db.select().from(tasks).where(and(inArray(tasks.id, taskIds), eq(tasks.status, 3)))
        : [];
    const taskById = new Map(taskRows.map((t) => [String(t.id), t]));

    const zip = new JSZip();
    const manifest = {
      export_id: exportId,
      episode: { ep_no: episode.epNo, title: episode.title, synopsis: episode.synopsis },
      generated_at: new Date().toISOString(),
      ai_label: { ai_generated: true, standard: "GB 45438 / 生成合成内容标识办法", explicit: false, implicit: true },
      shots: [] as Array<Record<string, unknown>>,
    };

    for (const shot of shots) {
      const task = shot.videoTaskId ? taskById.get(String(shot.videoTaskId)) : undefined;
      const uri = (task?.results as TaskResult[] | null)?.[0]?.uri;
      if (!uri) continue;
      const fileName = `shot-${String(shot.shotNo).padStart(2, "0")}.mp4`;
      try {
        zip.file(fileName, await readResult(deps.storage, uri));
        const resultMeta = (task?.results as Array<{ meta?: { ai_label?: { explicit?: boolean } } }> | null)?.[0]?.meta;
        const aiLabel = resultMeta?.ai_label;
        if (aiLabel?.explicit) manifest.ai_label.explicit = true;
        manifest.shots.push({
          shot_no: shot.shotNo,
          shot_desc: shot.shotDesc,
          duration_s: shot.durationS,
          ratio: shot.ratio,
          resolution: shot.resolution,
          task_id: shot.videoTaskId ? String(shot.videoTaskId) : null,
          file: fileName,
          ai_label: aiLabel ?? null,
        });
      } catch (error) {
        deps.log?.(
          { export_id: exportId, shot_no: shot.shotNo, err: error instanceof Error ? error.message : String(error) },
          "export skip result",
        );
      }
    }

    if (manifest.shots.length === 0) {
      await deps.db
        .update(exportJobs)
        .set({
          status: 4,
          error: { code: 400106, message: "no video results to export" },
          updatedAt: new Date(),
        })
        .where(eq(exportJobs.id, id));
      return;
    }

    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const key = `u/${row.spaceId}/exports/${id}/episode-${episode.epNo}.zip`;
    await deps.storage.put(key, buffer, "application/zip");
    await deps.db
      .update(exportJobs)
      .set({
        status: 3,
        fileUri: key,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        updatedAt: new Date(),
      })
      .where(eq(exportJobs.id, id));
  } catch (error) {
    deps.log?.(
      { export_id: exportId, err: error instanceof Error ? error.message : String(error) },
      "export failed",
    );
    await deps.db
      .update(exportJobs)
      .set({
        status: 4,
        error: { code: 500000, message: error instanceof Error ? error.message : String(error) },
        updatedAt: new Date(),
      })
      .where(eq(exportJobs.id, id));
  }
}
