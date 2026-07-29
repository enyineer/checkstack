import { eq, inArray } from "drizzle-orm";
import { satellites } from "./schema";
import * as schema from "./schema";
import type { SafeDatabase } from "@checkstack/backend-api";
import type { SatelliteWithStatus } from "@checkstack/satellite-common";
import {
  toSatelliteConnectionState,
  type SatelliteConnectionEvent,
  type SatelliteConnectionState,
} from "./entity";
import { computeStatus } from "./status";

// Drizzle type helper
type Db = SafeDatabase<typeof schema>;

/**
 * A fixed, valid bcrypt hash used as a decoy when a `clientId` does not exist.
 * Verifying the supplied token against this decoy makes the missing-clientId
 * path do the SAME amount of (constant-time) bcrypt work as the wrong-token
 * path, so an attacker cannot use response timing to learn which client IDs
 * exist (enumeration / timing oracle). The decoy is a hash of a random value;
 * no real token can ever match it. cost 10 matches the cost used for real
 * satellite tokens so the timings line up.
 */
const DECOY_TOKEN_HASH =
  "$2b$10$C5yFDCdJ9bpPgF8MIqBKMO1IrYwobQF5oAiHKmrr8lmCV6bfNbgUW";

/**
 * Service for managing satellite records.
 */
export class SatelliteService {
  constructor(private db: Db) {}

  /**
   * Create a new satellite.
   * Generates a cryptographically random token, stores a bcrypt hash,
   * and returns the plaintext token (shown once to the user).
   */
  async createSatellite(props: {
    name: string;
    region: string;
    tags: Record<string, string>;
    /** Offline tolerance override; omit to follow the platform default. */
    offlineThresholdMs?: number;
  }): Promise<{ satellite: SatelliteWithStatus; plaintextToken: string }> {
    const { name, region, tags, offlineThresholdMs } = props;

    // Generate a cryptographically random token with a recognizable prefix
    const randomBytes = crypto.getRandomValues(new Uint8Array(32));
    const tokenBody = Buffer.from(randomBytes).toString("base64url");
    const plaintextToken = `csat_${tokenBody}`;

    // Hash the token using bcrypt
    const tokenHash = await Bun.password.hash(plaintextToken, {
      algorithm: "bcrypt",
      cost: 10,
    });

    const [row] = await this.db
      .insert(satellites)
      .values({
        name,
        region,
        tags,
        tokenHash,
        offlineThresholdMs: offlineThresholdMs ?? null,
      })
      .returning();

    const satellite: SatelliteWithStatus = {
      id: row.id,
      name: row.name,
      region: row.region,
      tags: row.tags,
      capabilities: row.capabilities,
      lastHeartbeatAt: row.lastHeartbeatAt ?? undefined,
      offlineThresholdMs: row.offlineThresholdMs ?? undefined,
      version: row.version ?? undefined,
      createdAt: row.createdAt,
      status: "offline",
    };

    return { satellite, plaintextToken };
  }

  /**
   * Delete a satellite by ID.
   */
  async deleteSatellite(id: string): Promise<void> {
    await this.db.delete(satellites).where(eq(satellites.id, id));
  }

  /**
   * Update a satellite's metadata (name, region, tags). Token is left intact —
   * use `rotateSatelliteToken` to issue a new one.
   */
  async updateSatelliteMetadata(props: {
    id: string;
    name?: string;
    region?: string;
    tags?: Record<string, string>;
    /**
     * `null` clears the override (back to the platform default); `undefined`
     * leaves the current value untouched. The two must stay distinguishable,
     * or clearing an override would be impossible.
     */
    offlineThresholdMs?: number | null;
  }): Promise<SatelliteWithStatus | undefined> {
    const updates: Partial<typeof satellites.$inferInsert> = {};
    if (props.name !== undefined) updates.name = props.name;
    if (props.region !== undefined) updates.region = props.region;
    if (props.tags !== undefined) updates.tags = props.tags;
    if (props.offlineThresholdMs !== undefined) {
      updates.offlineThresholdMs = props.offlineThresholdMs;
    }
    if (Object.keys(updates).length === 0) return this.getSatellite(props.id);

    const [row] = await this.db
      .update(satellites)
      .set(updates)
      .where(eq(satellites.id, props.id))
      .returning();
    return row ? this.toSatelliteWithStatus(row) : undefined;
  }

  /**
   * Rotate the token for an existing satellite. Generates a fresh plaintext
   * token, stores its bcrypt hash, and returns the plaintext for one-time
   * display. The previous token is invalidated immediately.
   */
  async rotateSatelliteToken(
    id: string,
  ): Promise<{ satellite: SatelliteWithStatus; plaintextToken: string } | undefined> {
    const randomBytes = crypto.getRandomValues(new Uint8Array(32));
    const tokenBody = Buffer.from(randomBytes).toString("base64url");
    const plaintextToken = `csat_${tokenBody}`;

    const tokenHash = await Bun.password.hash(plaintextToken, {
      algorithm: "bcrypt",
      cost: 10,
    });

    const [row] = await this.db
      .update(satellites)
      .set({ tokenHash })
      .where(eq(satellites.id, id))
      .returning();
    if (!row) return undefined;

    return {
      satellite: this.toSatelliteWithStatus(row),
      plaintextToken,
    };
  }

