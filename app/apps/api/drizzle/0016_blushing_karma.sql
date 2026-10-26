CREATE TABLE "canvas_download_lists" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"canvas_id" bigint NOT NULL,
	"node_count" integer DEFAULT 0 NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"object_key" text NOT NULL,
	"filename" text NOT NULL,
	"status" smallint DEFAULT 2 NOT NULL,
	"error" jsonb,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "canvas_download_lists" ADD CONSTRAINT "canvas_download_lists_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_download_lists" ADD CONSTRAINT "canvas_download_lists_canvas_id_canvases_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_download_lists" ADD CONSTRAINT "canvas_download_lists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_canvas_download_lists_canvas" ON "canvas_download_lists" USING btree ("canvas_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_canvas_download_lists_space" ON "canvas_download_lists" USING btree ("space_id","created_at" DESC NULLS LAST);