CREATE TABLE "status_pages" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"theme" jsonb DEFAULT '{"mode":"auto"}'::jsonb NOT NULL,
	"draft_layout" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_layout" jsonb,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "status_pages_slug_unique" ON "status_pages" USING btree ("slug");