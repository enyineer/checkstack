ALTER TABLE "anomalies" ADD COLUMN "environment_id" text;--> statement-breakpoint
-- This ADD COLUMN backfills every pre-existing anomaly row to
-- environment_id = NULL. For a check that fans out to environments, subsequent
-- runs now carry a non-null environmentId and the detector/drift-evaluator look
-- the open row up by that env, so they can never match (and never recover) the
-- backfilled NULL row: it would stay open forever and keep surfacing in the
-- active-anomaly signals. Close those stranded rows so the check re-detects per
-- (check, environment). We touch ONLY rows whose check is actually fanned out -
-- identified, without reaching into another plugin, by the presence of a
-- per-environment baseline for the same (system, config, field) - so genuinely
-- env-less checks (which legitimately keep environment_id = NULL and are still
-- matched by the IS NULL slice) keep their open anomalies untouched.
UPDATE "anomalies" AS a
SET "state" = 'recovered', "recovered_at" = now()
WHERE a."environment_id" IS NULL
  AND a."state" IN ('suspicious', 'anomaly')
  AND EXISTS (
    SELECT 1 FROM "anomaly_baselines" AS b
    WHERE b."system_id" = a."system_id"
      AND b."configuration_id" = a."configuration_id"
      AND b."field_path" = a."field_path"
      AND b."environment_id" IS NOT NULL
  );