import type { EntityEnvelope } from "@checkstack/gitops-common";
import { extractEntityRefs } from "@checkstack/gitops-common";
import type { DiscoveredFile } from "../scrapers/types";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CollectedEntity {
  entity: EntityEnvelope;
  contentHash: string;
  file: DiscoveredFile;
  /** Secret names referenced via ${{ secrets.NAME }} in this entity's spec. */
  secretRefs?: string[];
}

// ─── Topological Sort ──────────────────────────────────────────────────────

/**
 * Sort entities by dependency order using entity refs found in their specs.
 *
 * 1. Build a map of all collected entities keyed by "Kind::name"
 * 2. For each entity, extract entity refs from its spec via extractEntityRefs()
 * 3. Filter to refs that exist in the collected set (ignore external/unknown refs)
 * 4. Exclude self-references (an entity referencing itself is not a dependency)
 * 5. Build adjacency list and run Kahn's algorithm (BFS topological sort)
 * 6. Throw on cycles with descriptive error
 * 7. Entities at the same depth maintain their original discovery order
 */
export function sortEntitiesByDependency({
  entities,
}: {
  entities: CollectedEntity[];
}): CollectedEntity[] {
  if (entities.length <= 1) return entities;

  // Build entity key → index map
  const keyToIndex = new Map<string, number>();
  for (const [i, e] of entities.entries()) {
    keyToIndex.set(`${e.entity.kind}::${e.entity.metadata.name}`, i);
  }

  // Build adjacency list: edges[i] = indices that i depends on
  // (i.e., entities that must be processed BEFORE entity i)
  const dependsOn: Set<number>[] = entities.map(() => new Set());
  const dependedBy: Set<number>[] = entities.map(() => new Set());

  for (const [i, collected] of entities.entries()) {
    const spec = collected.entity.spec;
    if (!spec) continue;

    const selfKey = `${collected.entity.kind}::${collected.entity.metadata.name}`;
    const refs = extractEntityRefs(spec);

    for (const ref of refs) {
      const refKey = `${ref.kind}::${ref.name}`;

      // Skip self-references and refs to entities not in this batch
      if (refKey === selfKey) continue;
      const depIndex = keyToIndex.get(refKey);
      if (depIndex === undefined) continue;

      dependsOn[i].add(depIndex);
      dependedBy[depIndex].add(i);
    }
  }

  // Kahn's algorithm — BFS topological sort preserving discovery order
  const inDegree = dependsOn.map((deps) => deps.size);
  const queue: number[] = [];

  // Seed with zero-dependency entities in discovery order
  for (const [i, degree] of inDegree.entries()) {
    if (degree === 0) queue.push(i);
  }

  const sorted: CollectedEntity[] = [];

  while (queue.length > 0) {
    const idx = queue.shift()!;
    sorted.push(entities[idx]);

    // Process dependents in their original discovery order
    const dependents = [...dependedBy[idx]].toSorted((a, b) => a - b);
    for (const depIdx of dependents) {
      inDegree[depIdx]--;
      if (inDegree[depIdx] === 0) {
        queue.push(depIdx);
      }
    }
  }

  if (sorted.length !== entities.length) {
    // Find entities involved in the cycle
    const cycleEntities = entities
      .filter((_, i) => inDegree[i] > 0)
      .map((e) => `${e.entity.kind}::${e.entity.metadata.name}`);
    throw new Error(
      `Dependency cycle detected among entities: ${cycleEntities.join(", ")}`,
    );
  }

  return sorted;
}
