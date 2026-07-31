---
"@checkstack/ai-backend": patch
---

Regenerate the docs index for the updated status pages and markdown editor pages

The status-pages architecture guide now documents which markdown renderer a
public surface must use for operator-authored content and the shared
`UpdatesTimeline` behind the event history. The markdown-editor guide gains the
general rule - render a saved editor value with `MarkdownBlock`, never the
inline `Markdown` - and why the wrong choice passes review unnoticed.
