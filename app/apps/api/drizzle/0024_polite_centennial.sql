CREATE TABLE "creator_likes" (
	"id" bigint PRIMARY KEY NOT NULL,
	"asset_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "director_pose_presets" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"name" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scope" smallint DEFAULT 1 NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "director_scenes" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"project_id" bigint,
	"episode_id" bigint,
	"name" text DEFAULT '未命名场景' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"thumbnail_uri" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" bigint,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "home_configs" (
	"id" bigint PRIMARY KEY NOT NULL,
	"scope" text DEFAULT 'global' NOT NULL,
	"space_id" bigint,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_slots" (
	"id" bigint PRIMARY KEY NOT NULL,
	"slot" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"image_uri" text,
	"link_uri" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"click_count" integer DEFAULT 0 NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timeline_publications" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"project_id" bigint NOT NULL,
	"episode_id" bigint NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"slice" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"file_uri" text,
	"share_token" text,
	"error" jsonb,
	"published_at" timestamp with time zone,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "creator_likes" ADD CONSTRAINT "creator_likes_asset_id_creator_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."creator_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_likes" ADD CONSTRAINT "creator_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "director_pose_presets" ADD CONSTRAINT "director_pose_presets_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "director_pose_presets" ADD CONSTRAINT "director_pose_presets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "director_scenes" ADD CONSTRAINT "director_scenes_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "director_scenes" ADD CONSTRAINT "director_scenes_project_id_script_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."script_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "director_scenes" ADD CONSTRAINT "director_scenes_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "director_scenes" ADD CONSTRAINT "director_scenes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home_configs" ADD CONSTRAINT "home_configs_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home_configs" ADD CONSTRAINT "home_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_slots" ADD CONSTRAINT "promo_slots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_publications" ADD CONSTRAINT "timeline_publications_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_publications" ADD CONSTRAINT "timeline_publications_project_id_script_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."script_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_publications" ADD CONSTRAINT "timeline_publications_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_publications" ADD CONSTRAINT "timeline_publications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_creator_likes" ON "creator_likes" USING btree ("asset_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_creator_likes_asset" ON "creator_likes" USING btree ("asset_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_director_pose_presets_space" ON "director_pose_presets" USING btree ("space_id","scope");--> statement-breakpoint
CREATE INDEX "idx_director_scenes_space" ON "director_scenes" USING btree ("space_id","project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_home_configs_scope" ON "home_configs" USING btree ("scope","space_id");--> statement-breakpoint
CREATE INDEX "idx_promo_slots_slot" ON "promo_slots" USING btree ("slot","status","sort");--> statement-breakpoint
CREATE INDEX "idx_timeline_publications_episode" ON "timeline_publications" USING btree ("episode_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_timeline_publications_token" ON "timeline_publications" USING btree ("share_token");