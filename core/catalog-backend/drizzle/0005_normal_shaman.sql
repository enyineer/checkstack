-- Before enforcing the new uniqueness constraints, resolve any pre-existing
-- duplicates (these columns had no unique constraint until now). Names are
-- preserved by suffixing later duplicates (" (2)", " (3)", ...); redundant
-- contact/link rows are removed, keeping the earliest by created_at/id. Mirrors
-- the systems_name_unique migration (0004).

-- environments.name
UPDATE "environments" AS e
SET "name" = e."name" || ' (' || r.rn || ')'
FROM (
	SELECT "id", row_number() OVER (PARTITION BY "name" ORDER BY "created_at", "id") AS rn
	FROM "environments"
) AS r
WHERE e."id" = r."id" AND r.rn > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX "environments_name_unique" ON "environments" USING btree ("name");--> statement-breakpoint

-- groups.name
UPDATE "groups" AS g
SET "name" = g."name" || ' (' || r.rn || ')'
FROM (
	SELECT "id", row_number() OVER (PARTITION BY "name" ORDER BY "created_at", "id") AS rn
	FROM "groups"
) AS r
WHERE g."id" = r."id" AND r.rn > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX "groups_name_unique" ON "groups" USING btree ("name");--> statement-breakpoint

-- system_contacts (system_id, user_id) — NULL user_id rows (mailbox contacts)
-- are distinct in btree and unaffected; only duplicate user contacts are pruned.
DELETE FROM "system_contacts" WHERE "id" IN (
	SELECT "id" FROM (
		SELECT "id", row_number() OVER (PARTITION BY "system_id", "user_id" ORDER BY "created_at", "id") AS rn
		FROM "system_contacts"
		WHERE "user_id" IS NOT NULL
	) AS r WHERE r.rn > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX "system_contacts_system_user_unique" ON "system_contacts" USING btree ("system_id","user_id");--> statement-breakpoint

-- system_contacts (system_id, email) — NULL email rows (user contacts) are distinct.
DELETE FROM "system_contacts" WHERE "id" IN (
	SELECT "id" FROM (
		SELECT "id", row_number() OVER (PARTITION BY "system_id", "email" ORDER BY "created_at", "id") AS rn
		FROM "system_contacts"
		WHERE "email" IS NOT NULL
	) AS r WHERE r.rn > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX "system_contacts_system_email_unique" ON "system_contacts" USING btree ("system_id","email");--> statement-breakpoint

-- system_links (system_id, url)
DELETE FROM "system_links" WHERE "id" IN (
	SELECT "id" FROM (
		SELECT "id", row_number() OVER (PARTITION BY "system_id", "url" ORDER BY "created_at", "id") AS rn
		FROM "system_links"
	) AS r WHERE r.rn > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX "system_links_system_url_unique" ON "system_links" USING btree ("system_id","url");
