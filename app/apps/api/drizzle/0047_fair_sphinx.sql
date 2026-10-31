CREATE TABLE "admin_audit_logs" (
	"id" bigint PRIMARY KEY NOT NULL,
	"admin_id" bigint,
	"admin_username" text DEFAULT '' NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"action" text DEFAULT '' NOT NULL,
	"status_code" integer DEFAULT 200 NOT NULL,
	"ok" boolean DEFAULT true NOT NULL,
	"ip" text,
	"request_id" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_configs" (
	"id" bigint PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"module" text DEFAULT '' NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text,
	"updated_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_configs_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "status" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "token_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "password_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_configs" ADD CONSTRAINT "app_configs_updated_by_admin_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_admin_audit_logs_created" ON "admin_audit_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_admin_audit_logs_admin_created" ON "admin_audit_logs" USING btree ("admin_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_admin_audit_logs_action_created" ON "admin_audit_logs" USING btree ("action","created_at" DESC NULLS LAST);
--> statement-breakpoint
-- 存量库升级：改造前 bootstrap 建的首个管理员角色是 "ops"，而管理员管理端点是 super-only，
-- 不修正就会"升级后没有任何账号能管管理员"。仅在库内没有 super 时把最早的管理员提升为 super。
UPDATE "admin_users" SET "role" = 'super'
WHERE "id" = (SELECT min("id") FROM "admin_users")
  AND NOT EXISTS (SELECT 1 FROM "admin_users" WHERE "role" = 'super');