ALTER TABLE "script_projects" DROP CONSTRAINT "script_projects_source_novel_id_novels_id_fk";
--> statement-breakpoint
ALTER TABLE "script_projects" ADD CONSTRAINT "script_projects_source_novel_id_novels_id_fk" FOREIGN KEY ("source_novel_id") REFERENCES "public"."novels"("id") ON DELETE set null ON UPDATE no action;