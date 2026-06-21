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
- **Render-time (allow-list).** Each widget type's `resolvePublic` runs as the trusted service principal (so it can read the bound resources regardless of the anonymous caller's grants) but emits only its DTO shape. The service re-validates the returned value against the widget's `dtoSchema`, so a resolver that accidentally returns extra fields fails closed. Internal fields - config, ids, `createdBy` on incident/maintenance updates - are never copied into a DTO.

Each binding carries an optional public `label` so internal names need not be exposed.

## The overall-status summary

`getPublishedStatusPage` also returns an `overallStatus` summary - a page-wide rollup the public header renders as a banner:

```ts
type OverallStatusSummary = {
  status:
    | "operational"
    | "degraded"
    | "partial_outage"
    | "major_outage"
    | "maintenance"
    | "unknown";
  label: string; // default banner copy, e.g. "All systems operational"
};
```

It is derived by the **pure** `deriveOverallStatus({ blocks })` function in `@checkstack/status-page-common` from the page's **already-resolved blocks** - the same field-allow-listed `data` DTOs the public surface receives. It never reads from any domain plugin (healthcheck, incident, maintenance), so it cannot widen the exposure surface: a private system that is not on the page contributes nothing.

The rollup is **worst-status-wins** over every status a block contributes (the banner widget's status, each `systemHealth` / `groupStatus` item, and the most recent `uptime` bar). Precedence, most severe first: `major_outage` > `partial_outage` > `degraded` > `maintenance` > `operational`. `maintenance` is surfaced above `operational` but ranks below any degradation or outage (an active outage during a maintenance window is still an outage to a visitor). `unknown` is the fallback only when no widget contributed any status at all - an empty page, or a page of purely content widgets. Because it is pure, the rule is unit-tested directly (`overall-status.test.ts`).

A widget type contributes to the rollup automatically if its DTO carries the public `status` enum in one of the shapes above; content-only widgets (text, heading, links, image, divider) are ignored.

## Publishing is a deliberate, audited exposure

Publishing is a one-time, deliberate decision to expose the bound resources' public-safe status, recorded by the `statuspage.page.published` audit hook (which lists exactly which resources were exposed, by whom). It is NOT re-gated on every public request: the data a widget shows was published because the operator chose to expose it, so tying a public page's availability to one editor's later, mutable role would be both a reliability risk on an anonymous surface and arguably less correct than the explicit-publish model. The revocation path is **unpublish** (or removing the widget and re-publishing - which re-emits the audit hook with the new exposed set). Bindings resolve live by id, so deleting a bound resource degrades the widget to nothing; recreating a resource under the same id would re-expose it (ids are UUIDs, so reuse does not happen in practice).

## Team scoping (RLAC)

A status page is a team-scopable resource (`statuspage.page`). It is created through the standard create-mode flow (`instanceAccess: { create }` + the owning-team picker), team-owned via the relation-tuple store, and resolvable by name in the Teams admin through the `ResourceResolverRegistry`. `page.read` / `page.manage` gate the authenticated builder; the public read is a separate `published.read` rule, default-granted to the anonymous role (revoke it to switch public status pages off platform-wide). Per-page `visibility` (`public` or `authenticated`) is enforced in the handler on top of that.

## Custom domains

A published page can be served on its own host - `status.acme.com` - so visitors never see a Checkstack admin URL. The public surface is isolated from the admin app at three layers: data, network, and code. This page covers the model; for the operator walkthrough (DNS records, ingress and Caddy/Cloudflare TLS, troubleshooting) see [Serve a status page on a custom domain](/checkstack/user-guide/guides/serve-a-status-page-on-a-custom-domain/).

### Setting one up

In the builder, open the **Custom domain** panel, enter the host, and Save. Checkstack issues a one-time DNS TXT verification token; add it as a TXT record, then click **Verify**:

```env
# DNS record proving ownership (exact values are shown in the builder)
_checkstack-verify.status.acme.com  TXT  cs-verify-3f2a...
```

A domain routes only once it is verified AND the page is published AND its visibility is `public` - the backend gates on all three (`resolveByHost`), so an unverified, unpublished, or `authenticated`-only page serves nothing on a custom domain. Point the domain at your Checkstack ingress (CNAME or A record) and make sure your edge terminates TLS for it (see below).

Host lookups are cached per pod for about 60 seconds (both hits and misses). So a freshly verified+published domain begins routing within ~60s, and - the inverse operators hit most - if the domain was visited before setup was finished, the cached negative result means it can keep showing "not available" for up to ~60s after you finish. Removing a custom domain likewise stops routing within that window (the page content, however, respects unpublish immediately - it is read live, not host-cached).

### The locked-down surface

When a request arrives on a verified custom domain, the platform serves ONLY the public surface and refuses everything else with a 404. This is enforced server-side in a host-routing middleware, so it holds regardless of what any client tries:

- Allowed: the single public read (`getPublishedStatusPage`), `/api/config` (which returns only `{ baseUrl, publicHost: { slug } }`), the public bundle's static assets, and the on-demand-TLS hook.
- Refused: every other `/api/*`, all of `/rest/*`, the admin docs (`/checkstack/*`), and the platform endpoints (`/.checkstack/*` readiness, `/.well-known/jwks.json`).

On a custom domain, `/api/config` returns THAT domain as `baseUrl` (never the admin origin), so the bundle's RPC client can only ever call back into this same locked-down host. The net effect: a published page can reach exactly one data endpoint, and that endpoint already enforces published + visibility + the field allow-list. There is no path from the public host to any other plugin's data.

### A separate public bundle

The custom-domain host loads a minimal public bundle that ships NONE of the admin app - no sidebar, auth, signals, command palette, or general plugin loader. The bundle is `core/frontend`'s public-app (`@checkstack/frontend`'s `public-app.tsx`), which renders the page WITHOUT the admin router, driving the slug from `/api/config` instead of the URL; `@checkstack/status-page-frontend` re-exports the `PublicStatusPageView` and the `RendererRemotesProvider` it mounts. The frontend entry fetches `/api/config` first and, when it sees a `publicHost`, dynamically imports only this public bundle; the admin app chunk is never fetched. So a public host downloads a few KB of public code plus shared vendor, and admin code never reaches the visitor's browser.

