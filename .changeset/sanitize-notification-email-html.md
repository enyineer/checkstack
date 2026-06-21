---
"@checkstack/backend-api": patch
---

fix(backend-api): sanitize notification email HTML

`markdownToHtml()` now sanitizes its output with an email-safe allow-list before
returning. Notification bodies can be influenced by operator- or user-controlled
content (incident titles/descriptions, integration payloads), and `marked` does
not sanitize, so the rendered HTML could previously carry `<script>`, `on*`
event-handler attributes, or `javascript:`/`data:` URLs into an email body.

The sanitizer keeps ordinary formatting (emphasis, lists, tables, code,
headings, and `http`/`https`/`mailto` links) and removes anything executable,
matching the intent the frontend already enforces with `rehype-sanitize`. A new
`sanitizeEmailHtml()` helper is exported for reuse.
