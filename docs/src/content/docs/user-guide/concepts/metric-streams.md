---
title: Metric streams
description: Ingest metrics via OTLP, Prometheus scraping, or JSON, and assert on gauges, counter rates, and label-filtered series as health checks.
---

A metric stream receives numeric metrics from your applications and infrastructure and turns them into something you can monitor. Checkstack aggregates every datapoint into per-minute series buckets and exposes the stream as a health-check type, so you can assert on a gauge's current value, a counter's rate, or the average across a set of labeled series with the same assertions, incidents, and status pages you already use. If you are shipping logs instead, see [Log streams](/checkstack/user-guide/concepts/log-streams/) - the two share the same design.

## Where metrics come from

A stream accepts metrics from several source types at once, and more can be added by plugins:

- **OTLP push**: applications and collectors send OpenTelemetry metrics to the stream's endpoint, authenticated by a source token.
- **Prometheus scraping**: Checkstack pulls from exporter endpoints you configure as scrape targets (URL, interval, optional bearer token). Failing targets are surfaced on the stream and raise an important event when they stay down.
- **JSON push**: a minimal endpoint for scripts and custom apps without an SDK.

Push sources authenticate with per-stream **source tokens** (`ckms_` prefix), shown once at mint time and revocable - the same model as log streams.

## Series, gauges, and counters

Every datapoint belongs to a **series**: a metric name plus its labels (for example `http_requests_total{method="GET", status="500"}`). Checkstack keeps a registry of the names and series it has seen - that registry is what powers autocomplete when you build a check.

Metric types matter for what you assert:

- A **gauge** is a moving value (queue depth, temperature, memory). You assert on its latest value or its windowed average, minimum, or maximum.
- A **counter** only goes up (requests served, errors). Its raw value is rarely useful; Checkstack computes its **rate** and **increase** over the window at read time, detecting counter resets (a restarted process) so they don't produce nonsense spikes.
- **Histograms** are ingested as their sum and count, so the average (for example, mean request duration) is assertable. Percentile assertions are not supported yet.

## Bounded by design

Metric label combinations can explode (a `user_id` label mints one series per user). Each stream therefore has a **series cap**: existing series always keep updating, but new series beyond the cap are dropped, counted, and surfaced as an important event and in the stream's overview, so you can fix the offending labels. Aggregates roll from minute grain to hourly grain as they age, and each tier has its own retention - growth stays bounded no matter the volume.

## Metric health checks

Attach a **Metric Stream** health check to a system and add a **Metric window** check item. The editor guides every choice:

- The **metric** field is a searchable dropdown of the names the stream has actually seen.
- **Label filters** narrow to specific series - keys and values are autocompleted from real data, and each filter row's values follow its own key.
- Assertions then run against the windowed aggregates across all matching series: latest value, average, minimum, maximum, sample count, series count, and (for counters) rate per second and total increase.

A staleness field reports the seconds since the selection last received a sample, so "this metric stopped arriving" is an ordinary assertion - meaningful from the moment the stream is created. Windows cover complete minutes plus the current one, and reads automatically span the minute and hourly storage tiers, so long windows stay accurate.

Metric names your checks reference are protected: they never vanish from the registry while a check points at them, even if the metric goes quiet.
