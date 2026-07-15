---
"@checkstack/logstream-backend": minor
"@checkstack/metricstream-backend": minor
"@checkstack/logstream-frontend": minor
"@checkstack/metricstream-frontend": minor
---

Integrate the log and metric streams with the new telemetry platform.

- The backends contribute telemetry SINKS: normalized platform records enter
  the exact same ingest pipelines (severity rules, banding, clamping, caps) as
  the plugins' own push endpoints, and bind-time authorization is answered by
  each plugin's own stream access rules.
- The frontends embed the platform's `StreamSourcesSection` (metricstream on
  the Sources tab, logstream on the Settings tab), so configured telemetry
  sources bound to a stream are managed next to the stream's other ingestion
  settings. The section self-hides while no source types are installed.
