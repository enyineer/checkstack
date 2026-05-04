import { z } from "zod";
import {
  CHECKSTACK_API_VERSION,
  type EntityKindExtensionDefinition,
  type EntityKindRegistry,
  type ReconcileContext,
} from "@checkstack/gitops-common";
import {
  AnomalySettingsSchema,
  AnomalyFieldConfigSchema,
} from "@checkstack/anomaly-common";
import type { CollectorRegistry } from "@checkstack/backend-api";
import type { AnomalyService } from "./service";

interface AnomalyGitOpsKindsDeps {
  /**
   * Lazy accessor — populated during init(), invoked at reconcile time.
   * Mirrors the pattern healthcheck-backend uses to expose its service to
   * the GitOps reconciler without bleeding init order into kind registration.
   */
  getService: () => AnomalyService;
}

// ─── Shared schemas ─────────────────────────────────────────────────────────

/**
 * A reference to a Healthcheck entity. Constrained so YAML callers can't
 * accidentally point an anomaly override at a non-Healthcheck kind.
 */
const healthcheckRefSchema = z
  .object({
    kind: z.literal("Healthcheck"),
    name: z.string().min(1),
  })
  .describe("Reference to the Healthcheck this anomaly override applies to.");

// ─── Healthcheck → anomaly extension ────────────────────────────────────────
//
// Declares the *template-level* AnomalySettings for a Healthcheck. GitOps is
// the source of truth, so the entire AnomalySettings record is replaced.

const healthcheckAnomalyExtensionSchema = AnomalySettingsSchema.optional();
type HealthcheckAnomalyExtension = z.infer<
  typeof healthcheckAnomalyExtensionSchema
>;

export function buildHealthcheckAnomalyExtension(
  deps: AnomalyGitOpsKindsDeps,
): EntityKindExtensionDefinition<HealthcheckAnomalyExtension> {
  return {
    apiVersion: CHECKSTACK_API_VERSION,
    kind: "Healthcheck",
    namespace: "anomaly",
    specSchema: healthcheckAnomalyExtensionSchema,

    reconcile: async ({
      extensionSpec,
      entityId,
      context,
    }: {
      extensionSpec: HealthcheckAnomalyExtension;
      entityId: string;
      context: ReconcileContext;
    }) => {
      if (!extensionSpec) return;
      await deps.getService().updateAnomalyConfig(entityId, extensionSpec);
      context.logger.info(
        `GitOps: applied anomaly defaults to Healthcheck (id: ${entityId})`,
      );
    },
  };
}

// ─── System → anomaly extension ─────────────────────────────────────────────
//
// Declares per-assignment AnomalySettings overrides ("exceptions"), keyed by
// healthcheck ref. Lives under namespace `anomaly` on the System kind so the
// YAML naming mirrors the Healthcheck.anomaly extension.

const systemAnomalyEntrySchema = z.object({
  healthcheckRef: healthcheckRefSchema,
  enabled: z.boolean().optional(),
  baselineWindow: z.string().optional(),
  notify: z.boolean().optional(),
  fieldOverrides: z.record(z.string(), AnomalyFieldConfigSchema).optional(),
});

const systemAnomalyExtensionSchema = z.array(systemAnomalyEntrySchema).optional();

type SystemAnomalyExtension = z.infer<typeof systemAnomalyExtensionSchema>;

export function buildSystemAnomalyExtension(
  deps: AnomalyGitOpsKindsDeps,
): EntityKindExtensionDefinition<SystemAnomalyExtension> {
  return {
    apiVersion: CHECKSTACK_API_VERSION,
    kind: "System",
    namespace: "anomaly",
    specSchema: systemAnomalyExtensionSchema,

    reconcile: async ({
      extensionSpec,
      entityId,
      context,
    }: {
      extensionSpec: SystemAnomalyExtension;
      entityId: string;
      context: ReconcileContext;
    }) => {
      if (!extensionSpec || extensionSpec.length === 0) return;

      const service = deps.getService();
      const systemId = entityId;

      for (const entry of extensionSpec) {
        const configurationId = await context.resolveEntityRef({
          kind: entry.healthcheckRef.kind,
          entityName: entry.healthcheckRef.name,
        });
        if (!configurationId) {
          throw new Error(
            `Cannot resolve Healthcheck ref "${entry.healthcheckRef.name}" — anomaly overrides require the healthcheck to exist`,
          );
        }

        const { healthcheckRef: _ref, ...overrides } = entry;
        void _ref;

        await service.updateAnomalyAssignmentConfig(
          systemId,
          configurationId,
          overrides,
        );

        context.logger.info(
          `GitOps: applied anomaly overrides for Healthcheck "${entry.healthcheckRef.name}" on System (id: ${systemId})`,
        );
      }
    },
  };
}

