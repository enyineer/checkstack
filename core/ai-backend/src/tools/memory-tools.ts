import { z } from "zod";
import {
  qualifyAccessRuleId,
  qualifyResourceType,
  isAccessRuleSatisfied,
} from "@checkstack/common";
import type { AuthUser } from "@checkstack/backend-api";
import { catalogAccess } from "@checkstack/catalog-common";
import { aiAccess, pluginMetadata, type AiProposalPreview } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "../tool-registry";
import {
  isMemoryVisibleTo,
  type AiMemoryStore,
  type AiMemoryScope,
} from "../memory-store";
import type { SystemAccessResolver } from "../system-signals-contributor";
import { principalGrantedRuleIds } from "../extension-points";

const MEMORY_READ = qualifyAccessRuleId(pluginMetadata, aiAccess.memoryRead);
const MEMORY_MANAGE = qualifyAccessRuleId(pluginMetadata, aiAccess.memoryManage);

/**
 * Stable owner id for a memory: a real user or a service-account (application)
 * principal. A bare trusted `service` principal has no identity to own a memory,
 * so memory tools are not for it.
 */
function ownerIdOf(principal: AuthUser): string {
  if (principal.type === "user" || principal.type === "application") {
    return principal.id;
  }
  throw new Error(
    "Memory tools require a user or service-account principal (no owner identity for a trusted service).",
  );
}

/** Catalog "system" resource type the access resolver filters on (`catalog.system`). */
const SYSTEM_RESOURCE_TYPE = qualifyResourceType(
  catalogAccess.system.read.pluginId,
  catalogAccess.system.read.resource,
);

/** The serialized shape of a recalled memory returned to the model / UI. */
const MemoryViewSchema = z.object({
  id: z.string(),
  scope: z.enum(["user", "system"]),
  systemId: z.string().nullable(),
  recallHint: z.string(),
  content: z.string(),
  tags: z.array(z.string()),
  savedAt: z.string(),
});
type MemoryView = z.infer<typeof MemoryViewSchema>;

