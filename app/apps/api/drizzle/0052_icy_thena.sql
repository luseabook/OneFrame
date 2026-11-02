ALTER TABLE "tasks" ADD COLUMN "route_id" bigint;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "route_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_route_id_model_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."model_routes"("id") ON DELETE set null ON UPDATE no action;