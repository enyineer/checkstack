import { and, eq, inArray, ne } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
import * as schema from "./schema";

/**
 * The relation-tuple store (Target B): the single ReBAC engine that replaces
 * resource_team_access / resource_access_settings / resource_create_grant.
 *
 * Relations on a concrete object, with implication owner ⊃ editor ⊃ viewer:
 * - viewer: team may READ the object
 * - editor: team may READ + MANAGE the object
 * - owner:  the single owning team (implies editor)
 * The special `public:*` `viewer` tuple is the PRIVACY MARKER — present means
 * "the global RBAC path is open for this object" (today's teamOnly=false).
 * `creator` lives only on the type-level object (objectId "*").
 */
// A single marker tuple `(object, "private", "public:*")` records that the
// object is PRIVATE (the global RBAC path is closed for it). Its ABSENCE is the
// default (globally readable). Privacy is encoded as an explicit marker — rather
// than "absence of a public marker" — so that a private object with ZERO team
// grants is still distinguishable from a never-configured one and stays denied
// to global-rule holders (preserving the old teamOnly fail-closed invariant).
export const PUBLIC_SUBJECT_TYPE = "public";
export const PUBLIC_SUBJECT_ID = "*";
export const PRIVATE_RELATION = "private";
export const TYPE_OBJECT_ID = "*";
export type Relation = "viewer" | "editor" | "owner" | "creator";

/** Relations that grant access to a concrete object (not `creator`). */
const READ_RELATIONS = new Set<string>(["viewer", "editor", "owner"]);
const MANAGE_RELATIONS = new Set<string>(["editor", "owner"]);

export interface ObjectTuple {
  relation: string;
  subjectType: string;
  subjectId: string;
}

/**
 * PURE access decision for ONE object, given all its tuples. Extracted so the
 * security-critical logic is unit-testable without a database. Preserves the
 * exact semantics of the old `checkResourceTeamAccess` (teamOnly model):
 *
 * - PRIVATE (marker present): the global path is closed — team grants ONLY. A
 *   private object with no team grants denies everyone (the old teamOnly
 *   fail-closed invariant).
 * - NOT private + no team grants → default-open: the caller's global verdict.
 * - NOT private + team grants + global access → allow (global path open).
 * - NOT private + team grants, no global → the caller must be in a team holding
 *   a relation satisfying the action (read: viewer|editor|owner; manage:
 *   editor|owner).
 */
export function evaluateAccess({
  tuples,
  userTeamIds,
  action,
  hasGlobalAccess,
}: {
  tuples: ObjectTuple[];
  userTeamIds: string[];
  action: "read" | "manage";
  hasGlobalAccess: boolean;
}): boolean {
  const teamGrants = tuples.filter(
    (t) => t.subjectType === "team" && READ_RELATIONS.has(t.relation),
  );
  const isPrivate = tuples.some(
    (t) =>
      t.subjectType === PUBLIC_SUBJECT_TYPE && t.relation === PRIVATE_RELATION,
  );
  const need = action === "read" ? READ_RELATIONS : MANAGE_RELATIONS;
  const teamSet = new Set(userTeamIds);
  const hasTeamGrant = () =>
    teamGrants.some((t) => teamSet.has(t.subjectId) && need.has(t.relation));

  if (isPrivate) {
    // Global path closed: team grants only (no grants ⇒ deny everyone).
    return hasTeamGrant();
  }
  // Not private:
  if (teamGrants.length === 0) return hasGlobalAccess; // default-open
  if (hasGlobalAccess) return true; // global path open
  return hasTeamGrant();
}

type AuthDb = SafeDatabase<typeof schema>;

export class RelationTupleStore {
  constructor(private readonly db: AuthDb) {}

  private rowsForObject(objectType: string, objectId: string) {
    return this.db
      .select({
        relation: schema.relationTuple.relation,
        subjectType: schema.relationTuple.subjectType,
        subjectId: schema.relationTuple.subjectId,
      })
      .from(schema.relationTuple)
      .where(
        and(
          eq(schema.relationTuple.objectType, objectType),
          eq(schema.relationTuple.objectId, objectId),
        ),
      );
  }

