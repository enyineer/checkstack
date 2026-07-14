import type { SafeDatabase } from "@checkstack/backend-api";
import { and, desc, eq } from "drizzle-orm";
import {
  TRACESTREAM_TOKEN_DISPLAY_PREFIX_LENGTH,
  type TraceStreamToken,
} from "@checkstack/tracestream-common";
import * as schema from "../../schema";
import { traceStreamTokens } from "../../schema";
import type { TokenStore } from "../ports";

type Db = SafeDatabase<typeof schema>;

type TokenRow = typeof traceStreamTokens.$inferSelect;

function mapRow(row: TokenRow): TraceStreamToken {
  return {
    id: row.id,
    streamId: row.streamId,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  };
}

export function createTokenStore({ db }: { db: Db }): TokenStore {
  return {
    async insert({ streamId, name, tokenHash, tokenPrefix }) {
      const id = crypto.randomUUID();
      const [row] = await db
        .insert(traceStreamTokens)
        .values({
          id,
          streamId,
          name,
          tokenHash,
          tokenPrefix: tokenPrefix.slice(
            0,
            TRACESTREAM_TOKEN_DISPLAY_PREFIX_LENGTH,
          ),
          lastUsedAt: null,
          revokedAt: null,
        })
        .returning();
      return mapRow(row);
    },

    async list({ streamId }) {
      const rows = await db
        .select()
        .from(traceStreamTokens)
        .where(eq(traceStreamTokens.streamId, streamId))
        .orderBy(desc(traceStreamTokens.createdAt));
      return rows.map((row) => mapRow(row));
    },

    async revoke({ streamId, tokenId }) {
      const [row] = await db
        .update(traceStreamTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(traceStreamTokens.id, tokenId),
            eq(traceStreamTokens.streamId, streamId),
          ),
        )
        .returning({ tokenHash: traceStreamTokens.tokenHash });
      return row ? { tokenHash: row.tokenHash } : null;
    },

    async touchLastUsed({ tokenHash, at }) {
      await db
        .update(traceStreamTokens)
        .set({ lastUsedAt: at })
        .where(eq(traceStreamTokens.tokenHash, tokenHash));
    },

    async lookupByHash({ tokenHash }) {
      const [row] = await db
        .select({
          tokenId: traceStreamTokens.id,
          streamId: traceStreamTokens.streamId,
          revokedAt: traceStreamTokens.revokedAt,
        })
        .from(traceStreamTokens)
        .where(eq(traceStreamTokens.tokenHash, tokenHash))
        .limit(1);
      return row ?? null;
    },

    async listHashesForStream({ streamId }) {
      const rows = await db
        .select({ tokenHash: traceStreamTokens.tokenHash })
        .from(traceStreamTokens)
        .where(eq(traceStreamTokens.streamId, streamId));
      return rows.map((r) => r.tokenHash);
    },

    async deleteAllForStream({ streamId }) {
      await db
        .delete(traceStreamTokens)
        .where(eq(traceStreamTokens.streamId, streamId));
    },
  };
}
