CREATE TABLE "asset_folders" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"parent_id" bigint,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"uri" text NOT NULL,
	"preview_uri" text,
	"source_task_id" bigint,
	"folder_id" bigint,
	"name" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" bigint PRIMARY KEY NOT NULL,
	"project_id" bigint NOT NULL,
	"ep_no" integer NOT NULL,
	"title" text,
	"synopsis" text,
	"script_text" text,
	"status" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_assets" (
	"id" bigint PRIMARY KEY NOT NULL,
	"project_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"prompt" text,
	"ref_image_uri" text,
	"source_task_id" bigint,
	"portrait_asset_id" bigint,
	"status" smallint DEFAULT 1 NOT NULL,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "script_projects" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"title" text NOT NULL,
	"genre" text,
	"drama_type" smallint DEFAULT 1 NOT NULL,
	"ratio" text DEFAULT '9:16' NOT NULL,
	"source_type" smallint DEFAULT 1 NOT NULL,
	"source_text" text,
	"status" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storyboard_assets" (
	"storyboard_id" bigint NOT NULL,
	"project_asset_id" bigint NOT NULL,
	CONSTRAINT "storyboard_assets_storyboard_id_project_asset_id_pk" PRIMARY KEY("storyboard_id","project_asset_id")
);
--> statement-breakpoint
CREATE TABLE "storyboards" (
	"id" bigint PRIMARY KEY NOT NULL,
	"episode_id" bigint NOT NULL,
	"shot_no" integer NOT NULL,
	"shot_desc" text,
	"video_prompt" text,
	"duration_s" integer,
	"ratio" text,
	"resolution" text,
	"status" smallint DEFAULT 1 NOT NULL,
	"image_task_id" bigint,
	"video_task_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_folders" ADD CONSTRAINT "asset_folders_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_source_task_id_tasks_id_fk" FOREIGN KEY ("source_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_folder_id_asset_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."asset_folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_project_id_script_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."script_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assets" ADD CONSTRAINT "project_assets_project_id_script_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."script_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assets" ADD CONSTRAINT "project_assets_source_task_id_tasks_id_fk" FOREIGN KEY ("source_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assets" ADD CONSTRAINT "project_assets_portrait_asset_id_assets_id_fk" FOREIGN KEY ("portrait_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_projects" ADD CONSTRAINT "script_projects_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboard_assets" ADD CONSTRAINT "storyboard_assets_storyboard_id_storyboards_id_fk" FOREIGN KEY ("storyboard_id") REFERENCES "public"."storyboards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboard_assets" ADD CONSTRAINT "storyboard_assets_project_asset_id_project_assets_id_fk" FOREIGN KEY ("project_asset_id") REFERENCES "public"."project_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboards" ADD CONSTRAINT "storyboards_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_asset_folders_space" ON "asset_folders" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "idx_assets_space" ON "assets" USING btree ("space_id","kind","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_assets_tags" ON "assets" USING gin ("tags");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_episodes_project_no" ON "episodes" USING btree ("project_id","ep_no");--> statement-breakpoint
CREATE INDEX "idx_project_assets_project" ON "project_assets" USING btree ("project_id","kind","status");--> statement-breakpoint
CREATE INDEX "idx_script_projects_space" ON "script_projects" USING btree ("space_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_storyboards_episode_shot" ON "storyboards" USING btree ("episode_id","shot_no");