  /** Decide access to a single object. */
  async check({
    objectType,
    objectId,
    userTeamIds,
    action,
    hasGlobalAccess,
  }: {
    objectType: string;
    objectId: string;
    userTeamIds: string[];
    action: "read" | "manage";
    hasGlobalAccess: boolean;
  }): Promise<boolean> {
    const tuples = await this.rowsForObject(objectType, objectId);
    return evaluateAccess({ tuples, userTeamIds, action, hasGlobalAccess });
  }

  /** Filter candidate ids of a type to those the caller can access. */
  async listAccessibleObjectIds({
    objectType,
    candidateIds,
    userTeamIds,
    action,
    hasGlobalAccess,
  }: {
    objectType: string;
    candidateIds: string[];
    userTeamIds: string[];
    action: "read" | "manage";
    hasGlobalAccess: boolean;
  }): Promise<string[]> {
    if (candidateIds.length === 0) return [];
    const rows = await this.db
      .select({
        objectId: schema.relationTuple.objectId,
        relation: schema.relationTuple.relation,
        subjectType: schema.relationTuple.subjectType,
        subjectId: schema.relationTuple.subjectId,
      })
      .from(schema.relationTuple)
      .where(
        and(
          eq(schema.relationTuple.objectType, objectType),
          inArray(schema.relationTuple.objectId, candidateIds),
        ),
      );
    const byObject = new Map<string, ObjectTuple[]>();
    for (const r of rows) {
      const list = byObject.get(r.objectId) ?? [];
      list.push(r);
      byObject.set(r.objectId, list);
    }
    return candidateIds.filter((id) =>
      evaluateAccess({
        tuples: byObject.get(id) ?? [],
        userTeamIds,
        action,
        hasGlobalAccess,
      }),
    );
  }

  /**
   * Does the caller belong to a team holding ANY access grant of the required
   * level on a concrete object of this type? Powers the G11 categorical-403.
   */
  async hasAnyTypeGrant({
    objectType,
    userTeamIds,
    action,
    includeCreator = false,
  }: {
    objectType: string;
    userTeamIds: string[];
    action: "read" | "manage";
    /**
     * Also count a type-level `creator` (create-capability) grant, and stop
     * excluding the type object id. Used by the `typeScoped` gate so a team
     * member who may CREATE the type is authorized for its authoring utilities
     * before they own any concrete instance. Default false preserves the
     * list/record post-filter semantics (a creator who owns nothing has nothing
     * to list, so must not read as "has a grant" there).
     */
    includeCreator?: boolean;
  }): Promise<boolean> {
    if (userTeamIds.length === 0) return false;
    const base = action === "read" ? READ_RELATIONS : MANAGE_RELATIONS;
    const need = includeCreator ? [...base, "creator"] : [...base];
    const [row] = await this.db
      .select({ objectId: schema.relationTuple.objectId })
      .from(schema.relationTuple)
      .where(
        and(
          eq(schema.relationTuple.objectType, objectType),
          // Concrete-object grants (viewer/editor/owner) live on real ids; the
          // `creator` grant lives on the type object id (`*`). Only exclude the
          // type id when we are NOT counting creator grants.
          includeCreator
            ? undefined
            : ne(schema.relationTuple.objectId, TYPE_OBJECT_ID),
          eq(schema.relationTuple.subjectType, "team"),
          inArray(schema.relationTuple.subjectId, userTeamIds),
          inArray(schema.relationTuple.relation, need),
        ),
      )
      .limit(1);
    return !!row;
  }

  /**
   * The distinct resource types the given teams can act on as a MANAGER: either
   * a `creator` grant (may create the type) or an `editor`/`owner` grant on at
   * least one concrete object of the type (may manage an existing one). Powers
   * the frontend nav/route/page "should this management surface be visible?"
   * gate for team-scoped users who hold no global manage rule.
   */
  async manageableTypesForTeams({
    userTeamIds,
  }: {
    userTeamIds: string[];
  }): Promise<string[]> {
    if (userTeamIds.length === 0) return [];
    const rows = await this.db
      .select({ objectType: schema.relationTuple.objectType })
      .from(schema.relationTuple)
      .where(
        and(
          eq(schema.relationTuple.subjectType, "team"),
          inArray(schema.relationTuple.subjectId, userTeamIds),
          inArray(schema.relationTuple.relation, ["creator", "editor", "owner"]),
        ),
      );
    return [...new Set(rows.map((r) => r.objectType))];
  }

