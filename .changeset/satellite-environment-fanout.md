---
"@checkstack/healthcheck-frontend": minor
"@checkstack/ai-backend": patch
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/satellite": minor
"@checkstack/satellite-common": minor
"@checkstack/satellite-backend": patch
---

Satellites run per environment, and can be scoped to specific ones

Satellites were handed no environment information at all, so every result they
reported was stored env-less. On a system with environments that meant satellite
checks contributed nothing to per-environment health - and, until the preceding
fix, were labelled "Old checks" for it.

A satellite now fans out exactly as the local executor does:

- `getAssignmentsForSatellite` resolves each assignment's effective environments
  and sends them with the assignment.
- The agent schedules ONE run per environment and reports each result with its
  `environmentId`, so per-environment history, charts and rollups include
  satellite results.
- Collectors on a satellite now receive the `environment` run-context block, so
  `{{ environment.<key> }}` templating resolves there exactly as it does locally.

**A satellite can also be scoped to specific environments.** Without that, every
satellite would probe every environment - a staging-network satellite would start
failing prod checks it has no route to, and one per-environment slice would merge
results from satellites in different networks. A new `satelliteEnvironmentIds`
map on the assignment scopes each satellite: an absent key means "all
environments" (so every existing assignment behaves exactly as before), `[]` means
one env-less run, and a list narrows to those ids. A satellite can only ever
narrow the assignment's own selector, never widen it.

Both protocol additions are optional, for version skew in either direction: an
older satellite sends no `environmentId` and its runs are stored env-less as they
always were, while an older core sends no environments and the agent falls back to
a single env-less run.

The assignment's Execution panel gains a per-satellite environment picker,
shown for each assigned satellite once the system has environments.

Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.
