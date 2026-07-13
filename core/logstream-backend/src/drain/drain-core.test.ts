import { describe, it, expect } from "bun:test";
import { createDrainCore } from "./drain-core";
import { WILDCARD } from "./masking";

const W = WILDCARD;

/** Tokenize a pre-masked template string for terse test input. */
function toks(s: string): string[] {
  return s.split(" ");
}

describe("createDrainCore clustering", () => {
  it("clusters same-shape lines and wildcards a differing post-prefix position", () => {
    const core = createDrainCore();
    // Lines sharing their leading (prefix-routed) tokens land in one leaf; a
    // token that differs AFTER the prefix layers merges to a wildcard. (Leading
    // tokens must match - in real logs variable leading tokens are masked to
    // <*> and converge via the wildcard branch instead.)
    const a = core.match({ streamId: "s", tokens: toks("user session opened alice") });
    expect(a.isNewCluster).toBe(true);

    const b = core.match({ streamId: "s", tokens: toks("user session opened bob") });
    expect(b.isNewCluster).toBe(false);
    expect(b.templateChanged).toBe(true);
    // Position 3 (alice/bob) becomes a wildcard; the rest stays static.
    expect(b.template).toEqual(["user", "session", "opened", W]);
    expect(core.streamClusterCount("s")).toBe(1);
  });

  it("converges masked leading tokens through the wildcard branch", () => {
    const core = createDrainCore();
    // When the variable leading token is masked (as the engine's preprocessor
    // does), both lines route through the same <*> prefix branch and merge.
    core.seed({ streamId: "s", tokens: [W, "worker", "started"] });
    const a = core.match({ streamId: "s", tokens: [W, "worker", "started"] });
    const b = core.match({ streamId: "s", tokens: [W, "worker", "started"] });
    expect(a.isNewCluster).toBe(false);
    expect(b.isNewCluster).toBe(false);
    expect(core.streamClusterCount("s")).toBe(1);
  });

  it("keeps different shapes in different clusters", () => {
    const core = createDrainCore();
    core.match({ streamId: "s", tokens: toks("connection accepted from host") });
    core.match({ streamId: "s", tokens: toks("disk usage is high now") });
    // Same length, but < 0.5 similarity in the leaf -> distinct clusters.
    core.match({ streamId: "s", tokens: toks("cache miss for key x") });
    expect(core.streamClusterCount("s")).toBe(3);
  });

  it("separates lines of different token counts", () => {
    const core = createDrainCore();
    core.match({ streamId: "s", tokens: toks("short line here") });
    core.match({ streamId: "s", tokens: toks("a much longer line indeed yes") });
    expect(core.streamClusterCount("s")).toBe(2);
  });

  it("wildcard positions are correct across three merges", () => {
    const core = createDrainCore();
    core.match({ streamId: "s", tokens: toks("job 1 done in fast") });
    core.match({ streamId: "s", tokens: toks("job 1 done in slow") });
    const r = core.match({ streamId: "s", tokens: toks("job 1 done in medium") });
    expect(r.template).toEqual(["job", "1", "done", "in", W]);
  });

  it("isolates streams from each other", () => {
    const core = createDrainCore();
    core.match({ streamId: "a", tokens: toks("hello world foo") });
    core.match({ streamId: "b", tokens: toks("hello world foo") });
    expect(core.streamClusterCount("a")).toBe(1);
    expect(core.streamClusterCount("b")).toBe(1);
    expect(core.streamCount()).toBe(2);
  });

  it("handles empty (zero-token) lines as one cluster", () => {
    const core = createDrainCore();
    const a = core.match({ streamId: "s", tokens: [] });
    const b = core.match({ streamId: "s", tokens: [] });
    expect(a.isNewCluster).toBe(true);
    expect(b.isNewCluster).toBe(false);
    expect(core.streamClusterCount("s")).toBe(1);
  });
});

describe("createDrainCore maxChildren fallback", () => {
  it("routes overflowing prefixes through the <*> branch without exploding leaves", () => {
    const core = createDrainCore({ maxChildren: 4, prefixLayers: 1 });
    // Distinct first tokens beyond maxChildren fall into the wildcard branch and
    // land in ONE shared leaf, where similarity keeps them apart or merges them.
    for (let i = 0; i < 20; i++) {
      core.match({ streamId: "s", tokens: toks(`prefix${i} the same tail here`) });
    }
    // First 4 distinct prefixes get their own leaf-with-one-cluster; the rest
    // share the <*> leaf where they merge (tail identical) -> bounded clusters.
    expect(core.streamClusterCount("s")).toBeLessThanOrEqual(6);
  });
});

