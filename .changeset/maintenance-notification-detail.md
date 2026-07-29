---
"@checkstack/maintenance-backend": minor
---

Include the window and description in maintenance notifications

A maintenance notification said only `Maintenance "<title>" has been scheduled`,
which told a subscriber nothing about WHAT was planned or WHEN - every recipient
had to open the app to learn anything at all.

The body now carries the scheduled window and the maintenance description, both
of which the operator had already written.

The window renders in **UTC with an explicit suffix**: the notification pipeline
has no per-recipient timezone, so a server-local time would be silently wrong for
most subscribers and an unlabelled one would be unfalsifiable. The description is
normalised through the same sanitiser as update messages, so authored markdown
survives while control characters and blank-line padding do not.
