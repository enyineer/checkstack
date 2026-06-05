-- Make catalog display-name uniqueness CASE-INSENSITIVE. The name indexes added
-- in 0004/0005 were on the raw column, so "Api" and "api" were distinct. Rebuild
-- them as functional `lower(name)` indexes; the stored value keeps its original
-- casing. Before recreating each, resolve pre-existing case-insensitive
-- duplicates by suffixing the later ones (" (2)", " (3)", ...) so no data is lost
-- and the unique index can be created.

DROP INDEX "environments_name_unique";--> statement-breakpoint
DROP INDEX "groups_name_unique";--> statement-breakpoint
DROP INDEX "systems_name_unique";--> statement-breakpoint

-- environments.name (case-insensitive)
UPDATE "environments" AS e
SET "name" = e."name" || ' (' || r.rn || ')'
FROM (
	SELECT "id", row_number() OVER (PARTITION BY lower("name") ORDER BY "created_at", "id") AS rn
	FROM "environments"
) AS r
WHERE e."id" = r."id" AND r.rn > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX "environments_name_unique" ON "environments" USING btree (lower("name"));--> statement-breakpoint

-- groups.name (case-insensitive)
UPDATE "groups" AS g
SET "name" = g."name" || ' (' || r.rn || ')'
FROM (
	SELECT "id", row_number() OVER (PARTITION BY lower("name") ORDER BY "created_at", "id") AS rn
	FROM "groups"
) AS r
WHERE g."id" = r."id" AND r.rn > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX "groups_name_unique" ON "groups" USING btree (lower("name"));--> statement-breakpoint

-- systems.name (case-insensitive)
UPDATE "systems" AS s
SET "name" = s."name" || ' (' || r.rn || ')'
FROM (
	SELECT "id", row_number() OVER (PARTITION BY lower("name") ORDER BY "created_at", "id") AS rn
	FROM "systems"
) AS r
WHERE s."id" = r."id" AND r.rn > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX "systems_name_unique" ON "systems" USING btree (lower("name"));
