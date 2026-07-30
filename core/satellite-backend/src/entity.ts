/**
 * Satellite connection reactive entity (reactive automation engine §10.6,
 * §9.1).
 *
 * Satellite connection state is genuinely an entity: the WS handler's
 * connection lifecycle and the heartbeat monitor's online→offline transition
 * ARE state with diffs. The `satellite-connection` entity is PLUGIN-BACKED
 * (Model B) and COMPUTE-ON-READ: its `status` is DERIVED on read from the
 * durable `satellites.lastHeartbeatAt` column (via `computeStatus` /
 * `OFFLINE_THRESHOLD_MS` — the SAME single liveness source of truth the admin
 * list uses), so there is no second stored copy of the status to drift, and the
 * read is globally consistent from any pod AND self-healing: a stale row reads
 * `offline` once `lastHeartbeatAt` ages past the offline threshold, even if the
 * pod that owned the socket crashed without writing offline. The only extra
 * durable column is `lastConnectionEvent` (the deriver's event discriminator).
 * There is NO framework `entity_state` mirror. This fixes a horizontal-scaling
 * bug twice over: the original design stored status in a process-local in-memory
 * map (invisible across pods), and the prior fix's stored `connectionStatus`
 * still got stuck `online` forever after a pod crash because the heartbeat-lost
 * EDGE was detected pod-locally. Computing status on read removes both.
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
import type {
  EntityChangePayloadMapper,
  EntityRead,
} from "@checkstack/automation-backend";
import type { SatelliteService } from "./service";
import { computeStatus } from "./status";

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
  /**
   * COMPUTED on read from `lastHeartbeatAt` (the single liveness source of
   * truth). Never stored — a stale row reads `offline` once the heartbeat ages
   * past the offline threshold, so presence self-heals after a pod crash.
   */
  status: z.enum(["online", "offline"]),
  name: z.string(),
  region: z.string(),
  /**
   * ISO timestamp the satellite was last seen alive (its `lastHeartbeatAt`), or
   * `null` after a clean disconnect (when `lastHeartbeatAt` is cleared so the
   * status flips offline immediately). Derived, not separately stored.
   */
  lastSeenAt: z.string().nullable(),
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

function readString(
  state: Record<string, unknown> | null,
  field: string,
): string | undefined {
  if (state === null) return undefined;
  const value = state[field];
  return typeof value === "string" ? value : undefined;
}

/**
 * Map a `satellite-connection` entity change to the domain-named
 * `trigger.payload` the connection triggers declare via `payloadSchema`
 * (`satelliteId`, `name`, `region`, `status`, `lastSeenAt`). Restores the keys
 * operators read (`trigger.payload.satelliteId`, `.name`, …) that the generic
 * change shape omits, so an entity-driven connection trigger sees the same
 * documented payload the four migrated lifecycle domains do.
 *
 * `satelliteId` is the entity id; the remaining fields read off `next` (a
 * tombstone fires no event, so `next` is always present when a trigger fires).
 * `lastSeenAt` is nullable (`null` after a clean disconnect).
 */
export const satelliteChangeToPayload: EntityChangePayloadMapper = (changed) => {
  const next = changed.next;
  const lastSeenAt = next === null ? null : next["lastSeenAt"];
  return {
    satelliteId: changed.id,
    name: readString(next, "name"),
    region: readString(next, "region"),
    status: readString(next, "status"),
    lastSeenAt: typeof lastSeenAt === "string" ? lastSeenAt : null,
  };
};

/**
 * The durable connection columns of a satellite row, as read from the shared
 * `satellites` table. This is the raw shape the service returns for the entity
 * `read` accessor; {@link toSatelliteConnectionState} projects it onto the
 * reactive view by COMPUTING `status` from `lastHeartbeatAt`. A satellite that
 * has never connected has `lastConnectionEvent === null` (no recorded edge yet).
 */
export interface SatelliteConnectionRow {
  name: string;
  region: string;
  /** The single durable liveness source of truth; `status` is computed from it. */
  lastHeartbeatAt: Date | null;
  /**
   * This satellite's own offline tolerance (null = the platform default).
   * Required on the row rather than looked up separately, so this read can
   * never disagree with the admin list or the heartbeat monitor about the same
   * satellite's status.
   */
  offlineThresholdMs: number | null;
  lastConnectionEvent: SatelliteConnectionEvent | null;
}

/**
 * Project a durable `satellites` connection row onto the reactive
 * `SatelliteConnectionState` view (the exact shape the deriver + change events
 * consume). `status` is COMPUTED on read from `lastHeartbeatAt` via
 * {@link computeStatus} — never read from a stored copy — so it is globally
 * consistent and self-heals to `offline` once the heartbeat ages out. A
 * satellite with no recorded lifecycle edge yet (never connected,
 * `lastConnectionEvent === null`) has no entity state, so this returns `null`
 * and the `read` accessor omits the id — exactly the `prev === null` (create)
 * signal the framework needs on the first connect.
 */
export function toSatelliteConnectionState(
  row: SatelliteConnectionRow,
): SatelliteConnectionState | null {
  if (row.lastConnectionEvent === null) {
    return null;
  }
  return {
    status: computeStatus({
        lastHeartbeatAt: row.lastHeartbeatAt,
        offlineThresholdMs: row.offlineThresholdMs,
      }),
    name: row.name,
    region: row.region,
    lastSeenAt: row.lastHeartbeatAt ? row.lastHeartbeatAt.toISOString() : null,
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
