import { and, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
import * as schema from "./schema";
import type { AiMemoryRow } from "./schema";
import { tokenize } from "./tools/rank-docs";
import { scrubContent } from "./chat/scrub-content";

type AiDatabase = SafeDatabase<typeof schema>;

export type AiMemoryScope = "user" | "system";

/**
 * Durable operator-memory persistence (state-and-scale §9: shared Postgres,
 * identical on every pod). Scoping is enforced HERE, not assumed: every method
 * takes explicit owner / readable-system / manageable-system params and filters
 * on them, so a `user` memory is never visible to another principal and a
 * `system` memory is only returned/deleted for systems the caller may
 * read/manage. The caller (tool execute / RPC handler) resolves those id sets
 * from the principal via the per-system access resolver.
 */
export interface AiMemoryStore {
  /**
   * Insert a new memory, or UPDATE a near-duplicate in place (dedup) so
   * re-encountering the same fact never spawns a second row or a repeat
   * confirmation. Returns whether an existing memory was updated.
   */
  saveOrUpdate(input: SaveMemoryInput): Promise<{ row: AiMemoryRow; updated: boolean }>;
  /** The dedup target `saveOrUpdate` would hit, without writing (for dry-run previews). */
  findDuplicate(args: DuplicateQuery): Promise<AiMemoryRow | undefined>;
  /** Ranked recall: owner's `user` memories + `system` memories for readable systems. */
  search(args: {
    ownerId: string;
    readableSystemIds: string[];
    query: string;
    limit?: number;
  }): Promise<AiMemoryRow[]>;
  /** All visible memories (no query), most-recent first — for the UI. */
  list(args: { ownerId: string; readableSystemIds: string[] }): Promise<AiMemoryRow[]>;
  /** Delete IF the caller is authorized: owner for `user`, system-manage for `system`. */
  delete(args: {
    id: string;
    ownerId: string;
    manageableSystemIds: string[];
  }): Promise<boolean>;
  /** Distinct system ids that have a `system`-scoped memory (to gate recall). */
  systemIdsWithMemories(): Promise<string[]>;
  /** Fetch one row by id with no scope check (caller enforces authority). */
  findById(id: string): Promise<AiMemoryRow | undefined>;
  /** Visible memories flagged `alwaysInject` — prepended to the system prompt. */
  listAlwaysInject(args: {
    ownerId: string;
    readableSystemIds: string[];
  }): Promise<AiMemoryRow[]>;
  /** Toggle a memory's `alwaysInject` IF authorized (owner / system-manage). */
  setAlwaysInject(args: {
    id: string;
    ownerId: string;
    manageableSystemIds: string[];
    alwaysInject: boolean;
  }): Promise<boolean>;
}

export interface SaveMemoryInput {
  ownerId: string;
  scope: AiMemoryScope;
  systemId?: string;
  recallHint: string;
  content: string;
  tags?: string[];
  /** Prepend to the system prompt every turn (always-apply preference). */
  alwaysInject?: boolean;
  sourceConversationId?: string;
}

interface DuplicateQuery {
  ownerId: string;
  scope: AiMemoryScope;
  systemId?: string;
  recallHint: string;
}

/**
 * Two recall hints are "the same memory" when their token sets overlap at or
 * above this Jaccard ratio. Above it, `saveOrUpdate` supersedes in place rather
 * than adding a near-duplicate row.
 */
export const DEDUP_THRESHOLD = 0.6;

/** BM25-style term-frequency saturation (k1 = 1.5); bounded, diminishing returns. */
function saturate(tf: number): number {
  if (tf <= 0) return 0;
  return (tf * 2.5) / (tf + 1.5);
}

/** Jaccard similarity of two strings' token sets (0..1). Pure; unit-tested. */
export function recallHintSimilarity(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared += 1;
  return shared / (setA.size + setB.size - shared);
}

/**
 * Relevance of a memory to a query: saturated term frequency across the recall
 * hint (weight 3), tags (2), and content (1). Pure; unit-tested. A score of 0
 * means no query token appears.
 */
export function scoreMemory(
  query: string,
  memory: { recallHint: string; content: string; tags?: string[] | null },
): number {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return 0;
  const hintCounts = termCounts(memory.recallHint);
  const tagCounts = termCounts((memory.tags ?? []).join(" "));
  const contentCounts = termCounts(memory.content);
  let score = 0;
  for (const token of queryTokens) {
    score += 3 * saturate(hintCounts.get(token) ?? 0);
    score += 2 * saturate(tagCounts.get(token) ?? 0);
    score += 1 * saturate(contentCounts.get(token) ?? 0);
  }
  return score;
}

function termCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tokenize(text)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}

