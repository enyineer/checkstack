---
"@checkstack/satellite-common": minor
---

Extend the satellite protocol for script-package distribution: the
`authenticated` / `config_updated` payloads now carry an optional
`scriptPackagesLockfileHash` (the durable convergence backstop), a new
`refresh_script_packages { lockfileHash }` core->satellite control push,
and a new `script_package_sync_state` satellite->core report message. All
additions are optional / additive, so existing satellites and protocol
tests are unaffected.
