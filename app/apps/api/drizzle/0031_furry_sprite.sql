CREATE TABLE "episode_resources" (
	"id" bigint PRIMARY KEY NOT NULL,
	"episode_id" bigint NOT NULL,
	"space_id" bigint NOT NULL,
	"kind" smallint DEFAULT 1 NOT NULL,
	"project_asset_id" bigint,
	"name" text NOT NULL,
	"prompt" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_assets" ADD COLUMN "prompt_status" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "script_projects" ADD COLUMN "project_mode" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "script_projects" ADD COLUMN "mode_meta" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "subjects" ADD COLUMN "is_starred" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subjects" ADD COLUMN "template_key" text;--> statement-breakpoint
ALTER TABLE "episode_resources" ADD CONSTRAINT "episode_resources_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_resources" ADD CONSTRAINT "episode_resources_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_resources" ADD CONSTRAINT "episode_resources_project_asset_id_project_assets_id_fk" FOREIGN KEY ("project_asset_id") REFERENCES "public"."project_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_episode_resources" ON "episode_resources" USING btree ("episode_id","kind","name");--> statement-breakpoint
CREATE INDEX "idx_episode_resources_episode" ON "episode_resources" USING btree ("episode_id","kind","sort");