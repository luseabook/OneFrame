CREATE TABLE "voice_favorites" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"timbre_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voice_favorites" ADD CONSTRAINT "voice_favorites_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_favorites" ADD CONSTRAINT "voice_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_voice_favorites" ON "voice_favorites" USING btree ("space_id","user_id","timbre_key");--> statement-breakpoint
CREATE INDEX "idx_voice_favorites_user" ON "voice_favorites" USING btree ("user_id","created_at" DESC NULLS LAST);