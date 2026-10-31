ALTER TABLE "app_configs" DROP CONSTRAINT "app_configs_key_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_app_configs_key_module" ON "app_configs" USING btree ("key","module");