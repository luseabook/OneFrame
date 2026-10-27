CREATE TABLE "film_exports" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"project_id" bigint NOT NULL,
	"table_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"format" text DEFAULT 'xlsx' NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"file_uri" text,
	"expires_at" timestamp with time zone,
	"error" jsonb,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "film_recent_opens" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"project_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"table_id" bigint,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "film_table_prefs" (
	"id" bigint PRIMARY KEY NOT NULL,
	"table_id" bigint NOT NULL,
	"space_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"hidden_field_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"filter_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ui" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "film_task_templates" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"project_id" bigint NOT NULL,
	"name" text NOT NULL,
	"scope" smallint DEFAULT 1 NOT NULL,
	"owner_id" bigint NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "film_review_versions" ADD COLUMN "asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "film_review_versions" ADD COLUMN "thumb_file_id" text;--> statement-breakpoint
ALTER TABLE "film_review_versions" ADD COLUMN "decision_comment" text;--> statement-breakpoint
ALTER TABLE "film_exports" ADD CONSTRAINT "film_exports_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_exports" ADD CONSTRAINT "film_exports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_recent_opens" ADD CONSTRAINT "film_recent_opens_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_recent_opens" ADD CONSTRAINT "film_recent_opens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_recent_opens" ADD CONSTRAINT "film_recent_opens_table_id_film_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."film_tables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_table_prefs" ADD CONSTRAINT "film_table_prefs_table_id_film_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."film_tables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_table_prefs" ADD CONSTRAINT "film_table_prefs_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_table_prefs" ADD CONSTRAINT "film_table_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_task_templates" ADD CONSTRAINT "film_task_templates_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_task_templates" ADD CONSTRAINT "film_task_templates_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_film_exports_project" ON "film_exports" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_film_recent_opens" ON "film_recent_opens" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_film_table_prefs" ON "film_table_prefs" USING btree ("table_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_film_templates_project" ON "film_task_templates" USING btree ("project_id","scope");