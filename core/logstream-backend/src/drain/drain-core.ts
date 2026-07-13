/**
 * Pure, IO-free implementation of the Drain fixed-depth parse tree (He et al.,
 * "Drain: An Online Log Parsing Approach with Fixed Depth Tree", ICWS 2017),
 * tuned for streaming. This module knows nothing about hashing, storage or
 * severity - it clusters token sequences into templates and manages the
 * per-pod memory bounds. The {@link import("./engine").DrainEngine} wrapper adds
 * `patternId` hashing and persistence.
 *
 * Tree shape (a depth-4 tree, following the paper's default):
 *   root -> length node (keyed by token count)
 *        -> up to PREFIX_LAYERS token nodes (keyed by the leading tokens)
 *        -> leaf: a list of clusters (log groups) sharing that length + prefix.
 * A leaf's clusters are matched by sequence similarity; the best cluster above
 * the threshold absorbs the line (merging differing positions to `<*>`).
 *
 * PROTECTED clusters (user-authored patterns, and mined patterns referenced by a
 * healthcheck) live in the same leaves but are special: they are matched FIRST
 * by exact equality (with wildcards), never template-refined, and never evicted
 * by either the per-leaf or the global (whole-stream) LRU layer. This keeps a
 * watched pattern's id and counts stable even under memory pressure.
 */

import { WILDCARD } from "./masking";
import { matchesTemplate } from "./user-pattern-matcher";

/** Tunable Drain parameters; every field has a default (see {@link DEFAULTS}). */
export interface DrainCoreOptions {
  /**
   * Number of leading-token layers between the length node and the leaf. The
   * paper's depth-4 tree has 2 such layers (root + length + 2 tokens + leaf).
   */
  prefixLayers?: number;
  /** Minimum sequence similarity for a line to join an existing cluster. */
  simThreshold?: number;
  /** Max distinct token children per internal node before the `<*>` fallback. */
  maxChildren?: number;
  /** Max clusters kept in one leaf; least-recently-updated is evicted past this. */
  maxClustersPerLeaf?: number;
  /** Global in-memory cluster budget across all streams (LRU by stream). */
  maxTotalClusters?: number;
  /** Called when a whole stream tree is evicted (so the engine re-hydrates). */
  onStreamEvicted?: (streamId: string) => void;
  /**
   * Derive a cluster's stable pattern id from its (streamId, space-joined
   * template). Supplied by the engine so the core can decide whether a resident
   * mined cluster is in a stream's healthcheck-referenced protected set. When
   * omitted, referenced-id protection is inert (user-origin protection still
   * works, as it carries an explicit id).
   */
  computePatternId?: (input: { streamId: string; template: string }) => string;
}

const DEFAULTS = {
  prefixLayers: 2,
  simThreshold: 0.5,
  maxChildren: 100,
  maxClustersPerLeaf: 512,
  maxTotalClusters: 50_000,
} as const;

interface Cluster {
  /** The template token sequence; positions that vary hold {@link WILDCARD}. */
  template: string[];
  /** Monotonic tick of the last match/create - the LRU key. */
  lastUpdate: number;
  /**
   * The user pattern id when this is a user-authored protected cluster, else
   * `null`. User clusters are exact-match-only and never refined or evicted.
   */
  userPatternId: string | null;
  /**
   * True when this (mined) cluster's id is in its stream's healthcheck-referenced
   * set. Recomputed by {@link DrainCore.setProtectedIds}; makes the cluster
   * protected without pinning it to a user id.
   */
  refProtected: boolean;
}

/** A protected cluster is exempt from refinement and both eviction layers. */
function isProtected(cluster: Cluster): boolean {
  return cluster.userPatternId !== null || cluster.refProtected;
}

