ALTER TABLE "script_projects" ADD COLUMN "source_file_name" text;--> statement-breakpoint
UPDATE "script_projects" SET "drama_type" = 3 WHERE "drama_type" = 2;
