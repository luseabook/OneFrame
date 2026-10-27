CREATE TABLE "sku_promotions" (
	"id" bigint PRIMARY KEY NOT NULL,
	"sku" text NOT NULL,
	"kind" smallint DEFAULT 1 NOT NULL,
	"price_cents" integer NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" bigint PRIMARY KEY NOT NULL,
	"space_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"sku_id" bigint NOT NULL,
	"sku" text NOT NULL,
	"start_at" timestamp with time zone DEFAULT now() NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"auto_renew" boolean DEFAULT false NOT NULL,
	"order_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sku_promotions_sku" ON "sku_promotions" USING btree ("sku","active","starts_at");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_space" ON "subscriptions" USING btree ("space_id","status","end_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_subscriptions_active_space" ON "subscriptions" USING btree ("space_id") WHERE status = 1;