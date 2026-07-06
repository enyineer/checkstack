import { eq, or, and, inArray } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
import * as schema from "../schema";
import {
  dependencies,
  dependencyHealthCheckRules,
  nodePositions,
} from "../schema";
import type {
  Dependency,
  CreateDependencyInput,
  UpdateDependencyInput,
  NodePosition,
  ImpactType,
} from "@checkstack/dependency-common";

type Db = SafeDatabase<typeof schema>;

function generateId(): string {
  return crypto.randomUUID();
}

export class DependencyService {
  constructor(private db: Db) {}

  /**
   * Get all dependencies for a system in the specified direction.
   */
  async getDependencies({
    systemId,
    direction = "both",
  }: {
    systemId: string;
    direction?: "upstream" | "downstream" | "both";
  }): Promise<Dependency[]> {
    let condition;
    if (direction === "upstream") {
      condition = eq(dependencies.sourceSystemId, systemId);
    } else if (direction === "downstream") {
      condition = eq(dependencies.targetSystemId, systemId);
    } else {
      condition = or(
        eq(dependencies.sourceSystemId, systemId),
        eq(dependencies.targetSystemId, systemId),
      );
    }

    const rows = await this.db.select().from(dependencies).where(condition);
    return this.enrichWithRules(rows);
  }

  /**
   * Get all dependencies in the system (for the canvas).
   */
  async getAllDependencies(): Promise<Dependency[]> {
    const rows = await this.db.select().from(dependencies);
    return this.enrichWithRules(rows);
  }

  /**
   * Create a new dependency with cycle detection.
   * Throws if the dependency would create a circular chain.
   *
   * `id` may be supplied by the caller so the reactive `dependency-edge`
   * entity can be keyed on a known id BEFORE the insert runs (the create's
   * `prev` snapshot must read the not-yet-existing row as absent — see
   * §10.5). When omitted, a fresh id is generated. The id is server-owned
   * either way.
   */
  async createDependency(
    input: CreateDependencyInput,
    id: string = generateId(),
  ): Promise<Dependency> {
    // Check for duplicate edge
    const [existing] = await this.db
      .select()
      .from(dependencies)
      .where(
        and(
          eq(dependencies.sourceSystemId, input.sourceSystemId),
          eq(dependencies.targetSystemId, input.targetSystemId),
        ),
      );

    if (existing) {
      throw new Error(
        `Dependency already exists between ${input.sourceSystemId} and ${input.targetSystemId}`,
      );
    }

    // Cycle detection: check if adding this edge would create a cycle
    const cyclePath = await this.detectCycle({
      sourceSystemId: input.sourceSystemId,
      targetSystemId: input.targetSystemId,
    });

    if (cyclePath) {
      throw new Error(
        `Cannot create dependency: would form a circular chain: ${cyclePath.join(" → ")}`,
      );
    }

    await this.db.insert(dependencies).values({
      id,
      sourceSystemId: input.sourceSystemId,
      targetSystemId: input.targetSystemId,
      impactType: input.impactType,
      transitive: input.transitive ?? false,
       
      label: input.label ?? null,
    });

    // Create scope cells if provided
    if (input.healthCheckRules && input.healthCheckRules.length > 0) {
      for (const rule of input.healthCheckRules) {
        await this.db.insert(dependencyHealthCheckRules).values({
          id: generateId(),
          dependencyId: id,
          healthCheckId: rule.healthCheckId ?? null,
          environmentId: rule.environmentId ?? null,
          overrideImpactType: rule.overrideImpactType,
        });
      }
    }

    const result = await this.getDependencyById(id);
    if (!result) {
      throw new Error("Failed to create dependency");
    }
    return result;
  }