// ─── Documentation ──────────────────────────────────────────────────────────

/**
 * Mirrors the unwrap helper in healthcheck-gitops-kinds — peels Optional /
 * Nullable / Default wrappers so we can introspect a collector's result
 * shape and enumerate its field names.
 */
function unwrapZodType(type: z.ZodTypeAny): z.ZodTypeAny {
  let current = type;
  while (current) {
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
      current = current.unwrap() as z.ZodTypeAny;
    } else if (current instanceof z.ZodDefault) {
      current = current._def.innerType as z.ZodTypeAny;
    } else if ("innerType" in current && typeof current.innerType === "function") {
      current = current.innerType() as z.ZodTypeAny;
    } else {
      break;
    }
  }
  return current;
}

/**
 * Register schema documentation for the anomaly extensions. Called from
 * anomaly-backend's `afterPluginsReady` once the kind registry and the
 * collector registry have been populated.
 *
 * The Healthcheck.anomaly.fieldOverrides documentation is registered
 * **per collector field**: each variant is gated on the matching
 * collectors[].config selection so the kind-registry browser can pre-populate
 * the available result fields once the user picks a collector.
 *
 * The System.anomaly[].fieldOverrides path can't be conditioned on a sibling
 * config (the collector lives on the referenced Healthcheck, not on the
 * System spec), so it falls back to a generic AnomalyFieldConfig variant.
 */
export function registerAnomalyGitOpsDocumentation({
  kindRegistry,
  collectorRegistry,
}: {
  kindRegistry: EntityKindRegistry;
  collectorRegistry: CollectorRegistry;
}): void {
  // Per-collector, per-field variants conditioned on the chosen collector.
  for (const registered of collectorRegistry.getCollectors()) {
    const unwrapped = unwrapZodType(registered.collector.result.schema);
    if (!(unwrapped instanceof z.ZodObject)) continue;

    for (const fieldName of Object.keys(unwrapped.shape)) {
      kindRegistry.registerSpecSchemaDocumentation({
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "Healthcheck",
        fieldPath: "anomaly.fieldOverrides",
        variantId: `${registered.qualifiedId}.field.${fieldName}`,
        label: `Field: ${fieldName}`,
        description: `Anomaly engine override for the "${fieldName}" result field of ${registered.collector.displayName}. The map key is "${fieldName}".`,
        schema: AnomalyFieldConfigSchema,
        conditions: [
          {
            fieldPath: "collectors[].config",
            variantIds: [registered.qualifiedId],
          },
        ],
      });
    }
  }

  // Generic fallback for the System extension — the relevant collector lives
  // on the referenced Healthcheck, so we can't gate on a sibling.
  kindRegistry.registerSpecSchemaDocumentation({
    apiVersion: CHECKSTACK_API_VERSION,
    kind: "System",
    fieldPath: "anomaly[].fieldOverrides",
    label: "Anomaly field override",
    description:
      "Per-result-field overrides applied to the System ↔ Healthcheck assignment. The map key is the field path of the referenced healthcheck's result (e.g. \"cpu.usage\", \"latencyMs\").",
    schema: AnomalyFieldConfigSchema,
  });
}

// ─── Registration entry point ───────────────────────────────────────────────

export function registerAnomalyGitOpsKinds({
  kindRegistry,
  ...deps
}: AnomalyGitOpsKindsDeps & {
  kindRegistry: EntityKindRegistry;
}): void {
  kindRegistry.registerKindExtension(buildHealthcheckAnomalyExtension(deps));
  kindRegistry.registerKindExtension(buildSystemAnomalyExtension(deps));
}
