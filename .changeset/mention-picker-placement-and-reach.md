---
"@checkstack/ui": minor
"@checkstack/frontend-api": minor
"@checkstack/incident-frontend": minor
"@checkstack/maintenance-frontend": minor
---

Fix the `#` mention picker's placement, and let it reach descriptions and closed records

Three reported problems with cross-entity mentions, all in the authoring half.

**The picker was clipped by the editor.** It rendered as a `position: absolute`
list inside the write pane, which put it inside the editor shell's
`overflow-hidden` (that shell exists to keep the textarea's corners rounded). A
picker taller than the field - the normal case, since the field defaults to
three rows - had its top rows painted away, and it was drawn straight over the
text being typed. It is now a Radix `Popover` anchored to the textarea, the same
floating layer every other combobox in the kit uses: it portals out of the
clipping ancestor, flips above the field when there is no room below, and
inside a modal Dialog portals into the dialog content so the scroll-lock does
not freeze its internal scrolling. Focus stays in the textarea throughout.

Worth noting for anyone writing a similar guard: `toBeVisible()` cannot catch
this. An ancestor's `overflow: hidden` clips painting without changing the
element's layout box, so a fully clipped list still reports visible at a
plausible size and position - which is how it shipped. The new e2e assertion is
on containment and geometry instead.

**`#` only worked in update messages.** Incident and maintenance DESCRIPTIONS -
the same `MarkdownEditor`, on both the create and edit dialogs - swallowed `#`
with no picker, leaving a literal `#Foo`. The asymmetry was invisible from
either side, because the renderer had always handled descriptions (the
description is one of the documents fed to `useMentionResolution`), so such a
reference would have resolved fine on the detail page; there was simply no way
to author one.

**Closed records could not be mentioned.** The picker asked for open records
only, so the moment an incident was resolved or a window completed, every
reference to it became unauthorable - exactly when you most want one
("recurrence of #Checkout degraded" in the follow-up). Resolved, completed and
cancelled records are now offered, and ranked strictly behind everything still
live so they cannot crowd out active ones as they accumulate. Note the
deliberate trade this makes: because active-first outranks relevance, hunting a
closed record by name will not surface it while eight active records also match
the query - a few more characters resolves it.

`filterMentionCandidates` moves to `@checkstack/frontend-api`, next to
`MentionSuggestion`. It previously existed as a byte-identical copy in
`incident-frontend` and `maintenance-frontend`, untested in both; two copies of
a ranking rule drift the moment one is tuned, and the picker would then order
incidents and maintenances differently within the same dropdown.
`MentionSuggestion` gains an optional `isActive`, which drives ordering only and
is treated as active when omitted.
