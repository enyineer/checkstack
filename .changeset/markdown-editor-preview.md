---
"@checkstack/ui": minor
"@checkstack/incident-frontend": minor
"@checkstack/maintenance-frontend": minor
"@checkstack/announcement-frontend": minor
---

Markdown editor with a live preview tab and formatting toolbar

Markdown fields were plain textareas with a "Markdown supported" hint, so an
author found out how their text rendered only after saving - or, for a
notification, after it had already been delivered.

New `MarkdownEditor` in `@checkstack/ui`: Write / Preview tabs plus a toolbar
(bold, italic, link, code, lists, quote). Adopted by the incident and maintenance
update forms and descriptions, and the announcement message.

The preview renders through `MarkdownBlock` - the same component, remark/rehype
chain and sanitiser used for the saved content. A second renderer here would be
free to drift, and a preview that disagrees with the real render is worse than no
preview.

Toolbar marks toggle rather than only adding, and mark lengths are matched
exactly so italic (`*`) never claims bold's (`**`) delimiters and silently
downgrades an author's emphasis.

Note for adopters: `MarkdownEditor` wraps its textarea, so `required` on it does
nothing - gate submission explicitly instead.
