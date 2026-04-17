---
"@checkstack/integration-jira-backend": minor
"@checkstack/backend-api": minor
"@checkstack/ui": minor
---

### Jira Data Center Support

Added support for on-premise Jira Data Center installations alongside existing Jira Cloud support:

- **Authentication mode switching**: New `authMode` field (`cloud` | `datacenter`) on connection configuration. Cloud uses Basic Auth (email + API token), Data Center uses Bearer Auth (Personal Access Token).
- **API version routing**: Automatically selects REST API v3 for Cloud and v2 for Data Center.
- **Description format**: Cloud uses Atlassian Document Format (ADF), Data Center uses plain text.
- **Connection schema v2**: Backward-compatible — defaults to `cloud` mode for existing connections.

### DynamicForm `x-hidden-when` Conditional Visibility

New generic platform feature for conditionally hiding form fields based on sibling field values:

- Added `x-hidden-when` metadata extension to `ConfigMeta` and `JsonSchemaProperty`.
- DynamicForm automatically hides fields and skips their validation when conditions match.
- Used by Jira integration to hide the email field when `authMode` is `datacenter`.
