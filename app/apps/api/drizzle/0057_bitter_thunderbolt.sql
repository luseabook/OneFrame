CREATE TABLE "project_resource_dirs" (
	"id" bigint PRIMARY KEY NOT NULL,
	"project_id" bigint NOT NULL,
	"parent_id" bigint,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_assets" ADD COLUMN "dir_id" bigint;--> statement-breakpoint
ALTER TABLE "project_resource_dirs" ADD CONSTRAINT "project_resource_dirs_project_id_script_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."script_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_project_resource_dirs_project" ON "project_resource_dirs" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "project_assets" ADD CONSTRAINT "project_assets_dir_id_project_resource_dirs_id_fk" FOREIGN KEY ("dir_id") REFERENCES "public"."project_resource_dirs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_project_assets_dir" ON "project_assets" USING btree ("project_id","dir_id");