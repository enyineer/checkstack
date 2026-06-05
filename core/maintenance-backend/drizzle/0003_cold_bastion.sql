-- Resolve any pre-existing duplicate (maintenance_id, url) links before
-- enforcing uniqueness: keep the earliest by created_at/id, remove the rest.
DELETE FROM "maintenance_links" WHERE "id" IN (
	SELECT "id" FROM (
		SELECT "id", row_number() OVER (PARTITION BY "maintenance_id", "url" ORDER BY "created_at", "id") AS rn
		FROM "maintenance_links"
	) AS r WHERE r.rn > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_links_maintenance_url_unique" ON "maintenance_links" USING btree ("maintenance_id","url");