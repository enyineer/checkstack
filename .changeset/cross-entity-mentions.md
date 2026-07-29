---
"@checkstack/common": minor
"@checkstack/frontend-api": minor
"@checkstack/ui": minor
"@checkstack/incident-frontend": minor
"@checkstack/maintenance-frontend": minor
---

Link incidents and maintenances with `#` mentions

Typing `#` in a markdown field now opens a picker over every mentionable record
and inserts a reference. Referencing another record previously meant pasting a
URL, which cannot be right everywhere: an admin URL is meaningless on a public
status page, a status-page URL is meaningless in the admin UI, and neither works
in an email.

A mention therefore stores WHAT it points at, never where:
`[Database upgrade](checkstack:maintenance/<id>)`. That is an ordinary markdown
link - readable in the raw source, parsed unchanged by existing tooling - and
only the href is resolved per render context.

Resolution may REFUSE: a resolver returning nothing renders the label as plain
text rather than a link. That is a confidentiality property, not a nicety - an
internal-only incident referenced from a public status update must not become a
link that confirms it exists. A renderer given no resolver links nothing.

Incident and maintenance detail pages gained a **Referenced items** section,
derived by scanning the authored markdown on each render. Nothing is stored
twice, so an edit that drops a reference drops it from the list too.

The platform owns the contract (`registerMentionRoutes` / `setMentionSearch` in
`@checkstack/frontend-api`); each owning plugin registers its own type, so no
plugin imports another. Search only ever offers records the caller may read.

Scope: resolution is wired for the admin UI. Public status pages and notification
bodies do not resolve mentions yet, so a mention renders there as plain text -
the safe default above, not a broken link.

Precisely: the admin resolver maps a well-formed reference to a route WITHOUT
checking that the target still exists or that this viewer may read it, so a
mention to a deleted or unreadable record links to a not-found or an access gate.
That is deliberate - gating on the provider's fetched list would silently
downgrade valid references to plain text (the incident search excludes resolved
incidents by default), and silently dropping a valid link is worse than one that
lands on a gate the backend already enforces. The confidentiality property is
carried by the public renderers, which resolve nothing.
