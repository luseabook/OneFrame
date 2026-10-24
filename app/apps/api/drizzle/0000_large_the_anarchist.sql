CREATE TABLE "admin_users" (
	"id" bigint PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'ops' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "credit_accounts" (
	"space_id" bigint PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"frozen" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_credit_accounts_balance" CHECK ("credit_accounts"."balance" >= 0),
	CONSTRAINT "ck_credit_accounts_frozen" CHECK ("credit_accounts"."frozen" >= 0)
);
--> statement-breakpoint
CREATE TABLE "credit_flows" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"delta" integer NOT NULL,
	"frozen_delta" integer DEFAULT 0 NOT NULL,
	"kind" text NOT NULL,
	"ref_task_id" bigint,
	"ref_order_id" bigint,
	"ref_code_id" bigint,
	"balance_after" integer NOT NULL,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" bigint PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"space_id" bigint NOT NULL,
	"request_hash" text NOT NULL,
	"response_body" jsonb,
	"expire_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"id" bigint PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"provider" text NOT NULL,
	"phone_hash" text,
	"phone_cipher" text,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite_codes" (
	"id" bigint PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"credits" integer DEFAULT 0 NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"status" smallint DEFAULT 1 NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "invite_redemptions" (
	"id" bigint PRIMARY KEY NOT NULL,
	"code_id" bigint NOT NULL,
	"space_id" bigint NOT NULL,
	"flow_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_prices" (
	"id" bigint PRIMARY KEY NOT NULL,
	"model_id" bigint NOT NULL,
	"mode" text NOT NULL,
	"resolution" text DEFAULT '' NOT NULL,
	"duration_s" integer,
	"credits" integer NOT NULL,
	"strike_credits" integer,
	"member_credits" integer,
	"time_limited_credits" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" bigint PRIMARY KEY NOT NULL,
	"vendor" text NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"logo" text DEFAULT '' NOT NULL,
	"capability" text NOT NULL,
	"types" text[] DEFAULT '{}'::text[] NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"promotions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"adapter_code" text NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"need_vip" boolean DEFAULT false NOT NULL,
	"audio_video_support" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 100 NOT NULL,
	"mode_order" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"modes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scene_modes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "models_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "skus" (
	"id" bigint PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"sku" text NOT NULL,
	"label" text NOT NULL,
	"price_cents" integer NOT NULL,
	"credits" integer NOT NULL,
	"period" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skus_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "space_members" (
	"space_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"role" smallint DEFAULT 3 NOT NULL,
	"credits_quota" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_members_space_id_user_id_pk" PRIMARY KEY("space_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" bigint PRIMARY KEY NOT NULL,
	"owner_user_id" bigint NOT NULL,
	"type" smallint DEFAULT 1 NOT NULL,
	"name" text DEFAULT '我的空间' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_events" (
	"id" bigint PRIMARY KEY NOT NULL,
	"task_id" bigint NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"episode_id" bigint,
	"shot_id" bigint,
	"attempt_no" integer DEFAULT 1 NOT NULL,
	"origin_task_id" bigint,
	"capability" text NOT NULL,
	"mode" text NOT NULL,
	"scene" text,
	"model_id" bigint NOT NULL,
	"input" jsonb NOT NULL,
	"options" jsonb NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"progress" smallint DEFAULT 0 NOT NULL,
	"error" jsonb,
	"vendor_task_id" text,
	"results" jsonb,
	"credits_frozen" integer DEFAULT 0 NOT NULL,
	"credits_settled" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text,
	"dedupe_key" text,
	"finished_at" timestamp with time zone,
	"expire_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigint PRIMARY KEY NOT NULL,
	"nickname" text DEFAULT '' NOT NULL,
	"avatar_uri" text,
	"region" text DEFAULT 'CN' NOT NULL,
	"data_center" text DEFAULT 'sz' NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"age_declared_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waitlist_entries" (
	"id" bigint PRIMARY KEY NOT NULL,
	"phone_hash" text NOT NULL,
	"source" text DEFAULT 'landing' NOT NULL,
	"invited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_entries_phone_hash_unique" UNIQUE("phone_hash")
);
--> statement-breakpoint
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_flows" ADD CONSTRAINT "credit_flows_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_redemptions" ADD CONSTRAINT "invite_redemptions_code_id_invite_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."invite_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_redemptions" ADD CONSTRAINT "invite_redemptions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_redemptions" ADD CONSTRAINT "invite_redemptions_flow_id_credit_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."credit_flows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_prices" ADD CONSTRAINT "model_prices_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_flows_space" ON "credit_flows" USING btree ("space_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_idempotency_key_space" ON "idempotency_records" USING btree ("key","space_id");--> statement-breakpoint
CREATE INDEX "idx_idem_expire" ON "idempotency_records" USING btree ("expire_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_identities_phone" ON "identities" USING btree ("provider","phone_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_identities_external" ON "identities" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "idx_identities_user" ON "identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_invite_codes_status" ON "invite_codes" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_invite_redemptions" ON "invite_redemptions" USING btree ("code_id","space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_model_prices" ON "model_prices" USING btree ("model_id","mode","resolution","duration_s");--> statement-breakpoint
CREATE INDEX "idx_model_prices_model" ON "model_prices" USING btree ("model_id","mode");--> statement-breakpoint
CREATE INDEX "idx_models_visible_sort" ON "models" USING btree ("visible","sort");--> statement-breakpoint
CREATE INDEX "idx_task_events_task" ON "task_events" USING btree ("task_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tasks_dedupe" ON "tasks" USING btree ("dedupe_key","space_id") WHERE "tasks"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "idx_tasks_shot" ON "tasks" USING btree ("shot_id","attempt_no" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_tasks_space_status" ON "tasks" USING btree ("space_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_tasks_polling" ON "tasks" USING btree ("id","status") WHERE "tasks"."status" in (1, 2, 6);--> statement-breakpoint
CREATE INDEX "idx_tasks_expire" ON "tasks" USING btree ("expire_at");