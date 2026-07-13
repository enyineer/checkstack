---
"@checkstack/metricstream-frontend": minor
"@checkstack/satellite-frontend": minor
---

Surface satellite telemetry in the frontend: satellite-side scraping and
capability advertisement.

- **Scrape target "Scrape from" selector** (metricstream): the create/edit
  scrape-target dialog now offers Core (the default) or a specific satellite as
  the scrape source, so a target can be pulled from inside its own network zone
  instead of opening a firewall hole for the core. Satellites that have not
  advertised the "scrape" capability are listed but disabled with a hint
  ("This satellite has not enabled scraping"). The binding persists via the
  extended `createScrapeTarget` / `updateScrapeTarget` contract (`satelliteId`,
  `null` = core). The selector is gated on satellite read access; a stream
  manager without it still edits the target, and an existing binding is
  preserved on save. The scrape-targets table gains a "Source" column badge
  showing Core vs which satellite scrapes each target (a generic "Satellite"
  fallback when the bound satellite is unavailable or not visible to the
  caller). Bearer-authenticated targets ARE scrapable from satellites: the
  token is delivered just-in-time over the secure channel per scrape and is
  never stored on the satellite, so no operator warning is needed.
- **In-transit drop tile** (metricstream): the stream overview adds a "Dropped
  in transit" stat tile bound to `activity.droppedInTransitCount`, with a hover
  explanation ("datapoints dropped in transit from a satellite during a
  disconnect"). This is a distinct failure mode from the cardinality-cap and
  buffer-full drops - telemetry a satellite dropped from its bounded buffer
  during a disconnect, which never reached core.
- **Satellite capability badges** (satellite): the satellite list, mobile card
  and edit ("detail") surface render the satellite's advertised capabilities
  (Telemetry, Scrape, Log receivers, Syslog) as badges, with a per-capability
  explainer on the detail surface. Unrecognised capability ids from a newer
  agent degrade gracefully to a raw-id badge.

The id -> label mapping and the scrape-source selector state (core vs
satellite, disabled-satellite filtering, row badge resolution) are pure and
unit-tested.
