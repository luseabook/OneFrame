ALTER TABLE "agent_skills" ADD COLUMN "name_en" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD COLUMN "is_home_recommend" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_agent_skills_home" ON "agent_skills" USING btree ("is_home_recommend","use_count" DESC NULLS LAST);--> statement-breakpoint
UPDATE "agent_skills" SET "name_en" = COALESCE("config"->>'slug', '') WHERE "name_en" = '';