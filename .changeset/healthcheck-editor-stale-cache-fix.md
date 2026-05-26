---
"@checkstack/healthcheck-frontend": patch
---

Fix stale healthcheck editor on reopen after save.

Deleting a collector from a healthcheck, saving, then reopening the
editor used to show the deleted collector reappear — only a full page
refresh cleared it. The editor's `getConfiguration` query was being
served stale-while-revalidate on remount, and `useInitOnceForKey`
fired with that stale value before the background refetch landed.

Setting `gcTime: 0` on the loader query drops the cached entry on
unmount, so the next mount has nothing stale to serve and the form
seeds from fresh data.

The wider rule has been written up at
`docs/src/content/docs/frontend/query-invalidation.md` (Pillar 3) and
a pointer added to `.agent/rules/code-style-guide.md`. tl;dr:
within-plugin mutations are auto-invalidated by the oRPC client (no
manual `refetch()` needed); cross-plugin mutations must invalidate
explicitly; one-shot editor forms must use `gcTime: 0` on their loader.
