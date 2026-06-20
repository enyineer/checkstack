---
title: The system.issues tool and system-signals contributors
description: How the system.issues AI tool aggregates "needs attention" signals across plugins, and how a plugin contributes its own problem signals via the systemSignalsExtensionPoint.
---

`system.issues` is the single "what is wrong right now" read tool. In ONE call it returns every current problem across all systems - failing health checks, breaching or at-risk SLOs, active anomalies, open incidents, active maintenances, and dependency problems - grouped by system. The model is told to reach for it FIRST whenever asked whether there are issues, what is down, or for an overall health overview, before any per-domain tool.

The tool itself owns no domain knowledge. It fans out across every backend `SystemSignalsContributor` that plugins register through the `systemSignalsExtensionPoint`, merges their per-system maps, and shapes the result for the model. `ai-backend` imports no capability plugin's `*-common` to do this - the dependency direction is always plugin -> `@checkstack/ai-backend`, exactly like [registering tools](/checkstack/developer-guide/ai/registering-tools/).

## The contributor contract

A contributor returns problem signals for ALL systems globally, keyed by systemId, scoped to what the calling principal may see. This mirrors the frontend `SystemSignalsSlot`: where a frontend plugin's React filler computes per-system `SystemSignal[]` from a bulk RPC, a backend plugin registers a contributor that computes the same signals server-side for the aggregator.

```ts
import type { AuthUser } from "@checkstack/backend-api";
import type { SystemSignalsMap } from "@checkstack/catalog-common";

interface SystemSignalsContribution {
  /** False when the principal lacks this source's access (signals are empty). */
  accessible: boolean;
  signals: SystemSignalsMap;
}

interface SystemSignalsContributor {
  /** Stable id of the source, e.g. "incident" / "slo" / "healthcheck". */
  sourceId: string;
  /**
   * Return problem signals for ALL systems globally, keyed by systemId, scoped
   * to what `principal` may see, plus whether the principal could read this
   * source at all. When access is denied, return
   * `{ accessible: false, signals: {} }` (never a throw).
   */
  read(context: { principal: AuthUser }): Promise<SystemSignalsContribution>;
}
```

`SystemSignalsMap` is `Record<string, SystemSignal[]>` from `@checkstack/catalog-common`. Only systems that currently have a problem appear in the map; healthy systems are simply absent. The aggregator drops the link/icon fields the model does not need (`href`, `accessRule`, `iconName`) and keeps `source` / `tone` / `label` / `detail` / `since`.

Returning `accessible` lets the aggregator tell "checked and clear" apart from "skipped for lack of permission". The tool output therefore includes `checkedSources`, `inaccessibleSources`, and `failedSources` (a contributor that threw), and the model is instructed to tell the operator when a source could not be checked rather than implying everything is clear.

## The per-source access gate

The `system.issues` tool is gated by `catalog.system.read`, but that only controls whether the tool runs at all. Per-source visibility - the global rule AND per-system team grants - is applied for you by `createGatedSystemSignalsContributor`. Build your contributor with it instead of hand-rolling the gate: pass your source's read `accessRule`, a `SystemAccessResolver`, and a `readSignals` that returns problem signals for ALL systems globally. The factory then:

- lets a principal holding the global rule (and a trusted `ServiceUser`, mapped to the wildcard) see every system the source reports;
- filters a real user / application WITHOUT the global rule to the systems its TEAM grants allow - the SAME `listAccessibleObjectIds` instance/team filtering the matching bulk RPC applies - so `system.issues` never under- or over-reports relative to the per-domain UI;
- returns `{ accessible: false, signals: {} }` (never throws) for any other principal without access, and reports the source as inaccessible.

It does not call `readSignals` for a principal that can see nothing.

```ts
import {
  createGatedSystemSignalsContributor,
  type SystemAccessResolver,
  type SystemSignalsContributor,
} from "@checkstack/ai-backend";
import {
  incidentAccess,
  INCIDENT_SIGNAL_SOURCE_ID,
  deriveIncidentSignals,
} from "@checkstack/incident-common";
import type { IncidentService } from "./service";

export function createIncidentSignalsContributor({
  service,
  resolver,
}: {
  service: Pick<IncidentService, "listOpenIncidentsBySystem">;
  resolver: SystemAccessResolver;
}): SystemSignalsContributor {
  return createGatedSystemSignalsContributor({
    sourceId: INCIDENT_SIGNAL_SOURCE_ID,
    accessRule: incidentAccess.incident.read,
    resolver,
    // Global read: problem signals for EVERY system. The factory applies the
    // access gate (global rule + per-system team grants) on top.
    readSignals: async () => {
      const incidentsBySystem = await service.listOpenIncidentsBySystem();
      return deriveIncidentSignals({
        incidentsBySystem,
        systemIds: Object.keys(incidentsBySystem),
      });
    },
  });
}
```

## Share the deriver with the frontend

A signal must look the same whether it comes from the backend aggregator or the dashboard's frontend filler. Put the pure mapping - the function that turns domain rows into `SystemSignal[]` - in your plugin's `*-common` package and have BOTH the frontend filler and the backend contributor call it. The deriver stays dependency-free (it imports only types and `resolveRoute`), so it is trivially unit-testable and the two surfaces can never drift.

## Register the contributor

Register ONE contributor from your plugin's own `init`, after the service it reads is bound, through the same extension point external plugins use.

```ts
import {
  systemSignalsExtensionPoint,
  createSystemAccessResolver,
} from "@checkstack/ai-backend";

// in registerInit({ init }), with `rpcClient` from coreServices.rpcClient:
env.getExtensionPoint(systemSignalsExtensionPoint).contribute(
  createIncidentSignalsContributor({
    service,
    resolver: createSystemAccessResolver(rpcClient),
  }),
);
```

`ai-backend` accumulates every contributor into the same array the `system.issues` tool reads at execute time, so a contributor registered during any plugin's `init` is visible by the time the tool runs.

## State and scale

A contributor's `read` MUST resolve from shared, durable storage - the plugin's own Postgres tables or a derivation of them - so the answer is identical on every pod. Never read from process-local or in-memory state: the tool can execute on whichever pod handles the request, and a value written on one pod would be invisible to another, returning stale or empty issues. This is the same constraint reactive entity reads follow.

## Why ai-backend stays plugin-agnostic

The aggregator is pure machinery: collect contributors, merge their maps, shape the output. It knows nothing about incidents, SLOs, or health checks. Each domain owns its source id, its access gate, its global query, and its shared deriver. Adding or removing a plugin never touches `ai-backend` - the new source simply appears in (or disappears from) the aggregated answer.
