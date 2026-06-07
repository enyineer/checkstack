---
"@checkstack/scripts": patch
---

Pass the now-required `pluginId` option to `accessPair()` in the common plugin
template (`access.ts.hbs`). After `accessPair()` gained a required third
argument (fully-qualified access rules), scaffolded plugins no longer
typechecked out of the box. The template now supplies `{ pluginId }` (the
plugin base name), so freshly scaffolded common/backend/frontend plugins pass
typecheck again.
