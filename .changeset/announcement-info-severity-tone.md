---
"@checkstack/announcement-frontend": patch
"@checkstack/ui": patch
---

Fix info-severity announcements rendering in the neutral grey "unknown" hue

An announcement with `info` severity mapped onto the grey `unknown` status
tone, so its severity pill, its card accent stripe and the global announcement
banner all rendered grey - reading as "inert/disabled" rather than
"informational" - on the announcements manage page, the dashboard and the
public status page widget.

`info` severity now maps to the blue `info` tone that the design system already
defines (`--status-info`) and that incidents and status pages already use.
The announcement plugin's private copy of the tone table, which was missing the
`info` entry entirely, is replaced by the shared `pillToneStyles` from
`@checkstack/ui`, and the banner now derives its classes from the same
severity-to-tone mapping as the pills instead of carrying its own switch, so the
two can no longer drift.

`pillToneStyles` gains `text`, `tint`, `border` and `tintHover` class sets per
tone (additive - existing `pill` / `dot` / `accent` are unchanged) so banner-like
surfaces can be tinted from the shared table.

Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.
