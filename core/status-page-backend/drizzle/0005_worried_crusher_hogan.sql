CREATE TABLE "status_page_verified_emails" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"verified_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "status_pages" ADD COLUMN "email_verification_required" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "status_page_verified_emails_email_unique" ON "status_page_verified_emails" USING btree ("email");