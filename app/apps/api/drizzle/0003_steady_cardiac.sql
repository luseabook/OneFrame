CREATE TABLE "task_shares" (
	"id" bigint PRIMARY KEY NOT NULL,
	"task_id" bigint NOT NULL,
	"space_id" bigint NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_shares_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "task_shares" ADD CONSTRAINT "task_shares_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_shares" ADD CONSTRAINT "task_shares_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_task_shares_task" ON "task_shares" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_task_shares_token" ON "task_shares" USING btree ("token");