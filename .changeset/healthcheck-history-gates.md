---
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/anomaly-frontend": patch
---

Align the health-check run-history gates end to end. The history surfaces had a
three-way drift: the route allowed `configuration.read`, the page required
manage capability, and the procedures required the standalone
`healthcheck.details` rule - so global read-rule holders reached a page that
denied them, and team-scoped managers passed the page gate but got 403s from
every data call.

Detailed run history is now a MANAGER surface everywhere, with system owners
included: access requires global `configuration.manage`, a team manage grant
on the CONFIGURATION, or manage access to the SYSTEM - a system's owning team
sees every run of that system, whoever owns the configuration.

- Routes, pages, drawer links, and the anomaly/health signals gate on the
  manage capability (with `catalog.system` as the parent type); the drawer and
  chart hook check the caller's grant on the specific configuration OR system.
- All three history procedures (`getDetailedHistory`,
  `getDetailedAggregatedHistory`, `getRunById`) are authorized in the handler
  via a shared fail-closed module (`history-access.ts`) - the triple-OR is not
  expressible with the declarative instanceAccess modes. `getRunById`
  authorizes against the fetched run's own configuration/system, and answers
  `undefined` for unauthorized callers so run ids don't leak existence.
- The feed (`getDetailedHistory`) scopes team callers to runs of their
  configurations UNION runs of their systems, with correct pagination totals.

BREAKING CHANGES:

- The standalone `healthcheck.details` access rule is REMOVED. Roles that held
  `details` without `configuration.manage` lose access to detailed run data;
  grant them the manage rule (or a team grant on the configuration/system)
  instead. Stale role rows referencing the removed rule are inert.
- `getDetailedAggregatedHistory` is `authenticated` (was `public`); anonymous
  callers could never pass its access rule anyway.