Built-in widget renderers are bundled in. For a THIRD-PARTY widget type, the published-page response lists exactly the renderer remotes that page needs (each widget type can declare a `rendererRemote` - its frontend npm package); the bundle then loads only those, on demand, via Module Federation. The set of remotes comes entirely from the page's widget types (operator-controlled, never visitor input), the loaded code is the operator's own installed plugin (trusted, as in the admin app), and its renderers are pure - and even if one tried an RPC, the only data endpoint reachable on this origin is the public read. So third-party widgets render on custom domains without widening the data surface.

### TLS at the edge

Checkstack terminates no TLS itself; an ingress or reverse proxy does, exactly as for the primary domain. For arbitrary customer domains there are two common patterns:

- A wildcard or per-domain certificate managed by your ingress (for example, cert-manager creating a `Certificate` per domain - see the [Kubernetes installation guide](/checkstack/user-guide/installation/kubernetes/) and the [custom-domain how-to](/checkstack/user-guide/guides/serve-a-status-page-on-a-custom-domain/)).
- On-demand TLS at the edge (Caddy `on_demand_tls`, Cloudflare for SaaS), gated by the platform's authorization hook so certificates are minted ONLY for domains an operator has verified:

```text
{
  on_demand_tls {
    # Caddy asks Checkstack before minting a cert for an unknown host.
    ask http://checkstack-backend:3000/.well-known/checkstack/authorize-domain
  }
}

https:// {
  tls {
    on_demand
  }
  reverse_proxy checkstack-backend:3000
}
```

