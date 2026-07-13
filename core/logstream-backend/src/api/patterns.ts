/**
 * Custom-pattern operations: create / delete / test a user-authored Drain
 * pattern, and summarize a pattern's `<*>` variable positions for the
 * pattern-metric collector's picker. Split out of {@link LogstreamService} to
 * keep that file lean; the service spreads these into its public surface.
 *
 * RLAC is enforced upstream by the contract's `instanceAccess` (manage on the
 * stream for create/delete, read for test/list), so these functions never
 * re-check grants - they only read/write.
 */

import { createHash } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  withScopedTransaction,
  type EventBus,
  type Logger,
  type SafeDatabase,
  type ScopedTransaction,
} from "@checkstack/backend-api";
import {
  bandFromSeverityNumber,
  type CreatePattern,
  type DeletePattern,
  type LogPattern,
  type TestPattern,
  type TestPatternResult,
  type PatternMatchSample,
  type MaskLine,
  type MaskLineResult,
  type ListPatternVariables,
  type ListPatternVariablesResult,
  type PatternVariableSample,
} from "@checkstack/logstream-common";
import * as schema from "../schema";
import {
  logEvents,
  logPatterns,
  logPatternBuckets,
  logPatternHourly,
  logPatternVariableBuckets,
  logPatternVariableHourly,
} from "../schema";
import { WILDCARD, MAX_TOKENS, maskAndTokenize } from "../drain/masking";
// The single source of truth for user-pattern matching (shared with the Drain
// core, so classification and this dry-run preview agree by construction).
import {
  matchesTemplate,
  templateToTokens,
} from "../drain/user-pattern-matcher";
import {
  logstreamPatternsChangedHook,
  type LogstreamPatternsChangedPayload,
} from "../events/bus-hooks";
import type { FindReferencingChecks } from "../health/pattern-references";

type Db = SafeDatabase<typeof schema>;
type Tx = ScopedTransaction<typeof schema>;

/** Recent window (ms) scanned for the variable-picker summary (both tiers). */
const VARIABLE_SUMMARY_WINDOW_MS = 24 * 3_600_000;

/**
 * Hard cap on user-authored (`origin: 'user'`) patterns per stream. Every user
 * pattern is a PROTECTED Drain cluster that is never LRU-evicted and never aged
 * out by retention, and it is re-installed in memory on every pod - so an
 * unbounded set would grow each pod's parse tree without bound. 200 is generous
 * for hand-authored patterns while keeping the protected set bounded.
 */
export const MAX_USER_PATTERNS_PER_STREAM = 200;

/**
 * Deterministic user-pattern id. MUST match the Drain engine's `computePatternId`
 * byte-for-byte (`sha256(streamId + " " + template)`) so the row the API writes
 * and the cluster every pod installs converge on ONE id.
 */
export function computeUserPatternId({
  streamId,
  template,
}: {
  streamId: string;
  template: string;
}): string {
  return createHash("sha256")
    .update(streamId)
    .update(" ")
    .update(template)
    .digest("hex");
}

/**
 * Throw a friendly 4xx when the stream already holds
 * {@link MAX_USER_PATTERNS_PER_STREAM} user patterns. Counted INSIDE the caller's
 * transaction so the count-then-write is atomic against a concurrent create.
 */
async function assertUnderUserPatternCap({
  tx,
  streamId,
}: {
  tx: Tx;
  streamId: string;
}): Promise<void> {
  const [row] = await tx
    .select({ value: sql<string>`count(*)` })
    .from(logPatterns)
    .where(
      and(
        eq(logPatterns.streamId, streamId),
        eq(logPatterns.origin, "user"),
      ),
    );
  if (Number(row?.value ?? 0) >= MAX_USER_PATTERNS_PER_STREAM) {
    throw new ORPCError("BAD_REQUEST", {
      message: `This stream already has the maximum of ${MAX_USER_PATTERNS_PER_STREAM} custom patterns. Delete an existing custom pattern before adding another.`,
    });
  }
}

// ============================================================================
// OPERATIONS
// ============================================================================

export interface PatternOperations {
  createPattern(input: CreatePattern): Promise<LogPattern>;
  deletePattern(input: DeletePattern): Promise<void>;
  testPattern(input: TestPattern): Promise<TestPatternResult>;
  maskLine(input: MaskLine): Promise<MaskLineResult>;
  listPatternVariables(
    input: ListPatternVariables,
  ): Promise<ListPatternVariablesResult>;
}

