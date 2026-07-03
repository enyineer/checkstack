---
"@checkstack/ai-frontend": minor
"@checkstack/ai-backend": patch
"@checkstack/about-frontend": patch
---

Move the assistant memory UI onto a system's About sidebar.

The **Assistant Memories** button now lives in the About card of a system's
detail page (catalog `SystemMetaSlot`), where it belongs, instead of on the
platform "About Checkstack" page. Clicking it opens a Sheet listing the memories
the assistant has saved about that specific system. As before, the button hides
entirely - and fires no `listMemories` request - for users without
`ai.memory.read`; delete and always-apply remain server-enforced
(`ai.memory.manage`).

The platform `AboutSectionsSlot` (`plugin.about.sections`) remains available as
a general extension point for plugins to contribute self-gating section cards to
the About page; it just no longer hosts the memory button, and its About-page
comment no longer references the memory feature.

The `@checkstack/ai-backend` bundled docs index is regenerated to reflect the
updated `ai/memory.md` and `frontend/extension-points.md` content.
