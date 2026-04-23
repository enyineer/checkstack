import { z } from "zod";
import type {
  EntityKindDefinition,
  EntityKindExtensionDefinition,
  EntityKindRegistry,
  ReconcileContext,
} from "@checkstack/gitops-common";
import {
  CHECKSTACK_API_VERSION,
  entityRefSchema,
} from "@checkstack/gitops-common";
import type {
  HealthCheckRegistry,
  CollectorRegistry,
} from "@checkstack/backend-api";
import { HealthCheckService } from "./service";

/**
 * Lazy accessor functions — populated during init(), consumed during reconcile.
 * Safe because reconcile only runs during sync (afterPluginsReady), by which
 * point init() has completed.
 */
interface HealthcheckGitOpsKindsDeps {
  createService: () => HealthCheckService;
  getHealthCheckRegistry: () => HealthCheckRegistry;
  getCollectorRegistry: () => CollectorRegistry;
}

// ─── Healthcheck Spec Schema ───────────────────────────────────────────────

/**
 * GitOps spec schema for kind: Healthcheck.
 *
 * Strategy `config` values may contain `${{ secrets.NAME }}` templates
 * which are automatically resolved by the reconciliation engine.
 */
const healthcheckSpecSchema = z.object({
  strategy: z.string().min(1),
  intervalSeconds: z.number().int().min(1),
  config: z.record(z.string(), z.unknown()),
  collectors: z
    .array(
      z.object({
        collectorId: z.string().min(1),
        config: z.record(z.string(), z.unknown()),
        assertions: z
          .array(
            z.object({
              field: z.string(),
              jsonPath: z.string().optional(),
              operator: z.string(),
              value: z.unknown().optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

type HealthcheckSpec = z.infer<typeof healthcheckSpecSchema>;

// ─── System Extension Schema ───────────────────────────────────────────────

const systemHealthcheckExtensionSchema = z
  .array(
    z.object({
      ref: entityRefSchema,
      degradedThreshold: z.number().int().min(1).optional(),
      unhealthyThreshold: z.number().int().min(1).optional(),
      satelliteIds: z.array(z.string()).optional(),
      includeLocal: z.boolean().optional(),
    }),
  )
  .optional();

type SystemHealthcheckExtension = z.infer<
  typeof systemHealthcheckExtensionSchema
>;

// ─── Kind Builder Functions ────────────────────────────────────────────────

/**
 * Build the ``kind: Healthcheck`` definition.
 *
 * Exported for isolated unit testing — the register() phase calls this
 * and passes the result to `kindRegistry.registerKind()`.
 */
export function buildHealthcheckKind(
  deps: HealthcheckGitOpsKindsDeps,
): EntityKindDefinition<HealthcheckSpec> {
  return {
    apiVersion: CHECKSTACK_API_VERSION,
    kind: "Healthcheck",
    specSchema: healthcheckSpecSchema,

    reconcile: async ({
      entity,
      existingEntityId,
      context,
    }: {
      entity: {
        metadata: { name: string; title?: string; description?: string };
        spec: HealthcheckSpec;
      };
      existingEntityId?: string;
      context: ReconcileContext;
    }) => {
      const service = deps.createService();
      const spec = entity.spec;

      // Look up strategy first — we need its typed schema for secret resolution
      const healthCheckRegistry = deps.getHealthCheckRegistry();
      const strategy = healthCheckRegistry.getStrategy(spec.strategy);
      if (!strategy) {
        throw new Error(
          `Unknown health check strategy "${spec.strategy}". ` +
            `Available: ${healthCheckRegistry
              .getStrategies()
              .map((s) => s.id)
              .join(", ")}`,
        );
      }

      // Resolve secrets using the strategy's typed schema.
      // Only fields marked with configString({ "x-secret": true }) get resolved.
      const { resolved: resolvedConfig } = await context.resolveSecretsBySchema(
        {
          value: spec.config,
          schema: strategy.config.schema,
        },
      );

      // Validate resolved config against strategy's Zod schema
      const configValidation = strategy.config.schema.safeParse(resolvedConfig);
      if (!configValidation.success) {
        throw new Error(
          `Strategy "${spec.strategy}" config validation failed: ${configValidation.error.message}`,
        );
      }

      // Resolve and validate collector configs using their registry schemas
      const resolvedCollectors = spec.collectors
        ? await Promise.all(
            spec.collectors.map(async (c) => {
              const collectorReg = deps.getCollectorRegistry();
              const registered = collectorReg.getCollector(c.collectorId);
              if (!registered) {
                throw new Error(
                  `Unknown collector "${c.collectorId}". ` +
                    `Available: ${collectorReg
                      .getCollectors()
                      .map((col) => col.qualifiedId)
                      .join(", ")}`,
                );
              }

              // Resolve secrets using the collector's typed schema
              const { resolved: resolvedCollectorConfig } =
                await context.resolveSecretsBySchema({
                  value: c.config,
                  schema: registered.collector.config.schema,
                });

              const collectorConfigValidation =
                registered.collector.config.schema.safeParse(
                  resolvedCollectorConfig,
                );
              if (!collectorConfigValidation.success) {
                throw new Error(
                  `Collector "${c.collectorId}" config validation failed: ${collectorConfigValidation.error.message}`,
                );
              }

              return { ...c, config: resolvedCollectorConfig };
            }),
          )
        : undefined;

      // Create or update configuration
      const displayName = entity.metadata.title ?? entity.metadata.name;

      if (existingEntityId) {
        await service.updateConfiguration(existingEntityId, {
          name: displayName,
          strategyId: spec.strategy,
          config: resolvedConfig,
          intervalSeconds: spec.intervalSeconds,
          collectors: resolvedCollectors?.map((c) => ({
            id: c.collectorId,
            collectorId: c.collectorId,
            config: c.config,
            assertions: c.assertions,
          })),
        });
        context.logger.info(
          `GitOps: updated Healthcheck "${displayName}" (id: ${existingEntityId})`,
        );
        return { entityId: existingEntityId };
      }

      const config = await service.createConfiguration({
        name: displayName,
        strategyId: spec.strategy,
        config: resolvedConfig,
        intervalSeconds: spec.intervalSeconds,
        collectors: resolvedCollectors?.map((c) => ({
          id: c.collectorId,
          collectorId: c.collectorId,
          config: c.config,
          assertions: c.assertions,
        })),
      });
      context.logger.info(
        `GitOps: created Healthcheck "${displayName}" (id: ${config.id})`,
      );
      return { entityId: config.id };
    },

    delete: async ({
      entityId,
      context,
    }: {
      entityName: string;
      entityId?: string;
      context: ReconcileContext;
    }) => {
      if (!entityId) return;
      const service = deps.createService();
      await service.deleteConfiguration(entityId);
      context.logger.info(`GitOps: deleted Healthcheck (id: ${entityId})`);
    },
  };
}

/**
 * Build the System → healthchecks extension definition.
 *
 * Resolves health check entity references to configuration IDs via
 * `context.resolveEntityRef`, then manages system ↔ health check associations.
 */
export function buildSystemHealthcheckExtension(
  deps: HealthcheckGitOpsKindsDeps,
): EntityKindExtensionDefinition<SystemHealthcheckExtension> {
  return {
    apiVersion: CHECKSTACK_API_VERSION,
    kind: "System",
    namespace: "healthchecks",
    specSchema: systemHealthcheckExtensionSchema,

    reconcile: async ({
      entity,
      extensionSpec,
      entityId,
      context,
    }: {
      entity: { metadata: { name: string } };
      extensionSpec: SystemHealthcheckExtension;
      entityId: string;
      context: ReconcileContext;
    }) => {
      if (!extensionSpec || extensionSpec.length === 0) return;

      const service = deps.createService();

      // entityId is injected directly from the base reconciler — no provenance lookup needed
      const systemEntityId = entityId;

      // Resolve each healthcheck ref → configurationId
      const desiredConfigIds = new Set<string>();

      for (const entry of extensionSpec) {
        const configId = await context.resolveEntityRef({
          kind: entry.ref.kind,
          entityName: entry.ref.name,
        });

        if (!configId) {
          throw new Error(
            `Cannot resolve ${entry.ref.kind} ref "${entry.ref.name}" — ensure the entity exists`,
          );
        }

        desiredConfigIds.add(configId);

        // Build state thresholds from the shorthand
        const stateThresholds =
          entry.degradedThreshold || entry.unhealthyThreshold
            ? {
                mode: "consecutive" as const,
                healthy: { minSuccessCount: 1 },
                degraded: {
                  minFailureCount: entry.degradedThreshold ?? 2,
                },
                unhealthy: {
                  minFailureCount: entry.unhealthyThreshold ?? 5,
                },
              }
            : undefined;

        await service.associateSystem({
          systemId: systemEntityId,
          configurationId: configId,
          enabled: true,
          stateThresholds,
          satelliteIds: entry.satelliteIds,
          includeLocal: entry.includeLocal,
        });

        context.logger.info(
          `GitOps: associated ${entry.ref.kind} "${entry.ref.name}" (${configId}) with System "${entity.metadata.name}"`,
        );
      }

      // Remove stale associations not in the spec
      const currentAssociations =
        await service.getSystemConfigurations(systemEntityId);
      for (const existing of currentAssociations) {
        if (!desiredConfigIds.has(existing.id)) {
          await service.disassociateSystem(systemEntityId, existing.id);
          context.logger.info(
            `GitOps: removed stale association ${existing.id} from System "${entity.metadata.name}"`,
          );
        }
      }
    },
  };
}

// ─── Registration Entry Point ──────────────────────────────────────────────

/**
 * Register all healthcheck-related GitOps entity kinds and extensions.
 * Called from healthcheck-backend's `register()` phase.
 */
export function registerHealthcheckGitOpsKinds({
  kindRegistry,
  ...deps
}: HealthcheckGitOpsKindsDeps & {
  kindRegistry: EntityKindRegistry;
}): void {
  kindRegistry.registerKind(buildHealthcheckKind(deps));
  kindRegistry.registerKindExtension(buildSystemHealthcheckExtension(deps));
}

/**
 * Register spec schema documentation for the Healthcheck kind.
 * Called from healthcheck-backend's `afterPluginsReady` phase once registries are populated.
 */
export function registerHealthcheckGitOpsDocumentation({
  kindRegistry,
  healthCheckRegistry,
  collectorRegistry,
}: {
  kindRegistry: EntityKindRegistry;
  healthCheckRegistry: HealthCheckRegistry;
  collectorRegistry: CollectorRegistry;
}): void {
  // 1. Register documentation for strategy configs (fieldPath: "config")
  for (const registered of healthCheckRegistry.getStrategiesWithMeta()) {
    kindRegistry.registerSpecSchemaDocumentation({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "Healthcheck",
      fieldPath: "config",
      variantId: registered.ownerPluginId,
      label: registered.strategy.displayName,
      description: registered.strategy.description,
      schema: registered.strategy.config.schema,
    });
  }

  // 2. Register documentation for collector configs (fieldPath: "collectors[].config")
  for (const registered of collectorRegistry.getCollectors()) {
    kindRegistry.registerSpecSchemaDocumentation({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "Healthcheck",
      fieldPath: "collectors[].config",
      label: registered.collector.displayName,
      description: registered.collector.description,
      schema: registered.collector.config.schema,
      conditions: [
        {
          fieldPath: "config",
          variantIds: registered.collector.supportedPlugins.map(
            (p) => p.pluginId,
          ),
        },
      ],
    });
  }
}
