-- Custom SQL migration file, put your code below! --

-- Remove the deprecated auto-seeded incident automations.
--
-- These were historically seeded one-time from each health-check
-- assignment's notification policy (sustained-unhealthy / flapping ->
-- incident.create) and tagged `managed_by = 'auto-incident:<...>'`. The
-- seeder has been removed; auto-incidents are now built entirely by
-- user-authored automations. This deletes the orphaned seeded rows.
--
-- Destructive and intentional: a fresh install never created these, and
-- on upgraded installs they are no longer managed by anything.
DELETE FROM "automations" WHERE "managed_by" LIKE 'auto-incident:%';
