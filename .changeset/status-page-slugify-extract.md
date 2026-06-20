---
"@checkstack/status-page-frontend": patch
---

Extract the status-page create-dialog `slugify` helper into a tested module.

The "New status page" dialog already auto-fills the slug from the title until the
operator edits the slug themselves. That derivation logic lived inline in
`StatusPagesListPage.tsx` with no test coverage. It now lives in
`src/utils/slugify.ts` with unit tests (`slugify.test.ts`) covering lowercasing,
hyphenation, invalid-character stripping, leading/trailing-hyphen trimming, and
empty input. No behavioral change: the title-to-slug prefill and the
edit-the-slug-to-stop-overriding flow are unchanged.
