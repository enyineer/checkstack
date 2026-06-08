import { z } from "zod";
import { lucideIconSchema } from "@checkstack/common";
import { AutomationDefinitionSchema } from "./schemas";

/**
 * A curated, ready-to-use **example automation** an operator can start from
 * when creating a new automation, instead of facing a blank editor.
 *
 * A template IS a validated {@link AutomationDefinitionSchema} plus a little
 * presentation metadata: selecting one in the picker seeds the editor (the
 * operator still chooses a `runAs` service account and saves it themselves -
 * a template is never auto-created).
 *
 * Templates are contributed by core AND by external plugins through the
 * `automationTemplateExtensionPoint` (same pattern as actions / triggers /
 * artifact types). Because each `definition` references concrete action,
 * trigger and artifact ids, the backend validates every registered template
 * against the LIVE registries at startup, so a template can never silently
 * drift when a contributed action/trigger/artifact interface changes - the
 * mismatch surfaces loudly at boot rather than when an operator picks it.
 */
export const AutomationTemplateSchema = z.object({
  /** Stable, unique id (qualified with the contributing plugin id). */
  id: z.string().min(1),
  /** Short operator-facing name shown on the card. */
  name: z.string().min(1).max(120),
  /** One- or two-sentence summary of what the automation does. */
  description: z.string().min(1).max(500),
  /** Grouping label for the picker gallery (e.g. "Incident response"). */
  category: z.string().min(1).max(80),
  /** Optional lucide icon name for the card (falls back to a default). */
  icon: lucideIconSchema.optional(),
  /** Id of the plugin that contributed the template (attribution badge). */
  ownerPluginId: z.string().min(1),
  /** The seedable automation definition. */
  definition: AutomationDefinitionSchema,
});

export type AutomationTemplate = z.infer<typeof AutomationTemplateSchema>;

/**
 * What a plugin passes to `registerTemplate`. The `id`/`ownerPluginId` are
 * stamped/qualified by the extension point from the registering plugin's
 * metadata, so a contributor supplies only the unqualified `id`.
 */
export const AutomationTemplateInputSchema = AutomationTemplateSchema.omit({
  ownerPluginId: true,
});

/**
 * The INPUT (pre-parse) shape: a contributor may omit schema defaults
 * (`enabled`, `continue_on_error`, `conditions`, `mode`, ...). The registry
 * parses an input through {@link AutomationTemplateSchema} to normalize it
 * into the fully-defaulted {@link AutomationTemplate}.
 */
export type AutomationTemplateInput = z.input<
  typeof AutomationTemplateInputSchema
>;
