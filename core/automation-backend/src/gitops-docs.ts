/**
 * GitOps spec-schema documentation for the `Automation` kind.
 *
 * Mirrors `registerHealthcheckGitOpsDocumentation` in healthcheck-backend:
 * the `Automation` spec (`AutomationDefinitionSchema`) has two polymorphic,
 * user-facing field paths whose concrete shape depends on a sibling
 * discriminator value:
 *
 *   - `triggers[].config` is polymorphic on `triggers[].event` — each
 *     registered trigger declares its own versioned `config` (whose
 *     `.schema` we document here).
 *   - `actions[].config` is polymorphic on `actions[].action` — each
 *     registered provider action declares its own config schema.
 *
 * For every registered trigger/action we emit one standalone documentation
 * entry (a variant keyed by the trigger/action id, with NO `conditions`), so
 * the kind browser renders one variant dropdown per field - exactly the way
 * Healthcheck surfaces its primary `config` (strategy) field. We deliberately
 * do NOT condition these on `triggers[].event` / `actions[].action`: those
 * discriminators have no variant-selector group of their own in the kind
 * browser, so a condition referencing them would never be satisfied and the
 * whole "Additional Schemas" section would render empty.
 *
 * IMPORTANT — why this uses a LAZY provider, not eager registration:
 * unlike Healthcheck (whose strategy/collector registries are CORE SERVICES
 * fully populated before any plugin's `afterPluginsReady`), the automation
 * trigger/action registries are filled by OTHER plugins across their
 * `init` / `afterPluginsReady` phases, which have NO guaranteed ordering
 * relative to automation's `afterPluginsReady`. Several plugins
 * (catalog/maintenance/notification) register their provider actions in
 * THEIR `afterPluginsReady`, so a one-shot eager registration at automation's
 * `afterPluginsReady` would snapshot a half-populated (often empty) registry.
 * Registering a provider thunk instead means the kind registry re-reads the
 * registries when the kind-browser RPC is queried, so the docs always reflect
 * the fully-populated registries regardless of registration order.
 */
import type {
  EntityKindRegistry,
  SpecSchemaDocumentation,
} from "@checkstack/gitops-common";
import { CHECKSTACK_API_VERSION } from "@checkstack/gitops-common";
import type { TriggerRegistry } from "./trigger-registry";
import type { ActionRegistry } from "./action-registry";

/** A documentation entry as accepted by the kind registry. */
type AutomationDoc = {
  apiVersion: string;
  kind: string;
} & SpecSchemaDocumentation;

/**
 * Compose a doc description for a registered variant: the fully-qualified id
 * (so operators can copy the exact `event` / `action` value into YAML)
 * followed by the registration's own description, when present.
 */
function buildDescription({
  qualifiedId,
  description,
}: {
  qualifiedId: string;
  description?: string;
}): string {
  return description
    ? `ID: ${qualifiedId}\n\n${description}`
    : `ID: ${qualifiedId}`;
}

/**
 * Build the `Automation` spec-schema documentation entries from the CURRENT
 * contents of the trigger/action registries. Pure: it only reads the
 * registries it is handed and returns the entries — no side effects. The
 * provider registered below calls this at describe time.
 */
export function buildAutomationSpecSchemaDocumentation({
  triggerRegistry,
  actionRegistry,
}: {
  triggerRegistry: TriggerRegistry;
  actionRegistry: ActionRegistry;
}): AutomationDoc[] {
  const docs: AutomationDoc[] = [];

  // 1. Trigger config docs (fieldPath: "triggers[].config").
  //    A trigger's `config` block is only meaningful when the trigger
  //    declares a versioned `config` — config-less triggers (most hook-backed
  //    ones) have no documentable shape, so we skip them. Each entry is a
  //    standalone variant keyed by the trigger id (no `conditions`): the
  //    kind browser surfaces one dropdown of triggers, exactly like
  //    Healthcheck's primary `config` (strategy) field.
  for (const trigger of triggerRegistry.getTriggers()) {
    if (!trigger.config) continue;

    docs.push({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "Automation",
      fieldPath: "triggers[].config",
      variantId: trigger.qualifiedId,
      label: trigger.displayName,
      description: buildDescription({
        qualifiedId: trigger.qualifiedId,
        description: trigger.description,
      }),
      schema: trigger.config.schema,
    });
  }

  // 2. Provider-action config docs (fieldPath: "actions[].config").
  //    Every registered provider action carries a config schema
  //    (`action.config.schema`). Block kinds (choose/parallel/repeat/…)
  //    are structural and documented by the base spec schema, not here.
  //    Each entry is a standalone variant keyed by the action id (no
  //    `conditions`) - one dropdown of provider actions in the kind browser.
  for (const action of actionRegistry.getActions()) {
    docs.push({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "Automation",
      fieldPath: "actions[].config",
      variantId: action.qualifiedId,
      label: action.displayName,
      description: buildDescription({
        qualifiedId: action.qualifiedId,
        description: action.description,
      }),
      schema: action.config.schema,
    });
  }

  return docs;
}

/**
 * Register a lazy spec-schema documentation provider for the `Automation`
 * kind. The provider re-reads the trigger/action registries each time the
 * kind registry is described, so the docs reflect the fully-populated
 * registries regardless of cross-plugin registration ordering.
 */
export function registerAutomationGitOpsDocumentation({
  kindRegistry,
  triggerRegistry,
  actionRegistry,
}: {
  kindRegistry: EntityKindRegistry;
  triggerRegistry: TriggerRegistry;
  actionRegistry: ActionRegistry;
}): void {
  kindRegistry.registerSpecSchemaDocumentationProvider(() =>
    buildAutomationSpecSchemaDocumentation({
      triggerRegistry,
      actionRegistry,
    }),
  );
}
