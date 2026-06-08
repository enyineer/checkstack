---
title: Building automations with the assistant
description: How the chat assistant discovers real platform values, chooses integration actions vs fetch scripts, gates with side-effect-free conditions, and wires artifacts so a proposed automation actually saves and runs.
---

The chat assistant can draft a full automation, but a model that guesses at values it should source from the platform produces automations that fail to save or run. Three failure modes recur: an invented `runAs` that does not exist, a hand-rolled HTTP fetch with a placeholder URL or token instead of a configured connection, and a script return value that is never wired downstream. The platform closes all three with discovery tools the model calls before drafting, propose-time validation that rejects the bad cases with actionable messages, and a system-prompt playbook that steers the model toward the working pattern.

This page describes the end-to-end flow. The two-step gate every mutating tool goes through is documented in [Propose and apply](/checkstack/developer-guide/ai/propose-apply/); the catalog tools the model uses to learn which kinds exist are documented in [Capability catalog tools](/checkstack/developer-guide/ai/capability-catalog/).

## Discover before drafting

The model never drafts an action config from memory. It first introspects the registry, then pulls the exact schema for the action it intends to use, then resolves the real-world values that config needs. All of these tools are `effect: "read"`, so they auto-run with no confirm step.

- `automation.listCapabilities` and `automation.getCapabilitySchema` enumerate the available triggers, actions, and artifact types and return one action's full config schema. See [Capability catalog tools](/checkstack/developer-guide/ai/capability-catalog/).
- `automation.listServiceAccounts` lists the service accounts (applications) the calling user may bind as an automation's `runAs`. The list is filtered by the same `isApplicationBindable` subset check the create and update handler enforces at save time, so every id the model sees is a `runAs` it is allowed to use.
- `automation.listConnections` lists the configured integration connections, grouped by provider, optionally narrowed by a `providerId`. Each entry is a real `connectionId` the model can place in an integration action's config.
- `automation.resolveActionOptions` resolves the valid values for a dynamic-option field (one whose schema carries `x-options-resolver`), fetched live from the connection - see [Resolving dynamic field values](#resolving-dynamic-field-values).

> [!IMPORTANT]
> `runAs` is a service-account (application) id, not a free-form string. Values like `system` or `admin` do not exist and are rejected. The model must pick one returned by `automation.listServiceAccounts`.

`automation.listConnections` discovers connection-capable providers from the action catalog (`automation.listActions`, gated by the same `automation.read` rule the tool itself holds) via each action's `connectionProviderId`, not from the integration plugin's admin-only `listProviders`. It then lists each provider's connections via `integration.listConnectionSummaries`, a name-only endpoint (`{ id, providerId, name }`, no config or secrets) callable by any authenticated principal. So a caller who can read automations but lacks `integration.manage` still gets the real connection ids - not an empty list. Both reads degrade gracefully: a failed catalog fetch yields an empty result and a failed per-provider listing yields an empty connection list for that provider, so the model always gets a usable partial result instead of a hard tool error.

## Integrated systems use an integration action

When the target system has a configured integration (Jira, Teams, and so on), the automation must use that integration's action and reference a connection by id. The action resolves the stored credentials at execute time from the connection store; the model never sees or supplies a URL or token.

```json
{
  "id": "file-ticket",
  "action": "integration-jira.create_issue",
  "config": {
    "connectionId": "conn-jira-prod",
    "projectKey": "OPS",
    "summary": "{{ trigger.title }}"
  }
}
```

The `connectionId` here comes from `automation.listConnections`. A hand-rolled fetch against `jira.example.com` with a placeholder token is exactly the anti-pattern this replaces.

### Resolving dynamic field values

Many integration-action fields are NOT free-form: their valid values live in the connected system. In the editor these render as cascading dropdowns; the action's config schema marks such a field with `x-options-resolver` (and `x-depends-on` for fields that cascade). For Jira `create_issue` that is `projectKey`, `issueTypeId` (depends on `projectKey`), `priorityId`, and custom `fieldKey`s.

The model must not guess these. It resolves them with `automation.resolveActionOptions`, which fetches the live options for a field from the connection - the same source the dropdown uses - and is provider-agnostic (it reads the resolver and dependencies from the action's own schema):

```text
resolveActionOptions({ action: "integration-jira.create_issue", field: "projectKey", connectionId })
  -> [{ value: "OPS", label: "Ops (OPS)" }, ...]
resolveActionOptions({ action: "integration-jira.create_issue", field: "issueTypeId",
                       connectionId, dependencies: { projectKey: "OPS" } })
  -> [{ value: "10001", label: "Bug" }, ...]
```

For a cascading field, resolve its parent first and pass the chosen value in `dependencies`. Use the option's `value` (not the human label) in the config.

## Non-integrated systems use a fetch script

When the target system has no integration, the automation uses a script action that calls `fetch`. The script sandbox is deliberately narrow: a script receives only the event payload, upstream artifacts, variables, and `secretEnv`-injected environment values. It has no RPC client, no connection store, and no access to a configured integration's stored credentials.

So the working pattern is:

- Authentication comes from secrets. Declare them in the action's `secretEnv` mapping (`{ API_TOKEN: "${{ secrets.MY_TOKEN }}" }`) and read them from `process.env.API_TOKEN`. Never hardcode a token and never leave a placeholder.
- The URL and request parameters come from an upstream `variables` action, read in the script as `context.var.X`. Never hardcode a URL.
- Egress is blocked by default. The script can only reach hosts an operator has added to the global egress allowlist (CIDRs; cloud-metadata is always blocked, fail-closed). The assistant must tell the operator which host needs allowlisting.

```ts
const url = context.var.endpoint;
const res = await fetch(url, {
  method: "POST",
  headers: { authorization: `Bearer ${process.env.API_TOKEN}` },
  body: JSON.stringify({ message: context.var.message }),
});
return { ok: res.ok, status: res.status };
```

The model validates any script with `automation.testScript` (which fans the draft out to the same fail-closed sandbox without persisting anything) before it proposes the automation.

## Gate with a side-effect-free condition

A decision or gate is modelled as a `choose` action or a `condition_guard` over a template, never as an action that also performs I/O. Conditions are side-effect-free and cannot do network or store access. To gate on the state of an external system, the automation runs a read action first, then gates on its artifact.

For example, to avoid filing a duplicate ticket, run `integration-jira.search_issues` (a read-only action that produces an `issue_search` artifact), then gate creation on the result:

```text
{{ not artifacts.check-existing.issue_search.found }}
```

## Wire outputs with artifact references

Every action that produces output must have an `id`. Its output is then available downstream as `{{ artifacts.<actionId>.<artifactType>.<field> }}`. For a script action, the return value surfaces under `script_result.result`. An automation whose later steps reference `{{ artifacts.<id>... }}` for an `id` that does not exist, or that is not produced by an action that actually produces an artifact, is broken.

```text
{{ artifacts.file-ticket.issue.key }}
{{ artifacts.fetch-status.script_result.result.status }}
```

> [!IMPORTANT]
> The `<artifactType>` segment is required and easy to drop. An `integration-jira.search_issues` action with id `check-existing` produces an `issue_search` artifact, so its result is `{{ artifacts.check-existing.issue_search.found }}` - NOT `{{ artifacts.check-existing.found }}`. Dropping the type segment resolves to `undefined` at run time, so a gate built on it silently misfires. The exact `<artifactType>` for an action is listed by `automation.getCapabilitySchema`.

The built-in roots `trigger`, `vars`, and `now` are always available and are not artifact references.

## Propose-time validation

When the assistant calls `automation.propose`, the dry run catches these failure modes before anything is applied, surfacing each as a clear error on the review card rather than a runtime failure:

- A `runAs` that does not exist or that the caller may not bind is rejected with guidance to call `automation.listServiceAccounts`. A lookup failure degrades to a soft "could not verify" note.
- A `runAs` that is bindable but lacks the access rules an action requires (each action declares `requiredAccessRules`, e.g. `integration-jira.create_issue.manage`) is flagged per action, so the author learns on the review card that the chosen service account cannot run that action - rather than the automation failing on first run. The dispatch engine enforces the same rules at execute time.
- A `connectionId` that does not reference a real connection for the action's provider is rejected with guidance to call `automation.listConnections`. Templated connection ids are skipped, and a lookup failure degrades to a soft note.
- A literal dynamic-option value the connection does not offer (e.g. a `projectKey` or `issueTypeId` that is not a real Jira project / issue type) is rejected with guidance to call `automation.resolveActionOptions`. This reuses the same per-field resolvers, sourcing each field's dependency values from the same literal config so a cascade (issueTypeId needs projectKey) resolves. Templated values, and fields whose dependencies are templated/absent, are skipped; a resolver lookup failure is skipped rather than blocking (the connection itself is already validated), so transient provider flakiness never gates a proposal - only a definitively-invalid value is flagged.
- An unwired `{{ artifacts.<id>... }}` reference (the producer id does not exist or does not produce an artifact), or a reference whose `<artifactType>` segment does not match what the producing action actually produces (e.g. `artifacts.check-existing.found` when the action produces `issue_search`), is flagged by the definition validator, which walks configs, variables blocks, `choose` `when` clauses, and conditions. A bare whole-object `artifacts.<id>` reference, built-in roots, and literal prose are left untouched.

All of these merge into the dry-run errors and are raised before apply, so an operator reviewing the confirm card sees them up front. Existing valid automations still pass unchanged.
