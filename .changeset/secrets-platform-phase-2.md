---
"@checkstack/backend-api": minor
"@checkstack/secrets-common": minor
"@checkstack/automation-common": minor
"@checkstack/automation-backend": minor
"@checkstack/automation-frontend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/integration-script-backend": minor
"@checkstack/secrets-frontend": minor
"@checkstack/ui": minor
---

Secrets platform Phase 2: secret -> env-var mapping with central resolve, inject, and mask.

- Script consumers declare a least-privilege `secretEnv` allowlist
  (`{ ENV_NAME: "${{ secrets.NAME }}" }`). The automation `run_script` /
  `run_shell` actions resolve ONLY the declared secrets via
  `secretResolverRef.resolveForRun`, inject them into the runner env for
  that run (memory-only; the ESM runner gained a per-run `env` option), and
  mask their values out of stdout/stderr/result/error via the run-scoped
  masking context. A missing required secret fails the run clearly. No
  ambient secret access.
- Test panel: `testScript` / `testCollectorScript` inject named
  `__SECRET_<NAME>__` placeholders by default, or user-supplied per-secret
  overrides; real production values are never resolved in the test path,
  and overrides are masked out of the result.
- Healthcheck collectors carry the `secretEnv` field for authoring +
  the test panel; runtime injection on satellites lands in Phase 3.
- Editor UX: a new `@checkstack/ui` `SecretEnvEditor` renders `x-secret-env`
  record fields with `${{ secrets.* }}` name autocomplete (from
  `listSecretNames`), wired into the automation action editor and the
  healthcheck collector editor. New `withConfigMeta` helper +
  `x-secret-env` config-meta key in `@checkstack/backend-api`.
