import { and, eq, inArray } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
import * as schema from "./schema";

/**
 * Server-local logic shared by every spec / target / resource / dispatch
 * RPC. Centralizes the auto-provisioning, parent-edge lookup, and
 * group-id derivation so plugins never compute groupIds themselves.
 *
 * Convention:
 *   notification group id = `<spec.ownerPlugin>.<spec.localId>.<resourceKey>`
 *
 * That is the *only* way notification groups for spec subscriptions are
 * named; there is no escape hatch.
 */

type Db = SafeDatabase<typeof schema>;

export function deriveGroupId(opts: {
  ownerPlugin: string;
  localId: string;
  resourceKey: string;
}): string {
  return `${opts.ownerPlugin}.${opts.localId}.${opts.resourceKey}`;
}

/**
 * Materialize a single notification group for a (spec × resource) pair.
 * Idempotent — relies on the existing `notification_groups` upsert.
 */
export async function ensureGroupForSpecAndResource(opts: {
  db: Db;
  spec: typeof schema.subscriptionSpecs.$inferSelect;
  resource: typeof schema.notificationResources.$inferSelect;
}): Promise<{ groupId: string; created: boolean }> {
  const { db, spec, resource } = opts;
  const groupId = deriveGroupId({
    ownerPlugin: spec.ownerPlugin,
    localId: spec.localId,
    resourceKey: resource.resourceKey,
  });

  // Group naming follows `<DisplayLabel> <SpecTitle>` ("API Gateway
  // Anomaly Detection") so audit lists and the bell render labels that
  // make sense without context.
  const groupName = `${resource.displayLabel} · ${spec.displayTitle}`;
  const description = spec.displayDescription;

  const existing = await db
    .select({ id: schema.notificationGroups.id })
    .from(schema.notificationGroups)
    .where(eq(schema.notificationGroups.id, groupId))
    .limit(1);
  const created = existing.length === 0;

  await db
    .insert(schema.notificationGroups)
    .values({
      id: groupId,
      name: groupName,
      description,
      ownerPlugin: spec.ownerPlugin,
    })
    .onConflictDoUpdate({
      target: [schema.notificationGroups.id],
      set: { name: groupName, description },
    });

  return { groupId, created };
}

export async function deleteGroupForSpecAndResource(opts: {
  db: Db;
  spec: { ownerPlugin: string; localId: string };
  resourceKey: string;
}): Promise<void> {
  const { db, spec, resourceKey } = opts;
  const groupId = deriveGroupId({
    ownerPlugin: spec.ownerPlugin,
    localId: spec.localId,
    resourceKey,
  });
  await db
    .delete(schema.notificationGroups)
    .where(eq(schema.notificationGroups.id, groupId));
}

/**
 * Provision groups for a newly-registered spec across every existing
 * resource of its target. Also handles the one-shot legacy seeding when
 * the target declared a legacy migration: subscribers of the legacy
 * group are bulk-copied onto the new group, exactly once per
 * (spec × resource), tracked in `subscription_migrations`.
 */
export async function provisionGroupsForSpec(opts: {
  db: Db;
  spec: typeof schema.subscriptionSpecs.$inferSelect;
  legacyGroupIdFor?: (resourceKey: string) => string;
}): Promise<void> {
  const { db, spec, legacyGroupIdFor } = opts;

  const resources = await db
    .select()
    .from(schema.notificationResources)
    .where(eq(schema.notificationResources.targetTypeId, spec.targetTypeId));

  for (const resource of resources) {
    const { groupId } = await ensureGroupForSpecAndResource({
      db,
      spec,
      resource,
    });

    if (!legacyGroupIdFor) continue;

    const [migrated] = await db
      .select()
      .from(schema.subscriptionMigrations)
      .where(
        and(
          eq(schema.subscriptionMigrations.specId, spec.specId),
          eq(schema.subscriptionMigrations.resourceKey, resource.resourceKey),
        ),
      )
      .limit(1);
    if (migrated) continue;

    const legacyGroupId = legacyGroupIdFor(resource.resourceKey);
    const legacySubs = await db
      .select({ userId: schema.notificationSubscriptions.userId })
      .from(schema.notificationSubscriptions)
      .where(eq(schema.notificationSubscriptions.groupId, legacyGroupId));

    if (legacySubs.length > 0) {
      await db
        .insert(schema.notificationSubscriptions)
        .values(
          legacySubs.map((s) => ({ userId: s.userId, groupId })),
        )
        .onConflictDoNothing();
    }

    await db
      .insert(schema.subscriptionMigrations)
      .values({ specId: spec.specId, resourceKey: resource.resourceKey })
      .onConflictDoNothing();
  }
}

/**
 * Provision groups for a newly-upserted resource across every spec
 * registered against its target. Used both on first push and on rename
 * (rename re-runs the upsert which refreshes group display labels).
 */
export async function provisionGroupsForResource(opts: {
  db: Db;
  targetTypeId: string;
  resource: typeof schema.notificationResources.$inferSelect;
}): Promise<void> {
  const { db, targetTypeId, resource } = opts;
  const specs = await db
    .select()
    .from(schema.subscriptionSpecs)
    .where(eq(schema.subscriptionSpecs.targetTypeId, targetTypeId));
  for (const spec of specs) {
    await ensureGroupForSpecAndResource({ db, spec, resource });
  }
}

