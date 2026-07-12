---
"@checkstack/ui": minor
"@checkstack/auth-frontend": patch
---

Opaque card surfaces and a heading opt-out for dialog-hosted editors:

- `TeamAccessEditor`'s compact container now carries its own `bg-card`
  background. It was a bordered box with no background - fine inside the old
  opaque dialog, but transparent when mounted on a page with a decorative
  backdrop (the detail pages' grid bled through the content). Card-like
  containers must always declare their own opaque background.
- `LinksEditor` gains an optional `hideTitle` prop so hosts whose own title
  already names the surface (e.g. a "Manage links" dialog) can suppress the
  built-in heading; the description still renders. Default behavior is
  unchanged.
