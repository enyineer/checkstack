---
"@checkstack/auth-frontend": patch
"@checkstack/automation-frontend": patch
"@checkstack/integration-frontend": patch
---

fix: make data tables responsive on narrow viewports

The users, teams, and roles management tables (auth-frontend), the automation
run-history table (automation-frontend), and the integration provider
connections table (integration-frontend) previously overflowed horizontally on
phone-width (~375px) viewports. Each now uses the `ResponsiveTable` +
`MobileCardList` dual-layout primitive from `@checkstack/ui`: the existing table
renders unchanged on `sm` and up, with a stacked per-row card surfacing the key
fields and action buttons below `sm`. Shared per-row rendering (role checkboxes,
team/role/connection action buttons, connection status) was lifted into small
local components so both layouts stay in sync.
