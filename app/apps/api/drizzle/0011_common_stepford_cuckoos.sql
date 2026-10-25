CREATE TABLE "project_timelines" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"project_id" bigint NOT NULL,
	"episode_id" bigint NOT NULL,
	"clips" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timeline_exports" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"project_id" bigint NOT NULL,
	"episode_id" bigint NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"file_uri" text,
	"clip_count" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"duration_s" integer DEFAULT 0 NOT NULL,
	"watermarked" boolean DEFAULT false NOT NULL,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_timelines" ADD CONSTRAINT "project_timelines_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_timelines" ADD CONSTRAINT "project_timelines_project_id_script_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."script_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_timelines" ADD CONSTRAINT "project_timelines_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_exports" ADD CONSTRAINT "timeline_exports_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_exports" ADD CONSTRAINT "timeline_exports_project_id_script_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."script_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_exports" ADD CONSTRAINT "timeline_exports_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_project_timelines_episode" ON "project_timelines" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "idx_project_timelines_project" ON "project_timelines" USING btree ("project_id","episode_id");--> statement-breakpoint
CREATE INDEX "idx_timeline_exports_space" ON "timeline_exports" USING btree ("space_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_timeline_exports_episode" ON "timeline_exports" USING btree ("episode_id","created_at" DESC NULLS LAST);