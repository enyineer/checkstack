CREATE TABLE "status_page_subscribers" (
	"id" text PRIMARY KEY NOT NULL,
	"status_page_id" text NOT NULL,
	"email" text NOT NULL,
	"verification_token" text,
	"verified" boolean DEFAULT false NOT NULL,
	"unsubscribe_token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"verified_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "status_page_subscribers" ADD CONSTRAINT "status_page_subscribers_status_page_id_status_pages_id_fk" FOREIGN KEY ("status_page_id") REFERENCES "status_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "status_page_subscribers_page_email_unique" ON "status_page_subscribers" USING btree ("status_page_id","email");--> statement-breakpoint
CREATE INDEX "status_page_subscribers_page_idx" ON "status_page_subscribers" USING btree ("status_page_id");