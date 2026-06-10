---
title: "Status pages"
description: "How operator-built public status pages stay isolated, team-scoped, and extensible."
---

Status pages let operators compose a public-facing page from widgets (system health, uptime, incidents, scheduled maintenance) and content blocks, bind each widget to chosen resources, and publish it. The hard requirement is isolation: a published page must reveal only the data in the widgets the operator placed on it, and the public surface must never expose the rest of the platform.

## The isolation invariant

There is exactly one public endpoint, `statuspage.getPublishedStatusPage(slug)`. It returns the page layout plus, per block, the widget's already-resolved, field-allow-listed `data` DTO. The public renderer makes no other data call, so it structurally cannot enumerate anything that is not on the page.

Three gates enforce this end to end:

- **Edit-time (RLAC).** You can only bind a resource to a widget if you can access it. You cannot expose what you cannot see.
- **Publish-time (audit).** `publishStatusPage` re-checks, via a USER-scoped loopback client, that the editor can read every bound resource, then snapshots the draft into the published layout and emits a `statuspage.page.published` hook recording exactly which resources were exposed, by whom.
- **Render-time (allow-list).** Each widget type's `resolvePublic` runs as the trusted service principal (so it can read the bound resources regardless of the anonymous caller's grants) but emits only its DTO shape. The service re-validates the returned value against the widget's `dtoSchema`, so a resolver that accidentally returns extra fields fails closed. Internal fields — config, ids, `createdBy` on incident/maintenance updates — are never copied into a DTO.

The overall-status banner rolls up only the systems bound to the page, so a private system can never bleed into the public indicator. Each binding carries an optional public `label` so internal names need not be exposed.

## Team scoping (RLAC)

A status page is a team-scopable resource (`statuspage.page`). It is created through the standard create-mode flow (`instanceAccess: { create }` + the owning-team picker), team-owned via the relation-tuple store, and resolvable by name in the Teams admin through the `ResourceResolverRegistry`. `page.read` / `page.manage` gate the authenticated builder; the public read is a separate `published.read` rule, default-granted to the anonymous role (revoke it to switch public status pages off platform-wide). Per-page `visibility` (`public` or `authenticated`) is enforced in the handler on top of that.

## Contributing a widget type

Widget types live in an extension-point registry, so any plugin can add one:

```ts
import { statusWidgetTypeExtensionPoint } from "@checkstack/status-page-backend";

env.getExtensionPoint(statusWidgetTypeExtensionPoint).registerWidgetType(
  {
    id: "latency",
    displayName: "Latency",
    description: "p95 latency for a system.",
    category: "Status",
    binding: "system",
    configSchema: LatencyConfigSchema,
    dtoSchema: LatencyDtoSchema, // the public allow-list
    boundResources: (config) => [
      { resourceType: "catalog.system", resourceId: LatencyConfigSchema.parse(config).systemId },
    ],
    resolvePublic: async ({ config, ctx }) => {
      const c = LatencyConfigSchema.parse(config);
      const stats = await ctx.rpcClient.forPlugin(HealthCheckApi).getRunStats({ /* ... */ });
      return LatencyDtoSchema.parse({ p95: stats.total.p95LatencyMs ?? 0 });
    },
  },
  pluginMetadata,
);
```

> [!IMPORTANT]
> A widget's public RENDERER (frontend) must be a PURE, prop-only component: it receives the resolved DTO and has no RPC client or `fetch`. That is what keeps third-party widgets unable to leak — a renderer can only draw the DTO it is handed.

`resolvePublic` may read anything via the trusted `ctx.rpcClient`, but must return only `dtoSchema` fields. The service validates the result against `dtoSchema` before it leaves the backend.

## Phases

Phase 1 (this release) ships the secure core, the admin builder, and the public page as a no-access-rule route. A fully separate public bundle, custom domains with edge-delegated TLS, drag-to-reorder, live-data preview, and distribution (embeds, SVG badges, RSS, subscriptions) are the next phases. The data-isolation guarantee is server-enforced and holds regardless of how the public page is bundled.
