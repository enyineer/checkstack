ALTER TABLE "telemetry_sources" ADD COLUMN "push_token_hash" text;--> statement-breakpoint
ALTER TABLE "telemetry_sources" ADD COLUMN "push_token_prefix" text;--> statement-breakpoint
CREATE INDEX "telemetry_sources_push_hash_idx" ON "telemetry_sources" USING btree ("push_token_hash");--> statement-breakpoint
-- Promote the stream plugins' LEGACY push source tokens into the telemetry
-- platform as push-mode source instances (`logstream.push` /
-- `metricstream.push` / `tracestream.push`), one instance per token, so every
-- EXISTING shipper token keeps authenticating without a re-mint: the sha256
-- token hash is copied VERBATIM (all three plugins hash via the same shared
-- source-token kit) and the ingest endpoints verify against
-- `telemetry_sources.push_token_hash` from this release on.
--
-- Guarded by to_regclass per source table, so a fresh install (tables not yet
-- created, or already dropped) is a no-op; ON CONFLICT (id) keeps any
-- already-present row so re-runs converge. REVOKED tokens are dead
-- credentials and are deliberately not migrated.
--
-- The legacy tables ARE dropped this release - by each OWNING plugin's own
-- migration chain. That is safe because plugin migrations run in topological
-- dependency order (deps first) and all three stream plugins depend on
-- telemetry-backend, so this promotion is guaranteed to have run before the
-- owners' DROP migrations in the same boot.
DO $$
BEGIN
  IF to_regclass('"plugin_logstream".log_stream_tokens') IS NOT NULL THEN
    INSERT INTO telemetry_sources (
      id, source_type_id, name, description, config, bindings, enabled,
      interval_seconds, satellite_id, webhook_secret_hash, webhook_secret_prefix,
      push_token_hash, push_token_prefix, consecutive_failures, last_run_at,
      last_error, created_at, updated_at
    )
    SELECT
      t.id, 'logstream.push', t.name, NULL, '{}'::jsonb,
      jsonb_build_array(jsonb_build_object('signal', 'logs', 'streamId', t.stream_id)),
      true, NULL, NULL, NULL, NULL,
      t.token_hash, t.token_prefix, 0, t.last_used_at,
      NULL, t.created_at, t.created_at
    FROM "plugin_logstream".log_stream_tokens AS t
    WHERE t.revoked_at IS NULL
    ON CONFLICT (id) DO NOTHING;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('"plugin_metricstream".metric_stream_tokens') IS NOT NULL THEN
    INSERT INTO telemetry_sources (
      id, source_type_id, name, description, config, bindings, enabled,
      interval_seconds, satellite_id, webhook_secret_hash, webhook_secret_prefix,
      push_token_hash, push_token_prefix, consecutive_failures, last_run_at,
      last_error, created_at, updated_at
    )
    SELECT
      t.id, 'metricstream.push', t.name, NULL, '{}'::jsonb,
      jsonb_build_array(jsonb_build_object('signal', 'metrics', 'streamId', t.stream_id)),
      true, NULL, NULL, NULL, NULL,
      t.token_hash, t.token_prefix, 0, t.last_used_at,
      NULL, t.created_at, t.created_at
    FROM "plugin_metricstream".metric_stream_tokens AS t
    WHERE t.revoked_at IS NULL
    ON CONFLICT (id) DO NOTHING;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('"plugin_tracestream".trace_stream_tokens') IS NOT NULL THEN
    INSERT INTO telemetry_sources (
      id, source_type_id, name, description, config, bindings, enabled,
      interval_seconds, satellite_id, webhook_secret_hash, webhook_secret_prefix,
      push_token_hash, push_token_prefix, consecutive_failures, last_run_at,
      last_error, created_at, updated_at
    )
    SELECT
      t.id, 'tracestream.push', t.name, NULL, '{}'::jsonb,
      jsonb_build_array(jsonb_build_object('signal', 'traces', 'streamId', t.stream_id)),
      true, NULL, NULL, NULL, NULL,
      t.token_hash, t.token_prefix, 0, t.last_used_at,
      NULL, t.created_at, t.created_at
    FROM "plugin_tracestream".trace_stream_tokens AS t
    WHERE t.revoked_at IS NULL
    ON CONFLICT (id) DO NOTHING;
  END IF;
END
$$;
