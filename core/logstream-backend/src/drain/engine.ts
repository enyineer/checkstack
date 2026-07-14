import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { Logger, InstanceRuntime } from "@checkstack/backend-api";
import type { CacheManager } from "@checkstack/cache-api";
import type { PatternUpsert } from "../storage";
import type { Storage } from "../storage";
import { logPatterns } from "../schema";
import { maskAndTokenize, maskAndTokenizeAnnotated, WILDCARD } from "./masking";
import { createDrainCore } from "./drain-core";
import { templateToTokens } from "./user-pattern-matcher";

/**
 * A Drain classification result for a single line. `patternId` is
 * `sha256(streamId + normalizedTemplate)` so identical templates converge to
 * one id across pods.
 */
export interface DrainClassification {
  patternId: string;
  /** True when this flush created a brand-new template. */
  isNew: boolean;
  template: string;
  tokenCount: number;
  /** The severity number that produced this classification (carried through
   * so the flush can maintain `severityMax` without re-deriving it). */
  severityNumber: number;
  /**
   * The raw (pre-mask) body token at each `<*>` position of the matched
   * template, in template order (the "wildcard values"). The flush fold parses
   * these as floats to maintain the pattern-variable buckets; non-numeric values
   * (identifiers, words, timestamps) are skipped downstream. Empty for a
   * wildcard-free template. When refinement changes a template's wildcard
   * positions mid-flush, the values follow the CURRENT (post-refine) template.
   */
  wildcardValues: string[];
  /**
   * True when the matched pattern is user-hidden: the flush still folds every
   * aggregate delta for the line but skips persisting it as a raw event row.
   */
  hidden: boolean;
}

/**
 * The Drain engine seam consumed by the ingest flush. The engine keeps a
 * per-pod in-memory parse tree (hydrated from `log_patterns` on a stream's
 * first line) and buffers new/updated pattern rows for the flush transaction to
 * persist via {@link Storage.upsertPatterns}.
 */
export interface DrainEngine {
  /**
   * Classify a raw line into a pattern. Pure/in-memory and fast (no IO);
   * new templates are queued for {@link pendingPatternUpserts}.
   */
  classify(input: {
    streamId: string;
    body: string;
    severityNumber: number;
    at: Date;
  }): DrainClassification;

  /**
   * Drain and return the pattern rows accumulated since the last call, for the
   * flush transaction to upsert. Each row's `totalCount` is this flush's delta.
   */
  pendingPatternUpserts(): PatternUpsert[];

  /**
   * Seed a stream's parse tree from persisted templates (called lazily on the
   * stream's first line after boot). Idempotent and cheap once hydrated, so the
   * ingest path may await it on every flush without penalty.
   */
  hydrateStream(input: { streamId: string }): Promise<void>;

  /**
   * Register a USER-authored pattern in this pod's tree as a protected,
   * match-first cluster (exact, non-wildcard tokens equal; never refined or
   * evicted) so subsequent lines classify into it with precedence over mining.
   * Returns the derived `patternId = sha256(streamId + template)`. Called by
   * `createPattern` on the owning pod and by the `logstream.patterns.changed`
   * consumer on every other pod. Idempotent.
   */
  upsertUserPattern(input: { streamId: string; template: string }): {
    patternId: string;
  };

  /**
   * Remove a user-authored pattern (unpin and drop the protected cluster) from
   * this pod's tree. Called by `deletePattern` on the owning pod and by the
   * patterns-changed consumer elsewhere. Idempotent (a no-op if the pattern is
   * not resident). The durable `log_patterns` row deletion is the API's concern.
   */
  removeUserPattern(input: { streamId: string; patternId: string }): void;

