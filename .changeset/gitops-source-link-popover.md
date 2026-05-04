---
"@checkstack/gitops-common": minor
"@checkstack/gitops-backend": minor
"@checkstack/gitops-frontend": minor
"@checkstack/catalog-frontend": patch
---

Surface the source repository for GitOps-managed entities and gate the
system→group remove button on the system's lock state.

- `provenanceSchema` now carries a `sourceUrl` field, derived on the
  backend from the provider type, baseUrl, repository and filePath. URLs
  are constructed for github.com / gitlab.com and self-hosted
  GitHub/GitLab where the API base ends in `/api/v3` or `/api/v4`. Other
  baseUrls fall back to `null` so the UI keeps showing the raw path.
- New `useProvenanceLocks` hook (bulk variant of `useProvenanceLock`)
  for views that render many entities and need to look up locks
  client-side.
- New `<GitOpsSourceBadge>` popover component that replaces the bare
  GitBranch icon on system and group catalog cards. The popover
  surfaces the repository, file path, and a "View in source provider"
  deep link.
- `<GitOpsLockBanner>` repo line is now a real link when a sourceUrl is
  available.
- The system→group remove button in the catalog now disables itself
  when the system is GitOps-managed, matching the backend lock that was
  already in place.