export function createPatternOperations({
  db,
  eventBus,
  logger,
  findReferencingChecks,
  now = () => new Date(),
}: {
  db: Db;
  eventBus?: EventBus;
  logger: Logger;
  findReferencingChecks: FindReferencingChecks;
  now?: () => Date;
}): PatternOperations {
  /** Best-effort post-commit broadcast; never throws (durable row is truth). */
  async function emitPatternsChanged(
    payload: LogstreamPatternsChangedPayload,
  ): Promise<void> {
    if (!eventBus) return;
    try {
      await eventBus.emit(logstreamPatternsChangedHook, payload);
    } catch (error) {
      logger.warn(
        `logstream: failed to broadcast pattern change (${payload.action}): ${String(error)}`,
      );
    }
  }

  return {
    async createPattern({ streamId, template }) {
      const tokens = templateToTokens(template);
      // Validate in the MASKED-token space the builder authors in.
      if (tokens.length === 0 || tokens.length > MAX_TOKENS) {
        throw new ORPCError("BAD_REQUEST", {
          message: `A pattern must have between 1 and ${MAX_TOKENS} tokens.`,
        });
      }
      if (!tokens.some((t) => t !== WILDCARD && t.length > 0)) {
        throw new ORPCError("BAD_REQUEST", {
          message:
            "A pattern must contain at least one literal token - an all-`<*>` template would match every line.",
        });
      }

      const id = computeUserPatternId({ streamId, template });
      const at = now();

      // The cap check and the insert/promote must be one atomic unit, or two
      // concurrent creates could both pass the count and breach the cap.
      const row = await withScopedTransaction(db, async (tx) => {
        const [existing] = await tx
          .select({ origin: logPatterns.origin })
          .from(logPatterns)
          .where(and(eq(logPatterns.id, id), eq(logPatterns.streamId, streamId)))
          .limit(1);

        if (existing) {
          // A user pattern with this exact template already exists: a real
          // duplicate, reported as a 409 (never a silent overwrite).
          if (existing.origin === "user") {
            throw new ORPCError("CONFLICT", {
              message:
                "A pattern with this template already exists on this stream.",
            });
          }
          // The template was already MINED under this same id. "Create pattern
          // from this line" should not dead-end - PROMOTE the mined row to a
          // protected user pattern in place (keeping its counts, first/last-seen
          // and mined sample) rather than 409. Promotion joins the protected
          // set, so it is subject to the same per-stream cap.
          await assertUnderUserPatternCap({ tx, streamId });
          const [promoted] = await tx
            .update(logPatterns)
            .set({ origin: "user" })
            .where(
              and(eq(logPatterns.id, id), eq(logPatterns.streamId, streamId)),
            )
            .returning();
          return promoted!;
        }

        await assertUnderUserPatternCap({ tx, streamId });
        const [inserted] = await tx
          .insert(logPatterns)
          .values({
            id,
            streamId,
            template,
            tokenCount: tokens.length,
            firstSeenAt: at,
            lastSeenAt: at,
            // The template itself is the display sample for a user pattern.
            sampleBody: template,
            totalCount: 0,
            severityMax: 0,
            origin: "user",
          })
          // A row can still appear between the SELECT and here (e.g. ingest
          // mined it, or a racing create): fall through to a 409 rather than
          // overwrite. The user can retry, and the retry then promotes it.
          .onConflictDoNothing()
          .returning();
        if (!inserted) {
          throw new ORPCError("CONFLICT", {
            message:
              "A pattern with this template already exists on this stream.",
          });
        }
        return inserted;
      });

      // Post-commit: tell every pod to install (or re-pin as protected, on a
      // promotion) the user cluster now, instead of waiting for the next
      // hydration.
      await emitPatternsChanged({
        streamId,
        patternId: id,
        template,
        action: "upserted",
      });

      return mapPatternRow(row);
    },

    async deletePattern({ streamId, patternId }) {
      const [existing] = await db
        .select({ origin: logPatterns.origin })
        .from(logPatterns)
        .where(
          and(
            eq(logPatterns.id, patternId),
            eq(logPatterns.streamId, streamId),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new ORPCError("NOT_FOUND", { message: "Pattern not found" });
      }
      if (existing.origin !== "user") {
        // Mined patterns are owned by the Drain engine (learned from lines), not
        // the user; they age out via retention, never by hand.
        throw new ORPCError("BAD_REQUEST", {
          message:
            "Only user-authored patterns can be deleted. This pattern was mined automatically from log lines.",
        });
      }

      // Refuse to orphan a health check that references this pattern (its picker
      // label + `minutesSinceLastSeen` semantics would break). Name the checks
      // so the user can unassign them first.
      //
      // DELIBERATE cross-plugin name disclosure: the referencing check names come
      // from the healthcheck plugin. We expose them because the caller already
      // holds `manage` on THIS stream (enforced upstream by the contract's
      // instanceAccess), the names are the minimum needed to act on the 409
      // (unassign the offending checks), and without them the error is an
      // undebuggable dead-end. The tradeoff (a stream manager learns the names of
      // checks that reference the stream, which they can reach anyway) is
      // accepted over a useless "referenced by 3 checks" message.
      const referencingChecks = await findReferencingChecks({
        streamId,
        patternId,
      });
      if (referencingChecks.length > 0) {
        throw new ORPCError("CONFLICT", {
          message: `This pattern is used by ${referencingChecks.length} health check(s): ${referencingChecks.join(
            ", ",
          )}. Remove it from those checks before deleting the pattern.`,
        });
      }

      await db
        .delete(logPatterns)
        .where(
          and(
            eq(logPatterns.id, patternId),
            eq(logPatterns.streamId, streamId),
          ),
        );

      await emitPatternsChanged({
        streamId,
        patternId,
        // Template is not needed to REMOVE a cluster; consumers key on id.
        template: "",
        action: "removed",
      });
    },

    async testPattern({ streamId, template, sampleLimit }) {
      const templateTokens = templateToTokens(template);
      const rows = await db
        .select({ id: logEvents.id, body: logEvents.body })
        .from(logEvents)
        .where(eq(logEvents.streamId, streamId))
        .orderBy(desc(logEvents.ts), desc(logEvents.id))
        .limit(sampleLimit);

      let matchCount = 0;
      const samples: PatternMatchSample[] = [];
      for (const row of rows) {
        // Mask+tokenize the raw line the SAME way ingest does before matching,
        // so the dry-run mirrors real classification.
        const lineTokens = maskAndTokenize({ body: row.body });
        if (!matchesTemplate({ templateTokens, lineTokens })) continue;
        matchCount += 1;
        if (samples.length < 3) {
          samples.push({ id: String(row.id), body: row.body });
        }
      }
      return { matchCount, samples };
    },

    maskLine({ body }) {
      // Pure masker call (streamId is only for RLAC gating): the builder seeds
      // its chips from the SAME masked-token space ingest classifies in.
      return Promise.resolve({
        template: maskAndTokenize({ body }).join(" "),
      });
    },

    async listPatternVariables({ streamId, patternId }) {
      const [pattern] = await db
        .select({ template: logPatterns.template })
        .from(logPatterns)
        .where(
          and(
            eq(logPatterns.id, patternId),
            eq(logPatterns.streamId, streamId),
          ),
        )
        .limit(1);
      if (!pattern) return { variables: [] };

      // Wildcard positions of the template define the varIndex space (0-based,
      // left to right) - the same order ingest folds `wildcardValues` into.
      const wildcardCount = templateToTokens(pattern.template).filter(
        (t) => t === WILDCARD,
      ).length;
      if (wildcardCount === 0) return { variables: [] };

      // Cheap, honest summary from the pre-aggregated buckets over a recent
      // window: the variable buckets hold ONLY numeric samples (count/sum/min/
      // max), and the pattern buckets hold total occurrences - so `numericShare`
      // is a real fraction, and representative numeric samples come from
      // min/mean/max. (Raw non-numeric sample values would need the wildcard
      // extractor; the buckets are the authoritative, index-cheap numeric source
      // for a picker.)
      //
      // Read BOTH tiers and merge: a stream with a short `minuteRetentionHours`
      // has already rolled its older minute buckets up to hourly, so a pattern
      // that went quiet beyond that window would show NO samples if we read only
      // the minute tier. Unioning the hourly twin keeps sample hints alive across
      // the full 24h window regardless of the minute-tier cutoff.
      const from = new Date(now().getTime() - VARIABLE_SUMMARY_WINDOW_MS);
      const [
        minuteVariableRows,
        hourlyVariableRows,
        minuteTotalRow,
        hourlyTotalRow,
      ] = await Promise.all([
        selectVariableAggregates({
          db,
          table: logPatternVariableBuckets,
          streamId,
          patternId,
          from,
        }),
        selectVariableAggregates({
          db,
          table: logPatternVariableHourly,
          streamId,
          patternId,
          from,
        }),
        selectPatternTotal({
          db,
          table: logPatternBuckets,
          streamId,
          patternId,
          from,
        }),
        selectPatternTotal({
          db,
          table: logPatternHourly,
          streamId,
          patternId,
          from,
        }),
      ]);

      const totalOccurrences =
        Number(minuteTotalRow[0]?.total ?? 0) +
        Number(hourlyTotalRow[0]?.total ?? 0);
      const byIndex = mergeVariableAggregates([
        ...minuteVariableRows,
        ...hourlyVariableRows,
      ]);

      const variables: PatternVariableSample[] = [];
      for (let varIndex = 0; varIndex < wildcardCount; varIndex++) {
        const agg = byIndex.get(varIndex);
        variables.push(
          buildVariableSample({ varIndex, agg, totalOccurrences }),
        );
      }
      return { variables };
    },
  };
}

// ============================================================================
// READ HELPERS (tier-agnostic: minute and hourly tables share their shape)
// ============================================================================

/** A minute OR hourly pattern-variable bucket table (identical columns). */
type VariableBucketTable =
  | typeof logPatternVariableBuckets
  | typeof logPatternVariableHourly;

/** A minute OR hourly pattern bucket table (identical columns). */
type PatternBucketTable = typeof logPatternBuckets | typeof logPatternHourly;

/** Grouped per-`varIndex` numeric aggregate over one tier's buckets since `from`. */
interface VariableAggregateRow {
  varIndex: number;
  count: string;
  sum: string;
  min: string | null;
  max: string | null;
}

/** Sum count/sum and min/max the numeric samples per wildcard position. */
function selectVariableAggregates({
  db,
  table,
  streamId,
  patternId,
  from,
}: {
  db: Db;
  table: VariableBucketTable;
  streamId: string;
  patternId: string;
  from: Date;
}): Promise<VariableAggregateRow[]> {
  return db
    .select({
      varIndex: table.varIndex,
      count: sql<string>`coalesce(sum(${table.count}), 0)`,
      sum: sql<string>`coalesce(sum(${table.sum}), 0)`,
      min: sql<string | null>`min(${table.min})`,
      max: sql<string | null>`max(${table.max})`,
    })
    .from(table)
    .where(
      and(
        eq(table.streamId, streamId),
        eq(table.patternId, patternId),
        gte(table.bucketStart, from),
      ),
    )
    .groupBy(table.varIndex);
}

/** Total occurrences of a pattern over one tier's buckets since `from`. */
function selectPatternTotal({
  db,
  table,
  streamId,
  patternId,
  from,
}: {
  db: Db;
  table: PatternBucketTable;
  streamId: string;
  patternId: string;
  from: Date;
}): Promise<{ total: string }[]> {
  return db
    .select({ total: sql<string>`coalesce(sum(${table.count}), 0)` })
    .from(table)
    .where(
      and(
        eq(table.streamId, streamId),
        eq(table.patternId, patternId),
        gte(table.bucketStart, from),
      ),
    );
}

/** Fold minute + hourly variable rows into one aggregate per `varIndex`. */
function mergeVariableAggregates(
  rows: VariableAggregateRow[],
): Map<number, VariableAggregate> {
  const byIndex = new Map<number, VariableAggregate>();
  for (const r of rows) {
    const min = r.min == null ? null : Number(r.min);
    const max = r.max == null ? null : Number(r.max);
    const existing = byIndex.get(r.varIndex);
    if (!existing) {
      byIndex.set(r.varIndex, {
        count: Number(r.count),
        sum: Number(r.sum),
        min,
        max,
      });
      continue;
    }
    existing.count += Number(r.count);
    existing.sum += Number(r.sum);
    existing.min = smallerNullable(existing.min, min);
    existing.max = largerNullable(existing.max, max);
  }
  return byIndex;
}

function smallerNullable(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.min(a, b);
}

function largerNullable(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

// ============================================================================
// PURE HELPERS
// ============================================================================

interface VariableAggregate {
  count: number;
  sum: number;
  min: number | null;
  max: number | null;
}

/**
 * Assemble one variable-position summary from its numeric bucket aggregate.
 * `numericShare` is the fraction of the pattern's recent occurrences that
 * carried a numeric value here; `sampleValues` are up to three representative
 * numeric values (min, mean, max, de-duplicated).
 */
export function buildVariableSample({
  varIndex,
  agg,
  totalOccurrences,
}: {
  varIndex: number;
  agg: VariableAggregate | undefined;
  totalOccurrences: number;
}): PatternVariableSample {
  if (!agg || agg.count === 0) {
    return { varIndex, sampleValues: [], numericShare: 0 };
  }
  const mean = agg.sum / agg.count;
  const rawSamples = [agg.min, mean, agg.max].filter(
    (v): v is number => v != null,
  );
  const sampleValues = [
    ...new Set(rawSamples.map((v) => formatSampleValue(v))),
  ].slice(0, 3);
  const numericShare =
    totalOccurrences > 0
      ? Math.min(1, agg.count / totalOccurrences)
      : agg.count > 0
        ? 1
        : 0;
  return { varIndex, sampleValues, numericShare };
}

/** Format a numeric sample tidily (integers stay integers; else 2 decimals). */
function formatSampleValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(round2(value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Map a persisted pattern row to the `LogPattern` DTO. */
function mapPatternRow(row: typeof logPatterns.$inferSelect): LogPattern {
  return {
    id: row.id,
    streamId: row.streamId,
    template: row.template,
    tokenCount: row.tokenCount,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    sampleBody: row.sampleBody,
    totalCount: Number(row.totalCount),
    severityMax: row.severityMax,
    band: bandFromSeverityNumber(row.severityMax),
    origin: row.origin,
  };
}
