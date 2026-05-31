---
"@checkstack/script-packages-frontend": minor
---

Declutter the Script Packages settings page with progressive disclosure.

The page stacked five always-open cards. The common case now stays prominent - install state plus the allowed-packages allowlist - and the advanced configuration (registry & storage summary, storage backend, satellite sync) moves into a collapsed-by-default accordion. The destructive storage-migration trigger is now guarded by a confirmation modal so it is never a single stray click.
