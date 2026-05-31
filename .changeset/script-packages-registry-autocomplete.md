---
"@checkstack/script-packages-common": minor
"@checkstack/script-packages-backend": minor
"@checkstack/script-packages-frontend": minor
---

Add live, backend-proxied npm package-name autocomplete and version lookup to the Script Packages "Allowed packages" form.

The package-name field now searches the configured registry as you type (debounced). The version field suggests the package's published versions newest-first, defaulting to the registry's `latest` dist-tag while staying free-typeable for an exact manual pin. Picking a package now auto-fills its version (from the search hit, then upgraded to `latest`) instead of clearing the field, and the version dropdown stays open so a version is actually selectable.

This is fully backend-proxied so it reuses the SAME configured registry + auth the install path uses: the registry can be private with a server-side-only auth token (the client only ever sees `hasAuthToken`), and browsers can't reach arbitrary registries due to CORS.

- `@checkstack/script-packages-common`: two new `manage`-gated query procedures - `searchPackages` (input `{ text }`, output `{ items: [{ name, version?, description? }] }`) and `getPackageVersions` (input `{ name }`, output `{ versions, distTags? }`). Output `version`/`versions` are relaxed to plain strings so valid-but-unusual registry versions surface as suggestions; strict `PackageVersionSchema` validation still applies on `addPackage`.
- `@checkstack/script-packages-backend`: new `registry-client` (fetch-based, AbortController timeout, size cap, zod-validated registry responses, scoped-registry selection, tolerant semver-descending sort, a best-effort pod-local read cache that is never a source of truth, and errors that never leak the auth token). Search results use the registry's own relevance ranking from `-/v1/search`. The registry + token resolution used by the install path is factored into a shared `resolveRegistryRequestConfig` helper reused by both the new RPC handlers and the installer.
- `@checkstack/script-packages-frontend`: the package and version inputs become live comboboxes (Popover + Input) with inline pinned-version validation before "Add" is enabled. Selecting a suggestion routes through a dedicated `onSelect(hit)` callback (separate from manual-typing `onValueChange`) so a pick auto-fills the version instead of clearing it; the popover dismissable layer ignores interactions originating on the anchor input, fixing the version dropdown that previously opened then immediately closed. The version-autofill decision logic is extracted into a pure, unit-tested helper.

State & scale: the registry-client TTL cache is an explicitly non-authoritative, pod-local best-effort read cache (search/version lookups are non-authoritative reads); a cache miss on another pod simply re-fetches, so pod-local divergence is harmless. No new durable state of record is introduced.
