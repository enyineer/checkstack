-- Better Auth 1.7 scopes account identity by issuer + accountId. Add the new
-- required column nullable so existing rows can be backfilled before the
-- constraint is enforced.
ALTER TABLE "account" ADD COLUMN "issuer" text;--> statement-breakpoint
-- Credential accountId changed from mutable email to the linked user's stable
-- id. LDAP and SAML accounts are local bridge identities; GitHub is the only
-- OAuth social provider shipped by this deployment.
UPDATE "account" AS a
SET
	"issuer" = CASE
		WHEN a."provider_id" = 'credential' THEN 'local:credential'
		WHEN a."provider_id" IN ('ldap', 'saml') THEN 'local:' || a."provider_id"
		WHEN a."provider_id" = 'github' THEN 'local:oauth:github'
		ELSE NULL
	END,
	"account_id" = CASE
		WHEN a."provider_id" = 'credential' THEN u."id"
		ELSE a."account_id"
	END
FROM "user" AS u
WHERE a."user_id" = u."id";--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "account" WHERE "issuer" IS NULL) THEN
		RAISE EXCEPTION 'Cannot backfill Better Auth 1.7 account issuer for an unknown provider_id';
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON "account" USING btree ("issuer","account_id");
