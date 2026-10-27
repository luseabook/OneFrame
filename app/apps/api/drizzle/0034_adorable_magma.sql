ALTER TABLE "creator_assets" ADD COLUMN "reviewed_by_admin" bigint;--> statement-breakpoint
ALTER TABLE "creator_assets" ADD COLUMN "reviewed_by_kind" smallint;--> statement-breakpoint
ALTER TABLE "creator_assets" ADD CONSTRAINT "creator_assets_reviewed_by_admin_admin_users_id_fk" FOREIGN KEY ("reviewed_by_admin") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;