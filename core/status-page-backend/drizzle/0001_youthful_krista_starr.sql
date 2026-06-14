ALTER TABLE "status_pages" ADD COLUMN "custom_domain" text;--> statement-breakpoint
ALTER TABLE "status_pages" ADD COLUMN "custom_domain_token" text;--> statement-breakpoint
ALTER TABLE "status_pages" ADD COLUMN "custom_domain_verified_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "status_pages_custom_domain_unique" ON "status_pages" USING btree ("custom_domain");