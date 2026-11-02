CREATE TABLE "task_folders" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "folder_id" bigint;--> statement-breakpoint
ALTER TABLE "task_folders" ADD CONSTRAINT "task_folders_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_task_folders_space_name" ON "task_folders" USING btree ("space_id","name");--> statement-breakpoint
CREATE INDEX "idx_task_folders_space" ON "task_folders" USING btree ("space_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_folder_id_task_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."task_folders"("id") ON DELETE set null ON UPDATE no action;