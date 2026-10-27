CREATE TABLE "op_daily_rewards" (
	"id" bigint PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"space_id" bigint NOT NULL,
	"reward_date" text NOT NULL,
	"credits" integer DEFAULT 0 NOT NULL,
	"flow_ref" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "op_questionnaire_responses" (
	"id" bigint PRIMARY KEY NOT NULL,
	"questionnaire_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "op_questionnaires" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint,
	"qkey" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "campaign_key" text;--> statement-breakpoint
ALTER TABLE "creator_assets" ADD COLUMN "category" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_assets" ADD COLUMN "reviewed_by" bigint;--> statement-breakpoint
ALTER TABLE "creator_assets" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "op_daily_rewards" ADD CONSTRAINT "op_daily_rewards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "op_daily_rewards" ADD CONSTRAINT "op_daily_rewards_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "op_questionnaire_responses" ADD CONSTRAINT "op_questionnaire_responses_questionnaire_id_op_questionnaires_id_fk" FOREIGN KEY ("questionnaire_id") REFERENCES "public"."op_questionnaires"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "op_questionnaire_responses" ADD CONSTRAINT "op_questionnaire_responses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "op_questionnaires" ADD CONSTRAINT "op_questionnaires_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "op_questionnaires" ADD CONSTRAINT "op_questionnaires_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_op_daily_rewards" ON "op_daily_rewards" USING btree ("user_id","reward_date");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_op_questionnaire_responses" ON "op_questionnaire_responses" USING btree ("questionnaire_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_op_questionnaires_key" ON "op_questionnaires" USING btree ("qkey");--> statement-breakpoint
ALTER TABLE "creator_assets" ADD CONSTRAINT "creator_assets_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_campaigns_key" ON "campaigns" USING btree ("campaign_key") WHERE "campaigns"."campaign_key" is not null;--> statement-breakpoint
CREATE INDEX "idx_creator_assets_category" ON "creator_assets" USING btree ("status","category","published_at" DESC NULLS LAST);