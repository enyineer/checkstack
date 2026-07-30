---
"@checkstack/common": minor
"@checkstack/frontend-api": minor
"@checkstack/incident-common": minor
"@checkstack/incident-backend": minor
"@checkstack/incident-frontend": minor
"@checkstack/maintenance-common": minor
"@checkstack/maintenance-backend": minor
"@checkstack/maintenance-frontend": minor
"@checkstack/status-page-common": minor
"@checkstack/status-page-backend": minor
"@checkstack/status-page-frontend": minor
"@checkstack/notification-common": minor
"@checkstack/frontend": minor
"@checkstack/ai-backend": patch
---

Resolve `#` mentions on public status pages, and check viewability in the admin UI

Cross-entity mentions previously resolved only in the admin UI, and did so
without asking whether the reader could actually open the target. Public
surfaces resolved nothing at all. Three changes, one per delivery context.

**The admin UI now checks viewability.** `useMentionResolution({ documents })`
collects the references a page is about to render and asks each owning plugin -
in ONE batched request - which of them this viewer may read. A mention to a
deleted or unreadable record now renders as plain text instead of a link to a
not-found page or an access gate. Backed by new `resolveIncidentRefs` /
`resolveMaintenanceRefs` procedures, which return ids only (so an unreadable
record is indistinguishable from a deleted one) and carry the same `listKey`
read post-filter as their list procedures. They are deliberately not a filter
over the authoring search list, which hides resolved incidents and would
silently downgrade valid references.

**Public status pages now resolve mentions.** A reference becomes a link to the
target's public detail page when - and only when - the same page publishes that
target, which is exactly the anti-enumeration gate the detail pages already
apply. So an operator writing "caused by #Database upgrade" in a public update
gets a working link, while a mention of an internal-only incident stays plain
text rather than becoming a link that confirms it exists. Widgets opt in by
declaring a `mentionType`, so the status-page packages take no dependency on any
domain plugin.

**BREAKING CHANGE (behavioural, no API change):** the in-app public status page
at `/statuspage/view/<slug>` now builds detail-page hrefs. Previously it passed
none, so incident and maintenance titles rendered as plain text there while the
same page on a custom domain linked them. Both now behave identically.

**Notification bodies no longer leak the internal scheme.** `checkstack:` is
meaningless outside a Checkstack renderer, and channels leaked it differently:
the email sanitiser stripped the href and left a dead anchor, while Slack's
mrkdwn emitted `<checkstack:maintenance/9f1c-abc|Database upgrade>` straight to
the recipient (Discord, Telegram and Teams render markdown natively and would
have passed it through too). `sanitizeUpdateMessage` now flattens every mention
to its label before the body reaches any channel, so no channel has to know the
scheme exists. Flattening also happens before the length bound, so the excerpt
budget is spent on visible text rather than on an internal URI.
