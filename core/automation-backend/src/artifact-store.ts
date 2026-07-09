import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
import { automationArtifacts } from "./schema";
import type { RunSecretRegistry } from "./dispatch/run-secret-registry";

/**
 * Inputs for recording a new artifact.
 */
export interface RecordArtifactInput {
  automationId: string;
  runId: string;
  stepId: string;
  /** Operator-assigned action id, if any. */
  actionId: string | null;
  /** Fully qualified artifact type (e.g. "jira.issue"). */
  artifactType: string;
  /** Free-form data — caller is responsible for prior validation. */
  data: Record<string, unknown>;
  /** Durable lookup key (typically incidentId). */
  contextKey: string | null;
}

/**
 * Lookup parameters for finding an artifact. Each field narrows the
 * search; at minimum `automationId` is required. The most recent match
 * (by `created_at`) is returned, optionally restricted to still-open
 * artifacts (i.e. `closed_at` is NULL).
 */
export interface FindArtifactInput {
  automationId: string;
  contextKey?: string | null;
  artifactType?: string;
  actionId?: string;
  /** When true, ignore artifacts that have been closed. Defaults to true. */
  onlyOpen?: boolean;
}

export interface PersistedArtifact {
  id: string;
  automationId: string;
  runId: string;
  stepId: string;
  actionId: string | null;
  artifactType: string;
  data: Record<string, unknown>;
  contextKey: string | null;
  closedAt: Date | null;
  createdAt: Date;
}

/**
 * Persistence interface for artifacts. The dispatch engine writes a row
 * on every successful action that declares `produces`; consumers
 * (downstream actions, the run-detail UI) read through `find` and
 * `markClosed`.
 */
export interface ArtifactStore {
  record(input: RecordArtifactInput): Promise<PersistedArtifact>;
  find(input: FindArtifactInput): Promise<PersistedArtifact | undefined>;
  findAll(input: FindArtifactInput): Promise<PersistedArtifact[]>;
  /**
   * Batched sibling of {@link find} for resolving several artifact types at
   * once (a consuming action's `consumes` list). Returns, per requested type,
   * the SAME most-recent match {@link find} would return for that type in
   * isolation — keyed by `artifactType` — in a SINGLE `inArray` query instead
   * of one `find` per type. Types with no match are simply absent from the map.
   */
  findLatestByTypes(input: {
    automationId: string;
    contextKey?: string | null;
    artifactTypes: ReadonlyArray<string>;
    /** When true, ignore artifacts that have been closed. Defaults to true. */
    onlyOpen?: boolean;
  }): Promise<Map<string, PersistedArtifact>>;
  markClosed(artifactId: string): Promise<void>;
}

export function createArtifactStore(
  db: SafeDatabase<{ automationArtifacts: typeof automationArtifacts }>,
  /**
   * Run-scoped secret values accumulated during dispatch. When provided,
   * an artifact's `data` is masked (Jenkins-style, by-value) BEFORE
   * insert — so a resolved connection credential surfaced into a produced
   * artifact can't reach a replay / run-detail reader unmasked. Same
   * persist-time choke-point pattern as the run-state + run stores.
   * Optional so tests / older boots degrade to no masking.
   */
  secretRegistry?: RunSecretRegistry,
): ArtifactStore {
  const mapRow = (
    row: typeof automationArtifacts.$inferSelect,
  ): PersistedArtifact => ({
    id: row.id,
    automationId: row.automationId,
    runId: row.runId,
    stepId: row.stepId,
    actionId: row.actionId,
    artifactType: row.artifactType,
    data: row.data,
    contextKey: row.contextKey,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
  });

  return {
    async record(input) {
      // Mask resolved secret values out of the artifact data BEFORE insert
      // — the persistence choke point, so a credential surfaced into a
      // produced artifact never reaches a replay / run-detail reader.
      const maskedData = (secretRegistry?.maskDeep(input.runId, input.data) ??
        input.data) as Record<string, unknown>;
      const [row] = await db
        .insert(automationArtifacts)
        .values({
          automationId: input.automationId,
          runId: input.runId,
          stepId: input.stepId,
          actionId: input.actionId,
          artifactType: input.artifactType,
          data: maskedData,
          contextKey: input.contextKey,
        })
        .returning();
      if (!row) {
        throw new Error(
          "Failed to record artifact — insert returned no rows",
        );
      }
      return mapRow(row);
    },

    async find(input) {
      const rows = await this.findAll(input);
      return rows[0];
    },

    async findAll(input) {
      const onlyOpen = input.onlyOpen ?? true;
      const filters = [eq(automationArtifacts.automationId, input.automationId)];
      if (input.contextKey !== undefined && input.contextKey !== null) {
        filters.push(eq(automationArtifacts.contextKey, input.contextKey));
      }
      if (input.artifactType) {
        filters.push(eq(automationArtifacts.artifactType, input.artifactType));
      }
      if (input.actionId) {
        filters.push(eq(automationArtifacts.actionId, input.actionId));
      }
      if (onlyOpen) {
        filters.push(isNull(automationArtifacts.closedAt));
      }

      const rows = await db
        .select()
        .from(automationArtifacts)
        .where(and(...filters))
        .orderBy(desc(automationArtifacts.createdAt));

      return rows.map((row) => mapRow(row));
    },

    async findLatestByTypes(input) {
      if (input.artifactTypes.length === 0) return new Map();
      const onlyOpen = input.onlyOpen ?? true;
      const filters = [
        eq(automationArtifacts.automationId, input.automationId),
        inArray(automationArtifacts.artifactType, [...input.artifactTypes]),
      ];
      if (input.contextKey !== undefined && input.contextKey !== null) {
        filters.push(eq(automationArtifacts.contextKey, input.contextKey));
      }
      if (onlyOpen) {
        filters.push(isNull(automationArtifacts.closedAt));
      }

      // Ordered newest-first so the FIRST row seen per type is the most recent
      // — matching `find`'s per-type "most recent match wins" contract.
      const rows = await db
        .select()
        .from(automationArtifacts)
        .where(and(...filters))
        .orderBy(desc(automationArtifacts.createdAt));

      const byType = new Map<string, PersistedArtifact>();
      for (const row of rows) {
        if (!byType.has(row.artifactType)) {
          byType.set(row.artifactType, mapRow(row));
        }
      }
      return byType;
    },

    async markClosed(artifactId) {
      await db
        .update(automationArtifacts)
        .set({ closedAt: new Date() })
        .where(eq(automationArtifacts.id, artifactId));
    },
  };
}
