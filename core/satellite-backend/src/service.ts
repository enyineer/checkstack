import { eq, inArray } from "drizzle-orm";
import { satellites } from "./schema";
import * as schema from "./schema";
import type { SafeDatabase } from "@checkstack/backend-api";
import type {
  SatelliteWithStatus,
  SatelliteStatus,
} from "@checkstack/satellite-common";
import { OFFLINE_THRESHOLD_MS } from "@checkstack/satellite-common";
import {
  toSatelliteConnectionState,
  type SatelliteConnectionEvent,
  type SatelliteConnectionState,
} from "./entity";

// Drizzle type helper
type Db = SafeDatabase<typeof schema>;

/**
 * Compute satellite status from lastHeartbeatAt timestamp.
 */
function computeStatus(lastHeartbeatAt: Date | null): SatelliteStatus {
  if (!lastHeartbeatAt) return "offline";
  const elapsed = Date.now() - lastHeartbeatAt.getTime();
  return elapsed <= OFFLINE_THRESHOLD_MS ? "online" : "offline";
}

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
  }): Promise<{ satellite: SatelliteWithStatus; plaintextToken: string }> {
    const { name, region, tags } = props;

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
      })
      .returning();

    const satellite: SatelliteWithStatus = {
      id: row.id,
      name: row.name,
      region: row.region,
      tags: row.tags,
      lastHeartbeatAt: row.lastHeartbeatAt ?? undefined,
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
  }): Promise<SatelliteWithStatus | undefined> {
    const updates: Partial<typeof satellites.$inferInsert> = {};
    if (props.name !== undefined) updates.name = props.name;
    if (props.region !== undefined) updates.region = props.region;
    if (props.tags !== undefined) updates.tags = props.tags;
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

    if (!row) return undefined;

    const isValid = await Bun.password.verify(token, row.tokenHash);
    if (!isValid) return undefined;

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
   * Get IDs of all satellites currently considered online.
   */
  async getOnlineSatelliteIds(): Promise<string[]> {
    const rows = await this.db
      .select({ id: satellites.id, lastHeartbeatAt: satellites.lastHeartbeatAt })
      .from(satellites);

    return rows
      .filter((row) => computeStatus(row.lastHeartbeatAt) === "online")
      .map((row) => row.id);
  }

  /**
   * Batched durable read for the `satellite-connection` entity (Model B
   * plugin-backed `read` accessor). Given satellite ids, return the reactive
   * `SatelliteConnectionState` for each that exists AND has connected at least
   * once (missing / never-connected ids omitted). Reads the durable
   * `connectionStatus` / `lastSeenAt` / `lastConnectionEvent` columns from the
   * SHARED `satellites` table — so any pod sees the same state. This is the
   * single source of truth `handle.mutate` snapshots `prev` from and
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
        connectionStatus: satellites.connectionStatus,
        lastSeenAt: satellites.lastSeenAt,
        lastConnectionEvent: satellites.lastConnectionEvent,
      })
      .from(satellites)
      .where(inArray(satellites.id, [...ids]));

    const out: Record<string, SatelliteConnectionState> = {};
    for (const row of rows) {
      const state = toSatelliteConnectionState({
        status: row.connectionStatus,
        name: row.name,
        region: row.region,
        lastSeenAt: row.lastSeenAt,
        lastConnectionEvent: row.lastConnectionEvent,
      });
      if (state) out[row.id] = state;
    }
    return out;
  }

  /**
   * Durable write for a `satellite-connection` lifecycle edge (the `apply`
   * body of `handle.mutate`). UPDATEs the satellite's connection columns in the
   * shared `satellites` table and returns the resulting reactive view (`next`).
   * The pod that owns the socket is the writer; every other pod reads the new
   * state via {@link getManyConnectionStates}. Throws when the satellite no
   * longer exists (a write against a deleted satellite is a no-op caller error).
   */
  async applyConnectionState(props: {
    satelliteId: string;
    status: "online" | "offline";
    lastEvent: SatelliteConnectionEvent;
    lastSeenAt: Date;
  }): Promise<SatelliteConnectionState> {
    const { satelliteId, status, lastEvent, lastSeenAt } = props;

    const [row] = await this.db
      .update(satellites)
      .set({
        connectionStatus: status,
        lastConnectionEvent: lastEvent,
        lastSeenAt,
      })
      .where(eq(satellites.id, satelliteId))
      .returning();

    if (!row) {
      throw new Error(
        `Cannot apply connection state: satellite ${satelliteId} not found`,
      );
    }

    return {
      status,
      name: row.name,
      region: row.region,
      lastSeenAt: lastSeenAt.toISOString(),
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
      lastHeartbeatAt: row.lastHeartbeatAt ?? undefined,
      version: row.version ?? undefined,
      createdAt: row.createdAt,
      status: computeStatus(row.lastHeartbeatAt),
    };
  }
}
