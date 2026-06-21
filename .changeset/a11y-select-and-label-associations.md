---
"@checkstack/status-page-frontend": patch
"@checkstack/auth-frontend": patch
---

Fix accessibility labeling defects on status-page and auth forms.

Radix `SelectTrigger` renders a `combobox` whose accessible name comes from
`aria-label`/`aria-labelledby`, not from its `SelectValue` placeholder child, so
screen readers previously announced several comboboxes as unnamed. Every such
trigger in the status-page builder (system, heading level, group, visibility) and
in the auth team/scope/ownership/resource-grant pickers now carries an
`aria-label` matching its visible intent.

Form labels that were rendered as detached `<label>`/`<Label>` elements (no
`htmlFor`/`id` pairing) are now associated with their inputs, so clicking a label
focuses its field and assistive tech announces the field name. This covers the
"Create Application" dialog (Name, Description) in auth, and the status-page
builder fields (Title, Slug, Brand color, Logo URL, uptime Days, event-feed max
updates / max age). No visual or behavioral change beyond the added accessible
names and label associations.