describe("createDrainCore eviction", () => {
  it("evicts least-recently-updated cluster past the per-leaf cap", () => {
    const core = createDrainCore({ maxClustersPerLeaf: 3, prefixLayers: 0 });
    // prefixLayers 0 forces every line of a given length into ONE leaf.
    // Use length-5 lines that do not merge (all-distinct static tokens).
    core.match({ streamId: "s", tokens: toks("aaa bbb ccc ddd eee") });
    core.match({ streamId: "s", tokens: toks("fff ggg hhh iii jjj") });
    core.match({ streamId: "s", tokens: toks("kkk lll mmm nnn ooo") });
    expect(core.streamClusterCount("s")).toBe(3);
    // Touch the first cluster so it is NOT the LRU victim.
    core.match({ streamId: "s", tokens: toks("aaa bbb ccc ddd eee") });
    // A fourth distinct cluster evicts the least-recently-updated (the 2nd).
    core.match({ streamId: "s", tokens: toks("ppp qqq rrr sss ttt") });
    expect(core.streamClusterCount("s")).toBe(3);
  });

  it("evicts least-recently-used whole stream trees past the global cap", () => {
    const core = createDrainCore({ maxTotalClusters: 2 });
    core.match({ streamId: "a", tokens: toks("one two three") });
    core.match({ streamId: "b", tokens: toks("four five six") });
    expect(core.totalClusters()).toBe(2);
    // Third stream pushes total over the cap -> the LRU stream ("a") is evicted.
    core.match({ streamId: "c", tokens: toks("seven eight nine") });
    expect(core.streamClusterCount("a")).toBe(0);
    expect(core.totalClusters()).toBeLessThanOrEqual(2);
  });

  it("calls onStreamEvicted when a stream tree is dropped", () => {
    const evicted: string[] = [];
    const core = createDrainCore({
      maxTotalClusters: 1,
      onStreamEvicted: (id) => evicted.push(id),
    });
    core.match({ streamId: "a", tokens: toks("alpha beta") });
    core.match({ streamId: "b", tokens: toks("gamma delta") });
    expect(evicted).toEqual(["a"]);
  });
});

describe("createDrainCore seed (hydration)", () => {
  it("seeds a template without reporting a new cluster and matches it verbatim", () => {
    const core = createDrainCore();
    core.seed({ streamId: "s", tokens: ["user", W, "logged", "in"] });
    expect(core.streamClusterCount("s")).toBe(1);
    const r = core.match({ streamId: "s", tokens: toks("user carol logged in") });
    expect(r.isNewCluster).toBe(false);
    expect(r.template).toEqual(["user", W, "logged", "in"]);
  });

  it("does not duplicate an identical seed", () => {
    const core = createDrainCore();
    core.seed({ streamId: "s", tokens: ["a", "b", "c"] });
    core.seed({ streamId: "s", tokens: ["a", "b", "c"] });
    expect(core.streamClusterCount("s")).toBe(1);
  });
});