/** Structural equality of two token sequences. */
function sameTemplate(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

interface TreeNode {
  /** Child nodes keyed by token count (length node) or token (internal node). */
  children: Map<string, TreeNode>;
  /** Present only on leaf nodes: the clusters sharing this length + prefix. */
  clusters: Cluster[] | null;
}

interface StreamTree {
  root: TreeNode;
  clusterCount: number;
  /** Count of resident protected clusters; spares the tree from global eviction. */
  protectedCount: number;
  /** Monotonic tick of the last access - the cross-stream LRU key. */
  lastAccess: number;
}

/** The outcome of matching one token sequence. */
export interface MatchResult {
  /** The cluster's template AFTER any merge (live array - snapshot immediately). */
  template: string[];
  /** True when this call created a brand-new cluster (not a merge/refine). */
  isNewCluster: boolean;
  /** True when an existing cluster's template gained a new `<*>` this call. */
  templateChanged: boolean;
}

function newNode(isLeaf: boolean): TreeNode {
  return { children: new Map(), clusters: isLeaf ? [] : null };
}

/** Visit every leaf's cluster list under `node` (a node may be both). */
function forEachLeaf(node: TreeNode, visit: (leaf: Cluster[]) => void): void {
  if (node.clusters !== null) visit(node.clusters);
  for (const child of node.children.values()) forEachLeaf(child, visit);
}

/**
 * Similarity between an existing template and a candidate token sequence of the
 * SAME length (guaranteed by the length node). Wildcard template positions are
 * skipped in the numerator but still counted in the denominator - the paper's
 * `seqDist`. An all-empty pair (length 0) is defined as identical.
 */
function seqSimilarity(template: string[], tokens: string[]): number {
  const len = tokens.length;
  if (len === 0) return 1;
  let matches = 0;
  for (let i = 0; i < len; i++) {
    if (template[i] === WILDCARD) continue;
    if (template[i] === tokens[i]) matches++;
  }
  return matches / len;
}

/**
 * Merge a matched line into a template: any non-wildcard position that differs
 * becomes `<*>`. Returns whether the template changed. Mutates in place.
 */
function mergeTemplate(template: string[], tokens: string[]): boolean {
  let changed = false;
  for (let i = 0; i < template.length; i++) {
    if (template[i] !== WILDCARD && template[i] !== tokens[i]) {
      template[i] = WILDCARD;
      changed = true;
    }
  }
  return changed;
}

export interface DrainCore {
  /** Match (or create) the cluster for a masked token sequence. */
  match(input: { streamId: string; tokens: string[] }): MatchResult;
  /**
   * Insert a persisted template as a seed cluster (hydration). Does NOT report
   * as a new cluster to callers - it is a re-load of a known pattern. A seed
   * whose id is in the stream's referenced set is pinned as protected.
   */
  seed(input: { streamId: string; tokens: string[] }): void;
  /**
   * Install (or promote an existing cluster to) a protected USER cluster for
   * `templateTokens`. Matched first, exact-only, never refined or evicted.
   * Idempotent: re-installing the same id/template just refreshes it.
   */
  installProtectedCluster(input: {
    streamId: string;
    templateTokens: string[];
    patternId: string;
  }): void;
  /** Remove a user cluster by its pattern id. No-op if not resident. */
  removeProtectedCluster(input: { streamId: string; patternId: string }): void;
  /**
   * Replace the healthcheck-referenced protected id set for a stream. Resident
   * mined clusters whose id is in the set become protected; those dropping out
   * (and not user-origin) become evictable again.
   */
  setProtectedIds(input: {
    streamId: string;
    patternIds: readonly string[];
  }): void;
  /** Total clusters held in memory across all streams. */
  totalClusters(): number;
  /** Clusters held for one stream (0 if the stream tree is absent/evicted). */
  streamClusterCount(streamId: string): number;
  /** Protected clusters held for one stream (0 if absent/evicted). */
  streamProtectedCount(streamId: string): number;
  /** Number of stream trees currently resident. */
  streamCount(): number;
}

/**
 * Create a Drain core. All state is process-local (per pod) by design: the tree
 * is a throughput cache, and cross-pod convergence is guaranteed at a higher
 * layer because identical templates hash to identical pattern ids. Evicted
 * clusters are re-derivable from Postgres, so bounding memory here is safe.
 */
export function createDrainCore(options: DrainCoreOptions = {}): DrainCore {
  const prefixLayers = options.prefixLayers ?? DEFAULTS.prefixLayers;
  const simThreshold = options.simThreshold ?? DEFAULTS.simThreshold;
  const maxChildren = options.maxChildren ?? DEFAULTS.maxChildren;
  const maxClustersPerLeaf =
    options.maxClustersPerLeaf ?? DEFAULTS.maxClustersPerLeaf;
  const maxTotalClusters = options.maxTotalClusters ?? DEFAULTS.maxTotalClusters;
  const onStreamEvicted = options.onStreamEvicted;
  const computePatternId = options.computePatternId;

  const streams = new Map<string, StreamTree>();
  // Healthcheck-referenced protected id sets, kept independently of tree
  // lifecycle so a stream evicted and re-hydrated re-pins its referenced
  // patterns. Empty/absent = nothing referenced.
  const referencedIds = new Map<string, Set<string>>();
  let total = 0;
  let tick = 0;

  function getStream(streamId: string): StreamTree {
    let stream = streams.get(streamId);
    if (!stream) {
      stream = {
        root: newNode(false),
        clusterCount: 0,
        protectedCount: 0,
        lastAccess: tick,
      };
      streams.set(streamId, stream);
    }
    stream.lastAccess = tick;
    return stream;
  }

  /** Whether a mined cluster of `template` is in `streamId`'s referenced set. */
  function computeRefProtected(streamId: string, template: string[]): boolean {
    const set = referencedIds.get(streamId);
    if (!set || set.size === 0 || !computePatternId) return false;
    return set.has(computePatternId({ streamId, template: template.join(" ") }));
  }

  /**
   * Descend from a stream root to the leaf for `tokens`, creating nodes when
   * `create` is set. Implements the `<*>` fallback: an existing wildcard branch
   * is preferred over creating a new token child, and once a node reaches
   * `maxChildren` distinct tokens, further tokens route through `<*>`.
   */
  function leafFor(
    root: TreeNode,
    tokens: string[],
    create: boolean,
  ): TreeNode | null {
    const lenKey = String(tokens.length);
    const layers = Math.min(prefixLayers, tokens.length);
    const leafDepth = layers; // token layers descended before the leaf

    const lengthNode = root.children.get(lenKey);
    let node: TreeNode;
    if (lengthNode) {
      node = lengthNode;
    } else {
      if (!create) return null;
      node = newNode(leafDepth === 0);
      root.children.set(lenKey, node);
    }

    for (let i = 0; i < layers; i++) {
      const token = tokens[i];
      const isLastLayer = i === layers - 1;
      let next: TreeNode | undefined = node.children.get(token);
      if (!next) {
        const wildcard = node.children.get(WILDCARD);
        if (wildcard) {
          next = wildcard;
        } else if (!create) {
          return null;
        } else if (node.children.size >= maxChildren) {
          // Node is saturated: collapse this position to the fallback branch.
          next = newNode(isLastLayer);
          node.children.set(WILDCARD, next);
        } else {
          next = newNode(isLastLayer);
          node.children.set(token, next);
        }
      }
      node = next;
    }

    // Guarantee the terminal node carries a cluster list (a node first created
    // as an internal node for a longer sibling may still be this length's leaf).
    if (node.clusters === null) node.clusters = [];
    return node;
  }

  function evictLeafIfNeeded(leaf: Cluster[], stream: StreamTree): void {
    if (leaf.length <= maxClustersPerLeaf) return;
    // Choose the least-recently-updated NON-protected victim; protected clusters
    // are exempt, so a full-of-protected leaf simply stays over budget (bounded,
    // since protected clusters are few).
    let victim = -1;
    for (let i = 0; i < leaf.length; i++) {
      if (isProtected(leaf[i])) continue;
      if (victim === -1 || leaf[i].lastUpdate < leaf[victim].lastUpdate) {
        victim = i;
      }
    }
    if (victim === -1) return;
    leaf.splice(victim, 1);
    stream.clusterCount--;
    total--;
  }

  /**
   * Enforce the global cluster budget. Two phases, cheapest first:
   *
   * 1. Evict whole NON-protected stream trees, least-recently-accessed first (the
   *    fast path - a fully-evictable tree re-hydrates from Postgres on its next
   *    line). A stream holding any protected cluster is spared here: dropping its
   *    whole tree would take the protected cluster with it.
   * 2. If that cannot get under budget (a pod where EVERY resident stream holds a
   *    protected cluster), shed those streams' NON-protected clusters, globally
   *    least-recently-updated first, down to their protected cores. Protected
   *    clusters are never dropped, so `total` floors at the count of resident
   *    protected clusters - the bound becomes
   *    `maxTotalClusters + (resident protected clusters)`, which is what keeps a
   *    protected-holding pod from growing unboundedly. Evicting a mined cluster is
   *    safe: a user cluster re-hydrates from `log_patterns`, and a healthcheck-
   *    referenced cluster re-pins via the persistent `referencedIds` map (and the
   *    ingest re-push after a worker reset), so nothing is lost permanently.
   */
  function evictStreamsIfNeeded(currentStreamId: string): void {
    // Phase 1: whole non-protected trees.
    while (total > maxTotalClusters && streams.size > 1) {
      let victimId: string | null = null;
      let victimAccess = Number.POSITIVE_INFINITY;
      for (const [id, stream] of streams) {
        if (id === currentStreamId) continue;
        if (stream.protectedCount > 0) continue;
        if (stream.lastAccess < victimAccess) {
          victimAccess = stream.lastAccess;
          victimId = id;
        }
      }
      if (victimId === null) break;
      const victim = streams.get(victimId);
      if (victim) total -= victim.clusterCount;
      streams.delete(victimId);
      onStreamEvicted?.(victimId);
    }

    // Phase 2: still over budget - only protected-holding streams remain. Shed
    // their non-protected clusters until under budget or none are left.
    while (total > maxTotalClusters && shedOldestNonProtectedCluster()) {
      // loop body intentionally empty; the predicate does the work
    }
  }

  /**
   * Remove the single globally least-recently-updated NON-protected cluster from
   * whichever resident stream holds it. Returns `false` when no non-protected
   * cluster remains anywhere (every resident cluster is protected), which floors
   * eviction. The just-created cluster carries the newest `lastUpdate`, so it is
   * shed last and only when it is the sole non-protected cluster left.
   */
  function shedOldestNonProtectedCluster(): boolean {
    // Collect every non-protected cluster with a splice handle, then pick the
    // oldest in a plain loop (the min-selection is kept OUT of the forEachLeaf
    // closure so control-flow narrowing works on the chosen victim).
    const candidates: {
      leaf: Cluster[];
      index: number;
      stream: StreamTree;
      lastUpdate: number;
    }[] = [];
    for (const stream of streams.values()) {
      forEachLeaf(stream.root, (leaf) => {
        for (let i = 0; i < leaf.length; i++) {
          if (isProtected(leaf[i])) continue;
          candidates.push({ leaf, index: i, stream, lastUpdate: leaf[i].lastUpdate });
        }
      });
    }
    if (candidates.length === 0) return false;
    let victim = candidates[0];
    for (const candidate of candidates) {
      if (candidate.lastUpdate < victim.lastUpdate) victim = candidate;
    }
    victim.leaf.splice(victim.index, 1);
    victim.stream.clusterCount--;
    total--;
    return true;
  }

  function addCluster(
    stream: StreamTree,
    leaf: Cluster[],
    tokens: string[],
    streamId: string,
  ): Cluster {
    const refProtected = computeRefProtected(streamId, tokens);
    const cluster: Cluster = {
      template: [...tokens],
      lastUpdate: tick,
      userPatternId: null,
      refProtected,
    };
    leaf.push(cluster);
    stream.clusterCount++;
    if (refProtected) stream.protectedCount++;
    total++;
    evictLeafIfNeeded(leaf, stream);
    evictStreamsIfNeeded(streamId);
    return cluster;
  }

  /** Best similarity match among the NON-protected clusters of a leaf. */
  function bestMatch(leaf: Cluster[], tokens: string[]): Cluster | null {
    let best: Cluster | null = null;
    let bestSim = -1;
    for (const cluster of leaf) {
      if (isProtected(cluster)) continue;
      const sim = seqSimilarity(cluster.template, tokens);
      if (sim > bestSim) {
        bestSim = sim;
        best = cluster;
      }
    }
    return best !== null && bestSim >= simThreshold ? best : null;
  }

  return {
    match({ streamId, tokens }) {
      tick++;
      const stream = getStream(streamId);
      const leafNode = leafFor(stream.root, tokens, true);
      // leafFor with create=true never returns null.
      const leaf = leafNode!.clusters!;

      // 1. Protected clusters win: exact match (with wildcards), no refinement.
      for (const cluster of leaf) {
        if (!isProtected(cluster)) continue;
        if (
          matchesTemplate({ templateTokens: cluster.template, lineTokens: tokens })
        ) {
          cluster.lastUpdate = tick;
          return {
            template: cluster.template,
            isNewCluster: false,
            templateChanged: false,
          };
        }
      }

      // 2. Otherwise the usual similarity match over mined clusters.
      const matched = bestMatch(leaf, tokens);
      if (matched) {
        const templateChanged = mergeTemplate(matched.template, tokens);
        matched.lastUpdate = tick;
        return {
          template: matched.template,
          isNewCluster: false,
          templateChanged,
        };
      }

      const created = addCluster(stream, leaf, tokens, streamId);
      return {
        template: created.template,
        isNewCluster: true,
        templateChanged: false,
      };
    },

    seed({ streamId, tokens }) {
      tick++;
      const stream = getStream(streamId);
      const leafNode = leafFor(stream.root, tokens, true);
      const leaf = leafNode!.clusters!;
      // A seed re-loads a known template verbatim; if an identical template is
      // already resident (e.g. re-seeded), skip to avoid duplicate clusters.
      for (const cluster of leaf) {
        if (sameTemplate(cluster.template, tokens)) {
          cluster.lastUpdate = tick;
          return;
        }
      }
      addCluster(stream, leaf, tokens, streamId);
    },

    installProtectedCluster({ streamId, templateTokens, patternId }) {
      tick++;
      const stream = getStream(streamId);
      const leafNode = leafFor(stream.root, templateTokens, true);
      const leaf = leafNode!.clusters!;
      for (const cluster of leaf) {
        if (sameTemplate(cluster.template, templateTokens)) {
          // Promote an existing (mined or same-id) cluster in place.
          if (!isProtected(cluster)) stream.protectedCount++;
          cluster.userPatternId = patternId;
          cluster.lastUpdate = tick;
          return;
        }
      }
      const cluster: Cluster = {
        template: [...templateTokens],
        lastUpdate: tick,
        userPatternId: patternId,
        refProtected: false,
      };
      leaf.push(cluster);
      stream.clusterCount++;
      stream.protectedCount++;
      total++;
      // Adding a protected cluster may push the leaf over budget; that only ever
      // evicts a NON-protected victim (protected clusters are exempt).
      evictLeafIfNeeded(leaf, stream);
      evictStreamsIfNeeded(streamId);
    },

    removeProtectedCluster({ streamId, patternId }) {
      const stream = streams.get(streamId);
      if (!stream) return;
      forEachLeaf(stream.root, (leaf) => {
        for (let i = 0; i < leaf.length; i++) {
          if (leaf[i].userPatternId === patternId) {
            if (isProtected(leaf[i])) stream.protectedCount--;
            leaf.splice(i, 1);
            stream.clusterCount--;
            total--;
            return;
          }
        }
      });
    },

    setProtectedIds({ streamId, patternIds }) {
      const set = new Set(patternIds);
      if (set.size === 0) referencedIds.delete(streamId);
      else referencedIds.set(streamId, set);

      const stream = streams.get(streamId);
      if (!stream || !computePatternId) return;
      forEachLeaf(stream.root, (leaf) => {
        for (const cluster of leaf) {
          const shouldProtect = set.has(
            computePatternId({
              streamId,
              template: cluster.template.join(" "),
            }),
          );
          if (shouldProtect === cluster.refProtected) continue;
          const wasProtected = isProtected(cluster);
          cluster.refProtected = shouldProtect;
          const nowProtected = isProtected(cluster);
          if (!wasProtected && nowProtected) stream.protectedCount++;
          else if (wasProtected && !nowProtected) stream.protectedCount--;
        }
      });
    },

    totalClusters() {
      return total;
    },
    streamClusterCount(streamId) {
      return streams.get(streamId)?.clusterCount ?? 0;
    },
    streamProtectedCount(streamId) {
      return streams.get(streamId)?.protectedCount ?? 0;
    },
    streamCount() {
      return streams.size;
    },
  };
}
