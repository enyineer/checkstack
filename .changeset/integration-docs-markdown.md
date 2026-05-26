---
"@checkstack/integration-frontend": patch
---

Render integration provider `setupGuide` content as markdown instead of plain text. The `ProviderDocumentation` panel was wrapping `setupGuide` in a `whitespace-pre-wrap` div, so markdown syntax (headings, links, lists, bold) shipped by providers (e.g. Jira) showed up raw in the subscription dialog. Now uses `MarkdownBlock` from `@checkstack/ui` so the same formatting providers author renders correctly.
