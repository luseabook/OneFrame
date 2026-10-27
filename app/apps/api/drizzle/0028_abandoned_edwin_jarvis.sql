-- 既有行可能带着"用户 id"写进 created_by（该列此前 FK→users，测试数据如此）；
-- 改成 admin_users 前必须先把非法值清空，否则 ADD CONSTRAINT 会因引用不存在的 admin 而失败。
UPDATE "promo_slots" SET "created_by" = NULL WHERE "created_by" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "promo_slots" DROP CONSTRAINT "promo_slots_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "promo_slots" ADD CONSTRAINT "promo_slots_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;