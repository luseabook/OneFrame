import { eq, isNotNull } from "drizzle-orm";
import { filmExports } from "@app/db";
import { db, pool } from "./database";
import { StorageService } from "../storage/storage.service";

/**
 * 把历史 `film_exports.file_uri` 从旧的 `film/exports/<id>/...`
 * 迁到带空间归属的 `u/<spaceId>/film-exports/<id>/...`。
 *
 * 背景：存储层现在强制 key 必须属于 `u/<spaceId>/...`，旧 key 会让
 * `signDownload()` 抛错，导出记录因此拿不到下载链接。迁移只复制对象并
 * 更新 DB，**不删除旧对象**（回滚时旧记录仍可追溯）。
 *
 * 用法：
 *   pnpm --filter @app/api db:migrate-film-exports-keys --dry-run
 *   pnpm --filter @app/api db:migrate-film-exports-keys
 *
 * 幂等：已经是 `u/<spaceId>/` 前缀的行会跳过；对象不存在的行只告警不改库。
 * 另外单独统计 `u/<其它 spaceId>/...`：这类行不能直接复制进当前空间（可能是
 * 历史串号或数据污染），只告警交由运维确认，避免迁移把跨租户数据"洗白"。
 */

const CONTENT_TYPES: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
  zip: "application/zip",
};

function contentTypeOf(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const storage = new StorageService();
  const rows = await db
    .select({
      id: filmExports.id,
      spaceId: filmExports.spaceId,
      fileUri: filmExports.fileUri,
    })
    .from(filmExports)
    .where(isNotNull(filmExports.fileUri));

  let migrated = 0;
  let missing = 0;
  let skipped = 0;
  let foreign = 0;
  for (const row of rows) {
    const oldKey = row.fileUri;
    if (!oldKey) {
      skipped += 1;
      continue;
    }
    if (oldKey.startsWith(`u/${row.spaceId}/`)) {
      skipped += 1;
      continue;
    }
    if (oldKey.startsWith("u/")) {
      console.warn(`[foreign] export=${row.id} key 不属于当前空间：${oldKey}`);
      foreign += 1;
      continue;
    }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(oldKey)) {
      console.warn(`[skip] export=${row.id} 不是 storage key：${oldKey}`);
      skipped += 1;
      continue;
    }
    const filename = oldKey.split("/").pop();
    if (!filename) {
      console.warn(`[skip] export=${row.id} 无法解析文件名：${oldKey}`);
      skipped += 1;
      continue;
    }
    const newKey = `u/${row.spaceId}/film-exports/${row.id}/${filename}`;
    let data: Buffer;
    try {
      data = await storage.driver.read(oldKey);
    } catch {
      console.warn(`[missing] export=${row.id} 旧对象不存在：${oldKey}`);
      missing += 1;
      continue;
    }
    if (!dryRun) {
      await storage.driver.put(newKey, data, contentTypeOf(filename));
      await db.update(filmExports).set({ fileUri: newKey }).where(eq(filmExports.id, row.id));
    }
    migrated += 1;
  }

  console.log(
    JSON.stringify(
      { dry_run: dryRun, scanned: rows.length, migrated, missing, skipped, foreign },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
