ALTER TABLE "gpu_pools" ALTER COLUMN "image_source" SET DEFAULT 'app';--> statement-breakpoint
ALTER TABLE "gpu_pools" ADD COLUMN "application_uuid" text;--> statement-breakpoint
ALTER TABLE "gpu_pools" ADD COLUMN "application_version" text DEFAULT 'latest' NOT NULL;