  /**
   * Update an existing dependency.
   */
  async updateDependency(
    input: UpdateDependencyInput,
  ): Promise<Dependency | undefined> {
    const [existing] = await this.db
      .select()
      .from(dependencies)
      .where(eq(dependencies.id, input.id));

    if (!existing) return undefined;

    const updateData: Partial<typeof dependencies.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (input.impactType !== undefined) updateData.impactType = input.impactType;
    if (input.transitive !== undefined) updateData.transitive = input.transitive;
    if (input.label !== undefined) updateData.label = input.label;

    await this.db
      .update(dependencies)
      .set(updateData)
      .where(eq(dependencies.id, input.id));

    // Replace health check rules if provided
    if (input.healthCheckRules !== undefined) {
      await this.db
        .delete(dependencyHealthCheckRules)
        .where(eq(dependencyHealthCheckRules.dependencyId, input.id));

      for (const rule of input.healthCheckRules) {
        await this.db.insert(dependencyHealthCheckRules).values({
          id: generateId(),
          dependencyId: input.id,
          healthCheckId: rule.healthCheckId ?? null,
          environmentId: rule.environmentId ?? null,
          overrideImpactType: rule.overrideImpactType,
        });
      }
    }

    return this.getDependencyById(input.id);
  }

  /**
   * Delete a dependency.
   */
  async deleteDependency(id: string): Promise<boolean> {
    const [existing] = await this.db
      .select()
      .from(dependencies)
      .where(eq(dependencies.id, id));

    if (!existing) return false;

    // Cascade delete handles health check rules
    await this.db.delete(dependencies).where(eq(dependencies.id, id));
    return true;
  }

  /**
   * Remove all dependencies referencing a system (both as source and target).
   * Called when a system is deleted from the catalog.
   */
  async removeSystemDependencies(systemId: string): Promise<void> {
    await this.db
      .delete(dependencies)
      .where(
        or(
          eq(dependencies.sourceSystemId, systemId),
          eq(dependencies.targetSystemId, systemId),
        ),
      );
  }

  /**
   * Get a single dependency by ID with health check rules.
   */
  async getDependencyById(id: string): Promise<Dependency | undefined> {
    const [row] = await this.db
      .select()
      .from(dependencies)
      .where(eq(dependencies.id, id));

    if (!row) return undefined;

    const rules = await this.db
      .select()
      .from(dependencyHealthCheckRules)
      .where(eq(dependencyHealthCheckRules.dependencyId, id));

    return {
      ...row,

      label: row.label ?? null,
      healthCheckRules: rules.length > 0 ? rules : undefined,
    };
  }

  /**
   * Batched reactive-state read for the `dependency-edge` entity (Model B
   * plugin-backed `read` accessor). Given dependency ids, return the reactive
   * subset `{ sourceSystemId, targetSystemId, impactType, transitive }` for
   * each that exists (missing ids omitted). Reads the AUTHORITATIVE
   * `dependencies` table — no framework `entity_state` storage. This is the
   * single source of truth `handle.mutate` snapshots `prev` from and
   * `get`/`getMany`/scope enrichment route through.
   */
  async getManyEntityStates(
    ids: ReadonlyArray<string>,
  ): Promise<
    Record<
      string,
      {
        sourceSystemId: string;
        targetSystemId: string;
        impactType: ImpactType;
        transitive: boolean;
      }
    >
  > {
    if (ids.length === 0) return {};

    const rows = await this.db
      .select({
        id: dependencies.id,
        sourceSystemId: dependencies.sourceSystemId,
        targetSystemId: dependencies.targetSystemId,
        impactType: dependencies.impactType,
        transitive: dependencies.transitive,
      })
      .from(dependencies)
      .where(inArray(dependencies.id, [...ids]));

    const out: Record<
      string,
      {
        sourceSystemId: string;
        targetSystemId: string;
        impactType: ImpactType;
        transitive: boolean;
      }
    > = {};
    for (const row of rows) {
      out[row.id] = {
        sourceSystemId: row.sourceSystemId,
        targetSystemId: row.targetSystemId,
        impactType: row.impactType,
        transitive: row.transitive,
      };
    }
    return out;
  }

  // ===========================================================================
  // NODE POSITIONS
  // ===========================================================================

