---
"@checkstack/backend": patch
---

Pin patched `brace-expansion` and `tar`

The dependency-graph gate fails on any transitive vulnerability that has an
upgrade path, and every typecheck/lint/test/e2e job `needs:` that gate - so two
fixable CVEs were blocking the entire suite:

- `brace-expansion` 5.0.7 -> 5.0.8 (HIGH, CVE-2026-14257)
- `tar` 7.5.20 -> 7.5.21 (MEDIUM, GHSA-r292-9mhp-454m)

Pinned through the existing `overrides`/`resolutions` blocks, the same mechanism
already used for `minimatch`, `ws`, `adm-zip` and `fast-uri`.