/** Scrub credential-shaped values from a free-text field before persisting. */
function scrubText(text: string): string {
  const scrubbed = scrubContent({ value: text });
  return typeof scrubbed.value === "string" ? scrubbed.value : text;
}

/**
 * The single, authoritative rule for what a viewer may see:
 *
 *  - a `user` memory: ONLY its owner; never another principal.
 *  - a `system` memory: ONLY when its system is in the viewer's readable set.
 *
 * Pure and exhaustively unit-tested. The SQL {@link visibilityClause} mirrors it
 * for an efficient pre-filter, but this predicate is applied again as the LAST
 * word on every read path, so a mistake in the SQL can never leak a memory.
 */
export function isMemoryVisibleTo(
  memory: { scope: AiMemoryScope; ownerId: string; systemId: string | null },
  viewer: { ownerId: string; readableSystemIds: readonly string[] },
): boolean {
  if (memory.scope === "user") return memory.ownerId === viewer.ownerId;
  return (
    memory.systemId !== null &&
    viewer.readableSystemIds.includes(memory.systemId)
  );
}

/** WHERE clause for the memories a (owner, readable-systems) caller may see. */
function visibilityClause(ownerId: string, readableSystemIds: string[]): SQL {
  const userClause = and(
    eq(schema.aiMemory.scope, "user"),
    eq(schema.aiMemory.ownerId, ownerId),
  );
  if (readableSystemIds.length === 0) return userClause as SQL;
  const systemClause = and(
    eq(schema.aiMemory.scope, "system"),
    inArray(schema.aiMemory.systemId, readableSystemIds),
  );
  return or(userClause, systemClause) as SQL;
}

/** WHERE clause for memories a caller may MANAGE: owner (`user`) or system-manage. */
function manageAuthority(ownerId: string, manageableSystemIds: string[]): SQL {
  const ownsUser = and(
    eq(schema.aiMemory.scope, "user"),
    eq(schema.aiMemory.ownerId, ownerId),
  );
  if (manageableSystemIds.length === 0) return ownsUser as SQL;
  return or(
    ownsUser,
    and(
      eq(schema.aiMemory.scope, "system"),
      inArray(schema.aiMemory.systemId, manageableSystemIds),
    ),
  ) as SQL;
}

