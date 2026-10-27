ALTER TABLE "timeline_publications" ADD COLUMN "transcode_mode" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "timeline_publications" ADD COLUMN "transcode_reason" text;