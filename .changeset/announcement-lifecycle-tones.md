---
"@checkstack/announcement-frontend": patch
---

Give announcement lifecycle states deliberate colours instead of accidental grey

"Scheduled", "Expired" and "Inactive" all fell through a `default:` arm in
`statusToTone` to the neutral grey `unknown` tone, so a scheduled announcement
was indistinguishable from an inert one and none of the three had been chosen
on purpose.

Colour is now split by what it answers:

- **A row is coloured by its SEVERITY.** The manage table's leading dot and the
  mobile card's accent stripe follow the announcement's severity (info blue /
  warning amber / critical red), matching the banner, the dashboard card and
  the status-page widget, which already worked this way.
- **A row's lifecycle is stated in words.** The Status column is now a neutral
  pill (`Active` / `Scheduled` / `Expired` / `Inactive`), so it no longer puts a
  second, competing colour scale on the same line.
- **The stat strip above the table keeps lifecycle colour**, because each card
  IS a lifecycle bucket: active stays green, scheduled becomes informational
  blue (deliberately not amber, which means "degraded" everywhere else and would
  make a correctly scheduled announcement read as a fault), and expired and
  inactive stay grey - the tone the design system defines for inert states -
  now by explicit decision. The cards keep their neutral border and carry the
  tone on the existing left accent stripe.

Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.
