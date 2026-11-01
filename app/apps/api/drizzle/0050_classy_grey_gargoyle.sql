CREATE TABLE "canvas_shares" (
	"id" bigint PRIMARY KEY NOT NULL,
	"canvas_id" bigint NOT NULL,
	"space_id" bigint NOT NULL,
	"token" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"allow_clone" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "canvas_shares" ADD CONSTRAINT "canvas_shares_canvas_id_canvases_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_shares" ADD CONSTRAINT "canvas_shares_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_canvas_shares_canvas" ON "canvas_shares" USING btree ("canvas_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_canvas_shares_token" ON "canvas_shares" USING btree ("token");