  /**
   * Lookup helper — returns a satellite by its `name`. Used by GitOps to
   * resolve a YAML-declared satellite name to the persisted UUID.
   */
  async getSatelliteByName(name: string): Promise<SatelliteWithStatus | undefined> {
    const [row] = await this.db
      .select()
      .from(satellites)
      .where(eq(satellites.name, name));
    return row ? this.toSatelliteWithStatus(row) : undefined;
  }

  /**
   * List all satellites with computed online/offline status.
   */
  async listSatellites(): Promise<SatelliteWithStatus[]> {
    const rows = await this.db.select().from(satellites);
    return rows.map((row) => this.toSatelliteWithStatus(row));
  }

  /**
   * Get a single satellite by ID.
   */
  async getSatellite(id: string): Promise<SatelliteWithStatus | undefined> {
    const [row] = await this.db
      .select()
      .from(satellites)
      .where(eq(satellites.id, id));
    return row ? this.toSatelliteWithStatus(row) : undefined;
  }

  /**
   * Validate a satellite token using clientId for O(1) lookup.
   * Returns the satellite record if valid, undefined otherwise.
   */
  async validateToken(props: {
    clientId: string;
    token: string;
  }): Promise<SatelliteWithStatus | undefined> {
    const { clientId, token } = props;

    const [row] = await this.db
      .select()
      .from(satellites)
      .where(eq(satellites.id, clientId));

    // Always run a bcrypt verify, even when the clientId is unknown: verify the
    // token against a decoy hash so the missing-clientId path costs the same as
    // the wrong-token path. This removes the timing oracle that would otherwise
    // let an attacker enumerate which client IDs exist. bcrypt.verify is itself
    // constant-time, so a real wrong token and the decoy both take ~equal time.
    const hashToCheck = row?.tokenHash ?? DECOY_TOKEN_HASH;
    const isValid = await Bun.password.verify(token, hashToCheck);

    if (!row || !isValid) return undefined;

    return this.toSatelliteWithStatus(row);
  }

  /**
   * Update heartbeat timestamp and version for a satellite.
   */
  async updateHeartbeat(
    id: string,
    props: { version?: string },
  ): Promise<void> {
    await this.db
      .update(satellites)
      .set({
        lastHeartbeatAt: new Date(),
        version: props.version ?? undefined,
      })
      .where(eq(satellites.id, id));
  }

  /**
   * Persist the capabilities a satellite advertised on connect/heartbeat.
   * Idempotent; called whenever an `authenticate` / `heartbeat` carries a
   * capabilities list (an older agent omits it and we leave the column as-is).
   */
  async updateCapabilities(
    id: string,
    capabilities: string[],
  ): Promise<void> {
    await this.db
      .update(satellites)
      .set({ capabilities })
      .where(eq(satellites.id, id));
  }

  /**
   * Get IDs of all satellites currently considered online.
   */
  async getOnlineSatelliteIds(): Promise<string[]> {
    const rows = await this.db
      .select({
        id: satellites.id,
        lastHeartbeatAt: satellites.lastHeartbeatAt,
        offlineThresholdMs: satellites.offlineThresholdMs,
      })
      .from(satellites);

    return rows
      .filter((row) => computeStatus({
        lastHeartbeatAt: row.lastHeartbeatAt,
        offlineThresholdMs: row.offlineThresholdMs,
      }) === "online")
      .map((row) => row.id);
  }

  /**
   * Batched durable read for the `satellite-connection` entity (Model B
   * plugin-backed `read` accessor). Given satellite ids, return the reactive
   * `SatelliteConnectionState` for each that exists AND has connected at least
   * once (missing / never-connected ids omitted). The reactive `status` is
   * COMPUTED on read from the durable `lastHeartbeatAt` column (the single
   * liveness source of truth, shared by every pod) — never read from a stored
   * status copy — so any pod sees the same answer AND a stale row self-heals to
   * `offline` once the heartbeat ages out, even after a pod crash. Only
   * `lastConnectionEvent` is read additionally (the deriver's discriminator).
   * This is the single source of truth `handle.mutate` snapshots `prev` from and
   * `get` / `getMany` / scope enrichment / `wait_until` re-eval route through.
   */
  async getManyConnectionStates(
    ids: ReadonlyArray<string>,
  ): Promise<Record<string, SatelliteConnectionState>> {
    if (ids.length === 0) return {};

    const rows = await this.db
      .select({
        id: satellites.id,
        name: satellites.name,
        region: satellites.region,
        lastHeartbeatAt: satellites.lastHeartbeatAt,
        offlineThresholdMs: satellites.offlineThresholdMs,
        lastConnectionEvent: satellites.lastConnectionEvent,
      })
      .from(satellites)
      .where(inArray(satellites.id, [...ids]));

    const out: Record<string, SatelliteConnectionState> = {};
    for (const row of rows) {
      const state = toSatelliteConnectionState({
        name: row.name,
        region: row.region,
        lastHeartbeatAt: row.lastHeartbeatAt,
        offlineThresholdMs: row.offlineThresholdMs,
        lastConnectionEvent: row.lastConnectionEvent,
      });
      if (state) out[row.id] = state;
    }
    return out;
  }

