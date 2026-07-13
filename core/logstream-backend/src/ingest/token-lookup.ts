/**
 * Source-token lookup against `log_stream_tokens`. Lives in the ingest area (not
 * `storage/`) because it is an ingest-auth concern: it resolves a token HASH to
 * its stream + revocation state. Keyed on the uniquely-indexed `tokenHash`.
 */

import type { SafeDatabase } from "@checkstack/backend-api";
import { eq } from "drizzle-orm";
import * as schema from "../schema";
import { logStreamTokens } from "../schema";

export interface TokenRow {
  tokenId: string;
  streamId: string;
  tokenHash: string;
  revokedAt: Date | null;
}

/** Look up a token by its sha256 hex hash, or null when unknown. */
export async function lookupTokenByHash({
  db,
  tokenHash,
}: {
  db: SafeDatabase<typeof schema>;
  tokenHash: string;
}): Promise<TokenRow | null> {
  const [row] = await db
    .select({
      tokenId: logStreamTokens.id,
      streamId: logStreamTokens.streamId,
      tokenHash: logStreamTokens.tokenHash,
      revokedAt: logStreamTokens.revokedAt,
    })
    .from(logStreamTokens)
    .where(eq(logStreamTokens.tokenHash, tokenHash))
    .limit(1);
  return row ?? null;
}
