ALTER TABLE "idempotency_records" ADD COLUMN "status" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD COLUMN "error_body" jsonb;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_idem_status" ON "idempotency_records" USING btree ("status","expire_at");