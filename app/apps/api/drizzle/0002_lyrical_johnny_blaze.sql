CREATE TABLE "exports" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"episode_id" bigint NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"file_uri" text,
	"expires_at" timestamp with time zone,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_exports_space" ON "exports" USING btree ("space_id","created_at" DESC NULLS LAST);