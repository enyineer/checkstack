import { eq } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
import { plugins } from "../../schema";
import { rootLogger } from "../../logger";
import { verifyRecordedDigest } from "./integrity";

/**
 * Re-verify a fetched artifact's bytes against the digest pinned on its
 * `plugins` row at install time, then (when no digest was recorded) backfill it.
 *
 * Behavior:
 *  - Recorded digest present + matches  → no-op, returns (load proceeds).
 *  - Recorded digest present + mismatch → throws (fail-closed; caller must
 *    refuse to load THIS plugin without crashing the whole boot).
 *  - No recorded digest (legacy / monorepo) → logs an info and records the
 *    freshly computed SHA-256 so future reloads are pinned. Load proceeds.
 *
 * The artifact bytes come from the shared `plugin_artifacts` table, so this is
 * scale-correct: every pod re-hashes the same authoritative bytes and reads the
 * same pinned digest from Postgres.
 */
export async function verifyAndBackfillArtifactDigest({
  db,
  pluginName,
  tarball,
  recordedDigest,
}: {
  db: SafeDatabase<Record<string, unknown>>;
  pluginName: string;
  tarball: Uint8Array;
  recordedDigest: string | null | undefined;
}): Promise<void> {
  const { outcome, sha256 } = verifyRecordedDigest({
    tarball,
    recordedDigest,
    pluginRef: pluginName,
  });

  if (outcome === "backfill") {
    rootLogger.info(
      `🔐 No integrity digest pinned for '${pluginName}'; recording sha256:${sha256} now.`,
    );
    await db
      .update(plugins)
      .set({ installedDigest: sha256 })
      .where(eq(plugins.name, pluginName));
    return;
  }

  rootLogger.debug(`🔐 Integrity re-verified for '${pluginName}' (sha256:${sha256}).`);
}
