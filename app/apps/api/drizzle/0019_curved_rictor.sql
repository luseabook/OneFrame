CREATE TABLE "ab_experiments" (
	"id" bigint PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"variants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ab_hits" (
	"id" bigint PRIMARY KEY NOT NULL,
	"experiment_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"variant" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_skill_favorites" (
	"id" bigint PRIMARY KEY NOT NULL,
	"skill_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"space_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_skills" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint,
	"owner_user_id" bigint,
	"name" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"cover_uri" text,
	"category" text DEFAULT 'general' NOT NULL,
	"prompt_template" text DEFAULT '' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"visibility" smallint DEFAULT 1 NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"favorite_count" integer DEFAULT 0 NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_signups" (
	"id" bigint PRIMARY KEY NOT NULL,
	"campaign_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"space_id" bigint NOT NULL,
	"work_id" bigint,
	"status" smallint DEFAULT 1 NOT NULL,
	"nominated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint,
	"title" text NOT NULL,
	"kind" smallint DEFAULT 1 NOT NULL,
	"brief" text DEFAULT '' NOT NULL,
	"cover_uri" text,
	"reward_credits" integer DEFAULT 0 NOT NULL,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"status" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_assets" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"creator_user_id" bigint NOT NULL,
	"kind" smallint DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"cover_uri" text,
	"uri" text,
	"status" smallint DEFAULT 1 NOT NULL,
	"review_note" text,
	"view_count" integer DEFAULT 0 NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_follows" (
	"id" bigint PRIMARY KEY NOT NULL,
	"follower_user_id" bigint NOT NULL,
	"creator_user_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_profiles" (
	"id" bigint PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"space_id" bigint NOT NULL,
	"nickname" text DEFAULT '' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"avatar_uri" text,
	"status" smallint DEFAULT 1 NOT NULL,
	"follower_count" integer DEFAULT 0 NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "distributor_relations" (
	"id" bigint PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"parent_user_id" bigint NOT NULL,
	"commission_bps" integer DEFAULT 0 NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extraction_drafts" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"task_id" bigint NOT NULL,
	"eed_id" text NOT NULL,
	"kind" smallint DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" smallint DEFAULT 1 NOT NULL,
	"parent_state_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extraction_tasks" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"project_id" bigint,
	"episode_id" bigint,
	"source_asset_id" bigint,
	"source_uri" text,
	"task_type" smallint DEFAULT 4 NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" jsonb,
	"eed_id" text,
	"created_by" bigint,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_assets" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"dir_id" bigint,
	"asset_id" bigint,
	"title" text NOT NULL,
	"content" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"source_type" smallint DEFAULT 1 NOT NULL,
	"created_by" bigint,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_dirs" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"parent_id" bigint,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_tags" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_agreements" (
	"id" bigint PRIMARY KEY NOT NULL,
	"work_id" bigint NOT NULL,
	"buyer_user_id" bigint NOT NULL,
	"space_id" bigint NOT NULL,
	"order_id" bigint,
	"kind" smallint DEFAULT 1 NOT NULL,
	"price_credits" integer DEFAULT 0 NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"signed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_withdrawals" (
	"id" bigint PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"space_id" bigint NOT NULL,
	"amount_credits" integer NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"channel" text DEFAULT 'alipay' NOT NULL,
	"account_info" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"review_note" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_works" (
	"id" bigint PRIMARY KEY NOT NULL,
	"novel_id" bigint,
	"owner_user_id" bigint NOT NULL,
	"space_id" bigint NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"cover_uri" text,
	"kind" smallint DEFAULT 1 NOT NULL,
	"price_credits" integer DEFAULT 0 NOT NULL,
	"preorder_price_credits" integer,
	"status" smallint DEFAULT 1 NOT NULL,
	"audit_note" text,
	"sales_count" integer DEFAULT 0 NOT NULL,
	"revenue_credits" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redeem_code_redemptions" (
	"id" bigint PRIMARY KEY NOT NULL,
	"code_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"space_id" bigint NOT NULL,
	"credits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redeem_codes" (
	"id" bigint PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"space_id" bigint,
	"credits" integer DEFAULT 0 NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"status" smallint DEFAULT 1 NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subject_files" (
	"id" bigint PRIMARY KEY NOT NULL,
	"subject_id" bigint NOT NULL,
	"space_id" bigint NOT NULL,
	"asset_id" bigint,
	"uri" text NOT NULL,
	"role" smallint DEFAULT 1 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"name" text NOT NULL,
	"kind" smallint DEFAULT 1 NOT NULL,
	"desc" text,
	"cover_uri" text,
	"review_status" smallint DEFAULT 1 NOT NULL,
	"reject_reason" text,
	"business_list" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"project_id" bigint,
	"created_by" bigint,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ab_hits" ADD CONSTRAINT "ab_hits_experiment_id_ab_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."ab_experiments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ab_hits" ADD CONSTRAINT "ab_hits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skill_favorites" ADD CONSTRAINT "agent_skill_favorites_skill_id_agent_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."agent_skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skill_favorites" ADD CONSTRAINT "agent_skill_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skill_favorites" ADD CONSTRAINT "agent_skill_favorites_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_signups" ADD CONSTRAINT "campaign_signups_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_signups" ADD CONSTRAINT "campaign_signups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_signups" ADD CONSTRAINT "campaign_signups_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_signups" ADD CONSTRAINT "campaign_signups_work_id_creator_assets_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."creator_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_assets" ADD CONSTRAINT "creator_assets_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_assets" ADD CONSTRAINT "creator_assets_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_follows" ADD CONSTRAINT "creator_follows_follower_user_id_users_id_fk" FOREIGN KEY ("follower_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_follows" ADD CONSTRAINT "creator_follows_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD CONSTRAINT "creator_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD CONSTRAINT "creator_profiles_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distributor_relations" ADD CONSTRAINT "distributor_relations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distributor_relations" ADD CONSTRAINT "distributor_relations_parent_user_id_users_id_fk" FOREIGN KEY ("parent_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_drafts" ADD CONSTRAINT "extraction_drafts_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_drafts" ADD CONSTRAINT "extraction_drafts_task_id_extraction_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."extraction_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_tasks" ADD CONSTRAINT "extraction_tasks_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_tasks" ADD CONSTRAINT "extraction_tasks_project_id_script_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."script_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_tasks" ADD CONSTRAINT "extraction_tasks_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_tasks" ADD CONSTRAINT "extraction_tasks_source_asset_id_assets_id_fk" FOREIGN KEY ("source_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_tasks" ADD CONSTRAINT "extraction_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_assets" ADD CONSTRAINT "knowledge_assets_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_assets" ADD CONSTRAINT "knowledge_assets_dir_id_knowledge_dirs_id_fk" FOREIGN KEY ("dir_id") REFERENCES "public"."knowledge_dirs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_assets" ADD CONSTRAINT "knowledge_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_assets" ADD CONSTRAINT "knowledge_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_dirs" ADD CONSTRAINT "knowledge_dirs_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_tags" ADD CONSTRAINT "knowledge_tags_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_agreements" ADD CONSTRAINT "market_agreements_work_id_market_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."market_works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_agreements" ADD CONSTRAINT "market_agreements_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_agreements" ADD CONSTRAINT "market_agreements_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_agreements" ADD CONSTRAINT "market_agreements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_withdrawals" ADD CONSTRAINT "market_withdrawals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_withdrawals" ADD CONSTRAINT "market_withdrawals_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_works" ADD CONSTRAINT "market_works_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_works" ADD CONSTRAINT "market_works_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_works" ADD CONSTRAINT "market_works_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redeem_code_redemptions" ADD CONSTRAINT "redeem_code_redemptions_code_id_redeem_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."redeem_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redeem_code_redemptions" ADD CONSTRAINT "redeem_code_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redeem_code_redemptions" ADD CONSTRAINT "redeem_code_redemptions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redeem_codes" ADD CONSTRAINT "redeem_codes_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redeem_codes" ADD CONSTRAINT "redeem_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_files" ADD CONSTRAINT "subject_files_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_files" ADD CONSTRAINT "subject_files_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_files" ADD CONSTRAINT "subject_files_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_project_id_script_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."script_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ab_experiments_key" ON "ab_experiments" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ab_hits" ON "ab_hits" USING btree ("experiment_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agent_skill_favorites" ON "agent_skill_favorites" USING btree ("skill_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_agent_skills_plaza" ON "agent_skills" USING btree ("visibility","use_count" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_agent_skills_owner" ON "agent_skills" USING btree ("owner_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_campaign_signups" ON "campaign_signups" USING btree ("campaign_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_campaign_signups_status" ON "campaign_signups" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "idx_campaigns_status" ON "campaigns" USING btree ("status","start_at");--> statement-breakpoint
CREATE INDEX "idx_creator_assets_creator" ON "creator_assets" USING btree ("creator_user_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_creator_assets_feed" ON "creator_assets" USING btree ("status","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_creator_follows" ON "creator_follows" USING btree ("follower_user_id","creator_user_id");--> statement-breakpoint
CREATE INDEX "idx_creator_follows_creator" ON "creator_follows" USING btree ("creator_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_creator_profiles_user" ON "creator_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_distributor_relations_user" ON "distributor_relations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_extraction_drafts_task" ON "extraction_drafts" USING btree ("task_id","kind","state");--> statement-breakpoint
CREATE INDEX "idx_extraction_drafts_eed" ON "extraction_drafts" USING btree ("eed_id");--> statement-breakpoint
CREATE INDEX "idx_extraction_tasks_space" ON "extraction_tasks" USING btree ("space_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_extraction_tasks_project" ON "extraction_tasks" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_extraction_tasks_eed" ON "extraction_tasks" USING btree ("eed_id");--> statement-breakpoint
CREATE INDEX "idx_knowledge_assets_space" ON "knowledge_assets" USING btree ("space_id","dir_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_knowledge_assets_tags" ON "knowledge_assets" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "idx_knowledge_dirs_space" ON "knowledge_dirs" USING btree ("space_id","parent_id","sort");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_knowledge_tags" ON "knowledge_tags" USING btree ("space_id","name");--> statement-breakpoint
CREATE INDEX "idx_market_agreements_work" ON "market_agreements" USING btree ("work_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_market_withdrawals_user" ON "market_withdrawals" USING btree ("user_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_market_works_feed" ON "market_works" USING btree ("status","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_market_works_owner" ON "market_works" USING btree ("owner_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_redeem_code_redemptions" ON "redeem_code_redemptions" USING btree ("code_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_redeem_codes_code" ON "redeem_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_subject_files_subject" ON "subject_files" USING btree ("subject_id","sort");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_subject_files_subject_uri" ON "subject_files" USING btree ("subject_id","uri");--> statement-breakpoint
CREATE INDEX "idx_subjects_space" ON "subjects" USING btree ("space_id","kind","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_subjects_review" ON "subjects" USING btree ("space_id","review_status");--> statement-breakpoint
CREATE INDEX "idx_subjects_project" ON "subjects" USING btree ("project_id");