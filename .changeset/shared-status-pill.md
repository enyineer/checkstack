---
"@checkstack/ui": minor
"@checkstack/announcement-frontend": patch
"@checkstack/incident-frontend": patch
"@checkstack/maintenance-frontend": patch
"@checkstack/healthcheck-frontend": patch
"@checkstack/notification-frontend": patch
"@checkstack/script-packages-frontend": patch
"@checkstack/status-page-frontend": patch
"@checkstack/dependency-frontend": patch
---

Consolidate eight status pills into one

`StatusPill` moves into `@checkstack/ui`. It replaces six near-identical local
components (announcements, incidents, maintenance, health checks, notifications,
script packages) and three hand-rolled inline chips (the public status page's
event card and event detail page, the announcements status widget). They
differed only in whether they took `label` or `children`, whether they forwarded
`className`, and whether they set `shrink-0` - they agreed on everything that
mattered, which is why they collapse cleanly.

The shared pill absorbs the variations rather than flattening them:

- `tone="neutral"` for a state that deliberately carries no hue, read from its
  label alone. This was hand-rolled in three places after the "at most one
  coloured dimension per row" rule landed. It drops the dot, since with no hue
  to encode a grey dot adds nothing.
- `size="sm"` for dense contexts - a public event card, a widget list - which
  previously meant inline `text-[11px]` chips.
- `shrink-0` is now unconditional: a pill squashed by a greedy sibling is
  unreadable, and its text is the accessible encoding of the status.

Domain plugins keep their thin wrappers (`HealthStatusPill`,
`getIncidentSeverityBadge`, ...) because mapping a domain value to a tone and a
label IS domain knowledge - only the chip moved.

Also removes two related duplications found in the same sweep: the dependency
plugin hand-wrote the pill's classes inline in a `getImpactBadge` switch
duplicated across its alert banner and its editor (now one `ImpactBadge`
component over the tone mapping its own logic module already owned), and its
private tone table now sources the triad from the shared one.

`status-page-frontend`'s local `StatusPill` is renamed `PublicStatusPill`: it is
keyed by the public status enum and draws from that enum's own visual tokens, so
it is a genuinely different component and the name now says so.
