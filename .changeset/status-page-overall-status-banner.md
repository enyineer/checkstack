---
"@checkstack/status-page-common": minor
"@checkstack/status-page-backend": minor
"@checkstack/status-page-frontend": minor
---

feat(status-pages): page-wide overall-status summary banner

The public status page now shows a page-wide status banner at the top,
summarising the whole page in one line (for example "All systems
operational" or "Major outage").

- `status-page-common` gains a pure, fully unit-tested
  `deriveOverallStatus({ blocks })` plus an `OverallStatusSummary`
  (`{ status, label }`) zod schema/type. The summary reuses the existing
  public status vocabulary (`operational` / `degraded` / `partial_outage`
  / `major_outage` / `maintenance` / `unknown`).
- The published-page DTO (`PublishedStatusPageSchema`) now carries a
  required `overallStatus` field. The backend resolver derives it from the
  blocks it already resolves - worst-status-wins over each block's public
  DTO - so it adds no new data exposure and no domain-plugin dependency
  (it reads only the field-allow-listed widget output the resolver already
  produces).
- `status-page-frontend` renders the banner at the top of the public page
  (shared by the in-app and custom-domain surfaces) using the existing
  semantic status tokens, so the banner always matches the widgets below.

BREAKING: `PublishedStatusPageSchema` now requires `overallStatus`.
Consumers that build a `PublishedStatusPage` by hand must include it; the
status-page resolver populates it automatically.
