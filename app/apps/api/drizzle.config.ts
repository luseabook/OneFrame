import { defineConfig } from "drizzle-kit";

// drizzle-kit 配置：schema 是唯一结构源，migration 入 git（database.md §11）
export default defineConfig({
  dialect: "postgresql",
  schema: "../../packages/db/src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/app",
  },
  strict: true,
  verbose: true,
});
