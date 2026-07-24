---
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-frontend": patch
"@checkstack/dependency-backend": patch
---

Stop reporting systems as healthy when nothing has measured them

A system whose health check had never produced a run reported `healthy` - so it
showed green in the catalog, kept its group green, and read "operational" on the
public status page. A system with no checks at all did the same. For a
monitoring product that is the worst possible default: the one state you must
never invent is the reassuring one.

`getSystemHealthStatus` began each check at `healthy` and each system's
aggregate at `healthy`, then only ever downgraded. With no runs to examine,
nothing downgraded them. `HealthCheckStatus` had no way to say "not measured".

A new `SystemHealthStatus` adds `unknown` for systems and their checks. It is
deliberately NOT a run status - a run that happened is always healthy, degraded
or unhealthy, and the database enum stays three-valued. Now:

- A check with no runs is `unknown`, not `healthy`.
- A system reports `unknown` when no check contributed a signal. A system with
  one healthy check and one never-run check still reads `healthy`: it has
  positive evidence, and the unmeasured check is visible on its own page.
- The catalog reports `unknown` by OMISSION, which its group rollup already
  treats as "no signal" - so a group with an unmeasured member stops claiming to
  be healthy. That is the reported bug.
- The public status page maps it to its existing `unknown`, which is ignored for
  the overall banner unless everything is unknown. One unmeasured system no
  longer claims "operational" for itself, and does not panic the whole page.
- A first measurement records a transition with a NULL `fromStatus` - the column
  was already nullable for exactly this case - instead of pretending the system
  was healthy beforehand.
- Automations matching on `unhealthy` do not fire for a merely unmeasured
  system, which is correct: an unmeasured system is not a detected outage.

Dependency warnings deliberately keep their current behaviour: an unmeasured
upstream raises no warning, and a never-run check is dropped from the evaluation
rather than counted as passing.

Note that pausing a system's only check now leaves it `unknown` rather than
`healthy`. Paused failures still do not keep a system degraded - that behaviour
is unchanged - but with nothing running, the system is genuinely unmeasured.

Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.