  /**
   * Replace the set of healthcheck-REFERENCED protected pattern ids for a
   * stream (idempotent - the given set fully replaces the previous one).
   * Ingest refreshes this per stream alongside hydration and on a periodic
   * cadence, so a still-referenced but quiet pattern is never re-mined under a
   * fresh id.
   *
   * A PROTECTED cluster is never LRU-evicted (per-leaf OR global layer) and
   * never template-refined, so a watched pattern's id and counts stay stable.
   * `origin: 'user'` patterns are IMPLICITLY protected and are NOT part of this
   * set - this method carries only the referenced portion. A referenced id whose
   * cluster is not currently resident is pinned when its stream next hydrates.
   */
  setProtectedPatterns(input: {
    streamId: string;
    patternIds: readonly string[];
  }): void;

  /**
   * Mark a pattern hidden/visible on this pod's engine so classifications flag
   * matched lines (the flush then skips their raw persistence). Called by
   * `setPatternHidden` on the owning pod and by the patterns-changed consumer
   * elsewhere; hydration seeds the set from the `hidden` column. Idempotent.
   * The durable `log_patterns.hidden` update is the API's concern.
   */
  setPatternHidden(input: {
    streamId: string;
    patternId: string;
    hidden: boolean;
  }): void;
}

/** Max chars kept as a pattern's `sampleBody` (a display sample, not the raw store). */
const SAMPLE_MAX = 2048;

/**
 * Upper bound on the pattern rows loaded to hydrate ONE stream's parse tree.
 * Hydration re-seeds every persisted template into memory, so an unbounded read
 * of a pathological stream (a template-explosion, or a corrupt table) could OOM a
 * booting pod. We load the {@link HYDRATION_ROW_LIMIT} most-recently-seen rows
 * (`lastSeenAt DESC`, served by `log_patterns_stream_last_seen_idx`) and log a
 * truncation warning; the dropped tail is the coldest patterns, which simply
 * re-mine on their next line and converge, so the bound is safe. User-authored
 * and healthcheck-referenced patterns re-pin the moment they are seen again.
 */
export const HYDRATION_ROW_LIMIT = 10_000;

/**
 * Pattern id derivation. Identical `(streamId, template)` pairs MUST hash to the
 * same id on every pod - that identity is what makes per-pod trees converge in
 * Postgres. The ` ` separator prevents boundary collisions between the
 * stream id and the template.
 */
