---
"@checkstack/ui": minor
"@checkstack/maintenance-frontend": minor
"@checkstack/incident-frontend": minor
"@checkstack/status-page-frontend": minor
"@checkstack/logstream-frontend": patch
"@checkstack/metricstream-frontend": patch
"@checkstack/tracestream-frontend": patch
---

Colour timeline dots, and fix the rail they hang from

Status-update timeline dots were uniformly grey, so the rail carried no
information. They are now toned:

- **Maintenance** dots take the update's own status. Maintenance has no severity,
  so its lifecycle is the one coloured dimension and nothing competes with it.
- **Incident** dots take the incident's SEVERITY, keeping status on a neutral
  pill. Incidents carry both an urgency and a lifecycle, and `status-tone.ts`
  gives the hue to the urgency - colouring both would put two competing scales on
  one row.
- **Public status pages** now tone the dot to match the status label already
  rendered beside it.

An update that changes nothing stays neutral, so a coloured dot always means "the
status moved here".

Also fixes the rail itself: it anchored its left EDGE at `left-4`, putting its
centre at 16.25px while every dot centres at 16px, so each dot sat a hair off the
line. The rail is now centred on the same axis, and a new exported `TimelineDot`
owns the positioning so the four separate copies of that maths cannot diverge
again.
