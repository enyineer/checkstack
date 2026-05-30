---
"@checkstack/integration-jira-backend": minor
"@checkstack/integration-teams-backend": minor
"@checkstack/integration-webex-backend": minor
"@checkstack/integration-frontend": minor
"@checkstack/automation-backend": minor
"@checkstack/automation-common": minor
"@checkstack/automation-frontend": minor
"@checkstack/frontend-api": minor
---

feat(automation): connection picker for integration actions + restore Integrations menu

Connection-backed automation actions (Jira, Teams, Webex) now render a
working connection picker plus cascading provider dropdowns in the
visual editor, and the Integrations entry is back in the user menu.

**Contract.** `ActionDefinition` gained an optional
`connectionProviderId` (and it is surfaced on `ActionInfoSchema` and
mapped in the `listActions` router). It carries the integration
provider's fully-qualified id, derived from the provider plugin's own
`pluginMetadata.pluginId` (never a hardcoded string), so the editor
knows which provider backs an action's dropdowns and it matches the
`qualifiedId` the integration provider registry assigns.

**Providers.** Jira, Teams and Webex each export
`*_PROVIDER_LOCAL_ID` / `*_PROVIDER_QUALIFIED_ID`, register their
provider with the local id, and add a `CONNECTION_OPTIONS`
(`"connectionOptions"`) resolver name. Their `post_message` /
issue actions set `connectionProviderId` and expose `connectionId`
as an `x-options-resolver` dropdown instead of a hidden field.

**Frontend bridge.** A new `useConnectionOptionResolvers` hook
(`@checkstack/automation-frontend`, which now depends on
`@checkstack/integration-common`) turns an action's
`x-options-resolver` schema fields into live data: the
`connectionOptions` resolver lists the provider's connections via
`listConnections`, and every other resolver name is forwarded to
`getConnectionOptions` for the selected `connectionId`, passing the
live form values as `context` for dependent fields. `ProviderActionBody`
now passes this map to `DynamicForm` (it was previously missing
entirely, so connection-backed actions had no working dropdowns).

**frontend-api.** `usePluginClient` procedures now also expose a typed
imperative `.call(input)` alongside `.useQuery` / `.useMutation`, for
async callbacks that cannot host a hook (such as a `DynamicForm`
options resolver). Additive, non-breaking.

**Integrations menu.** Re-added `IntegrationMenuItem` and a new
`IntegrationsLandingPage`, wired into `integration-frontend` as a list
route and a `UserMenuItemsSlot` entry under the "Configuration" group.

**Action card polish.** The action editor's secondary metadata (id,
description, failure behaviour) is now grouped into one quiet settings
panel with consistent small uppercase "eyebrow" labels, so the action's
own configuration stays the focal point. The raw failure checkbox was
replaced with the standard `Checkbox` control, and the provider action
picker / configuration sections gained consistent section headers and a
divider. The per-step "type" dropdown was removed: an action's kind is
fixed at creation, so changing it now means adding a new step and
deleting the old one (avoids the surprising full-config reset that
switching kinds used to trigger).

**Add-step picker.** Adding a step now opens a Home-Assistant-style
dialog where the operator decides the step type up front: an "Actions"
tab lists the registered provider actions grouped by category
(searchable; picking one presets the step's `action`), and a "Blocks"
tab lists the structural building blocks (choose / parallel / repeat /
etc.). Because the concrete action is chosen here, the in-card action
switcher was removed - a step's action is fixed once created. Composite
blocks now start with an empty child list (filled via the nested
add-step picker) instead of seeding an unconfigurable empty action.
