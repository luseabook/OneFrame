CREATE TABLE "canvas_comment_nodes" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"canvas_id" bigint NOT NULL,
	"anchor_x" integer NOT NULL,
	"anchor_y" integer NOT NULL,
	"node_id" bigint,
	"scope" text DEFAULT 'canvas' NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_by" bigint,
	"resolved_at" timestamp with time zone,
	"created_by" bigint NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canvas_comments" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"comment_node_id" bigint NOT NULL,
	"content" text NOT NULL,
	"mentions" bigint[] DEFAULT '{}'::bigint[] NOT NULL,
	"created_by" bigint NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canvas_edges" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"canvas_id" bigint NOT NULL,
	"src_node_id" bigint NOT NULL,
	"dst_node_id" bigint NOT NULL,
	"semantic" text DEFAULT 'pipeline' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canvas_group_templates" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"canvas_id" bigint NOT NULL,
	"group_id" bigint NOT NULL,
	"name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canvas_groups" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"canvas_id" bigint NOT NULL,
	"parent_id" bigint,
	"name" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canvas_materials" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"canvas_id" bigint NOT NULL,
	"material_type" text NOT NULL,
	"source" smallint DEFAULT 1 NOT NULL,
	"node_id" bigint,
	"name" text DEFAULT '' NOT NULL,
	"object_key" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canvas_nodes" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"canvas_id" bigint NOT NULL,
	"node_type" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"x" integer DEFAULT 0 NOT NULL,
	"y" integer DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"z_index" integer DEFAULT 0 NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"task_id" bigint,
	"status" smallint DEFAULT 1 NOT NULL,
	"group_ids" bigint[] DEFAULT '{}'::bigint[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canvas_pin_groups" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"canvas_id" bigint NOT NULL,
	"name" text,
	"color" text,
	"slot" smallint NOT NULL,
	"node_ids" bigint[] DEFAULT '{}'::bigint[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canvas_snapshots" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"canvas_id" bigint NOT NULL,
	"version" integer NOT NULL,
	"kind" smallint DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canvas_templates" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint,
	"tpl_scope" smallint NOT NULL,
	"tpl_type" smallint DEFAULT 2 NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"cover_uri" text,
	"payload" jsonb NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"sort" integer DEFAULT 100 NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canvases" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"title" text DEFAULT '未命名画布' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"creation_mode" smallint DEFAULT 2 NOT NULL,
	"episode_id" bigint,
	"owner_user_id" bigint NOT NULL,
	"pinned_node_id" bigint,
	"last_edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "canvas_comment_nodes" ADD CONSTRAINT "canvas_comment_nodes_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_comment_nodes" ADD CONSTRAINT "canvas_comment_nodes_canvas_id_canvases_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_comment_nodes" ADD CONSTRAINT "canvas_comment_nodes_node_id_canvas_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."canvas_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_comment_nodes" ADD CONSTRAINT "canvas_comment_nodes_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_comment_nodes" ADD CONSTRAINT "canvas_comment_nodes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_comments" ADD CONSTRAINT "canvas_comments_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_comments" ADD CONSTRAINT "canvas_comments_comment_node_id_canvas_comment_nodes_id_fk" FOREIGN KEY ("comment_node_id") REFERENCES "public"."canvas_comment_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_comments" ADD CONSTRAINT "canvas_comments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_edges" ADD CONSTRAINT "canvas_edges_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_edges" ADD CONSTRAINT "canvas_edges_canvas_id_canvases_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_edges" ADD CONSTRAINT "canvas_edges_src_node_id_canvas_nodes_id_fk" FOREIGN KEY ("src_node_id") REFERENCES "public"."canvas_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_edges" ADD CONSTRAINT "canvas_edges_dst_node_id_canvas_nodes_id_fk" FOREIGN KEY ("dst_node_id") REFERENCES "public"."canvas_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_group_templates" ADD CONSTRAINT "canvas_group_templates_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_group_templates" ADD CONSTRAINT "canvas_group_templates_canvas_id_canvases_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_group_templates" ADD CONSTRAINT "canvas_group_templates_group_id_canvas_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."canvas_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_group_templates" ADD CONSTRAINT "canvas_group_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_groups" ADD CONSTRAINT "canvas_groups_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_groups" ADD CONSTRAINT "canvas_groups_canvas_id_canvases_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_materials" ADD CONSTRAINT "canvas_materials_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_materials" ADD CONSTRAINT "canvas_materials_canvas_id_canvases_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_materials" ADD CONSTRAINT "canvas_materials_node_id_canvas_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."canvas_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_nodes" ADD CONSTRAINT "canvas_nodes_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_nodes" ADD CONSTRAINT "canvas_nodes_canvas_id_canvases_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_nodes" ADD CONSTRAINT "canvas_nodes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_pin_groups" ADD CONSTRAINT "canvas_pin_groups_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_pin_groups" ADD CONSTRAINT "canvas_pin_groups_canvas_id_canvases_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_snapshots" ADD CONSTRAINT "canvas_snapshots_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_snapshots" ADD CONSTRAINT "canvas_snapshots_canvas_id_canvases_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_snapshots" ADD CONSTRAINT "canvas_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_templates" ADD CONSTRAINT "canvas_templates_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_templates" ADD CONSTRAINT "canvas_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvases" ADD CONSTRAINT "canvases_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvases" ADD CONSTRAINT "canvases_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_canvas_comment_nodes" ON "canvas_comment_nodes" USING btree ("canvas_id","resolved","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_canvas_comments" ON "canvas_comments" USING btree ("comment_node_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_canvas_edges" ON "canvas_edges" USING btree ("canvas_id","src_node_id","dst_node_id","semantic");--> statement-breakpoint
CREATE INDEX "idx_canvas_edges_src" ON "canvas_edges" USING btree ("src_node_id");--> statement-breakpoint
CREATE INDEX "idx_canvas_edges_dst" ON "canvas_edges" USING btree ("dst_node_id");--> statement-breakpoint
CREATE INDEX "idx_canvas_group_templates" ON "canvas_group_templates" USING btree ("canvas_id","group_id");--> statement-breakpoint
CREATE INDEX "idx_canvas_groups" ON "canvas_groups" USING btree ("canvas_id","parent_id","sort");--> statement-breakpoint
CREATE INDEX "idx_canvas_materials" ON "canvas_materials" USING btree ("canvas_id","material_type","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_canvas_nodes_canvas" ON "canvas_nodes" USING btree ("canvas_id","z_index");--> statement-breakpoint
CREATE INDEX "idx_canvas_nodes_type" ON "canvas_nodes" USING btree ("canvas_id","node_type");--> statement-breakpoint
CREATE INDEX "idx_canvas_nodes_task" ON "canvas_nodes" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_canvas_pin_groups" ON "canvas_pin_groups" USING btree ("canvas_id","slot");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_canvas_snapshots" ON "canvas_snapshots" USING btree ("canvas_id","version");--> statement-breakpoint
CREATE INDEX "idx_canvas_templates_list" ON "canvas_templates" USING btree ("tpl_scope","tpl_type","status","sort");--> statement-breakpoint
CREATE INDEX "idx_canvases_space" ON "canvases" USING btree ("space_id","updated_at" DESC NULLS LAST);