ALTER TABLE "project_assets" ADD COLUMN "resource_type" smallint GENERATED ALWAYS AS (case "kind"
        when 'character' then 1
        when 'scene' then 2
        when 'prop' then 3
        when 'reference_video' then 4
        when 'reference_image' then 5
        else 8 end) STORED;--> statement-breakpoint
ALTER TABLE "project_assets" ADD COLUMN "file_uri" text;--> statement-breakpoint
ALTER TABLE "project_assets" ADD COLUMN "content_type" text;--> statement-breakpoint
CREATE INDEX "idx_project_assets_resource" ON "project_assets" USING btree ("project_id","resource_type","status");