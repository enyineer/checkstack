---
"@checkstack/satellite-backend": minor
---

Migrate satellite connection state to the reactive entity state machine (reactive automation engine Phase 4, §10.6, §9.1).

Satellite connection liveness now mirrors into the framework-owned `satellite-connection` entity (`{ status: "online" | "offline", name, region, lastSeenAt, lastEvent }`, keyed by satellite id) at the three lifecycle sites that previously emitted connection hooks: WS authentication (online/connected), WS socket close (offline/disconnected), and the heartbeat monitor's online→offline edge (offline/heartbeat_lost). A registered change-deriver maps these entity changes back to the `satellite.connected` / `satellite.disconnected` / `satellite.heartbeat_lost` trigger events, so existing automations keep firing via the reactive dispatch pipeline. The `satellites.lastHeartbeatAt` column stays as escape-hatched bookkeeping (declared via `declareNonReactiveState`, reason "bookkeeping").

The three-way distinction the original triggers had is preserved by an explicit `lastEvent` discriminator on the entity state: a bare `status` diff cannot tell a socket drop (`disconnected`) apart from the heartbeat-lost offline edge (`heartbeat_lost`), so the deriver reads `lastEvent` to fire the exact original event.

BREAKING CHANGES:

- Removed the `satellite.connected`, `satellite.disconnected`, and `satellite.heartbeat_lost` hooks (`createHook`). Use the `satellite-connection` entity's auto-emitted change events (subscribe via the `automation.entity` extension point's `onEntityChanged`, or author automations against the derived trigger events). The `satellite.removed` deletion/cleanup hook is unaffected and stays.
- Removed the hook-backed `connected` / `disconnected` / `heartbeat_lost` automation triggers. The same qualified trigger event ids are now produced by the entity change-deriver, so already-authored automations referencing them continue to fire, but they are no longer offered as picker entries in the automation editor. The trigger payload is now the entity-change shape (`kind`, `id`, `prev`, `next`, `delta`, `changedFields`, plus the new state fields spread at top level: `status`, `name`, `region`, `lastSeenAt`, `lastEvent`) rather than the old hook payload (`satelliteId`, `name`, `region`, `timestamp`).
