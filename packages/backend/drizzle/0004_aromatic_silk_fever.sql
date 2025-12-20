CREATE TABLE "jwt_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"algorithm" text NOT NULL,
	"created_at" text NOT NULL,
	"expires_at" text,
	"revoked_at" text
);
