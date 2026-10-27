CREATE TABLE "film_canvas_bindings" (
	"id" bigint PRIMARY KEY NOT NULL,
	"task_id" bigint NOT NULL,
	"canvas_id" bigint NOT NULL,
	"node_id" bigint NOT NULL,
	"space_id" bigint NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "film_cells" (
	"id" bigint PRIMARY KEY NOT NULL,
	"task_id" bigint NOT NULL,
	"field_id" bigint NOT NULL,
	"space_id" bigint NOT NULL,
	"value_json" jsonb,
	"updated_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "film_fields" (
	"id" bigint PRIMARY KEY NOT NULL,
	"table_id" bigint NOT NULL,
	"space_id" bigint NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"field_type" text DEFAULT 'text' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_unique_type" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"width" integer,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "film_review_comments" (
	"id" bigint PRIMARY KEY NOT NULL,
	"version_id" bigint NOT NULL,
	"space_id" bigint NOT NULL,
	"author_id" bigint NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "film_review_reads" (
	"id" bigint PRIMARY KEY NOT NULL,
	"version_id" bigint NOT NULL,
	"space_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "film_review_versions" (
	"id" bigint PRIMARY KEY NOT NULL,
	"task_id" bigint NOT NULL,
	"space_id" bigint NOT NULL,
	"version_no" text NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"submitted_by" bigint NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" bigint,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "film_tables" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"project_id" bigint NOT NULL,
	"name" text DEFAULT '任务表' NOT NULL,
	"is_preset" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "film_tasks" (
	"id" bigint PRIMARY KEY NOT NULL,
	"table_id" bigint NOT NULL,
	"space_id" bigint NOT NULL,
	"parent_id" bigint,
	"sort" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"review_version_no" integer DEFAULT 0 NOT NULL,
	"assignee_user_id" bigint,
	"created_by" bigint,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "novel_chapter_outlines" (
	"id" bigint PRIMARY KEY NOT NULL,
	"novel_id" bigint NOT NULL,
	"chapter_no" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"synopsis" text DEFAULT '' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "novel_chapters" (
	"id" bigint PRIMARY KEY NOT NULL,
	"novel_id" bigint NOT NULL,
	"chapter_no" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "novel_characters" (
	"id" bigint PRIMARY KEY NOT NULL,
	"novel_id" bigint NOT NULL,
	"name" text NOT NULL,
	"role_type" smallint DEFAULT 2 NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"appearance" text DEFAULT '' NOT NULL,
	"personality" text DEFAULT '' NOT NULL,
	"prompt" text DEFAULT '' NOT NULL,
	"is_core" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "novel_edit_messages" (
	"id" bigint PRIMARY KEY NOT NULL,
	"session_id" bigint NOT NULL,
	"role" smallint NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"pending_changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "novel_edit_pendings" (
	"id" bigint PRIMARY KEY NOT NULL,
	"session_id" bigint NOT NULL,
	"episode_id" bigint NOT NULL,
	"original_text" text DEFAULT '' NOT NULL,
	"proposed_text" text DEFAULT '' NOT NULL,
	"change_summary" text DEFAULT '' NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "novel_edit_sessions" (
	"id" bigint PRIMARY KEY NOT NULL,
	"novel_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"heartbeat_at" timestamp with time zone,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "novel_episode_outlines" (
	"id" bigint PRIMARY KEY NOT NULL,
	"novel_id" bigint NOT NULL,
	"episode_no" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"synopsis" text DEFAULT '' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "novel_episodes" (
	"id" bigint PRIMARY KEY NOT NULL,
	"novel_id" bigint NOT NULL,
	"episode_no" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"script_text" text DEFAULT '' NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "novel_script_versions" (
	"id" bigint PRIMARY KEY NOT NULL,
	"novel_id" bigint NOT NULL,
	"episode_id" bigint,
	"version_no" integer NOT NULL,
	"script_text" text DEFAULT '' NOT NULL,
	"finalized_at" timestamp with time zone,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "novel_worldviews" (
	"id" bigint PRIMARY KEY NOT NULL,
	"novel_id" bigint NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "novels" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"title" text DEFAULT '未命名剧本' NOT NULL,
	"source_type" smallint DEFAULT 1 NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"sp_type" smallint DEFAULT 0 NOT NULL,
	"ratio" text DEFAULT '9:16' NOT NULL,
	"episode_count" integer DEFAULT 0 NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "film_canvas_bindings" ADD CONSTRAINT "film_canvas_bindings_task_id_film_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."film_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_canvas_bindings" ADD CONSTRAINT "film_canvas_bindings_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_canvas_bindings" ADD CONSTRAINT "film_canvas_bindings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_cells" ADD CONSTRAINT "film_cells_task_id_film_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."film_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_cells" ADD CONSTRAINT "film_cells_field_id_film_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."film_fields"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_cells" ADD CONSTRAINT "film_cells_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_cells" ADD CONSTRAINT "film_cells_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_fields" ADD CONSTRAINT "film_fields_table_id_film_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."film_tables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_fields" ADD CONSTRAINT "film_fields_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_review_comments" ADD CONSTRAINT "film_review_comments_version_id_film_review_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."film_review_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_review_comments" ADD CONSTRAINT "film_review_comments_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_review_comments" ADD CONSTRAINT "film_review_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_review_reads" ADD CONSTRAINT "film_review_reads_version_id_film_review_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."film_review_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_review_reads" ADD CONSTRAINT "film_review_reads_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_review_reads" ADD CONSTRAINT "film_review_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_review_versions" ADD CONSTRAINT "film_review_versions_task_id_film_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."film_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_review_versions" ADD CONSTRAINT "film_review_versions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_review_versions" ADD CONSTRAINT "film_review_versions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_review_versions" ADD CONSTRAINT "film_review_versions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_tables" ADD CONSTRAINT "film_tables_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_tasks" ADD CONSTRAINT "film_tasks_table_id_film_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."film_tables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_tasks" ADD CONSTRAINT "film_tasks_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_tasks" ADD CONSTRAINT "film_tasks_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_tasks" ADD CONSTRAINT "film_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novel_chapter_outlines" ADD CONSTRAINT "novel_chapter_outlines_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novel_chapters" ADD CONSTRAINT "novel_chapters_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novel_characters" ADD CONSTRAINT "novel_characters_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novel_edit_messages" ADD CONSTRAINT "novel_edit_messages_session_id_novel_edit_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."novel_edit_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novel_edit_pendings" ADD CONSTRAINT "novel_edit_pendings_session_id_novel_edit_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."novel_edit_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novel_edit_pendings" ADD CONSTRAINT "novel_edit_pendings_episode_id_novel_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."novel_episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novel_edit_sessions" ADD CONSTRAINT "novel_edit_sessions_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novel_edit_sessions" ADD CONSTRAINT "novel_edit_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novel_episode_outlines" ADD CONSTRAINT "novel_episode_outlines_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novel_episodes" ADD CONSTRAINT "novel_episodes_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novel_script_versions" ADD CONSTRAINT "novel_script_versions_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novel_script_versions" ADD CONSTRAINT "novel_script_versions_episode_id_novel_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."novel_episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novel_script_versions" ADD CONSTRAINT "novel_script_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novel_worldviews" ADD CONSTRAINT "novel_worldviews_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novels" ADD CONSTRAINT "novels_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_film_canvas_bindings" ON "film_canvas_bindings" USING btree ("task_id","canvas_id","node_id");--> statement-breakpoint
CREATE INDEX "idx_film_canvas_bindings_canvas" ON "film_canvas_bindings" USING btree ("canvas_id");--> statement-breakpoint
CREATE INDEX "idx_film_canvas_bindings_task" ON "film_canvas_bindings" USING btree ("task_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_film_cells" ON "film_cells" USING btree ("task_id","field_id");--> statement-breakpoint
CREATE INDEX "idx_film_cells_field" ON "film_cells" USING btree ("field_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_film_fields_key" ON "film_fields" USING btree ("table_id","key");--> statement-breakpoint
CREATE INDEX "idx_film_fields_table" ON "film_fields" USING btree ("table_id","sort");--> statement-breakpoint
CREATE INDEX "idx_film_review_comments_version" ON "film_review_comments" USING btree ("version_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_film_review_reads" ON "film_review_reads" USING btree ("version_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_film_review_versions_no" ON "film_review_versions" USING btree ("task_id","version_no");--> statement-breakpoint
CREATE INDEX "idx_film_review_versions_task" ON "film_review_versions" USING btree ("task_id","version_no" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_film_review_versions_space" ON "film_review_versions" USING btree ("space_id","status","submitted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_film_tables_project" ON "film_tables" USING btree ("project_id","sort");--> statement-breakpoint
CREATE INDEX "idx_film_tables_space" ON "film_tables" USING btree ("space_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_film_tasks_table" ON "film_tasks" USING btree ("table_id","parent_id","sort");--> statement-breakpoint
CREATE INDEX "idx_film_tasks_status" ON "film_tasks" USING btree ("table_id","status");--> statement-breakpoint
CREATE INDEX "idx_film_tasks_assignee" ON "film_tasks" USING btree ("space_id","assignee_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_novel_chapter_outlines_no" ON "novel_chapter_outlines" USING btree ("novel_id","chapter_no");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_novel_chapters_no" ON "novel_chapters" USING btree ("novel_id","chapter_no");--> statement-breakpoint
CREATE INDEX "idx_novel_chapters_novel" ON "novel_chapters" USING btree ("novel_id","chapter_no");--> statement-breakpoint
CREATE INDEX "idx_novel_characters_novel" ON "novel_characters" USING btree ("novel_id","is_core","role_type");--> statement-breakpoint
CREATE INDEX "idx_novel_edit_messages_session" ON "novel_edit_messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_novel_edit_pendings_pending" ON "novel_edit_pendings" USING btree ("session_id","episode_id") WHERE "novel_edit_pendings"."status" = 1;--> statement-breakpoint
CREATE INDEX "idx_novel_edit_pendings_session" ON "novel_edit_pendings" USING btree ("session_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_novel_edit_sessions_novel" ON "novel_edit_sessions" USING btree ("novel_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_novel_edit_sessions_user" ON "novel_edit_sessions" USING btree ("user_id","heartbeat_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_novel_episode_outlines_no" ON "novel_episode_outlines" USING btree ("novel_id","episode_no");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_novel_episodes_no" ON "novel_episodes" USING btree ("novel_id","episode_no");--> statement-breakpoint
CREATE INDEX "idx_novel_episodes_novel" ON "novel_episodes" USING btree ("novel_id","episode_no");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_novel_script_versions_episode" ON "novel_script_versions" USING btree ("episode_id","version_no") WHERE "novel_script_versions"."episode_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_novel_script_versions_novel" ON "novel_script_versions" USING btree ("novel_id","version_no") WHERE "novel_script_versions"."episode_id" is null;--> statement-breakpoint
CREATE INDEX "idx_novel_script_versions_novel" ON "novel_script_versions" USING btree ("novel_id","version_no" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_novel_worldviews_novel" ON "novel_worldviews" USING btree ("novel_id");--> statement-breakpoint
CREATE INDEX "idx_novels_space" ON "novels" USING btree ("space_id","status","created_at" DESC NULLS LAST);