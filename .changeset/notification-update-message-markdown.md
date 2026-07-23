---
"@checkstack/notification-common": minor
"@checkstack/incident-backend": patch
"@checkstack/maintenance-backend": patch
---

Render markdown in incident/maintenance update messages instead of escaping it

Thanks to @stuajnht for reporting: an email notification showed the raw
markdown of a link (`[text](url)`) instead of a clickable link. The report
placed the bug in the email renderer, but the email path was fine - it already
runs `markdownToHtml`. The damage happened upstream.

The shared `sanitizeUpdateMessage` (in `notification-common`, used by both the
incident and maintenance backends to embed the latest update in a notification
body) backslash-escaped every markdown control character and forced the message
onto a single line inside a blockquote. So a `[label](href)` link arrived as
`\[label\]\(href\)` and rendered as literal text in every channel - exactly the
symptom reported.

Update messages are authored as markdown and render as markdown on the web, so
they now do the same in notifications. `sanitizeUpdateMessage` still normalizes
the text (strips non-whitespace control characters, normalizes line endings,
collapses runs of blank lines, bounds the length) but no longer escapes the
markdown, and `buildUpdateMessageSuffix` appends it as its own multi-line
markdown block rather than a single-line blockquote. Links, emphasis, code, and
lists now render.

This does not weaken safety. The only strategy that emits HTML is SMTP, via
`markdownToHtml`, whose email-safe allow-list drops `<script>`, `on*=`
handlers, and `javascript:`/`data:` URLs; every other strategy renders markdown
/ mrkdwn / an adaptive card or flattens to plain text, none of which execute
HTML. Source-side escaping was redundant with that renderer sanitization for
the security goal while destroying legitimate formatting. The notification
title and the incident/maintenance descriptions were already interpolated into
the body unescaped, so this brings the update message in line with them.
