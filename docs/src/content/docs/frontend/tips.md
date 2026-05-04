---
title: "Welcome Tour & Tips"
description: "Checkstack ships a small, plugin-friendly infrastructure for first-run hints and empty-state coaching. The goal is to make the product self-explanatory to new users without falling back to a fragil…"
---
---
---
# Welcome Tour & Tips

Checkstack ships a small, plugin-friendly infrastructure for **first-run hints**
and **empty-state coaching**. The goal is to make the product self-explanatory
to new users without falling back to a fragile multi-step overlay tour that
breaks the moment a plugin renames a route or is disabled.

## Packages

| Package | Type | Purpose |
| --- | --- | --- |
| `@checkstack/tips-common` | common | RPC contract (`tipsContract`), zod schemas, `TipsApi` client definition. |
| `@checkstack/tips-backend` | backend | Postgres-backed dismissal store, scoped per user. |
| `@checkstack/tips-frontend` | frontend | `<Tip>`, `<TipBanner>`, `useTipState` hook. |

The dismissal table (`user_tip_dismissal`) has a composite primary key on
`(user_id, tip_id)`, so dismissing the same tip twice is a no-op. When a user
is deleted, their dismissals are cleaned up via the `auth.userDeleted` hook.

## Persistence model

| User state | Read from | Write to |
| --- | --- | --- |
| Logged in | server (`TipsApi.listDismissed`) **and** localStorage | server (`TipsApi.dismiss`) **and** localStorage |
| Anonymous | localStorage only (`checkstack.tips.dismissed`) | localStorage only |

Local storage acts as a synchronous fallback so consumers don't flash a tip
that the user already dismissed in another tab. Dismissals across tabs sync
via the `storage` event.

## Authoring tips inside a plugin

Plugins **never write a fully-qualified tip ID by hand**. The `<Tip>`,
`<TipBanner>`, and `useTipState` APIs all accept a `plugin` prop alongside a
local `id`, and the calling plugin's `pluginId` is automatically prepended.
This makes it impossible for one plugin to dismiss or forge a tip in
another plugin's namespace — a leading or trailing `.` in the local id is
rejected at runtime, so a local id of `".other-plugin.tip"` cannot escape
the caller's prefix.

### Anchored popover (preferred for UI affordances)

Wrap any element you want to explain. A small lightbulb icon is rendered
immediately after the wrapped element; clicking it opens the popover.
The lightbulb stays visible for a given user until they explicitly
dismiss the tip (X / Got it / action button), at which point only the
underlying element is rendered.

```tsx
import { Tip } from "@checkstack/tips-frontend";
import { Button } from "@checkstack/ui";
import { pluginMetadata } from "@checkstack/catalog-common";

<Tip
  plugin={pluginMetadata}
  id="systems.create"
  title="Add your first system"
  description="Systems are the things you monitor — services, hosts, jobs."
  side="bottom"
  align="end"
>
  <Button>Create system</Button>
</Tip>
```

The wire-level (and stored) tip id is `catalog.systems.create`, derived from
`pluginMetadata.pluginId` + the local `id`. The popover never auto-opens —
the lightbulb is the trigger, so first-time users see a subtle "more
info available" affordance rather than a popover that interrupts them
the moment a page loads.

### Inline banner (preferred for empty pages)

Use when there is no specific element to attach to — typically at the top of
a page or alongside an empty state.

```tsx
import { TipBanner } from "@checkstack/tips-frontend";
import { pluginMetadata } from "@checkstack/healthcheck-common";

<TipBanner
  plugin={pluginMetadata}
  id="results.filter"
  title="Filter results by status"
  description="Use the status pills above the table to narrow down to failing checks."
/>
```

### Empty-state coaching

`@checkstack/ui`'s `<EmptyState>` accepts optional `steps` and `actions`
props. When the page has no data, render a richer onboarding card instead
of a blank view:

```tsx
<EmptyState
  icon={<HeartPulse className="size-10" />}
  title="No health checks yet"
  description="Health checks tell you whether the things you care about are reachable and behaving."
  steps={[
    "Pick a check type (HTTP, TCP, Postgres, …) from the catalog.",
    "Point it at a target and choose how often it runs.",
    "Wire it into a notification channel so failures wake the right people.",
  ]}
  actions={<Button onClick={onCreate}>Create your first check</Button>}
/>
```

## Tip ID conventions

Fully-qualified tip IDs (the wire format and DB storage form) have shape
`<pluginId>.<localTipId>`. Plugins write only the local part — the platform
takes care of the namespace.

```
local id           plugin → fully-qualified id
─────────────      ──────────────────────────────────────
systems.create     catalog → catalog.systems.create
results.filter     healthcheck → healthcheck.results.filter
channels.test      notification → notification.channels.test
```

Validation:

- **Local id** (`LocalTipIdSchema`): `[a-zA-Z0-9._-]+`, must not start or end
  with `.`, max 150 chars. The leading-dot ban is what stops a malicious or
  buggy plugin from escaping its own namespace.
- **Fully-qualified id** (`TipIdSchema`): produced by `qualifyTipId(plugin,
  localId)` and validated end-to-end (must match
  `<pluginId>.<rest>`, max 200 chars).

## Resetting tips ("replay onboarding")

Plugins can wire up an admin or user-menu affordance that calls
`useTipState({ plugin, id }).reset()` to bring a single tip back. Calling
`TipsApi.reset` with no `tipIds` clears the user's entire dismissal list,
which can be surfaced as a "show me the welcome tour again" link.
