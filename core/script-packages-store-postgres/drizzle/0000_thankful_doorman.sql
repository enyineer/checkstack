CREATE TABLE "script_package_blob_data" (
	"integrity" text PRIMARY KEY NOT NULL,
	"data" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