export function createAiMemoryStore({ db }: { db: AiDatabase }): AiMemoryStore {
  async function findDuplicate({
    ownerId,
    scope,
    systemId,
    recallHint,
  }: DuplicateQuery): Promise<AiMemoryRow | undefined> {
    // user dedup is within the owner; system dedup is within the system (shared).
    const candidates = await db
      .select()
      .from(schema.aiMemory)
      .where(
        scope === "system" && systemId
          ? and(
              eq(schema.aiMemory.scope, "system"),
              eq(schema.aiMemory.systemId, systemId),
            )
          : and(
              eq(schema.aiMemory.scope, "user"),
              eq(schema.aiMemory.ownerId, ownerId),
            ),
      );
    let best: AiMemoryRow | undefined;
    let bestScore = 0;
    for (const row of candidates) {
      const sim = recallHintSimilarity(recallHint, row.recallHint);
      if (sim >= DEDUP_THRESHOLD && sim > bestScore) {
        best = row;
        bestScore = sim;
      }
    }
    return best;
  }

  return {
    findDuplicate,

    async saveOrUpdate(input) {
      const recallHint = scrubText(input.recallHint);
      const content = scrubText(input.content);
      const existing = await findDuplicate(input);
      if (existing) {
        const [row] = await db
          .update(schema.aiMemory)
          .set({
            recallHint,
            content,
            tags: input.tags,
            alwaysInject: input.alwaysInject ?? false,
            sourceConversationId: input.sourceConversationId,
            updatedAt: new Date(),
          })
          .where(eq(schema.aiMemory.id, existing.id))
          .returning();
        return { row, updated: true };
      }
      const [row] = await db
        .insert(schema.aiMemory)
        .values({
          ownerId: input.ownerId,
          scope: input.scope,
          systemId: input.scope === "system" ? input.systemId : null,
          recallHint,
          content,
          tags: input.tags,
          alwaysInject: input.alwaysInject ?? false,
          sourceConversationId: input.sourceConversationId,
        })
        .returning();
      return { row, updated: false };
    },

    async search({ ownerId, readableSystemIds, query, limit = 10 }) {
      const rows = await db
        .select()
        .from(schema.aiMemory)
        .where(visibilityClause(ownerId, readableSystemIds));
      return rows
        .filter((row) => isMemoryVisibleTo(row, { ownerId, readableSystemIds }))
        .map((row) => ({ row, score: scoreMemory(query, row) }))
        .filter((r) => r.score > 0)
        .toSorted((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((r) => r.row);
    },

    async list({ ownerId, readableSystemIds }) {
      const rows = await db
        .select()
        .from(schema.aiMemory)
        .where(visibilityClause(ownerId, readableSystemIds))
        .orderBy(desc(schema.aiMemory.updatedAt));
      // Final authoritative gate (defence-in-depth over the SQL clause).
      return rows.filter((row) =>
        isMemoryVisibleTo(row, { ownerId, readableSystemIds }),
      );
    },

    async delete({ id, ownerId, manageableSystemIds }) {
      const deleted = await db
        .delete(schema.aiMemory)
        .where(
          and(eq(schema.aiMemory.id, id), manageAuthority(ownerId, manageableSystemIds)),
        )
        .returning({ id: schema.aiMemory.id });
      return deleted.length > 0;
    },

    async listAlwaysInject({ ownerId, readableSystemIds }) {
      const rows = await db
        .select()
        .from(schema.aiMemory)
        .where(
          and(
            eq(schema.aiMemory.alwaysInject, true),
            visibilityClause(ownerId, readableSystemIds),
          ),
        )
        .orderBy(desc(schema.aiMemory.updatedAt));
      // Authoritative gate again (defence-in-depth over the SQL clause).
      return rows.filter((row) =>
        isMemoryVisibleTo(row, { ownerId, readableSystemIds }),
      );
    },

    async setAlwaysInject({ id, ownerId, manageableSystemIds, alwaysInject }) {
      const updated = await db
        .update(schema.aiMemory)
        .set({ alwaysInject, updatedAt: new Date() })
        .where(
          and(eq(schema.aiMemory.id, id), manageAuthority(ownerId, manageableSystemIds)),
        )
        .returning({ id: schema.aiMemory.id });
      return updated.length > 0;
    },

    async systemIdsWithMemories() {
      const rows = await db
        .selectDistinct({ systemId: schema.aiMemory.systemId })
        .from(schema.aiMemory)
        .where(eq(schema.aiMemory.scope, "system"));
      return rows
        .map((r) => r.systemId)
        .filter((s): s is string => typeof s === "string" && s.length > 0);
    },

    async findById(id) {
      const rows = await db
        .select()
        .from(schema.aiMemory)
        .where(eq(schema.aiMemory.id, id))
        .limit(1);
      return rows[0];
    },
  };
}
