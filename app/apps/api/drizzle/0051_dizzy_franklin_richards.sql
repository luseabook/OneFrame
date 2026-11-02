CREATE TABLE "model_providers" (
	"id" bigint PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"protocol" text NOT NULL,
	"base_url" text NOT NULL,
	"auth_type" text DEFAULT 'bearer' NOT NULL,
	"auth_header" text DEFAULT 'Authorization' NOT NULL,
	"credentials_ciphertext" text NOT NULL,
	"encryption_key_id" text DEFAULT 'v1' NOT NULL,
	"credential_version" integer DEFAULT 1 NOT NULL,
	"key_hint" text DEFAULT '' NOT NULL,
	"key_fingerprint" text DEFAULT '' NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"last_check_at" timestamp with time zone,
	"last_check_status" text,
	"last_check_message" text,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_providers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "model_routes" (
	"id" bigint PRIMARY KEY NOT NULL,
	"model_id" bigint NOT NULL,
	"provider_id" bigint NOT NULL,
	"remote_model_id" text NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"weight" integer DEFAULT 100 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_models" (
	"id" bigint PRIMARY KEY NOT NULL,
	"provider_id" bigint NOT NULL,
	"remote_model_id" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"capability_hint" text,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "model_providers" ADD CONSTRAINT "model_providers_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_routes" ADD CONSTRAINT "model_routes_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_routes" ADD CONSTRAINT "model_routes_provider_id_model_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."model_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_models" ADD CONSTRAINT "provider_models_provider_id_model_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."model_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_model_providers_status" ON "model_providers" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_model_routes_remote" ON "model_routes" USING btree ("model_id","provider_id","remote_model_id");--> statement-breakpoint
CREATE INDEX "idx_model_routes_model" ON "model_routes" USING btree ("model_id","active","priority");--> statement-breakpoint
CREATE INDEX "idx_model_routes_provider" ON "model_routes" USING btree ("provider_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_provider_models_remote" ON "provider_models" USING btree ("provider_id","remote_model_id");--> statement-breakpoint
CREATE INDEX "idx_provider_models_provider" ON "provider_models" USING btree ("provider_id","status");