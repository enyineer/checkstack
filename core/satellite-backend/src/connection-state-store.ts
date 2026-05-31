/**
 * In-memory current-state store for the reactive `satellite-connection`
 * entity (Model B PLUGIN-BACKED, reactive automation engine §10.6, §9.1).
 *
 * Satellite connection state has NO durable home of its own — it lives only
 * for the lifetime of the connection. The authoritative current state is this
 * process-local map; the framework still records full transition HISTORY in
 * `entity_transitions` for every change. This is exactly the "in-memory
 * current state, durable platform history" design the architecture calls for.
 *
 * Three lifecycle sites write through `handle.mutate` whose `apply` updates
 * this map (and returns the view): the WS handler (connect / disconnect) and
 * the heartbeat monitor (heartbeat-lost). One shared store backs both the
 * entity `read` accessor and the `apply` writes, so a connect, a disconnect,
 * and a heartbeat-lost on the same satellite diff against the right `prev`.
 *
 * `apply` in a plugin-backed `handle.mutate` receives NO framework tx — the
 * plugin owns its own storage. An in-memory map needs no transaction, so the
 * writes here are plain synchronous map mutations wrapped to satisfy the
 * async `apply` contract.
 */
import type { SatelliteConnectionState } from "./entity";

/**
 * The process-local source of truth for satellite connection state, keyed by
 * `satelliteId`. Backs the entity `read` accessor and the three lifecycle
 * `apply` writes.
 */
export interface ConnectionStateStore {
  /**
   * Batched read for the entity `read` accessor (Model B). Missing ids
   * (e.g. a satellite that never connected on this instance) are omitted.
   */
  readMany(
    ids: ReadonlyArray<string>,
  ): Promise<Record<string, SatelliteConnectionState>>;
  /**
   * Upsert the connection state for `satelliteId` and return it (so it can be
   * the `apply` return = `next`). Used by the connect / disconnect /
   * heartbeat-lost lifecycle sites.
   */
  write(args: {
    satelliteId: string;
    state: SatelliteConnectionState;
  }): SatelliteConnectionState;
  /** Drop a satellite's connection state (e.g. on satellite removal). */
  remove(satelliteId: string): void;
}

export function createConnectionStateStore(): ConnectionStateStore {
  const rows = new Map<string, SatelliteConnectionState>();
  return {
    async readMany(ids) {
      const out: Record<string, SatelliteConnectionState> = {};
      for (const id of ids) {
        const row = rows.get(id);
        if (row) out[id] = row;
      }
      return out;
    },
    write({ satelliteId, state }) {
      rows.set(satelliteId, state);
      return state;
    },
    remove(satelliteId) {
      rows.delete(satelliteId);
    },
  };
}
