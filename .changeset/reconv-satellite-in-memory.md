---
"@checkstack/satellite-backend": minor
---

Reconvert the `satellite-connection` entity to the Model B reactive API, plugin-backed by the in-memory connection map.

Satellite connection state (`{ status, name, region, lastSeenAt, lastEvent }`, keyed by `satelliteId`) lives only for the lifetime of the connection — it has no durable home. It was previously mirrored into `entity_state` via the deprecated `handle.set` sugar. It is now PLUGIN-BACKED: the new process-local connection-state map (`connection-state-store.ts`) is the single source of truth, and the `entity_state` mirror is dropped entirely.

Changes:

- New `connection-state-store.ts` holds the in-memory `Map<satelliteId, SatelliteConnectionState>`; its `readMany` is the entity `read` accessor.
- `defineEntity({ kind: "satellite-connection", read })` reads that map.
- The three lifecycle sites — WS connect, WS disconnect, and heartbeat-lost — drive `handle.mutate({ id: satelliteId, apply })`, where `apply` updates the in-memory map and returns the view. No more `handle.set`.

The platform still records full transition HISTORY in `entity_transitions` for every change — this is the "in-memory current state, durable platform history" design the architecture calls for. The `satellite.connected` / `.disconnected` / `.heartbeat_lost` change-event deriver (with its `lastEvent` discriminator), the `satellites.lastHeartbeatAt` `declareNonReactiveState` bookkeeping escape hatch, and the `satellite.removed` hook are all unchanged, so existing automations keep firing identically.

BREAKING CHANGE: the `satellite-connection` entity no longer writes an `entity_state` row — its current state is in-memory only. Any code reading current connection state directly from `entity_state` must instead read through the entity `read` accessor / `handle.get`. Durable history in `entity_transitions` is unaffected.