describe("createDrainCore protected user clusters", () => {
  it("matches a user cluster FIRST, exact (with wildcards), without refining it", () => {
    const core = createDrainCore();
    core.installProtectedCluster({
      streamId: "s",
      templateTokens: toks("GET /api/users <*>"),
      patternId: "u1",
    });
    const r = core.match({ streamId: "s", tokens: toks("GET /api/users 200") });
    expect(r.isNewCluster).toBe(false);
    expect(r.templateChanged).toBe(false);
    expect(r.template).toEqual(toks("GET /api/users <*>"));
    expect(core.streamClusterCount("s")).toBe(1);
    expect(core.streamProtectedCount("s")).toBe(1);
  });

  it("does NOT match a line that differs at a non-wildcard position (no refine)", () => {
    const core = createDrainCore();
    core.installProtectedCluster({
      streamId: "s",
      templateTokens: toks("job <*> done fast"),
      patternId: "u1",
    });
    // 'fast' != 'slow' at a literal position: similar but not an exact match, so
    // the user cluster is untouched and the line mines its own cluster.
    const r = core.match({ streamId: "s", tokens: toks("job 7 done slow") });
    expect(r.isNewCluster).toBe(true);
    expect(core.streamProtectedCount("s")).toBe(1);
    // The user cluster still matches its own shape verbatim.
    const again = core.match({ streamId: "s", tokens: toks("job 9 done fast") });
    expect(again.isNewCluster).toBe(false);
    expect(again.template).toEqual(toks("job <*> done fast"));
  });

  it("promotes an existing mined cluster of the same template in place", () => {
    const core = createDrainCore();
    // Vary the token PAST the 2-token prefix so both lines share a leaf and merge.
    core.match({ streamId: "s", tokens: toks("user session a") });
    core.match({ streamId: "s", tokens: toks("user session b") }); // -> user session <*>
    expect(core.streamClusterCount("s")).toBe(1);
    core.installProtectedCluster({
      streamId: "s",
      templateTokens: toks("user session <*>"),
      patternId: "u1",
    });
    // Promoted, not duplicated.
    expect(core.streamClusterCount("s")).toBe(1);
    expect(core.streamProtectedCount("s")).toBe(1);
  });

  it("is idempotent on re-install of the same id/template", () => {
    const core = createDrainCore();
    core.installProtectedCluster({
      streamId: "s",
      templateTokens: toks("x <*> y"),
      patternId: "u1",
    });
    core.installProtectedCluster({
      streamId: "s",
      templateTokens: toks("x <*> y"),
      patternId: "u1",
    });
    expect(core.streamClusterCount("s")).toBe(1);
    expect(core.streamProtectedCount("s")).toBe(1);
  });

  it("removeProtectedCluster drops the cluster and its protection", () => {
    const core = createDrainCore();
    core.installProtectedCluster({
      streamId: "s",
      templateTokens: toks("worker <*> restarted"),
      patternId: "u1",
    });
    expect(core.streamClusterCount("s")).toBe(1);
    core.removeProtectedCluster({ streamId: "s", patternId: "u1" });
    expect(core.streamClusterCount("s")).toBe(0);
    expect(core.streamProtectedCount("s")).toBe(0);
    // A later line now mines a fresh cluster.
    const r = core.match({ streamId: "s", tokens: toks("worker 4 restarted") });
    expect(r.isNewCluster).toBe(true);
  });

  it("removeProtectedCluster is a no-op for an unknown id / absent stream", () => {
    const core = createDrainCore();
    expect(() =>
      core.removeProtectedCluster({ streamId: "ghost", patternId: "u1" }),
    ).not.toThrow();
    core.installProtectedCluster({
      streamId: "s",
      templateTokens: toks("a b c"),
      patternId: "u1",
    });
    core.removeProtectedCluster({ streamId: "s", patternId: "other" });
    expect(core.streamClusterCount("s")).toBe(1);
  });
});

describe("createDrainCore protection under eviction pressure", () => {
  it("per-leaf: a protected cluster survives while an unprotected LRU victim is evicted", () => {
    const core = createDrainCore({ maxClustersPerLeaf: 3, prefixLayers: 0 });
    core.installProtectedCluster({
      streamId: "s",
      templateTokens: toks("PROT aaa bbb ccc ddd"),
      patternId: "u1",
    });
    // Three distinct unprotected length-5 clusters; the third add pushes the
    // leaf to 4 (> cap 3) and evicts the least-recently-updated UNPROTECTED one.
    core.match({ streamId: "s", tokens: toks("fff ggg hhh iii jjj") });
    core.match({ streamId: "s", tokens: toks("kkk lll mmm nnn ooo") });
    core.match({ streamId: "s", tokens: toks("ppp qqq rrr sss ttt") });
    expect(core.streamClusterCount("s")).toBe(3);
    expect(core.streamProtectedCount("s")).toBe(1);
    // The protected cluster (the oldest of all) still matches verbatim.
    const r = core.match({ streamId: "s", tokens: toks("PROT aaa bbb ccc ddd") });
    expect(r.isNewCluster).toBe(false);
    expect(r.template).toEqual(toks("PROT aaa bbb ccc ddd"));
  });

  it("global: a stream holding a protected cluster is spared from whole-tree eviction", () => {
    const core = createDrainCore({ maxTotalClusters: 2 });
    core.installProtectedCluster({
      streamId: "a",
      templateTokens: toks("prot one two"),
      patternId: "u1",
    });
    core.match({ streamId: "b", tokens: toks("four five six") }); // total 2 (at cap)
    core.match({ streamId: "c", tokens: toks("seven eight nine") }); // total 3 -> evict
    // 'a' is spared (protected); the unprotected LRU stream 'b' is evicted.
    expect(core.streamClusterCount("a")).toBe(1);
    expect(core.streamClusterCount("b")).toBe(0);
    expect(core.totalClusters()).toBeLessThanOrEqual(2);
  });

  it("global: sheds non-protected clusters of protected-holding streams to hold the budget", () => {
    // Every resident stream holds a protected cluster, so whole-tree eviction
    // (phase 1) can free nothing; the budget is instead held by shedding those
    // streams' NON-protected clusters (phase 2) down to their protected cores.
    const core = createDrainCore({
      maxTotalClusters: 4,
      maxClustersPerLeaf: 100,
      prefixLayers: 0,
    });
    const streamIds = ["s1", "s2", "s3"];
    // One protected (user) cluster per stream ...
    for (const s of streamIds) {
      core.installProtectedCluster({
        streamId: s,
        templateTokens: toks(`PROT ${s} core`),
        patternId: `u-${s}`,
      });
    }
    // ... plus four DISTINCT non-protected clusters each (distinct token counts
    // keep them in separate leaves so they never merge), far past the global cap.
    for (const s of streamIds) {
      for (let i = 0; i < 4; i++) {
        const filler = Array.from({ length: i + 2 }, (_, k) => `t${i}_${k}`);
        core.match({ streamId: s, tokens: ["mined", s, ...filler] });
      }
    }

    // Every protected cluster survives and still matches verbatim.
    for (const s of streamIds) {
      expect(core.streamProtectedCount(s)).toBe(1);
      const r = core.match({ streamId: s, tokens: toks(`PROT ${s} core`) });
      expect(r.isNewCluster).toBe(false);
      expect(r.template).toEqual(toks(`PROT ${s} core`));
    }

    // The global bound is enforceable again: total floors at the resident
    // protected clusters, so it stays within maxTotalClusters + protected.
    const protectedTotal = streamIds.reduce(
      (n, s) => n + core.streamProtectedCount(s),
      0,
    );
    expect(protectedTotal).toBe(3);
    expect(core.totalClusters()).toBeLessThanOrEqual(4 + protectedTotal);
    // And the protected clusters were NOT what got shed - non-protected paid.
    expect(core.totalClusters()).toBeGreaterThanOrEqual(protectedTotal);
  });
});

