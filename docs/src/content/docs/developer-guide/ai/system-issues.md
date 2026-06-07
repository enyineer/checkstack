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

interface SystemSignalsContributor {
  /** Stable id of the source, e.g. "incident" / "slo" / "healthcheck". */
  sourceId: string;
  /**
   * Return problem signals for ALL systems globally, keyed by systemId, scoped
   * to what `principal` may see. Systems absent from the map have no signal from
   * this source. Return `{}` (never a throw) when the principal lacks access.
   */
  read(context: { principal: AuthUser }): Promise<SystemSignalsMap>;
}
```

`SystemSignalsMap` is `Record<string, SystemSignal[]>` from `@checkstack/catalog-common`. Only systems that currently have a problem appear in the map; healthy systems are simply absent. The aggregator drops the link/icon fields the model does not need (`href`, `accessRule`, `iconName`) and keeps `source` / `tone` / `label` / `detail` / `since`.

## The per-source access gate

The `system.issues` tool is gated by `catalog.system.read`, but that only controls whether the tool runs at all. PER-SOURCE visibility is each contributor's own responsibility. The aggregator never inspects a source's data to decide what a principal may see - it trusts each contributor to return only allowed signals.

A contributor MUST:

- Check the principal's own access rule for its domain (e.g. `incident.read`).
- Return `{}` when the principal lacks access - never throw. A throwing or denied contributor is skipped, so one source can never break the whole call.
- Short-circuit BEFORE querying when access is denied, so a denied principal triggers no database work.

`ServiceUser` principals carry no access rules; treat them as ungranted for this gate unless your source explicitly trusts service callers.

```ts
import { isAccessRuleSatisfied } from "@checkstack/common";
import type { AuthUser } from "@checkstack/backend-api";
import type { SystemSignalsContributor } from "@checkstack/ai-backend";
import type { SystemSignalsMap } from "@checkstack/catalog-common";
import {
  incidentAccess,
  INCIDENT_SIGNAL_SOURCE_ID,
  deriveIncidentSignals,
} from "@checkstack/incident-common";
import type { IncidentService } from "./service";

/** RealUser / ApplicationUser carry accessRules; ServiceUser has none. */
function grantedRules(principal: AuthUser): readonly string[] {
  return "accessRules" in principal ? (principal.accessRules ?? []) : [];
}

export function createIncidentSignalsContributor({
  service,
}: {
  service: Pick<IncidentService, "listOpenIncidentsBySystem">;
}): SystemSignalsContributor {
  return {
    sourceId: INCIDENT_SIGNAL_SOURCE_ID,
    read: async ({ principal }): Promise<SystemSignalsMap> => {
      if (
        !isAccessRuleSatisfied(grantedRules(principal), incidentAccess.incident.read)
      ) {
        return {};
      }
      const incidentsBySystem = await service.listOpenIncidentsBySystem();
      return deriveIncidentSignals({
        incidentsBySystem,
        systemIds: Object.keys(incidentsBySystem),
      });
    },
  };
}
```

## Share the deriver with the frontend

A signal must look the same whether it comes from the backend aggregator or the dashboard's frontend filler. Put the pure mapping - the function that turns domain rows into `SystemSignal[]` - in your plugin's `*-common` package and have BOTH the frontend filler and the backend contributor call it. The deriver stays dependency-free (it imports only types and `resolveRoute`), so it is trivially unit-testable and the two surfaces can never drift.

## Register the contributor

Register ONE contributor from your plugin's own `init`, after the service it reads is bound, through the same extension point external plugins use.

```ts
import { systemSignalsExtensionPoint } from "@checkstack/ai-backend";

// in registerInit({ init }):
env.getExtensionPoint(systemSignalsExtensionPoint).contribute(
  createIncidentSignalsContributor({ service }),
);
```

`ai-backend` accumulates every contributor into the same array the `system.issues` tool reads at execute time, so a contributor registered during any plugin's `init` is visible by the time the tool runs.

## State and scale

A contributor's `read` MUST resolve from shared, durable storage - the plugin's own Postgres tables or a derivation of them - so the answer is identical on every pod. Never read from process-local or in-memory state: the tool can execute on whichever pod handles the request, and a value written on one pod would be invisible to another, returning stale or empty issues. This is the same constraint reactive entity reads follow.

## Why ai-backend stays plugin-agnostic

The aggregator is pure machinery: collect contributors, merge their maps, shape the output. It knows nothing about incidents, SLOs, or health checks. Each domain owns its source id, its access gate, its global query, and its shared deriver. Adding or removing a plugin never touches `ai-backend` - the new source simply appears in (or disappears from) the aggregated answer.
