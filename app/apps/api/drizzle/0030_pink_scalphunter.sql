CREATE TABLE "market_categories" (
	"id" bigint PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_review_logs" (
	"id" bigint PRIMARY KEY NOT NULL,
	"work_id" bigint NOT NULL,
	"action" smallint NOT NULL,
	"operator_admin_id" bigint,
	"operator_user_id" bigint,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_tags" (
	"id" bigint PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_withdrawals" ADD COLUMN "work_id" bigint;--> statement-breakpoint
ALTER TABLE "market_works" ADD COLUMN "category_id" bigint;--> statement-breakpoint
ALTER TABLE "market_works" ADD COLUMN "tag_ids" bigint[] DEFAULT '{}'::bigint[] NOT NULL;--> statement-breakpoint
ALTER TABLE "market_review_logs" ADD CONSTRAINT "market_review_logs_work_id_market_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."market_works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_review_logs" ADD CONSTRAINT "market_review_logs_operator_admin_id_admin_users_id_fk" FOREIGN KEY ("operator_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_review_logs" ADD CONSTRAINT "market_review_logs_operator_user_id_users_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_market_categories_name" ON "market_categories" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_market_categories_sort" ON "market_categories" USING btree ("status","sort");--> statement-breakpoint
CREATE INDEX "idx_market_review_logs_work" ON "market_review_logs" USING btree ("work_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_market_tags_name" ON "market_tags" USING btree ("name");--> statement-breakpoint
ALTER TABLE "market_withdrawals" ADD CONSTRAINT "market_withdrawals_work_id_market_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."market_works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_market_works_category" ON "market_works" USING btree ("status","category_id","published_at" DESC NULLS LAST);