---
"@checkstack/integration-jira-backend": patch
"@checkstack/integration-jira-common": patch
"@checkstack/integration-teams-backend": patch
"@checkstack/integration-webex-backend": patch
"@checkstack/notification-telegram-backend": patch
---

Template autocomplete on Jira template fields, plus a sweep of dead code across integration / notification plugins.

**FIXES**

- Jira subscription dialog now offers `{{ payload.* }}` autocomplete on its three template fields (`summaryTemplate`, `descriptionTemplate`, field-mapping `template`). Each was declared as `configString({})` with empty metadata, so `DynamicForm` fell through to a plain `<Input>` and the `templateProperties` chain that `CreateSubscriptionDialog` already pipes in from the event's payload schema bypassed them entirely. Tagged all three with `"x-editor-types": ["raw"]` so they now route through `MultiTypeEditorField` → `RawEditor` (the textarea with the `{{ … }}` popup) — the same path webhook templates already used.

**INTERNAL CLEANUP — dead code removed**

Every removal here was verified with a repo-wide `grep` for external consumers; nothing in this changeset alters a public surface that anyone actually imports.

- `@checkstack/integration-jira-common`:
  - Deleted `src/rpc-contract.ts` entirely. The Jira-specific `jiraContract` / `JiraApi` (connection-CRUD endpoints — `listConnections`, `getConnection`, `createConnection`, `updateConnection`, `deleteConnection`, `testConnection`) was never registered with the backend router and had zero client consumers. All connection management goes through the generic `integrationContract` in `@checkstack/integration-common`.
  - Removed seven dead Zod schemas + their inferred types from `src/schemas.ts`: `CreateJiraConnectionInputSchema`, `UpdateJiraConnectionInputSchema`, `JiraConnectionRedactedSchema`, `JiraFieldMappingSchema`, `JiraSubscriptionConfigSchema`, `JiraConnectionSchema`, plus their `…Input` / `…Redacted` / `…FieldMapping` / `…Config` / `…Connection` type aliases. The subscription config was duplicated against the canonical, metadata-tagged version in `jira-backend/src/provider.ts`; the connection schemas were marked `@deprecated` and only referenced by the now-removed RPC contract or the deprecated function below.
  - Removed orphaned npm deps `@orpc/contract` and `@checkstack/integration-common` from the package's `dependencies` (they were only used by the deleted RPC contract).
- `@checkstack/integration-jira-backend`:
  - Removed `createJiraClientFromConnection` from `src/jira-client.ts`. The function was marked `@deprecated` ("Use createJiraClientFromConfig with generic connection management") and had zero callers; removing it dropped the last consumer of `JiraConnection` / `JiraConnectionSchema`. The modern `createJiraClientFromConfig` (using `JiraConnectionConfig` with cloud/datacenter auth modes) is the canonical entry point.
- `@checkstack/integration-teams-backend` + `@checkstack/integration-webex-backend`:
  - Removed the `// Re-export for testing` blocks from each plugin's `src/index.ts`. The Teams plugin re-exported `teamsProvider` / `TeamsConnectionSchema` / `TeamsSubscriptionSchema` / `buildAdaptiveCard`; the Webex plugin re-exported `webexProvider` / `WebexConnectionSchema` / `WebexSubscriptionSchema`. Both `provider.test.ts` files were retargeted from `./index` to `./provider`, eliminating the indirection and matching the convention used by the other backend-only integration plugins.
- `@checkstack/notification-telegram-backend`:
  - Removed the broken `bundle` field from `package.json` that referenced `@checkstack/notification-telegram-common` and `@checkstack/notification-telegram-frontend` — neither package existed (the directories were empty leftovers with no `package.json`, so not even workspace members). The empty directories were deleted; `bun install` is clean afterwards. `bunx @checkstack/scripts plugin-pack` for this plugin would otherwise have tried to bundle non-existent packages.

No tests changed behaviour. 2040 tests pass, lint + typecheck clean.