  /**
   * Get saved node positions for a user.
   */
  async getNodePositions(userId: string): Promise<NodePosition[]> {
    const rows = await this.db
      .select()
      .from(nodePositions)
      .where(eq(nodePositions.userId, userId));

    return rows.map((r) => ({
      systemId: r.systemId,
      x: r.x,
      y: r.y,
    }));
  }

  /**
   * Save node positions for a user (replace all).
   */
  async saveNodePositions({
    userId,
    positions,
  }: {
    userId: string;
    positions: NodePosition[];
  }): Promise<void> {
    // Delete existing positions for this user
    await this.db
      .delete(nodePositions)
      .where(eq(nodePositions.userId, userId));

    // Insert new positions
    for (const pos of positions) {
      await this.db.insert(nodePositions).values({
        id: generateId(),
        userId,
        systemId: pos.systemId,
        x: pos.x,
        y: pos.y,
      });
    }
  }

  // ===========================================================================
  // CYCLE DETECTION
  // ===========================================================================

  /**
   * Detect if adding an edge from source → target would create a cycle.
   * Uses DFS from the target system following existing edges.
   * Returns the cycle path if found, or undefined if safe.
   */
  async detectCycle({
    sourceSystemId,
    targetSystemId,
  }: {
    sourceSystemId: string;
    targetSystemId: string;
  }): Promise<string[] | undefined> {
    // Load all edges for traversal
    const allEdges = await this.db
      .select({
        sourceSystemId: dependencies.sourceSystemId,
        targetSystemId: dependencies.targetSystemId,
      })
      .from(dependencies);

    // Build adjacency map: for each system, which systems does it depend on (upstream)?
    // Edge direction: source depends on target, so source → target
    // To detect cycles, we follow: target → (what depends on target as its upstream)
    // i.e., we need to check: can we reach sourceSystemId by following edges from targetSystemId?
    // An edge (A, B) means A depends on B. If we're adding (source, target),
    // we need to check if following existing edges from source as a target,
    // we can reach target. More precisely: does target already transitively depend on source?

    // Build: for each node, what are its upstream dependencies (targetSystemId values)?
    const upstreamMap = new Map<string, string[]>();
    for (const edge of allEdges) {
      const existing = upstreamMap.get(edge.sourceSystemId) ?? [];
      existing.push(edge.targetSystemId);
      upstreamMap.set(edge.sourceSystemId, existing);
    }

    // DFS: starting from targetSystemId, follow its upstream dependencies
    // If we reach sourceSystemId, there's a cycle
    const visited = new Set<string>();
    const path: string[] = [sourceSystemId, targetSystemId];

    const dfs = (current: string): string[] | undefined => {
      if (current === sourceSystemId) {
        return path;
      }

      if (visited.has(current)) {
        return undefined;
      }
      visited.add(current);

      const upstreams = upstreamMap.get(current) ?? [];
      for (const upstream of upstreams) {
        path.push(upstream);
        const result = dfs(upstream);
        if (result) return result;
        path.pop();
      }

      return undefined;
    };

    return dfs(targetSystemId);
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  /**
   * Enrich dependency rows with their health check rules.
   */
  private async enrichWithRules(
    rows: (typeof dependencies.$inferSelect)[],
  ): Promise<Dependency[]> {
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const allRules = await this.db
      .select()
      .from(dependencyHealthCheckRules)
      .where(inArray(dependencyHealthCheckRules.dependencyId, ids));

    const rulesByDep = new Map<
      string,
      (typeof dependencyHealthCheckRules.$inferSelect)[]
    >();
    for (const rule of allRules) {
      const existing = rulesByDep.get(rule.dependencyId) ?? [];
      existing.push(rule);
      rulesByDep.set(rule.dependencyId, existing);
    }

    return rows.map((row) => {
      const rules = rulesByDep.get(row.id);
      return {
        ...row,
         
        label: row.label ?? null,
        healthCheckRules: rules && rules.length > 0 ? rules : undefined,
      };
    });
  }
}