function toView(row: {
  id: string;
  scope: AiMemoryScope;
  systemId: string | null;
  recallHint: string;
  content: string;
  tags: string[] | null;
  updatedAt: Date;
}): MemoryView {
  return {
    id: row.id,
    scope: row.scope,
    systemId: row.systemId,
    recallHint: row.recallHint,
    content: row.content,
    tags: row.tags ?? [],
    savedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The systems (from `candidateSystemIds`) the principal may act on at `action`,
 * applying the SAME team/instance grants the catalog's own list endpoints use. A
 * `*`-holder (incl. trusted services, via {@link principalGrantedRuleIds}) gets
 * all; a real user/application is filtered by the access resolver; anyone else
 * gets none. `resolver` is built from a TRUSTED client (the auth S2S query is
 * `userType: "service"`), so it is injected, not built from the tool's
 * user-scoped client.
 */
export async function accessibleSystems({
  principal,
  resolver,
  candidateSystemIds,
  action,
}: {
  principal: AuthUser;
  resolver: SystemAccessResolver;
  candidateSystemIds: string[];
  action: "read" | "manage";
}): Promise<Set<string>> {
  if (candidateSystemIds.length === 0) return new Set();
  const rule = catalogAccess.system[action];
  if (isAccessRuleSatisfied(principalGrantedRuleIds(principal), rule)) {
    return new Set(candidateSystemIds);
  }
  if (principal.type !== "user" && principal.type !== "application") {
    return new Set();
  }
  const ids = await resolver.accessibleSystemIds({
    userId: principal.id,
    userType: principal.type,
    resourceType: SYSTEM_RESOURCE_TYPE,
    systemIds: candidateSystemIds,
    action,
    hasGlobalAccess: false,
  });
  return new Set(ids);
}

const SaveMemoryInputSchema = z
  .object({
    scope: z.enum(["user", "system"]),
    systemId: z.string().optional(),
    recallHint: z
      .string()
      .min(1)
      .describe("What this is + when to recall it, e.g. 'Recall when filing infra Jira tickets'."),
    content: z.string().min(1).describe("The note to remember."),
    tags: z.array(z.string()).optional(),
    alwaysInject: z
      .boolean()
      .optional()
      .describe(
        "Set true for a preference that should ALWAYS shape how you respond " +
          "(writing style, tone, formatting, defaults) so it applies every turn " +
          "without being recalled. Leave false (default) for a fact to look up " +
          "only when relevant. The operator can change this later.",
      ),
  })
  .refine((v) => v.scope !== "system" || !!v.systemId, {
    message: "systemId is required when scope is 'system'.",
    path: ["systemId"],
  });
type SaveMemoryInput = z.infer<typeof SaveMemoryInputSchema>;

/**
 * Build the three memory tools over a store + a (trusted-client-backed) system
 * access resolver. Registered through `aiToolExtensionPoint` in ai-backend init;
 * offered to the chat assistant and (because the agent runner offers read +
 * mutate and filters `destructive`) to the automation agent for `searchMemory` +
 * `saveMemory`, never `deleteMemory`.
 */
export function createMemoryTools({
  store,
  resolver,
}: {
  store: AiMemoryStore;
  resolver: SystemAccessResolver;
}): RegisteredAiTool[] {
  // Writing a `system` memory requires read access to that system.
  async function assertCanWriteSystem({
    input,
    principal,
  }: {
    input: SaveMemoryInput;
    principal: AuthUser;
  }): Promise<void> {
    if (input.scope !== "system" || !input.systemId) return;
    const readable = await accessibleSystems({
      principal,
      resolver,
      candidateSystemIds: [input.systemId],
      action: "read",
    });
    if (!readable.has(input.systemId)) {
      throw new Error(
        `Not allowed to save a memory for system ${input.systemId}: you do not have access to it.`,
      );
    }
  }

  const searchMemory: RegisteredAiTool<
    { query: string; limit?: number },
    { memories: MemoryView[] }
  > = {
    name: "ai.searchMemory",
    description:
      "Recall saved memories: operator preferences/policies and durable facts about a system, " +
      "from earlier conversations. Call this BEFORE drafting when prior context might apply. " +
      "Returns each memory's recallHint (what it is + when to use it) and content. Read-only.",
    effect: "read",
    input: z.object({
      query: z.string().min(1),
      limit: z.number().int().positive().max(50).optional(),
    }),
    output: z.object({ memories: z.array(MemoryViewSchema) }),
    requiredAccessRules: [MEMORY_READ],
    async execute({ input, principal }) {
      const readable = await accessibleSystems({
        principal,
        resolver,
        candidateSystemIds: await store.systemIdsWithMemories(),
        action: "read",
      });
      const rows = await store.search({
        ownerId: ownerIdOf(principal),
        readableSystemIds: [...readable],
        query: input.query,
        limit: input.limit,
      });
      return { memories: rows.map((row) => toView(row)) };
    },
  };

  const saveMemory: RegisteredAiTool<SaveMemoryInput, { id: string; updated: boolean }> = {
    name: "ai.saveMemory",
    description:
      "Save a durable memory so a FUTURE conversation benefits. Use ONLY for knowledge not " +
      "queryable live: an operator preference/policy (scope 'user'), or a non-obvious lasting " +
      "fact about one system (scope 'system' + systemId). NEVER save current/transient state " +
      "(health, incidents, metrics) — query those live. Search first; this updates a close " +
      "existing memory instead of duplicating. Propose at most one per turn, at the end.",
    effect: "mutate",
    input: SaveMemoryInputSchema,
    requiredAccessRules: [MEMORY_MANAGE],
    async dryRun({ input, principal }): Promise<AiProposalPreview<SaveMemoryInput>> {
      await assertCanWriteSystem({ input, principal });
      const dup = await store.findDuplicate({
        ownerId: ownerIdOf(principal),
        scope: input.scope,
        systemId: input.systemId,
        recallHint: input.recallHint,
      });
      const where = input.scope === "system" ? `system: ${input.systemId}` : "your preferences";
      const apply = input.alwaysInject
        ? " [always applied]"
        : " [recalled when relevant]";
      return {
        summary: `${dup ? "Update an existing memory" : "Remember"} (${where})${apply}: ${input.recallHint}`,
        payload: input,
      };
    },
    async execute({ input, principal }) {
      await assertCanWriteSystem({ input, principal });
      const { row, updated } = await store.saveOrUpdate({
        ownerId: ownerIdOf(principal),
        scope: input.scope,
        systemId: input.systemId,
        recallHint: input.recallHint,
        content: input.content,
        tags: input.tags,
        alwaysInject: input.alwaysInject,
      });
      return { id: row.id, updated };
    },
  };

  const deleteMemory: RegisteredAiTool<{ id: string }, { deleted: boolean }> = {
    name: "ai.deleteMemory",
    description:
      "Delete a saved memory that is stale or wrong (find its id with searchMemory). " +
      "Always requires human confirmation. Prefer saveMemory to supersede a drifting memory " +
      "in place; use this only for memories that should be removed entirely.",
    effect: "destructive",
    input: z.object({ id: z.string() }),
    requiredAccessRules: [MEMORY_MANAGE],
    async dryRun({ input, principal }): Promise<AiProposalPreview<{ id: string }>> {
      const row = await store.findById(input.id);
      if (!row) {
        return {
          summary: `Delete memory ${input.id} (not found — may already be gone)`,
          payload: input,
        };
      }
      // Only reveal the memory's hint in the preview if the caller can see it,
      // so the confirm card can't be used to read a memory you have no access to.
      const readable = await accessibleSystems({
        principal,
        resolver,
        candidateSystemIds: row.systemId ? [row.systemId] : [],
        action: "read",
      });
      const visible = isMemoryVisibleTo(row, {
        ownerId: ownerIdOf(principal),
        readableSystemIds: [...readable],
      });
      return {
        summary: visible
          ? `Delete memory (${row.scope}): ${row.recallHint}`
          : `Delete memory ${input.id}`,
        payload: input,
      };
    },
    async execute({ input, principal }) {
      const row = await store.findById(input.id);
      const manageable = await accessibleSystems({
        principal,
        resolver,
        candidateSystemIds: row?.systemId ? [row.systemId] : [],
        action: "manage",
      });
      const deleted = await store.delete({
        id: input.id,
        ownerId: ownerIdOf(principal),
        manageableSystemIds: [...manageable],
      });
      return { deleted };
    },
  };

  return [searchMemory, saveMemory, deleteMemory];
}
