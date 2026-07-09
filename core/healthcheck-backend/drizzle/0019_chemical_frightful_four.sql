-- NOTE: plain (non-CONCURRENT) CREATE INDEX takes a SHARE lock that blocks
-- writes to health_check_runs while each index builds. The migrator wraps every
-- migration in one transaction, so CREATE INDEX CONCURRENTLY (which cannot run
-- inside a transaction) is not possible here. On a very large table you can
-- pre-build these CONCURRENTLY by hand (outside the migrator, same names) before
-- deploying; the IF NOT EXISTS below then makes this migration a no-op.
CREATE INDEX IF NOT EXISTS "health_check_runs_check_recent_idx" ON "health_check_runs" USING btree ("system_id","configuration_id","timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "health_check_runs_slice_recent_idx" ON "health_check_runs" USING btree ("system_id","configuration_id","environment_id","timestamp");
