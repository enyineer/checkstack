---
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/ai-backend": minor
---

Add a deep `validateConfiguration` RPC to the health-check plugin so propose-time validation matches apply-time validation.

- `validateConfiguration` (`@checkstack/healthcheck-common`): a new mutation procedure gated by `healthcheck.healthcheck.manage`, taking a proposed configuration (reusing the create skeleton) and returning `{ valid, errors: [{ path, message }] }`, mirroring automation's `validateDefinition`. It persists nothing.
- Shared deep validation (`@checkstack/healthcheck-backend`): `collectConfigurationIssues` resolves strategy + collectors by fully-qualified id then migrate-then-validate-strict each config via `parseStrictAssumingV1`. The GitOps reconcile path is refactored to call the same `validateVersionedConfigStrict`, so create / gitops-apply / the new RPC share one implementation.
- `healthcheck.propose`'s dry-run (`@checkstack/ai-backend`) now calls `validateConfiguration` as its validation authority, so a wrong config type or a typo'd key surfaces at propose time, bringing it to the same deep-validate level `automation.propose` already has.

State and scale: no durable state; `validateConfiguration` is a pure read against the in-process registries plus zod validation, identical on every pod.

This is a beta minor.
