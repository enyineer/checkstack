---
"@checkstack/status-page-frontend": minor
"@checkstack/ui": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/api-docs-frontend": minor
"@checkstack/maintenance-frontend": minor
---

Render markdown wherever operator-authored content is shown, and give the status-update history its hierarchy back

Two reported problems on the public status page, plus the same defect found in
three more places while fixing them.

**Markdown was not rendered.** Every one of these surfaces drew authored content
with the INLINE `<Markdown>` component. That renderer exists for one-line
summaries: it maps every paragraph to a `<span>` and registers no heading, list,
blockquote, table, or code-block renderers at all. So an operator who wrote a
structured post-mortem - a `## Impact` heading, a bulleted list of affected
flows, several paragraphs - got one undifferentiated run of text with the
paragraphs collapsed onto a single line. The markdown editor's preview had been
showing them the correct rendering the whole time, because the preview uses
`MarkdownBlock`. Now fixed in:

- the public incident / maintenance detail pages (descriptions and updates),
- the public status page's event widgets,
- `StatusUpdateTimeline` in `@checkstack/ui`, which is the in-app "Status
  Updates" list on the incident and maintenance detail pages and inside their
  editor dialogs (edit-history snapshots too),
- a health-check strategy's setup guide, which is long-form prose with numbered
  steps and code blocks,
- an API-docs operation description.

**The status label sat flush against the message.** In the public page's history
list, an update's status change ("IDENTIFIED") is a small coloured label above
the message. It was an `inline-block`, and because the message beside it was also
inline, the two flowed onto the SAME line with nothing between them
("IDENTIFIEDWe have found the cause"). Fixing the markdown rendering is most of
the fix - the message is a block element now, so it cannot share the label's
line - and the label is additionally a `block` with its own bottom margin, so an
entry reads status, then message, then timestamp.

**The rail dot went near-invisible between status changes.** On the public page,
an update that changed no status drew its dot in `bg-border` - all but
invisible against the page - even though the event was plainly still in
whatever status it had last been set to. The dot now shows the status IN EFFECT
at that entry: a changeless update inherits the nearest change at or before it,
and never a NEWER one (which would paint an update "resolved" green while the
incident was still being investigated). Only an entry older than every change
in the published window - possible because the widget caps how many updates it
emits - falls back to the event's own tone, an incident's severity or a
maintenance's status.

The in-app maintenance timeline had the same hole, dropping to a flat grey
between status changes, so the carry-forward (`resolveEffectiveStatuses`) lives
in `@checkstack/ui` and both surfaces use it. `StatusUpdateTimeline` hands each
dot the status in effect as `renderDot`'s new third argument - a caller holding
one update cannot derive it, since it depends on the timeline's own sort order.
The argument is additive, so existing `renderDot` callbacks are unaffected;
in-app incidents already coloured every dot by severity and are unchanged.

The public timeline was two near-identical copies, one in the widget renderers
and one in the detail pages, which is how the same two bugs shipped in both. It
is now a single `UpdatesTimeline` component used by both, with the widget passing
the mention resolver from `StatusMentionContext` and the detail pages passing
their own. Mention resolution is unchanged everywhere: a reference still links
only when the viewer may open its target, and renders as plain text otherwise.

The one deliberate holdout is the notifications list, where a body stays inline
because that row is meant to be a compact one-liner.
