---
"@checkstack/ui": patch
---

Give `<DialogContent>` real vertical breathing room between its
children. The previous `gap-4` on `<DialogContent>` was a no-op because
the children were rendered inside a single inner wrapper, so
`<DialogHeader>`, the body, and `<DialogFooter>` all stacked tight
against each other. The inner wrapper is now a flex column with
`gap-6`, so headers/descriptions, body content, and footer buttons sit
apart at the dialog level without callers having to add
`<div className="space-y-…">` themselves.
