---
title: "Extending the automation platform"
description: "Register triggers, actions, artifact types, and pure filters into the automation engine from your plugin."
---

A plugin contributes to the automation platform by registering definitions into the extension points during its `register()` phase. This page is the reference for each registration. Triggers and artifact types are usually registered in `register()`; actions that capture a service instance register in `init()` (where the service exists) via the same buffered extension point.

## Registering a trigger

A trigger is hook-backed (subscribes to one of your plugin's hooks) or setup-backed (manages its own emission, e.g. a cron schedule). Declare a `contextKey` extractor so the engine can scope artifact lookups and `wait_for_trigger` matches. A trigger that needs per-automation configuration declares a versioned `config` - exactly like an action's `config` (see [Registering an action](#registering-an-action)).

```ts
import { automationTriggerExtensionPoint } from "@checkstack/automation-backend";
import { Versioned } from "@checkstack/backend-api";
import { z } from "zod";

const triggers = env.getExtensionPoint(automationTriggerExtensionPoint);
triggers.registerTrigger(
  {
    id: "incident_created",
    displayName: "Incident Created",
    category: "Incidents",
    payloadSchema: z.object({ incidentId: z.string(), severity: z.string() }),
    hook: incidentHooks.incidentCreated, // hook-backed
    contextKey: (p) => p.incidentId,
  },
  pluginMetadata,
);
```

### Structured config gates (`evaluateConfig`)

A hook-backed trigger can carry an optional `evaluateConfig(payload, config)` predicate. The fan-in calls it (with the incoming payload + the per-automation trigger `config`) before starting a run; a `false` result skips that firing. It runs before the operator's template `filter`. Use it for structured triggers whose firing depends on typed config rather than a hand-written expression - the built-in `numeric_state` trigger uses it for its `above` / `below` threshold. The predicate MUST be pure and synchronous.

```ts
triggers.registerTrigger(
  {
    id: "numeric_state",
    displayName: "Numeric Threshold",
    payloadSchema: numericStatePayloadSchema,
    config: new Versioned({
      version: 1,
      schema: z.object({ field: z.string(), above: z.number().optional() }),
    }),
    hook: someCheckCompletedHook,
    contextKey: (p) => p.systemId,
    evaluateConfig: (payload, config) =>
      extractField(payload, config.field) > (config.above ?? Infinity),
  },
  pluginMetadata,
);
```

## Registering an action

An action declares a versioned config schema and an `execute`. It may `produces` one artifact type and `consumes` several. `config` arrives already template-rendered; `consumedArtifacts` is the resolved upstream artifacts keyed by their local id.

> [!IMPORTANT]
> To call another plugin's procedures, an action MUST use the
> `rpcClient` handed to `execute` - it is bound to the automation's
> `runAs` service account, so every call is authorized exactly as that
> bounded identity (access rules + team scope). Never capture the trusted
> `coreServices.rpcClient` at registration time: that bypasses the
> automation's authorization and lets a run touch resources the service
> account cannot - a privilege-escalation path. See
> [Running as a service account](/checkstack/developer-guide/backend/automations/#running-as-a-service-account).

```ts
import { automationActionExtensionPoint } from "@checkstack/automation-backend";
import { Versioned } from "@checkstack/backend-api";

const actions = env.getExtensionPoint(automationActionExtensionPoint);
actions.registerAction(
  {
    id: "create_issue",
    displayName: "Create Jira Issue",
    category: "Jira",
    config: new Versioned({
      version: 1,
      schema: z.object({ connectionId: z.string(), summary: z.string() }),
    }),
    produces: "issue", // local artifact-type id (namespaced on registration)
    execute: async ({ config, consumedArtifacts, logger, rpcClient }) => {
      // `rpcClient` is bound to the automation's `runAs` service account.
      const issue = await jira.create(config);
      return {
        success: true,
        externalId: issue.key,
        artifact: { issueKey: issue.key, issueUrl: issue.url },
      };
    },
  },
  pluginMetadata,
);
```

### Evolving a config (migrate-then-validate)

Action and trigger configs are stored UNVERSIONED, nested raw in the
`automations.definition` blob. The platform reads them with
**assume-v1-on-read**: at runtime it calls `config.parseAssumingV1(...)`
(migrate, then validate leniently), and the editor validator calls
`config.parseStrictAssumingV1(...)` (migrate, then validate strictly so
genuine typos still surface). See
[Versioned data](/checkstack/developer-guide/backend/versioned-configs/).

To retire or reshape a field, bump the config's `version` and add a
migration - never silently drop it from the schema, or stored automations
that still carry the old key will error in the editor with
`Unrecognized key`. The script plugin's `run_script` / `run_shell` actions
retired their per-action `sandbox` key (the OS sandbox is now global-only)
this way:

```ts
import { Versioned, type Migration } from "@checkstack/backend-api";

const dropSandboxMigration: Migration<Record<string, unknown>, unknown> = {
  fromVersion: 1,
  toVersion: 2,
  description: "Drop the removed per-action `sandbox` override key",
  migrate: ({ sandbox: _sandbox, ...rest }) => rest,
};

config: new Versioned({
  version: 2,
  schema: runScriptConfigSchema, // no longer mentions `sandbox`
  migrations: [dropSandboxMigration],
}),
```

A `version > 1` config MUST ship a complete migration chain back to v1; a
registry-driven contract test enumerates every registered config and fails
CI if one is missing.

### Consuming an artifact

Declare `consumes: ["issue"]` and read `consumedArtifacts["issue"]`. The convention is config-takes-priority-else-artifact, so an operator can pin a value explicitly or let it flow from upstream:

```ts
consumes: ["issue"],
execute: async ({ config, consumedArtifacts }) => {
  const upstream = consumedArtifacts["issue"] as { issueKey?: string } | undefined;
  const issueKey = config.issueKey ?? upstream?.issueKey;
  // …
},
```

## Registering an artifact type

An artifact type gives `produces` / `consumes` a typed schema. Register it in `register()` so the producing action can reference it by local id.

```ts
import { automationArtifactTypeExtensionPoint } from "@checkstack/automation-backend";

const artifactTypes = env.getExtensionPoint(automationArtifactTypeExtensionPoint);
artifactTypes.registerArtifactType(
  {
    id: "issue",
    displayName: "Jira Issue",
    schema: z.object({ issueKey: z.string(), issueUrl: z.string().url() }),
  },
  pluginMetadata,
);
```

The artifact's `data` is validated against this schema before persistence; the local id is namespaced to `{pluginId}.{id}` (e.g. `integration-jira.issue`).

## Registering a pure filter

Plugins can contribute template filters through `automationFilterExtensionPoint`. Filters MUST be pure and synchronous - the engine evaluates them inline during rendering, with no async or I/O.

```ts
import { automationFilterExtensionPoint } from "@checkstack/automation-backend";

const filters = env.getExtensionPoint(automationFilterExtensionPoint);
filters.registerFilter(
  {
    name: "percent",
    signature: "percent(decimals)",
    description: "Format a 0-1 ratio as a percentage string.",
    filter: (value, decimals) => {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) return value;
      return `${(n * 100).toFixed(typeof decimals === "number" ? decimals : 0)}%`;
    },
  },
  pluginMetadata,
);
```

A filter whose name collides with a built-in is skipped with a warning rather than overwriting it.

## Exposing reactive state

Domain state (an incident's status, a maintenance window, a system's health) is made reactive through the separate `automation.entity` extension point, not as a hand-rolled change hook. `defineEntity` is a reactive wrapper: the plugin keeps owning its state and passes a `read` accessor, and every write goes through `handle.mutate`. Resolve `entityExtensionPoint` and call `defineEntity` to get a typed, reactive entity; use `registerChangeDeriver` to map a change to the trigger event id(s) it fires, and `onEntityChanged` to react to another plugin's changes.

```ts
import { entityExtensionPoint } from "@checkstack/automation-backend";

const entity = env.getExtensionPoint(entityExtensionPoint);
const handle = entity.defineEntity({
  kind: "incident",
  state: IncidentEntityStateSchema,
  read: (ids) => incidentService.getManyEntityStates(ids),
});
```

See [the entity state machine](/checkstack/developer-guide/backend/automations/entity-state-machine/) for the full API, the non-reactive escape hatch, delivery semantics, and runnable examples.
