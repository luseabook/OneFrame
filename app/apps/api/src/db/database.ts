import { createDb } from "@app/db";
import { env } from "../config/env";

// 数据层（schema/ledger 在 @app/db，供 api 与 worker 共用）
export const { db, pool } = createDb(env.DATABASE_URL);

export async function pingDb(): Promise<boolean> {
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  }
}
