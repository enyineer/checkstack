---
"@checkstack/status-page-frontend": patch
---

Status pages: render the optional "Block heading" (label) on content widgets.
Text, Heading, Links, and Image blocks previously dropped the per-block heading
on the public page (only status widgets, which wrap in a titled section, showed
it); they now render it consistently.
