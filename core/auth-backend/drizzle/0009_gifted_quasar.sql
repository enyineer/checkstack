CREATE TABLE "better_auth_rate_limit" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"last_request" bigint DEFAULT 0 NOT NULL
);