  /**
   * Read every satellite's durable liveness inputs `(lastHeartbeatAt,
   * lastConnectionEvent)`. Used by the heartbeat monitor to detect the
   * online→offline (heartbeat-lost) edge from DURABLE state alone — no pod-local
   * baseline — so detection works on ANY pod and is idempotent across pods /
   * redelivery. The monitor computes status from `lastHeartbeatAt` itself.
   */
  async listConnectionLiveness(): Promise<
    Array<{
      id: string;
      name: string;
      region: string;
      lastHeartbeatAt: Date | null;
      offlineThresholdMs: number | null;
      lastConnectionEvent: SatelliteConnectionEvent | null;
    }>
  > {
    return this.db
      .select({
        id: satellites.id,
        name: satellites.name,
        region: satellites.region,
        lastHeartbeatAt: satellites.lastHeartbeatAt,
        offlineThresholdMs: satellites.offlineThresholdMs,
        lastConnectionEvent: satellites.lastConnectionEvent,
      })
      .from(satellites);
  }

  /**
   * Durable write for a `satellite-connection` lifecycle edge (the `apply`
   * body of `handle.mutate`). UPDATEs the satellite's liveness columns in the
   * shared `satellites` table and returns the resulting reactive view (`next`),
   * whose `status` is COMPUTED from the just-written `lastHeartbeatAt`. The
   * caller passes the new `lastHeartbeatAt` explicitly so each edge controls
   * liveness directly:
   *   - connect / reconnect → `now` (computes online),
   *   - clean disconnect    → `null` (computes offline immediately),
   *   - heartbeat-lost      → unchanged (`undefined` leaves the column as the
   *     already-aged value, which still computes offline) — only
   *     `lastConnectionEvent` flips, which is what makes monitor detection
   *     idempotent.
   * The pod that owns the socket (or any pod, for heartbeat-lost) is the writer;
   * every other pod reads the new state via {@link getManyConnectionStates}.
   * Throws when the satellite no longer exists (a write against a deleted
   * satellite is a no-op caller error).
   */
  async applyConnectionState(props: {
    satelliteId: string;
    lastEvent: SatelliteConnectionEvent;
    /** New heartbeat timestamp, or `null` to clear it. Omit to leave unchanged. */
    lastHeartbeatAt?: Date | null;
  }): Promise<SatelliteConnectionState> {
    const { satelliteId, lastEvent, lastHeartbeatAt } = props;

    const updates: Partial<typeof satellites.$inferInsert> = {
      lastConnectionEvent: lastEvent,
    };
    if (lastHeartbeatAt !== undefined) {
      updates.lastHeartbeatAt = lastHeartbeatAt;
    }

    const [row] = await this.db
      .update(satellites)
      .set(updates)
      .where(eq(satellites.id, satelliteId))
      .returning();

    if (!row) {
      throw new Error(
        `Cannot apply connection state: satellite ${satelliteId} not found`,
      );
    }

    return {
      status: computeStatus({
        lastHeartbeatAt: row.lastHeartbeatAt,
        offlineThresholdMs: row.offlineThresholdMs,
      }),
      name: row.name,
      region: row.region,
      lastSeenAt: row.lastHeartbeatAt
        ? row.lastHeartbeatAt.toISOString()
        : null,
      lastEvent,
    };
  }

  /**
   * Map a database row to SatelliteWithStatus (excludes tokenHash).
   */
  private toSatelliteWithStatus(
    row: typeof satellites.$inferSelect,
  ): SatelliteWithStatus {
    return {
      id: row.id,
      name: row.name,
      region: row.region,
      tags: row.tags,
      capabilities: row.capabilities,
      lastHeartbeatAt: row.lastHeartbeatAt ?? undefined,
      offlineThresholdMs: row.offlineThresholdMs ?? undefined,
      version: row.version ?? undefined,
      createdAt: row.createdAt,
      status: computeStatus({
        lastHeartbeatAt: row.lastHeartbeatAt,
        offlineThresholdMs: row.offlineThresholdMs,
      }),
    };
  }
}