function computePatternId({
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
 * Pull the RAW body token at each `<*>` position of the matched template, in
 * template order (the pattern-variable "wildcard values"). Only computed for a
 * template that actually has a wildcard - a fully-static template yields no
 * values, so no extra masking pass runs for it. The annotated tokenizer
 * reproduces the tree's masked tokens exactly (guarded by a masking test), so
 * `raw[i]` lines up with template position `i`; a defensive length mismatch
 * falls back to the masked tree token (which numeric folding then skips).
 */
function extractWildcardValues({
  body,
  templateTokens,
  treeTokens,
}: {
  body: string;
  templateTokens: readonly string[];
  treeTokens: readonly string[];
}): string[] {
  let hasWildcard = false;
  for (const token of templateTokens) {
    if (token === WILDCARD) {
      hasWildcard = true;
      break;
    }
  }
  if (!hasWildcard) return [];

  const { tokens: annotatedTokens, raw } = maskAndTokenizeAnnotated({ body });
  const aligned = annotatedTokens.length === templateTokens.length;
  const values: string[] = [];
  for (const [i, token] of templateTokens.entries()) {
    if (token !== WILDCARD) continue;
    values.push(aligned ? raw[i]! : (treeTokens[i] ?? WILDCARD));
  }
  return values;
}

/** A persisted pattern row as needed to re-seed a stream's parse tree. */
export interface DrainPatternRow {
  id: string;
  template: string;
  /** `'mined'` | `'user'`; a `'user'` row re-seeds as a protected cluster. */
  origin: string;
  /** Seeds the engine's hidden set (raw-line persistence skip). */
  hidden: boolean;
}

/**
 * Load a stream's persisted pattern rows for hydration. The default reads the
 * `log_patterns` table via `storage`; a WORKER-hosted engine (Phase D) has no DB
 * connection and injects a loader that fetches the rows from the main thread over
 * the worker message channel instead (the main thread owns the pool's DB access).
 */
export type LoadPatternRows = (input: {
  streamId: string;
}) => Promise<DrainPatternRow[]>;

/**
 * Create the Drain engine. The parse tree is per-pod and in-memory for
 * throughput; templates persist to `log_patterns` and re-hydrate on boot, and
 * because {@link computePatternId} is a pure function of the template, pods
 * converge on identical ids without any cross-pod coordination. Near-duplicate
 * clusters across pods before convergence are accepted v1 slack.
 *
 * Hydration source: by default the engine reads `log_patterns` through
 * `storage`. A stream-sharded ingest worker (Phase D) holds no DB connection, so
 * it constructs the engine with an injected {@link LoadPatternRows} that fetches
 * the rows from the main thread over the worker channel; in that mode `storage`
 * and the (already-unused) platform services are omitted. Existing callers pass
 * `storage` and behave byte-identically.
 */
export function createDrainEngine({
  storage,
  loadPatternRows,
  cacheManager: _cacheManager,
  instanceRuntime: _instanceRuntime,
  logger,
}: {
  /** Required unless {@link loadPatternRows} is supplied (the worker path). */
  storage?: Storage;
  /** Injected hydration loader; defaults to the `storage`-backed DB query. */
  loadPatternRows?: LoadPatternRows;
  /** Unused today; optional so a worker with no platform services can construct. */
  cacheManager?: CacheManager;
  /** Unused today; optional so a worker with no platform services can construct. */
  instanceRuntime?: InstanceRuntime;
  /**
   * Used to warn when a stream's hydration is truncated at
   * {@link HYDRATION_ROW_LIMIT}. Optional so a worker with no platform services
   * can construct (the worker path's truncation is instead surfaced by the
   * main-thread `createDbPatternLoader`, which holds the logger).
   */
  logger?: Logger;
}): DrainEngine {
  const loadRows: LoadPatternRows =
    loadPatternRows ??
    (async ({ streamId }) => {
      if (!storage) {
        throw new Error(
          "createDrainEngine: either `storage` or `loadPatternRows` is required",
        );
      }
      // Bounded to the most-recently-seen rows (see HYDRATION_ROW_LIMIT); the
      // ORDER BY + LIMIT is served by `log_patterns_stream_last_seen_idx`.
      return storage.db
        .select({
          id: logPatterns.id,
          template: logPatterns.template,
          origin: logPatterns.origin,
          hidden: logPatterns.hidden,
        })
        .from(logPatterns)
        .where(eq(logPatterns.streamId, streamId))
        .orderBy(desc(logPatterns.lastSeenAt))
        .limit(HYDRATION_ROW_LIMIT);
    });
  const hydrated = new Set<string>();
  // In-flight hydrations, so concurrent first-lines for one stream await a
  // single DB read instead of racing several.
  const hydrating = new Map<string, Promise<void>>();
  // Per-stream hidden pattern ids. Engine-level (not a tree/cluster concern):
  // classify() only needs a membership check to flag matched lines, hydration
  // seeds it from the `hidden` column, and live toggles arrive via
  // setPatternHidden (same at-least-once propagation as user patterns, with
  // hydration as the convergence backstop). A refined template gets a NEW
  // pattern id, which starts visible - hiding is per-identity, by design.
  const hiddenIds = new Map<string, Set<string>>();
  // Pattern-row deltas accumulated since the last pendingPatternUpserts() drain,
  // keyed by patternId. `totalCount` here is the DELTA for this flush.
  const pending = new Map<string, PatternUpsert>();

  const core = createDrainCore({
    onStreamEvicted: (streamId) => {
      hydrated.delete(streamId);
      // Drop the hidden set with the stream; re-hydration re-seeds it.
      hiddenIds.delete(streamId);
    },
    // Lets the core decide whether a resident mined cluster is in a stream's
    // healthcheck-referenced protected set (same id derivation as classify).
    computePatternId,
  });

  function accumulate({
    patternId,
    streamId,
    template,
    tokenCount,
    at,
    severityNumber,
    body,
  }: {
    patternId: string;
    streamId: string;
    template: string;
    tokenCount: number;
    at: Date;
    severityNumber: number;
    body: string;
  }): void {
    const sample = body.length > SAMPLE_MAX ? body.slice(0, SAMPLE_MAX) : body;
    const existing = pending.get(patternId);
    if (existing) {
      existing.totalCount = (existing.totalCount ?? 0) + 1;
      if (at > existing.lastSeenAt) existing.lastSeenAt = at;
      if (severityNumber > (existing.severityMax ?? 0)) {
        existing.severityMax = severityNumber;
      }
      // Refresh the (possibly refined) template and latest sample.
      existing.template = template;
      existing.tokenCount = tokenCount;
      existing.sampleBody = sample;
      return;
    }
    pending.set(patternId, {
      id: patternId,
      streamId,
      template,
      tokenCount,
      firstSeenAt: at,
      lastSeenAt: at,
      sampleBody: sample,
      totalCount: 1,
      severityMax: severityNumber,
    });
  }

  return {
    classify({ streamId, body, severityNumber, at }) {
      const tokens = maskAndTokenize({ body });
      const result = core.match({ streamId, tokens });
      const templateTokens = result.template;
      const template = templateTokens.join(" ");
      const patternId = computePatternId({ streamId, template });
      accumulate({
        patternId,
        streamId,
        template,
        tokenCount: tokens.length,
        at,
        severityNumber,
        body,
      });
      return {
        patternId,
        isNew: result.isNewCluster,
        template,
        tokenCount: tokens.length,
        severityNumber,
        wildcardValues: extractWildcardValues({
          body,
          templateTokens,
          treeTokens: tokens,
        }),
        hidden: hiddenIds.get(streamId)?.has(patternId) ?? false,
      };
    },

    upsertUserPattern({ streamId, template }) {
      const patternId = computePatternId({ streamId, template });
      // Install a protected, match-first user cluster on THIS pod so subsequent
      // lines classify into it with precedence over mining. Idempotent - a
      // re-install (e.g. the patterns-changed consumer after this pod's own
      // create) just refreshes it.
      core.installProtectedCluster({
        streamId,
        templateTokens: templateToTokens(template),
        patternId,
      });
      return { patternId };
    },

    removeUserPattern({ streamId, patternId }) {
      core.removeProtectedCluster({ streamId, patternId });
    },

    setProtectedPatterns({ streamId, patternIds }) {
      core.setProtectedIds({ streamId, patternIds });
    },

    setPatternHidden({ streamId, patternId, hidden }) {
      const set = hiddenIds.get(streamId);
      if (hidden) {
        if (set) set.add(patternId);
        else hiddenIds.set(streamId, new Set([patternId]));
        return;
      }
      set?.delete(patternId);
    },

    pendingPatternUpserts() {
      const rows = [...pending.values()];
      pending.clear();
      return rows;
    },

    async hydrateStream({ streamId }) {
      if (hydrated.has(streamId)) return;
      const inFlight = hydrating.get(streamId);
      if (inFlight) return inFlight;

      const load = (async () => {
        const rows = await loadRows({ streamId });
        if (rows.length >= HYDRATION_ROW_LIMIT) {
          logger?.warn(
            `logstream: stream ${streamId} hydration truncated at ${HYDRATION_ROW_LIMIT} patterns (coldest patterns will re-mine on next line)`,
          );
        }
        const hidden = new Set<string>();
        for (const row of rows) {
          const tokens = templateToTokens(row.template);
          if (row.hidden) hidden.add(row.id);
          if (row.origin === "user") {
            // User patterns re-seed as protected clusters so their precedence,
            // exact-match and no-eviction guarantees survive a re-hydration.
            core.installProtectedCluster({
              streamId,
              templateTokens: tokens,
              patternId: row.id,
            });
          } else {
            core.seed({ streamId, tokens });
          }
        }
        // Replace (not merge) so an unhide that happened while the stream was
        // out of memory is honored on re-hydration.
        hiddenIds.set(streamId, hidden);
        hydrated.add(streamId);
      })().finally(() => hydrating.delete(streamId));

      hydrating.set(streamId, load);
      return load;
    },
  };
}
