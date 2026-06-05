-- Resolve any pre-existing duplicate (incident_id, url) links before enforcing
-- uniqueness: keep the earliest by created_at/id, remove the redundant rest.
DELETE FROM "incident_links" WHERE "id" IN (
	SELECT "id" FROM (
		SELECT "id", row_number() OVER (PARTITION BY "incident_id", "url" ORDER BY "created_at", "id") AS rn
		FROM "incident_links"
	) AS r WHERE r.rn > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX "incident_links_incident_url_unique" ON "incident_links" USING btree ("incident_id","url");