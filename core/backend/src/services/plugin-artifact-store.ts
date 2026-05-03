import { createHash } from "node:crypto";
import { eq, and } from "drizzle-orm";
import type {
  PluginArtifactStore,
  SafeDatabase,
} from "@checkstack/backend-api";
import { pluginArtifacts } from "../schema";

/**
 * Postgres-backed artifact store.
 *
 * Tarball bytes are stored as base64-encoded `text` (drizzle's `bytea`
 * support is awkward and this keeps the column portable). The 33% size
 * overhead is fine at our hard cap (50 MB per artifact).
 *
 * Sharing the row across instances means a freshly spun replica can
 * recover any runtime-installed plugin from the same Postgres the rest
 * of the platform already depends on — no new infra.
 */
const MAX_ARTIFACT_SIZE = 50 * 1024 * 1024;

export class PostgresPluginArtifactStore implements PluginArtifactStore {
  readonly maxArtifactSize = MAX_ARTIFACT_SIZE;

  constructor(
    private readonly db: SafeDatabase<Record<string, unknown>>,
  ) {}

  async store({
    pluginName,
    version,
    bundleId,
    tarball,
  }: {
    pluginName: string;
    version: string;
    bundleId?: string | null;
    tarball: Uint8Array;
  }): Promise<{ artifactId: string; contentHash: string }> {
    if (tarball.byteLength > MAX_ARTIFACT_SIZE) {
      throw new Error(
        `Artifact exceeds maximum size: ${tarball.byteLength} > ${MAX_ARTIFACT_SIZE} bytes`,
      );
    }
    const contentHash = sha256Hex(tarball);
    const encoded = Buffer.from(tarball).toString("base64");

    // Upsert by (plugin_name, version): reinstalling the same version
    // overwrites — useful for replacing a corrupted artifact, harmless
    // when bytes are identical.
    const inserted = await this.db
      .insert(pluginArtifacts)
      .values({
        pluginName,
        version,
        bundleId: bundleId ?? null,
        tarball: encoded,
        contentHash,
        sizeBytes: tarball.byteLength,
      })
      .onConflictDoUpdate({
        target: [pluginArtifacts.pluginName, pluginArtifacts.version],
        set: {
          tarball: encoded,
          contentHash,
          sizeBytes: tarball.byteLength,
          bundleId: bundleId ?? null,
        },
      })
      .returning({ id: pluginArtifacts.id });

    return { artifactId: inserted[0].id, contentHash };
  }

  async fetch({
    pluginName,
    version,
  }: {
    pluginName: string;
    version: string;
  }): Promise<{ tarball: Uint8Array; contentHash: string } | undefined> {
    const rows = await this.db
      .select()
      .from(pluginArtifacts)
      .where(
        and(
          eq(pluginArtifacts.pluginName, pluginName),
          eq(pluginArtifacts.version, version),
        ),
      )
      .limit(1);
    if (rows.length === 0) return undefined;
    return {
      tarball: new Uint8Array(Buffer.from(rows[0].tarball, "base64")),
      contentHash: rows[0].contentHash,
    };
  }

  async fetchById(artifactId: string) {
    const rows = await this.db
      .select()
      .from(pluginArtifacts)
      .where(eq(pluginArtifacts.id, artifactId))
      .limit(1);
    if (rows.length === 0) return;
    return {
      tarball: new Uint8Array(Buffer.from(rows[0].tarball, "base64")),
      contentHash: rows[0].contentHash,
      pluginName: rows[0].pluginName,
      version: rows[0].version,
    };
  }

  async delete({ pluginName }: { pluginName: string }): Promise<void> {
    await this.db
      .delete(pluginArtifacts)
      .where(eq(pluginArtifacts.pluginName, pluginName));
  }

  async deleteByBundle({ bundleId }: { bundleId: string }): Promise<void> {
    await this.db
      .delete(pluginArtifacts)
      .where(eq(pluginArtifacts.bundleId, bundleId));
  }
}

function sha256Hex(bytes: Uint8Array): string {
  const h = createHash("sha256");
  h.update(bytes);
  return h.digest("hex");
}