describe("createDrainCore referenced (healthcheck) protection", () => {
  // A trivial id derivation so the test can assert against known ids: a
  // cluster's id is just its space-joined template.
  const idFromTemplate = ({ template }: { template: string }): string => template;

  it("pins a resident mined cluster whose id is in the referenced set", () => {
    const core = createDrainCore({ computePatternId: idFromTemplate });
    core.match({ streamId: "s", tokens: toks("alpha beta gamma") });
    expect(core.streamProtectedCount("s")).toBe(0);
    core.setProtectedIds({ streamId: "s", patternIds: ["alpha beta gamma"] });
    expect(core.streamProtectedCount("s")).toBe(1);
  });

  it("replace semantics: dropping an id from the set unpins its cluster", () => {
    const core = createDrainCore({ computePatternId: idFromTemplate });
    core.match({ streamId: "s", tokens: toks("alpha beta gamma") });
    core.setProtectedIds({ streamId: "s", patternIds: ["alpha beta gamma"] });
    expect(core.streamProtectedCount("s")).toBe(1);
    core.setProtectedIds({ streamId: "s", patternIds: [] });
    expect(core.streamProtectedCount("s")).toBe(0);
  });

  it("pins a to-be-seeded referenced pattern once its stream hydrates", () => {
    const core = createDrainCore({ computePatternId: idFromTemplate });
    // Set the referenced ids BEFORE the stream is resident (as ingest may).
    core.setProtectedIds({ streamId: "s", patternIds: ["seeded template here"] });
    core.seed({ streamId: "s", tokens: toks("seeded template here") });
    expect(core.streamProtectedCount("s")).toBe(1);
  });

  it("a referenced mined cluster survives per-leaf eviction pressure", () => {
    const core = createDrainCore({
      maxClustersPerLeaf: 3,
      prefixLayers: 0,
      computePatternId: idFromTemplate,
    });
    core.match({ streamId: "s", tokens: toks("keep me alive here now") });
    core.setProtectedIds({
      streamId: "s",
      patternIds: ["keep me alive here now"],
    });
    // Fill the leaf past the cap with unprotected clusters.
    core.match({ streamId: "s", tokens: toks("aaa bbb ccc ddd eee") });
    core.match({ streamId: "s", tokens: toks("fff ggg hhh iii jjj") });
    core.match({ streamId: "s", tokens: toks("kkk lll mmm nnn ooo") });
    expect(core.streamProtectedCount("s")).toBe(1);
    const r = core.match({ streamId: "s", tokens: toks("keep me alive here now") });
    expect(r.isNewCluster).toBe(false);
    expect(r.template).toEqual(toks("keep me alive here now"));
  });

  it("leaves user-origin protection intact when the referenced set changes", () => {
    const core = createDrainCore({ computePatternId: idFromTemplate });
    core.installProtectedCluster({
      streamId: "s",
      templateTokens: toks("user pattern here"),
      patternId: "user pattern here",
    });
    // Referencing then de-referencing the SAME id must not drop user protection.
    core.setProtectedIds({ streamId: "s", patternIds: ["user pattern here"] });
    expect(core.streamProtectedCount("s")).toBe(1);
    core.setProtectedIds({ streamId: "s", patternIds: [] });
    expect(core.streamProtectedCount("s")).toBe(1);
  });
});
