-- Drop the two LEGACY tables whose data the telemetry platform has already
-- promoted into `telemetry_sources` instances. Both drops are safe here because
-- plugin migrations run TOPOLOGICALLY AFTER the telemetry platform's, so by the
-- time this runs the promotion has completed on this database:
--
--   * `metric_scrape_targets`  -> telemetry migration 0001 copied each row into a
--     `metricstream.prometheus-scrape` source instance (id reuse). The boot-time
--     re-key (`sources/prometheus/rekey.ts`) has already moved any inline bearer
--     secret into telemetry's own `__tlsecret__` channel.
--   * `metric_stream_tokens`   -> telemetry migration 0002 promoted each
--     non-revoked row into a `metricstream.push` source instance (id + token-hash
--     reuse), so existing shipper tokens keep authenticating via the platform
--     push-token verifier.
--
-- Nothing in this plugin reads or writes either table anymore (token CRUD and
-- scrape CRUD are the platform's), so the drop is data-lossless for the plugin.
DROP TABLE "metric_scrape_targets" CASCADE;--> statement-breakpoint
DROP TABLE "metric_stream_tokens" CASCADE;
