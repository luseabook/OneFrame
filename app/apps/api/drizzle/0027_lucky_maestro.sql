CREATE TABLE "asset_reports" (
	"id" bigint PRIMARY KEY NOT NULL,
	"asset_id" bigint NOT NULL,
	"reporter_user_id" bigint NOT NULL,
	"space_id" bigint NOT NULL,
	"reason" text NOT NULL,
	"detail" text,
	"contact" text,
	"status" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_signup_drafts" (
	"id" bigint PRIMARY KEY NOT NULL,
	"campaign_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"space_id" bigint NOT NULL,
	"work_id" bigint,
	"channel" text,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invite_codes" ADD COLUMN "owner_user_id" bigint;--> statement-breakpoint
ALTER TABLE "asset_reports" ADD CONSTRAINT "asset_reports_asset_id_creator_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."creator_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_reports" ADD CONSTRAINT "asset_reports_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_reports" ADD CONSTRAINT "asset_reports_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_signup_drafts" ADD CONSTRAINT "campaign_signup_drafts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_signup_drafts" ADD CONSTRAINT "campaign_signup_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_signup_drafts" ADD CONSTRAINT "campaign_signup_drafts_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_signup_drafts" ADD CONSTRAINT "campaign_signup_drafts_work_id_creator_assets_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."creator_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_asset_reports" ON "asset_reports" USING btree ("asset_id","reporter_user_id");--> statement-breakpoint
CREATE INDEX "idx_asset_reports_status" ON "asset_reports" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_campaign_signup_drafts" ON "campaign_signup_drafts" USING btree ("campaign_id","user_id");--> statement-breakpoint
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_invite_codes_owner" ON "invite_codes" USING btree ("owner_user_id");