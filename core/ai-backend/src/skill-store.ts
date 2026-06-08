import { desc, eq, and } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
import type {
  AiSkill,
  AiSkillOutputField,
  AiSkillTarget,
  CreateSkillInput,
  UpdateSkillInput,
} from "@checkstack/ai-common";
import * as schema from "./schema";
import type { AiSkillRow } from "./schema";
import { scrubContent } from "./chat/scrub-content";

type AiDatabase = SafeDatabase<typeof schema>;

/**
 * Persistence for user-authored GLOBAL skills (`ai_skill` table). Skills are
 * visible to everyone who can read skills, so there is no per-viewer scoping on
 * reads; edit/delete authority is the author (enforced HERE via `ownerId`), with
 * an admin/privileged override the RPC handler can opt into by passing
 * `allowAnyOwner`.
 */
export interface AiSkillStore {
  list(): Promise<AiSkill[]>;
  findById(id: string): Promise<AiSkill | undefined>;
  create(input: CreateSkillInput & { ownerId: string }): Promise<AiSkill>;
  /** Update IF the caller authored it (or `allowAnyOwner` for moderation). */
  update(
    input: UpdateSkillInput & { ownerId: string; allowAnyOwner?: boolean },
  ): Promise<AiSkill | undefined>;
  /** Delete IF the caller authored it (or `allowAnyOwner` for moderation). */
  delete(args: {
    id: string;
    ownerId: string;
    allowAnyOwner?: boolean;
  }): Promise<boolean>;
}

/** Scrub credential-shaped values from a free-text field before persisting. */
function scrubText(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const scrubbed = scrubContent({ value: text });
  return typeof scrubbed.value === "string" ? scrubbed.value : text;
}

/** Map a DB row to the wire `AiSkill` (a global user skill). */
export function rowToSkill(row: AiSkillRow): AiSkill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    targets: row.targets as AiSkillTarget[],
    systemPrompt: row.systemPrompt ?? undefined,
    promptTemplate: row.promptTemplate ?? undefined,
    // The column is null (not undefined) when unset; the schema field is
    // optional but NOT nullable, so coerce null -> undefined or output
    // validation rejects it.
    suggestedOutputFields:
      (row.suggestedOutputFields as AiSkillOutputField[] | null) ?? undefined,
    tags: row.tags ?? undefined,
    source: "user",
    ownerId: row.ownerId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createAiSkillStore({ db }: { db: AiDatabase }): AiSkillStore {
  return {
    async list() {
      const rows = await db
        .select()
        .from(schema.aiSkill)
        .orderBy(desc(schema.aiSkill.updatedAt));
      return rows.map((row) => rowToSkill(row));
    },

    async findById(id) {
      const rows = await db
        .select()
        .from(schema.aiSkill)
        .where(eq(schema.aiSkill.id, id))
        .limit(1);
      return rows[0] ? rowToSkill(rows[0]) : undefined;
    },

    async create(input) {
      const [row] = await db
        .insert(schema.aiSkill)
        .values({
          ownerId: input.ownerId,
          name: input.name,
          description: input.description,
          targets: input.targets,
          systemPrompt: scrubText(input.systemPrompt),
          promptTemplate: scrubText(input.promptTemplate),
          suggestedOutputFields: input.suggestedOutputFields,
          tags: input.tags,
        })
        .returning();
      return rowToSkill(row);
    },

    async update({ id, ownerId, allowAnyOwner, ...fields }) {
      const authority = allowAnyOwner
        ? eq(schema.aiSkill.id, id)
        : and(eq(schema.aiSkill.id, id), eq(schema.aiSkill.ownerId, ownerId));
      // Build the partial update from only the fields the caller supplied
      // (PATCH semantics). Plain `if` guards avoid negated-condition lint.
      const set: Partial<typeof schema.aiSkill.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (fields.name !== undefined) set.name = fields.name;
      if (fields.description !== undefined) set.description = fields.description;
      if (fields.targets !== undefined) set.targets = fields.targets;
      if (fields.systemPrompt !== undefined) {
        set.systemPrompt = scrubText(fields.systemPrompt);
      }
      if (fields.promptTemplate !== undefined) {
        set.promptTemplate = scrubText(fields.promptTemplate);
      }
      if (fields.suggestedOutputFields !== undefined) {
        set.suggestedOutputFields = fields.suggestedOutputFields;
      }
      if (fields.tags !== undefined) set.tags = fields.tags;
      const [row] = await db
        .update(schema.aiSkill)
        .set(set)
        .where(authority)
        .returning();
      return row ? rowToSkill(row) : undefined;
    },

    async delete({ id, ownerId, allowAnyOwner }) {
      const authority = allowAnyOwner
        ? eq(schema.aiSkill.id, id)
        : and(eq(schema.aiSkill.id, id), eq(schema.aiSkill.ownerId, ownerId));
      const deleted = await db
        .delete(schema.aiSkill)
        .where(authority)
        .returning({ id: schema.aiSkill.id });
      return deleted.length > 0;
    },
  };
}
