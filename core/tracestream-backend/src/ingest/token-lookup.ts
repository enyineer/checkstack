/**
 * Source-token lookup against `trace_stream_tokens`, adapting the row to the
 * shared {@link IngestTokenRow} shape the ingest authenticator expects
 * (`resourceId` = the stream id). Keyed on the uniquely-indexed `tokenHash`.
 */

import type { SafeDatabase } from "@checkstack/backend-api";
import { eq } from "drizzle-orm";
import type { IngestTokenRow } from "@checkstack/ingest-utils";
import * as schema from "../schema";
import { traceStreamTokens } from "../schema";

/** Look up a tracestream source token by its sha256 hex hash, or null when unknown. */
export async function lookupTokenByHash({
  db,
  tokenHash,
}: {
  db: SafeDatabase<typeof schema>;
  tokenHash: string;
}): Promise<IngestTokenRow | null> {
  const [row] = await db
    .select({
      tokenId: traceStreamTokens.id,
      streamId: traceStreamTokens.streamId,
      tokenHash: traceStreamTokens.tokenHash,
      revokedAt: traceStreamTokens.revokedAt,
    })
    .from(traceStreamTokens)
    .where(eq(traceStreamTokens.tokenHash, tokenHash))
    .limit(1);
  if (!row) return null;
  return {
    tokenId: row.tokenId,
    resourceId: row.streamId,
    tokenHash: row.tokenHash,
    revokedAt: row.revokedAt,
  };
}
