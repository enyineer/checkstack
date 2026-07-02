---
"@checkstack/about-common": minor
"@checkstack/about-frontend": minor
"@checkstack/ai-frontend": minor
---

Move the assistant's saved memories into a permission-gated Sheet opened from the
About page, and drop the oversized always-open memory card.

- `@checkstack/about-common` now exports a new `AboutSectionsSlot` render slot
  (with an optional `priority` metadata, like `DashboardSlot`). Plugins
  contribute self-contained, self-gating section cards to the platform About
  page without the general About page depending on any specific plugin.
- `@checkstack/about-frontend` renders `AboutSectionsSlot` on the "About
  Checkstack" page.
- `@checkstack/ai-frontend` contributes a compact "Assistant memory" section with
  a **Memories** button that opens a Sheet listing every memory the caller can
  see (their preferences plus `system` memories for systems they can read). The
  section is hidden entirely, and fires no `listMemories` request, for users
  without `ai.memory.read`.

BREAKING CHANGE (behavior): the per-system "Assistant memory" card previously
shown on a catalog system's detail page (the `SystemDetailsSlot` contribution) is
removed. Memories are still viewable and prunable from the About-page Sheet and
the existing "Assistant memory" workspace page; in-context per-system viewing on
the system detail page is no longer available. This also supersedes the earlier
patch that gated that card on `ai.memory.read` (the card no longer exists).