  /** Teams (of the caller's) that may CREATE the given type. */
  async creatorTeamIds({
    objectType,
    userTeamIds,
  }: {
    objectType: string;
    userTeamIds: string[];
  }): Promise<string[]> {
    if (userTeamIds.length === 0) return [];
    const rows = await this.db
      .select({ subjectId: schema.relationTuple.subjectId })
      .from(schema.relationTuple)
      .where(
        and(
          eq(schema.relationTuple.objectType, objectType),
          eq(schema.relationTuple.objectId, TYPE_OBJECT_ID),
          eq(schema.relationTuple.relation, "creator"),
          eq(schema.relationTuple.subjectType, "team"),
          inArray(schema.relationTuple.subjectId, userTeamIds),
        ),
      );
    return rows.map((r) => r.subjectId);
  }

  // ---- writes -------------------------------------------------------------

  /**
   * Set a team's access relation on an object to exactly `relation` (replacing
   * any other viewer/editor/owner it has there). Use for the read/manage editor.
   */
  async setTeamRelation({
    objectType,
    objectId,
    teamId,
    relation,
  }: {
    objectType: string;
    objectId: string;
    teamId: string;
    relation: Relation;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(schema.relationTuple)
        .where(
          and(
            eq(schema.relationTuple.objectType, objectType),
            eq(schema.relationTuple.objectId, objectId),
            eq(schema.relationTuple.subjectType, "team"),
            eq(schema.relationTuple.subjectId, teamId),
            inArray(schema.relationTuple.relation, [...READ_RELATIONS]),
          ),
        );
      await tx
        .insert(schema.relationTuple)
        .values({
          objectType,
          objectId,
          relation,
          subjectType: "team",
          subjectId: teamId,
        })
        .onConflictDoNothing();
    });
  }

  /** Remove all of a team's access relations on an object. */
  async removeTeamFromObject({
    objectType,
    objectId,
    teamId,
  }: {
    objectType: string;
    objectId: string;
    teamId: string;
  }): Promise<void> {
    await this.db
      .delete(schema.relationTuple)
      .where(
        and(
          eq(schema.relationTuple.objectType, objectType),
          eq(schema.relationTuple.objectId, objectId),
          eq(schema.relationTuple.subjectType, "team"),
          eq(schema.relationTuple.subjectId, teamId),
        ),
      );
  }

  /**
   * Set object privacy. `isPublic: true` (the default) removes the private
   * marker so the global RBAC path is open; `isPublic: false` writes the private
   * marker, closing the global path (team grants only).
   */
  async setObjectPublic({
    objectType,
    objectId,
    isPublic,
  }: {
    objectType: string;
    objectId: string;
    isPublic: boolean;
  }): Promise<void> {
    await (isPublic
      ? this.db
          .delete(schema.relationTuple)
          .where(
            and(
              eq(schema.relationTuple.objectType, objectType),
              eq(schema.relationTuple.objectId, objectId),
              eq(schema.relationTuple.relation, PRIVATE_RELATION),
              eq(schema.relationTuple.subjectType, PUBLIC_SUBJECT_TYPE),
            ),
          )
      : this.db
          .insert(schema.relationTuple)
          .values({
            objectType,
            objectId,
            relation: PRIVATE_RELATION,
            subjectType: PUBLIC_SUBJECT_TYPE,
            subjectId: PUBLIC_SUBJECT_ID,
          })
          .onConflictDoNothing());
  }

  /** Grant/revoke a team's create-capability for a type. */
  async setCreator({
    objectType,
    teamId,
    allowed,
  }: {
    objectType: string;
    teamId: string;
    allowed: boolean;
  }): Promise<void> {
    await (allowed
      ? this.db
          .insert(schema.relationTuple)
          .values({
            objectType,
            objectId: TYPE_OBJECT_ID,
            relation: "creator",
            subjectType: "team",
            subjectId: teamId,
          })
          .onConflictDoNothing()
      : this.db
          .delete(schema.relationTuple)
          .where(
            and(
              eq(schema.relationTuple.objectType, objectType),
              eq(schema.relationTuple.objectId, TYPE_OBJECT_ID),
              eq(schema.relationTuple.relation, "creator"),
              eq(schema.relationTuple.subjectType, "team"),
              eq(schema.relationTuple.subjectId, teamId),
            ),
          ));
  }

  /**
   * Record ownership of a freshly-created object: the team gets `owner` (the
   * object stays team-managed but globally readable by default). When not
   * public, the private marker is written too.
   */
  async setOwner({
    objectType,
    objectId,
    teamId,
    isPublic,
  }: {
    objectType: string;
    objectId: string;
    teamId: string;
    isPublic: boolean;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Clear any lower relation this team already holds on the object so it
      // ends up with exactly one access relation (owner), mirroring
      // setTeamRelation.
      await tx
        .delete(schema.relationTuple)
        .where(
          and(
            eq(schema.relationTuple.objectType, objectType),
            eq(schema.relationTuple.objectId, objectId),
            eq(schema.relationTuple.subjectType, "team"),
            eq(schema.relationTuple.subjectId, teamId),
            inArray(schema.relationTuple.relation, [...READ_RELATIONS]),
          ),
        );
      await tx
        .insert(schema.relationTuple)
        .values({
          objectType,
          objectId,
          relation: "owner",
          subjectType: "team",
          subjectId: teamId,
        })
        .onConflictDoNothing();
      if (!isPublic) {
        await tx
          .insert(schema.relationTuple)
          .values({
            objectType,
            objectId,
            relation: PRIVATE_RELATION,
            subjectType: PUBLIC_SUBJECT_TYPE,
            subjectId: PUBLIC_SUBJECT_ID,
          })
          .onConflictDoNothing();
      }
    });
  }

  /** Cascade: drop every tuple for a deleted team. */
  async deleteTeamTuples(teamId: string): Promise<void> {
    await this.db
      .delete(schema.relationTuple)
      .where(
        and(
          eq(schema.relationTuple.subjectType, "team"),
          eq(schema.relationTuple.subjectId, teamId),
        ),
      );
  }

  // ---- reads for the admin UI --------------------------------------------

  /** Team relations + public flag on an object (powers "Who can change this"). */
  async listObjectRelations({
    objectType,
    objectId,
  }: {
    objectType: string;
    objectId: string;
  }): Promise<{
    teams: Array<{ teamId: string; relation: string }>;
    isPublic: boolean;
  }> {
    const tuples = await this.rowsForObject(objectType, objectId);
    const isPrivate = tuples.some(
      (t) =>
        t.subjectType === PUBLIC_SUBJECT_TYPE && t.relation === PRIVATE_RELATION,
    );
    return {
      teams: tuples
        .filter((t) => t.subjectType === "team" && READ_RELATIONS.has(t.relation))
        .map((t) => ({ teamId: t.subjectId, relation: t.relation })),
      isPublic: !isPrivate,
    };
  }

  /** Concrete-object grants held by a team (powers the Teams-page grant list). */
  async listSubjectRelations({
    teamId,
  }: {
    teamId: string;
  }): Promise<
    Array<{ objectType: string; objectId: string; relation: string }>
  > {
    const rows = await this.db
      .select({
        objectType: schema.relationTuple.objectType,
        objectId: schema.relationTuple.objectId,
        relation: schema.relationTuple.relation,
      })
      .from(schema.relationTuple)
      .where(
        and(
          eq(schema.relationTuple.subjectType, "team"),
          eq(schema.relationTuple.subjectId, teamId),
          ne(schema.relationTuple.objectId, TYPE_OBJECT_ID),
          inArray(schema.relationTuple.relation, [...READ_RELATIONS]),
        ),
      );
    return rows;
  }

  /** Resource types a team may create (creator tuples). */
  async listCreateGrants({ teamId }: { teamId: string }): Promise<string[]> {
    const rows = await this.db
      .select({ objectType: schema.relationTuple.objectType })
      .from(schema.relationTuple)
      .where(
        and(
          eq(schema.relationTuple.objectId, TYPE_OBJECT_ID),
          eq(schema.relationTuple.relation, "creator"),
          eq(schema.relationTuple.subjectType, "team"),
          eq(schema.relationTuple.subjectId, teamId),
        ),
      );
    return rows.map((r) => r.objectType);
  }
}
