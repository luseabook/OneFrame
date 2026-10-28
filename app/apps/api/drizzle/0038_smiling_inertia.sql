DROP INDEX "uq_knowledge_tags";--> statement-breakpoint
ALTER TABLE "knowledge_assets" ADD COLUMN "scene" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_dirs" ADD COLUMN "scene" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_tags" ADD COLUMN "scene" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_knowledge_assets_scene" ON "knowledge_assets" USING btree ("space_id","scene","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_knowledge_dirs_scene" ON "knowledge_dirs" USING btree ("space_id","scene","parent_id","sort");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_knowledge_tags" ON "knowledge_tags" USING btree ("space_id","scene","name");