/**
 * Tear down all groups derived from a deleted resource across every
 * matching spec. Returns how many were dropped.
 */
export async function teardownGroupsForResource(opts: {
  db: Db;
  targetTypeId: string;
  resourceKey: string;
}): Promise<number> {
  const { db, targetTypeId, resourceKey } = opts;
  const specs = await db
    .select()
    .from(schema.subscriptionSpecs)
    .where(eq(schema.subscriptionSpecs.targetTypeId, targetTypeId));

  if (specs.length === 0) return 0;

  const groupIds = specs.map((spec) =>
    deriveGroupId({
      ownerPlugin: spec.ownerPlugin,
      localId: spec.localId,
      resourceKey,
    }),
  );
  const deleted = await db
    .delete(schema.notificationGroups)
    .where(inArray(schema.notificationGroups.id, groupIds))
    .returning({ id: schema.notificationGroups.id });
  return deleted.length;
}

/**
 * One inherited notification group for a child resource, carrying enough
 * provenance for callers (dispatch and the inheritance read proc) to also
 * look up the parent resource's display label.
 */
export interface InheritedGroup {
  /** Derived parent group id (`<ownerPlugin>.<localId>.<parentKey>`). */
  groupId: string;
  /** The parent resource's target type. */
  parentTargetTypeId: string;
  /** The parent resource's key. */
  parentResourceKey: string;
}

/**
 * Pure join step: cross parent edges with the parent specs of the SAME
 * owner plugin whose `targetTypeId` matches the parent's target type, and
 * derive one inherited group per matching (parent x parentSpec) pair.
 *
 * Extracted so the group-vs-system inheritance rule has a single,
 * DB-free, unit-testable derivation shared by dispatch and the read proc -
 * they can never diverge on "which groups are inherited".
 */
export function mapInheritedGroups(opts: {
  ownerPlugin: string;
  parents: ReadonlyArray<{
    parentTargetTypeId: string;
    parentResourceKey: string;
  }>;
  parentSpecs: ReadonlyArray<{
    ownerPlugin: string;
    localId: string;
    targetTypeId: string;
  }>;
}): InheritedGroup[] {
  const { ownerPlugin, parents, parentSpecs } = opts;
  const out: InheritedGroup[] = [];
  for (const parent of parents) {
    for (const parentSpec of parentSpecs) {
      // Only the child spec's OWN plugin inherits (an incident subscription
      // inherits from the incident group spec, not an anomaly one).
      if (parentSpec.ownerPlugin !== ownerPlugin) continue;
      if (parentSpec.targetTypeId !== parent.parentTargetTypeId) continue;
      out.push({
        groupId: deriveGroupId({
          ownerPlugin: parentSpec.ownerPlugin,
          localId: parentSpec.localId,
          resourceKey: parent.parentResourceKey,
        }),
        parentTargetTypeId: parent.parentTargetTypeId,
        parentResourceKey: parent.parentResourceKey,
      });
    }
  }
  return out;
}

/**
 * For dispatch and the inheritance read proc: given a child (target,
 * resourceKey), find every parent resource via
 * `notification_resource_parents`, then map each parent to the same
 * plugin's spec(s) whose `targetTypeId` equals the parent's target type.
 * Inherited groups (id + parent provenance) are derived from those specs.
 */
export async function resolveInheritedGroups(opts: {
  db: Db;
  spec: typeof schema.subscriptionSpecs.$inferSelect;
  resourceKey: string;
}): Promise<InheritedGroup[]> {
  const { db, spec, resourceKey } = opts;

  const parents = await db
    .select()
    .from(schema.notificationResourceParents)
    .where(
      and(
        eq(
          schema.notificationResourceParents.childTargetTypeId,
          spec.targetTypeId,
        ),
        eq(schema.notificationResourceParents.childResourceKey, resourceKey),
      ),
    );

  if (parents.length === 0) return [];

  const parentTargetTypeIds = [
    ...new Set(parents.map((p) => p.parentTargetTypeId)),
  ];

  const parentSpecs = await db
    .select()
    .from(schema.subscriptionSpecs)
    .where(
      and(
        eq(schema.subscriptionSpecs.ownerPlugin, spec.ownerPlugin),
        inArray(schema.subscriptionSpecs.targetTypeId, parentTargetTypeIds),
      ),
    );

  return mapInheritedGroups({
    ownerPlugin: spec.ownerPlugin,
    parents,
    parentSpecs,
  });
}

/**
 * Dispatch-facing convenience: the inherited group ids only. Delegates to
 * `resolveInheritedGroups` so there is a single derivation path.
 */
export async function resolveInheritedGroupIds(opts: {
  db: Db;
  spec: typeof schema.subscriptionSpecs.$inferSelect;
  resourceKey: string;
}): Promise<string[]> {
  const groups = await resolveInheritedGroups(opts);
  return groups.map((g) => g.groupId);
}
