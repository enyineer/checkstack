/**
 * Satellite connection reactive entity (reactive automation engine §10.6,
 * §9.1).
 *
 * Satellite connection state is genuinely an entity: the WS handler's
 * connection lifecycle and the heartbeat monitor's online→offline transition
 * ARE state with diffs. The `satellite-connection` entity is PLUGIN-BACKED
 * (Model B): its current state lives in the shared `satellites` table — in the
 * durable `connectionStatus` / `lastSeenAt` / `lastConnectionEvent` columns —
 * so it is GLOBALLY readable from any pod. There is NO framework `entity_state`
 * mirror. This fixes a horizontal-scaling read bug: the previous design stored
 * current state in a process-local in-memory map, so a satellite connected to
 * pod A was invisible to pod B's scope enrichment / `wait_until` re-eval.
 *
 * The three lifecycle sites that used to emit the `satellite.connected` /
 * `.disconnected` / `.heartbeat_lost` hooks now drive `handle.mutate`, whose
 * `apply` UPDATEs the satellite row's connection columns (the pod that owns the
 * socket is the writer) and returns the view; the framework still records full
 * transition HISTORY in `entity_transitions` (durable current state AND durable
 * platform history). The persisted `satellites.lastHeartbeatAt` column stays as
 * escape-hatched bookkeeping (declared non-reactive).
 *
 * The three hooks are removed; the change-deriver below maps an entity
 * change back to the SAME qualified trigger event ids existing automations
 * match. Because `disconnected` (socket drop) and `heartbeat_lost`
 * (online→offline edge) BOTH move the connection toward "offline", a plain
 * `status` diff cannot tell them apart. The entity therefore carries an
 * explicit `lastEvent` discriminator naming the lifecycle edge that
 * produced the change; the deriver reads it to preserve the three-way
 * distinction the original triggers had.
 */
import { z } from "zod";
import type { EntityChanged } from "@checkstack/automation-common";
import type { EntityRead } from "@checkstack/automation-backend";
import type { SatelliteService } from "./service";

/** Globally-unique entity kind for a satellite connection. */
export const SATELLITE_CONNECTION_ENTITY_KIND = "satellite-connection";

/**
 * Qualified trigger event ids the deriver maps to — `${pluginId}.${triggerId}`
 * for the (now-removed) connection triggers. Automations reference these
 * strings in `definition.triggers[].event`, so the deriver MUST return them
 * verbatim for Stage-1 routing to match.
 */
export const SATELLITE_CONNECTED_EVENT = "satellite.connected";
export const SATELLITE_DISCONNECTED_EVENT = "satellite.disconnected";
export const SATELLITE_HEARTBEAT_LOST_EVENT = "satellite.heartbeat_lost";

/**
 * The lifecycle edge that produced a connection-state change. Preserves the
 * distinction between a socket drop (`disconnected`) and the heartbeat-lost
 * offline edge (`heartbeat_lost`), which a bare `status` diff cannot encode.
 */
export const satelliteConnectionEventEnum = z.enum([
  "connected",
  "disconnected",
  "heartbeat_lost",
]);

export type SatelliteConnectionEvent = z.infer<
  typeof satelliteConnectionEventEnum
>;

/** Reactive state of a satellite connection (reactive automation engine §9.1). */
export const satelliteConnectionStateSchema = z.object({
  status: z.enum(["online", "offline"]),
  name: z.string(),
  region: z.string(),
  /** ISO timestamp of the lifecycle edge that last touched this connection. */
  lastSeenAt: z.string(),
  /** Which lifecycle edge produced the latest change (see above). */
  lastEvent: satelliteConnectionEventEnum,
});

export type SatelliteConnectionState = z.infer<
  typeof satelliteConnectionStateSchema
>;

/**
 * Map a `satellite-connection` entity change to the qualified trigger event
 * id(s) it should fire (reactive automation engine §7, §10.6). The
 * `lastEvent` discriminator on the NEW state names the lifecycle edge,
 * so the mapping is exact and preserves the three-way distinction:
 *
 *   - `connected`      → `satellite.connected`
 *   - `disconnected`   → `satellite.disconnected`
 *   - `heartbeat_lost` → `satellite.heartbeat_lost`
 *
 * A tombstone (`next === null`, e.g. an entity removed when the satellite is
 * deleted) fires nothing — satellite deletion has its own `satellite.removed`
 * hook (kept), not a connection-lifecycle event.
 */
export function deriveSatelliteConnectionEvents(
  changed: EntityChanged,
): ReadonlyArray<string> {
  if (changed.next === null) return [];
  const parsed = satelliteConnectionEventEnum.safeParse(
    changed.next["lastEvent"],
  );
  if (!parsed.success) return [];
  switch (parsed.data) {
    case "connected": {
      return [SATELLITE_CONNECTED_EVENT];
    }
    case "disconnected": {
      return [SATELLITE_DISCONNECTED_EVENT];
    }
    case "heartbeat_lost": {
      return [SATELLITE_HEARTBEAT_LOST_EVENT];
    }
  }
}

/**
 * The durable connection columns of a satellite row, as read from the shared
 * `satellites` table. This is the raw shape the service returns for the entity
 * `read` accessor; {@link toSatelliteConnectionState} projects it onto the
 * reactive view. A satellite that has never connected has `lastSeenAt === null`
 * and `lastConnectionEvent === null`.
 */
export interface SatelliteConnectionRow {
  status: "online" | "offline";
  name: string;
  region: string;
  lastSeenAt: Date | null;
  lastConnectionEvent: SatelliteConnectionEvent | null;
}

/**
 * Project a durable `satellites` connection row onto the reactive
 * `SatelliteConnectionState` view (the exact shape the deriver + change events
 * consume). A satellite with no recorded lifecycle edge yet (never connected)
 * has no entity state, so this returns `null` and the `read` accessor omits the
 * id — exactly the `prev === null` (create) signal the framework needs on the
 * first connect.
 */
export function toSatelliteConnectionState(
  row: SatelliteConnectionRow,
): SatelliteConnectionState | null {
  if (row.lastSeenAt === null || row.lastConnectionEvent === null) {
    return null;
  }
  return {
    status: row.status,
    name: row.name,
    region: row.region,
    lastSeenAt: row.lastSeenAt.toISOString(),
    lastEvent: row.lastConnectionEvent,
  };
}

/**
 * Build the PLUGIN-BACKED `read` accessor for the `satellite-connection`
 * entity. Routes straight to the service's batched durable read of the
 * `satellites` connection columns (no framework storage), so the current state
 * is the SAME for every pod — this is what makes the entity globally consistent
 * and is the single source of truth `handle.mutate` snapshots `prev` from and
 * `get` / `getMany` / scope enrichment / `wait_until` re-eval route through.
 */
export function createSatelliteConnectionRead(
  service: SatelliteService,
): EntityRead<SatelliteConnectionState> {
  return (ids) => service.getManyConnectionStates(ids);
}