`GET /.well-known/checkstack/authorize-domain?domain=<host>` returns 200 for a verified custom domain (or the primary host) and 404 otherwise, so the edge never provisions a certificate for a domain that is not configured in Checkstack.

### Contributing another public-host surface

Custom-domain routing is a platform mechanism, not status-page-specific. Any plugin can own public hosts by contributing a resolver to `publicHostResolverExtensionPoint` (in `@checkstack/backend-api`). The platform consults registered resolvers per request; the resolver returns the host's bootstrap hint and the exhaustive list of `/api` paths the surface may call. The platform stays ignorant of the surface and enforces that allow-list.

## Contributing a widget type

A widget has two halves: a backend **type** (config + DTO + how the public data is resolved) and a frontend **renderer** (a pure component that draws the DTO). A plugin contributes both, and the widget then works on every status page.

### Backend: the widget type

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

`resolvePublic` may read anything via the trusted `ctx.rpcClient`, but must return only `dtoSchema` fields. The service validates the result against `dtoSchema` before it leaves the backend.

### Frontend: the renderer

Contribute the renderer from your frontend plugin with `defineStatusWidgetRenderer` (in `@checkstack/status-page-common`), keyed by the same qualified widget-type id. It lands in your plugin's `extensions[]` and is collected through the plugin registry - no extra lifecycle:

```tsx
import { createFrontendPlugin } from "@checkstack/frontend-api";
import { defineStatusWidgetRenderer } from "@checkstack/status-page-common";
import { pluginMetadata } from "@checkstack/myplugin-common";
import { LatencyRenderer } from "./LatencyRenderer";

export default createFrontendPlugin({
  metadata: pluginMetadata,
  extensions: [
    defineStatusWidgetRenderer({
      pluginMetadata,
      id: "latency", // same local id as the backend type -> "myplugin.latency"
      component: LatencyRenderer,
    }),
  ],
});
```

Pass the LOCAL id and your plugin metadata; the qualified id (`${pluginId}.latency`) is computed for you, exactly like the backend `registerWidgetType`, so the renderer always matches the block type. The status-page frontend resolves each block's renderer by that id, merging built-ins with plugin-contributed ones (built-ins win on a clash, so the `statuspage.*` namespace cannot be shadowed). A block whose type has no registered renderer simply does not draw.

> [!IMPORTANT]
> A renderer MUST be a PURE, prop-only component: it receives the resolved DTO and has no RPC client or `fetch`. That is what keeps third-party widgets unable to leak - a renderer can only draw the DTO it is handed.

Plugin-contributed renderers load on the admin builder preview and the in-app page at `/status/<slug>` (where the admin app has already loaded every plugin). For a page served on a **custom domain**, the minimal public bundle loads your renderer on demand - declare its frontend package as `rendererRemote` on the backend widget type so the page knows which remote to fetch:

```ts
env.getExtensionPoint(statusWidgetTypeExtensionPoint).registerWidgetType(
  { id: "latency", /* ... */ rendererRemote: "@acme/widgets-frontend" },
  pluginMetadata,
);
```

Built-in widgets omit `rendererRemote` (they are bundled). See [Custom domains](#a-separate-public-bundle) for how the bundle loads remotes securely.

## Phases

Phase 1 shipped the secure core, the admin builder, and the public page as a no-access-rule route at `/status/<slug>`. Custom domains (with a separate public bundle, edge-delegated TLS, and on-demand loading of third-party widget renderers) now ship too (see [Custom domains](#custom-domains)), as does pluggable widget rendering (see [Contributing a widget type](#contributing-a-widget-type)). Drag-to-reorder, live-data preview, and distribution (embeds, SVG badges, RSS, subscriptions) are the next phases. The data-isolation guarantee is server-enforced and holds regardless of how the public page is bundled or hosted.
