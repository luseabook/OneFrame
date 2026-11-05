CREATE TABLE "gpu_accounts" (
	"id" bigint PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"space_id" bigint,
	"provider" text DEFAULT 'autodl' NOT NULL,
	"token_ciphertext" text NOT NULL,
	"encryption_key_id" text DEFAULT 'v1' NOT NULL,
	"credential_version" integer DEFAULT 1 NOT NULL,
	"token_hint" text DEFAULT '' NOT NULL,
	"token_fingerprint" text DEFAULT '' NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"last_check_at" timestamp with time zone,
	"last_check_status" text,
	"consent_version" text DEFAULT 'v1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gpu_jobs" (
	"id" bigint PRIMARY KEY NOT NULL,
	"task_id" bigint NOT NULL,
	"pool_id" bigint NOT NULL,
	"node_id" bigint,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"gpu_seconds" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"fail_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gpu_nodes" (
	"id" bigint PRIMARY KEY NOT NULL,
	"pool_id" bigint NOT NULL,
	"provider" text DEFAULT 'autodl' NOT NULL,
	"provider_instance_id" text NOT NULL,
	"instance_name" text DEFAULT '' NOT NULL,
	"gpu_spec" text NOT NULL,
	"vram_gb" integer DEFAULT 48 NOT NULL,
	"state" text DEFAULT 'provisioning' NOT NULL,
	"hourly_price_cents" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"last_heartbeat" timestamp with time zone,
	"agent_version" text,
	"model_commit" text,
	"variants_loaded" text[] DEFAULT '{}'::text[] NOT NULL,
	"cost_accrued_cents" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gpu_nodes_provider_instance_id_unique" UNIQUE("provider_instance_id")
);
--> statement-breakpoint
CREATE TABLE "gpu_pools" (
	"id" bigint PRIMARY KEY NOT NULL,
	"account_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"name" text NOT NULL,
	"gpu_spec" text DEFAULT 'v-48g' NOT NULL,
	"gpu_count" integer DEFAULT 1 NOT NULL,
	"image_uuid" text,
	"system_disk_gb" integer DEFAULT 50 NOT NULL,
	"lifecycle" text DEFAULT 'session' NOT NULL,
	"idle_minutes" integer DEFAULT 15 NOT NULL,
	"budget_daily_cents" integer DEFAULT 5000 NOT NULL,
	"budget_month_cents" integer DEFAULT 50000 NOT NULL,
	"state" text DEFAULT 'idle' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "uq_model_prices";--> statement-breakpoint
DROP INDEX "uq_model_prices_per_call";--> statement-breakpoint
ALTER TABLE "model_prices" ADD COLUMN "compute_source" text DEFAULT 'hosted' NOT NULL;--> statement-breakpoint
ALTER TABLE "model_routes" ADD COLUMN "compute_source" text DEFAULT 'hosted' NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "compute_source" text DEFAULT 'hosted' NOT NULL;--> statement-breakpoint
ALTER TABLE "gpu_accounts" ADD CONSTRAINT "gpu_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gpu_accounts" ADD CONSTRAINT "gpu_accounts_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gpu_jobs" ADD CONSTRAINT "gpu_jobs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gpu_jobs" ADD CONSTRAINT "gpu_jobs_pool_id_gpu_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."gpu_pools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gpu_jobs" ADD CONSTRAINT "gpu_jobs_node_id_gpu_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."gpu_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gpu_nodes" ADD CONSTRAINT "gpu_nodes_pool_id_gpu_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."gpu_pools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gpu_pools" ADD CONSTRAINT "gpu_pools_account_id_gpu_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."gpu_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gpu_pools" ADD CONSTRAINT "gpu_pools_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_gpu_accounts_user" ON "gpu_accounts" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "idx_gpu_jobs_task" ON "gpu_jobs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_gpu_jobs_pool_time" ON "gpu_jobs" USING btree ("pool_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_gpu_nodes_pool_state" ON "gpu_nodes" USING btree ("pool_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_gpu_pools_user" ON "gpu_pools" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_gpu_pools_state" ON "gpu_pools" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_model_prices" ON "model_prices" USING btree ("model_id","mode","resolution","duration_s","compute_source");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_model_prices_per_call" ON "model_prices" USING btree ("model_id","mode","resolution","compute_source") WHERE "model_prices"."duration_s" is null;