-- Per-satellite environment scoping for a health-check assignment.
--
-- Deliberately NO backfill: the column's "key absent" semantics already mean
-- "this satellite runs every environment the assignment resolves to", so a NULL
-- column reproduces exactly the behaviour every existing row has today. Writing
-- an explicit map for every row would only freeze today's satellite list into
-- data that has to be maintained.
ALTER TABLE "system_health_checks" ADD COLUMN "satellite_environment_ids" jsonb;
