import { z } from "zod";

// 配置层：启动即校验，缺失/非法直接崩（docs/04-engineering/dev-workflow.md §5）
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().default("postgres://app:app@localhost:5432/app"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  WORKER_ID: z.coerce.number().int().min(0).max(1023).optional(),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
