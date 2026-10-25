CREATE TABLE "team_groups" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"parent_id" bigint,
	"name" text NOT NULL,
	"leader_user_id" bigint,
	"sort" integer DEFAULT 0 NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_member_projects" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"project_kind" smallint DEFAULT 1 NOT NULL,
	"project_id" bigint NOT NULL,
	"participation_type" smallint DEFAULT 1 NOT NULL,
	"granted_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_roles" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"role_code" text NOT NULL,
	"role_name" text NOT NULL,
	"role_level" smallint NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"description" text,
	"power_list" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"module_id_list" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_third_keys" (
	"id" bigint PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"space_id" bigint,
	"provider" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"key_cipher" text NOT NULL,
	"key_hash" text,
	"status" smallint DEFAULT 1 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_flows" ADD COLUMN "ref_space_id" bigint;--> statement-breakpoint
ALTER TABLE "credit_flows" ADD COLUMN "ref_user_id" bigint;--> statement-breakpoint
ALTER TABLE "credit_flows" ADD COLUMN "op_user_id" bigint;--> statement-breakpoint
ALTER TABLE "credit_flows" ADD COLUMN "group_id" bigint;--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "role_id" bigint;--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "role_code" text;--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "role_level" smallint;--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "group_id" bigint;--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "status" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "nickname" text;--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "account" text;--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "remark" text;--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "invited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "joined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "max_seats" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "status" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "agent_whitelist" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "film_enabled" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "team_groups" ADD CONSTRAINT "team_groups_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_groups" ADD CONSTRAINT "team_groups_leader_user_id_users_id_fk" FOREIGN KEY ("leader_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_projects" ADD CONSTRAINT "team_member_projects_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_projects" ADD CONSTRAINT "team_member_projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_projects" ADD CONSTRAINT "team_member_projects_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_roles" ADD CONSTRAINT "team_roles_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_third_keys" ADD CONSTRAINT "user_third_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_third_keys" ADD CONSTRAINT "user_third_keys_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_team_groups_space" ON "team_groups" USING btree ("space_id","parent_id","sort");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tmp_scope" ON "team_member_projects" USING btree ("space_id","user_id","project_kind","project_id");--> statement-breakpoint
CREATE INDEX "idx_tmp_space_project" ON "team_member_projects" USING btree ("space_id","project_kind","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_team_roles_code" ON "team_roles" USING btree ("space_id","role_code");--> statement-breakpoint
CREATE INDEX "idx_user_third_keys_user" ON "user_third_keys" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "idx_flows_space_kind" ON "credit_flows" USING btree ("space_id","kind","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_flows_ref_space" ON "credit_flows" USING btree ("ref_space_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_space_members_group" ON "space_members" USING btree ("space_id","group_id");--> statement-breakpoint
CREATE INDEX "idx_space_members_role" ON "space_members" USING btree ("space_id","role_code");