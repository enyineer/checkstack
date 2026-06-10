-- Target B cutover: backfill the single relation_tuple store from the three
-- legacy access tables, THEN drop them. Backfill runs first (the drops at the
-- end read these tables). The INSERTs use ON CONFLICT DO NOTHING; the migration
-- as a whole is not re-runnable (the drops remove its sources), but Drizzle
-- records the applied hash and never replays it.

-- resource_team_access -> the single highest relation per (object, team).
-- Assumes the implied invariant that a higher flag includes the lower (owner ⇒
-- manage ⇒ read), which every real write path (setResourceOwner /
-- setResourceTeamAccess defaults) upheld:
--   is_owner -> owner ; can_manage -> editor ; else -> viewer.
INSERT INTO "relation_tuple" ("object_type","object_id","relation","subject_type","subject_id")
SELECT "resource_type","resource_id",
  CASE WHEN "is_owner" THEN 'owner' WHEN "can_manage" THEN 'editor' ELSE 'viewer' END,
  'team',"team_id"
FROM "resource_team_access"
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- resource_create_grant -> type-level `creator` tuple (object_id '*').
INSERT INTO "relation_tuple" ("object_type","object_id","relation","subject_type","subject_id")
SELECT "resource_type",'*','creator','team',"team_id"
FROM "resource_create_grant"
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Privacy marker: every teamOnly object gets a `private` marker tuple closing
-- the global RBAC path. Default (not teamOnly) objects get NO marker. This is
-- written for ALL teamOnly objects regardless of whether they have team grants,
-- so a teamOnly object with zero grants stays denied to global-rule holders
-- (preserving the old fail-closed invariant).
INSERT INTO "relation_tuple" ("object_type","object_id","relation","subject_type","subject_id")
SELECT DISTINCT "resource_type","resource_id",'private','public','*'
FROM "resource_access_settings"
WHERE "team_only" = true
ON CONFLICT DO NOTHING;--> statement-breakpoint
DROP TABLE "resource_access_settings" CASCADE;--> statement-breakpoint
DROP TABLE "resource_create_grant" CASCADE;--> statement-breakpoint
DROP TABLE "resource_team_access" CASCADE;