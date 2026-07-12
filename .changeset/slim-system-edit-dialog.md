---
"@checkstack/catalog-frontend": minor
"@checkstack/catalog-common": patch
---

Slim the "Edit System" dialog and move a system's living data onto its detail
page. The dialog was a `max-w-lg` modal mixing a deferred-save identity form
with five self-persisting panels. It now carries only the fields the Save
button persists - name, description, and custom fields - with a hint linking to
the system page for everything else. Nothing was lost; each surface moved or
already existed elsewhere:

- The detail page's sidebar sections read IDENTICALLY for every visitor (the
  compact read-only views). Managers additionally get a small pencil per
  section that opens a focused, single-purpose dialog: **Manage contacts**,
  **Manage links**, **Team access**, and **Manage dependencies** (the
  plugin-injected `SystemEditorSlot`; the slot doc reflects the new mount
  point - `@checkstack/catalog-common` patch). One small modal per concern,
  no permanently expanded forms on the page.
- **Environment membership** stays managed from the Systems-table row chips and
  the Environments tab; the redundant per-system environments picker in the
  dialog is removed.

The pencils are gated on manage capability and respect GitOps: a
GitOps-managed system shows the lock banner and hides the contacts/links
pencils (team-access grants are not GitOps-managed and stay editable). Also
fixes `SystemLinksEditor` gating its editability on the GLOBAL manage rule
only - team-scoped system managers got a read-only editor.
