-- Promote LEGACY metricstream Prometheus scrape targets into the telemetry
-- platform as `metricstream.prometheus-scrape` source instances.
--
-- The legacy `metric_scrape_targets` table lives in the `plugin_metricstream`
-- Postgres schema (see getPluginSchemaName). This copies its rows into this
-- plugin's `telemetry_sources` table WITHOUT loss: it is guarded by to_regclass
-- so a fresh install (no metricstream scrape table) is a no-op, and
-- ON CONFLICT (id) keeps any already-present row. The NEW source id REUSES the
-- OLD target id, so a boot-time re-key (metricstream-backend) can find the
-- inline bearer secret still keyed under the old target id, and re-runs converge.
--
-- The source table is intentionally NOT dropped, and moved rows are NOT deleted:
-- plugin migration order is not guaranteed, so leaving the source in place means
-- no rows can be lost if this migration ever runs before metricstream's own, and
-- ON CONFLICT makes a re-run safe. (Same rationale as the gitops-secrets
-- promotion.) The legacy table + rows can be dropped in a future release.
--
-- config jsonb: { url, timeoutMs, bearerToken? }. `bearerToken` is copied VERBATIM
-- from `bearer_token_secret` (an OLD `__mssecret__:<id>` marker, a `${{ secrets.NAME }}`
-- reference, or absent when null) - the metricstream re-key one-shot rewrites a
-- marker into telemetry's own `__tlsecret__` channel at boot; a reference is left
-- to resolve at run time. bindings: one metrics binding to the target's stream.
DO $$
BEGIN
  IF to_regclass('"plugin_metricstream".metric_scrape_targets') IS NOT NULL THEN
    INSERT INTO telemetry_sources (
      id,
      source_type_id,
      name,
      description,
      config,
      bindings,
      enabled,
      interval_seconds,
      satellite_id,
      webhook_secret_hash,
      webhook_secret_prefix,
      consecutive_failures,
      last_run_at,
      last_error,
      created_at,
      updated_at
    )
    SELECT
      t.id,
      'metricstream.prometheus-scrape',
      t.name,
      NULL,
      jsonb_strip_nulls(jsonb_build_object(
        'url', t.url,
        'timeoutMs', t.timeout_ms,
        'bearerToken', t.bearer_token_secret
      )),
      jsonb_build_array(jsonb_build_object('signal', 'metrics', 'streamId', t.stream_id)),
      t.enabled,
      t.interval_seconds,
      t.satellite_id,
      NULL,
      NULL,
      t.consecutive_failures,
      t.last_scrape_at,
      t.last_error,
      t.created_at,
      t.updated_at
    FROM "plugin_metricstream".metric_scrape_targets AS t
    ON CONFLICT (id) DO NOTHING;
  END IF;
END
$$;
