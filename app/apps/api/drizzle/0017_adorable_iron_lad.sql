-- 数据修复（迁移里带数据修复是少见但要说明的）：
-- 旧唯一键 `uq_model_prices(model_id,mode,resolution,duration_s)` 对 `duration_s IS NULL`
-- （按次计价，例如文本类 mode）**不生效**——PostgreSQL 认为 NULL 彼此不相等，于是同一档位
-- 可以被重复插入；`credits.price()` 又没排序，扣多少钱取决于取到哪一行。
-- 这里先清掉历史重复（保留 id 最小的一条），否则下面这条唯一索引在已有数据的库上会直接失败。
DELETE FROM "model_prices" a
USING "model_prices" b
WHERE a."duration_s" IS NULL
  AND b."duration_s" IS NULL
  AND a."model_id" = b."model_id"
  AND a."mode" = b."mode"
  AND a."resolution" = b."resolution"
  AND a."id" > b."id";
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_model_prices_per_call" ON "model_prices" USING btree ("model_id","mode","resolution") WHERE "model_prices"."duration_s" is null;
