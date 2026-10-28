ALTER TABLE "knowledge_assets" ADD COLUMN "cover_asset_id" bigint;--> statement-breakpoint
ALTER TABLE "knowledge_assets" ADD COLUMN "image_asset_ids" bigint[] DEFAULT '{}'::bigint[] NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_assets" ADD COLUMN "use_type" smallint DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_assets" ADD COLUMN "status" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_assets" ADD COLUMN "sp_type" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_assets" ADD COLUMN "meta_data" jsonb;--> statement-breakpoint
ALTER TABLE "knowledge_assets" ADD COLUMN "sort" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_assets" ADD CONSTRAINT "knowledge_assets_cover_asset_id_assets_id_fk" FOREIGN KEY ("cover_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_knowledge_assets_status" ON "knowledge_assets" USING btree ("space_id","scene","status","sort");