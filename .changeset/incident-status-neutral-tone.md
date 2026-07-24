---
"@checkstack/incident-frontend": patch
"@checkstack/ui": patch
---

Stop incidents colouring both severity and status

An incident row showed a coloured severity AND a coloured status, putting two
competing colour scales on one line - a red "Investigating" beside an amber
"Major" reads as a contradiction rather than as two independent facts. The
lifecycle is now stated in words on a neutral pill, so severity alone carries
the row's hue.

This is what the PUBLIC status page has always done with the same incident
(severity tinted, status on a muted chip), so the internal manage, detail,
overview and system-history views now agree with what a customer sees.

`presentIncidentStatus` no longer returns a tone at all. Nothing consumed it
once the badge went neutral, and a returned-but-unused tone is exactly how the
status gets re-coloured later.

The rule this follows is now written down on the shared tone module: at most ONE
coloured dimension per row. A domain with both an urgency (severity) and a
lifecycle (status) gives hue to the urgency; a domain with only one gives it the
hue - which is why maintenance, health checks, SLOs and gitops syncs keep their
coloured status, having no severity to compete with.
