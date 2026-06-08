import { z } from "zod";

/**
 * AI "skills" - reusable prompt templates that help operators write good
 * prompts and start quickly. A skill carries a system-prompt fragment plus an
 * optional starter prompt and (for the analyze action) suggested output fields.
 *
 * Two sources feed one catalogue:
 *   - **builtin**: contributed in code by core / plugins via the
 *     `aiSkillExtensionPoint` (read-only).
 *   - **user**: authored by an operator and stored in the `ai_skill` table -
 *     GLOBAL (visible to every user who can read skills), editable by its
 *     author.
 *
 * Each skill is tagged with the SURFACES it targets so a picker shows only
 * relevant skills (a chat picker hides analyze-only skills, and vice versa).
 */

/** The surfaces a skill can target. */
export const AiSkillTargetSchema = z.enum(["chat", "ai_analyze"]);
export type AiSkillTarget = z.infer<typeof AiSkillTargetSchema>;

/**
 * A suggested output field for the `ai_analyze` action. Mirrors that action's
 * own output-field shape; kept local so ai-common carries no dependency on
 * automation-backend.
 */
export const AiSkillOutputFieldSchema = z.object({
  key: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "enum"]),
  description: z.string().min(1),
  options: z.array(z.string()).optional(),
});
export type AiSkillOutputField = z.infer<typeof AiSkillOutputFieldSchema>;

/** Where a skill came from. */
export const AiSkillSourceSchema = z.enum(["builtin", "user"]);
export type AiSkillSource = z.infer<typeof AiSkillSourceSchema>;

export const AiSkillSchema = z.object({
  /** Stable id. Builtins are qualified `${pluginId}.${localId}`; user skills are a uuid. */
  id: z.string(),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  /** Surfaces this skill applies to. At least one. */
  targets: z.array(AiSkillTargetSchema).min(1),
  /** Instruction fragment folded into the system prompt when the skill is active. */
  systemPrompt: z.string().max(8000).optional(),
  /** Starter prompt seeded into the composer / analyze prompt. */
  promptTemplate: z.string().max(8000).optional(),
  /** Suggested `ai_analyze` output fields (used only when targeting ai_analyze). */
  suggestedOutputFields: z.array(AiSkillOutputFieldSchema).max(20).optional(),
  tags: z.array(z.string()).optional(),
  source: AiSkillSourceSchema,
  /** Creator principal id for `user` skills (attribution + edit/delete authority). */
  ownerId: z.string().nullable().optional(),
  /** Contributing plugin id for `builtin` skills. */
  pluginId: z.string().optional(),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
});
export type AiSkill = z.infer<typeof AiSkillSchema>;

/**
 * What a plugin passes to `registerSkill`. The `source`/`pluginId` are stamped
 * by the extension point; the contributor supplies an unqualified `id`.
 */
export const AiSkillDefinitionInputSchema = AiSkillSchema.omit({
  source: true,
  ownerId: true,
  pluginId: true,
  createdAt: true,
  updatedAt: true,
});
export type AiSkillDefinitionInput = z.input<typeof AiSkillDefinitionInputSchema>;

/** RPC input to create a global user skill (server stamps id/source/owner). */
export const CreateSkillInputSchema = AiSkillSchema.pick({
  name: true,
  description: true,
  targets: true,
  systemPrompt: true,
  promptTemplate: true,
  suggestedOutputFields: true,
  tags: true,
});
export type CreateSkillInput = z.infer<typeof CreateSkillInputSchema>;

/** RPC input to update an existing user skill. Only the author may apply it. */
export const UpdateSkillInputSchema = CreateSkillInputSchema.partial().extend({
  id: z.string(),
});
export type UpdateSkillInput = z.infer<typeof UpdateSkillInputSchema>;
