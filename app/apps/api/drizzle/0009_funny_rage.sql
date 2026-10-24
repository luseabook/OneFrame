ALTER TABLE "orders" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refund_no" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refund_status" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refund_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refund_reason" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refund_operator" text;