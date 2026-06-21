---
title: "Plugin boot-time hook policy"
description: "What happens when a subscriber to a core boot-time hook (`pluginInitialized`, `accessRulesRegistered`) throws. The rule of thumb: structural failures halt boot, operational failures continue + escalate."
---


This page documents what the platform does when a subscriber to one of
the boot-time core hooks emitted from
[`plugin-loader.ts`](https://github.com/enyineer/checkstack/blob/main/core/backend/src/plugin-manager/plugin-loader.ts)
throws.

The two hooks in question are emitted from inside the plugin loader,
during boot, before the platform finishes coming online:

| Hook                     | Emit site (Phase) | Policy on subscriber failure |
| ------------------------ | ----------------- | ---------------------------- |
| `pluginInitialized`      | End of Phase 2    | **HALT** the boot.           |
| `accessRulesRegistered`  | Start of Phase 3  | **CONTINUE**, escalate log.  |

There is no generic "halt on any hook failure" knob. The choice is made
per hook based on whether the failure is structural or operational.

## `pluginInitialized` - halt on subscriber failure

`pluginInitialized` fires immediately after a plugin's Phase 2 `init()`
resolves, so downstream consumers can wire themselves against the
freshly initialised plugin (register routes against its router,
materialise its service references, etc.).

A throwing subscriber here means a downstream never got the chance to
wire itself. Continuing past that would leave the platform running in
a half-wired state - the kind of failure that surfaces as confusing
`undefined is not a function` errors at request time, long after the
boot logs scrolled off the screen.

We therefore log the error and rethrow, naming the plugin whose
`pluginInitialized` emission failed. Boot stops, the operator gets a
clear stack trace, and the platform never serves traffic in an
inconsistent state.

This matches the existing `afterPluginsReady` failure handling lower
down in the same loader.

## `accessRulesRegistered` - continue, escalate log

`accessRulesRegistered` drives downstream consumers that mirror
access-rule registrations into their own stores: think of a sync
worker that hydrates a DB-backed access-rule cache, or a UI plugin
that wants to display the current access matrix.

A throwing subscriber here is operational, not structural - the
platform itself is fully wired even if a subscriber failed. The cost
of halting boot would be that **one** misbehaving plugin could DOS
every other plugin on the same instance. The cost of continuing is
that **one** downstream consumer has a stale view of one plugin's
access rules until that consumer recovers.

We pick the latter:

- The error is logged at `error` level (loud) so operators see it.
- We track a counter and emit a final summary line if any subscriber
  failed, so the failure isn't lost in a noisy boot log.
- Boot continues. Downstream consumers should implement their own
  retry / re-sync - `accessRulesRegistered` is fired again on plugin
  re-registration, and consumers can also pull the current snapshot
  via the plugin manager's `getAllAccessRules()` if needed.

## What this is not

- Not a hook-level retry mechanism. If the dispatch system itself
  supports retries (e.g. work-queue mode), those still apply - this
  policy is about what the loader does once the dispatch finally
  resolves or rejects from the emitter's point of view.
- Not a generic toggle. Adding a third hook with a different policy
  is a deliberate design decision, not a config flag.
- Not a substitute for testing your subscriber. Subscribers to
  `accessRulesRegistered` should be defensive; failing here always
  drops cache freshness for at least one plugin.

## Anti-patterns

- **Do not** silently swallow errors here without escalating them.
  Both branches in the loader log at `error` level deliberately.
- **Do not** rethrow from `accessRulesRegistered` - that's the whole
  point of the per-hook policy. A boot-blocking access-rules hook
  re-introduces the DOS vector this policy exists to prevent.
- **Do not** add new hooks emitted from inside `plugin-loader.ts`
  without explicitly choosing a policy. Default to "halt for
  structural, continue for operational" and document the choice
  inline.
