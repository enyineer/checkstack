import { eq } from "drizzle-orm";
import { satellites } from "./schema";
import * as schema from "./schema";
import type { SafeDatabase } from "@checkstack/backend-api";
import type {
  SatelliteWithStatus,
  SatelliteStatus,
} from "@checkstack/satellite-common";
import { OFFLINE_THRESHOLD_MS } from "@checkstack/satellite-common";

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
