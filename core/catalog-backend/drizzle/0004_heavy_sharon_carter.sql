-- Before enforcing uniqueness, resolve any pre-existing duplicate system names
-- (the column had no unique constraint until now). Keep the earliest system with
-- each name unchanged and suffix the later ones (" (2)", " (3)", ...) by
-- created_at/id order, so no data is lost and the unique index can be created.
UPDATE "systems" AS s
SET "name" = s."name" || ' (' || r.rn || ')'
FROM (
	SELECT "id", row_number() OVER (PARTITION BY "name" ORDER BY "created_at", "id") AS rn
	FROM "systems"
) AS r
WHERE s."id" = r."id" AND r.rn > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX "systems_name_unique" ON "systems" USING btree ("name");
