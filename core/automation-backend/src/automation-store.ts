/**
 * Drizzle-backed CRUD for the `automations` table plus the lookups the
 * dispatch engine needs (find by referenced trigger event, etc.).
 *
 * Returns are typed against the public `Automation` shape from
 * `@checkstack/automation-common`, with parsed `definition`.
 */
import { and, eq, sql } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
import {
  AutomationDefinitionSchema,
  type Automation,
  type AutomationDefinition,
  type AutomationStatus,
  type CreateAutomationInput,
  type UpdateAutomationInput,
} from "@checkstack/automation-common";

import { automations } from "./schema";
import type { LoadedAutomation } from "./dispatch/types";

type Schema = { automations: typeof automations };

export interface AutomationStore {
  create(input: CreateAutomationInput): Promise<Automation>;
  update(input: UpdateAutomationInput): Promise<Automation>;
  delete(id: string): Promise<void>;
  toggle(id: string, enabled: boolean): Promise<Automation>;
  getById(id: string): Promise<Automation | undefined>;
  list(filter?: {
    status?: AutomationStatus;
    limit?: number;
    offset?: number;
  }): Promise<{ items: Automation[]; total: number }>;

  /**
   * Enabled automations that reference the given trigger event id in one
   * of their trigger declarations. Used by the trigger fan-in to fan an
   * incoming event out to the right automations.
   */
  findEnabledByTriggerEvent(eventId: string): Promise<LoadedAutomation[]>;

  /**
   * All enabled automations — used at boot to set up setup-backed
   * triggers (cron, interval, …).
   */
  listEnabled(): Promise<LoadedAutomation[]>;
}

function mapToAutomation(
  row: typeof automations.$inferSelect,
): Automation {
  const definition = AutomationDefinitionSchema.parse(row.definition);
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status === "disabled" ? "disabled" : "enabled",
    definition,
    managedBy: row.managedBy ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapToLoaded(
  row: typeof automations.$inferSelect,
): LoadedAutomation {
  return {
    id: row.id,
    name: row.name,
    status: row.status === "disabled" ? "disabled" : "enabled",
    definition: AutomationDefinitionSchema.parse(row.definition),
  };
}

export function createAutomationStore(
  db: SafeDatabase<Schema>,
): AutomationStore {
  return {
    async create(input) {
      const parsedDefinition = AutomationDefinitionSchema.parse(
        input.definition,
      );
      const [row] = await db
        .insert(automations)
        .values({
          name: input.name,
          description: input.description ?? null,
          status: input.status,
          definition: parsedDefinition as unknown as Record<string, unknown>,
        })
        .returning();
      if (!row) throw new Error("create: insert returned no rows");
      return mapToAutomation(row);
    },

    async update(input) {
      const existing = await this.getById(input.id);
      if (!existing) throw new Error(`Automation ${input.id} not found`);

      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) set.name = input.name;
      if (input.description !== undefined)
        set.description = input.description ?? null;
      if (input.status !== undefined) set.status = input.status;
      if (input.definition !== undefined) {
        const parsed = AutomationDefinitionSchema.parse(input.definition);
        set.definition = parsed as unknown as Record<string, unknown>;
      }

      const [row] = await db
        .update(automations)
        .set(set)
        .where(eq(automations.id, input.id))
        .returning();
      if (!row) throw new Error(`update: row ${input.id} not found after update`);
      return mapToAutomation(row);
    },

    async delete(id) {
      await db.delete(automations).where(eq(automations.id, id));
    },

    async toggle(id, enabled) {
      const status: AutomationStatus = enabled ? "enabled" : "disabled";
      const [row] = await db
        .update(automations)
        .set({ status, updatedAt: new Date() })
        .where(eq(automations.id, id))
        .returning();
      if (!row) throw new Error(`Automation ${id} not found`);
      return mapToAutomation(row);
    },

    async getById(id) {
      const rows = await db
        .select()
        .from(automations)
        .where(eq(automations.id, id))
        .limit(1);
      const row = rows[0];
      return row ? mapToAutomation(row) : undefined;
    },

    async list(filter = {}) {
      const limit = filter.limit ?? 50;
      const offset = filter.offset ?? 0;
      const whereExpr = filter.status
        ? eq(automations.status, filter.status)
        : undefined;

      const rows = whereExpr
        ? await db
            .select()
            .from(automations)
            .where(whereExpr)
            .limit(limit)
            .offset(offset)
        : await db
            .select()
            .from(automations)
            .limit(limit)
            .offset(offset);

      const countRows = whereExpr
        ? await db
            .select({ c: sql<number>`count(*)::int` })
            .from(automations)
            .where(whereExpr)
        : await db
            .select({ c: sql<number>`count(*)::int` })
            .from(automations);

      return {
        items: rows.map((r) => mapToAutomation(r)),
        total: countRows[0]?.c ?? 0,
      };
    },

    async findEnabledByTriggerEvent(eventId) {
      // The `definition.triggers` array is queried via JSONB containment.
      // We can't index the inner JSON cheaply without a generated column;
      // for v1 we filter in-memory across all enabled rows. Volume is
      // expected to be in the dozens or low hundreds.
      const rows = await db
        .select()
        .from(automations)
        .where(eq(automations.status, "enabled"));

      const matching: LoadedAutomation[] = [];
      for (const row of rows) {
        const parsed = AutomationDefinitionSchema.safeParse(row.definition);
        if (!parsed.success) continue;
        const defn: AutomationDefinition = parsed.data;
        if (defn.triggers.some((t) => t.event === eventId)) {
          matching.push({
            id: row.id,
            name: row.name,
            status: "enabled",
            definition: defn,
          });
        }
      }
      return matching;
    },

    async listEnabled() {
      const rows = await db
        .select()
        .from(automations)
        .where(eq(automations.status, "enabled"));
      const result: LoadedAutomation[] = [];
      for (const row of rows) {
        const parsed = AutomationDefinitionSchema.safeParse(row.definition);
        if (parsed.success) {
          result.push(mapToLoaded({ ...row, definition: parsed.data as unknown as Record<string, unknown> }));
        }
      }
      return result;
    },
  };
}

// Silence unused-imports for the second `and` symbol (kept around for the
// inevitable future "filter by enabled AND something" query).
void and;
