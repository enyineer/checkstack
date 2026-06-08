---
"@checkstack/integration-common": minor
"@checkstack/integration-backend": minor
"@checkstack/automation-backend": minor
"@checkstack/automation-frontend": minor
---

feat(ai): let the assistant resolve dynamic integration-action field values

Integration action fields like Jira `create_issue`'s `projectKey`, `issueTypeId`,
and `priorityId` are not free-form - their valid values come from the connected
system (the editor renders them as cascading dropdowns via `x-options-resolver`).
The AI assistant had no way to fetch those values, so it guessed, and propose-time
validation never checked them - a fabricated `projectKey` only failed at runtime.

- **New user-callable `integration.resolveConnectionOptions` RPC** (the non-admin
  counterpart of `getConnectionOptions`, mirroring `listConnectionSummaries`), so
  automation authors and the assistant can resolve a field's options without
  `integration.manage`. Returns option labels/values only.
- **New `automation.resolveActionOptions` AI tool**: resolves a field's valid
  values live from the connection, the same source the editor dropdown uses. It
  is provider-agnostic (reads the field's resolver and `x-depends-on` from the
  action's own schema) and dependency-aware - for a cascade like `issueTypeId`
  (depends on `projectKey`), the model resolves the parent first and passes it in
  `dependencies`.
- **Propose-time options validation**: `automation.propose` now checks every
  literal dynamic-option value against the live options for its connection
  (sourcing each field's dependency values from the same config so cascades
  resolve), flagging values the connection does not offer with guidance to call
  `automation.resolveActionOptions`. Templated values and fields with
  templated/absent dependencies are skipped; a resolver lookup failure is skipped
  rather than blocking, so transient provider flakiness never gates a proposal.

- **Automation editor works for non-admins**: the editor's option-resolver
  bridge now calls the user-callable `listConnectionSummaries` /
  `resolveConnectionOptions` instead of the admin-gated `listConnections` /
  `getConnectionOptions`, so an automation author without `integration.manage`
  gets working connection pickers and cascading dropdowns instead of empty/
  forbidden ones.

The resolver lookup and the dependency handling are factored into reusable
helpers that work for any provider's `x-options-resolver` fields.
