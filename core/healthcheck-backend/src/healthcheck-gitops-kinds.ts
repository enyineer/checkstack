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
import { NotificationPolicySchema } from "@checkstack/healthcheck-common";
import { HealthCheckService } from "./service";
import { validateVersionedConfigStrict } from "./validate-configuration";
import {
  DynamicOperators,
  numericField,
  stringField,
  booleanField,
  arrayField,
  enumField,
} from "@checkstack/backend-api";
import type { QueueManager } from "@checkstack/queue-api";
import { scheduleHealthCheck } from "./queue-executor";

/**
 * Lazy accessor functions — populated during init(), consumed during reconcile.
 * Safe because reconcile only runs during sync (afterPluginsReady), by which
 * point init() has completed.
 */
interface HealthcheckGitOpsKindsDeps {
  createService: () => HealthCheckService;
  getHealthCheckRegistry: () => HealthCheckRegistry;
  getCollectorRegistry: () => CollectorRegistry;
  getQueueManager: () => QueueManager;
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
      /**
       * Per-assignment notification policy. Any field omitted falls
       * back to the platform default (see `DEFAULT_NOTIFICATION_POLICY`).
       * Flapping thresholds moved onto the automation engine's windowed-count
       * gate (the `system_health_changed` trigger's `window` block) and are no
       * longer accepted here.
       */
      notificationPolicy: NotificationPolicySchema.partial().optional(),
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

      // Look up strategy using strictly the fully qualified ID
      const healthCheckRegistry = deps.getHealthCheckRegistry();
      const allStrategies = healthCheckRegistry.getStrategiesWithMeta();
      const matchStrategy = allStrategies.find((s) => s.qualifiedId === spec.strategy);

      if (!matchStrategy) {
        throw new Error(
          `Unknown health check strategy "${spec.strategy}". ` +
            `Available: ${allStrategies
              .map((s) => s.qualifiedId)
              .join(", ")}`,
        );
      }
      
      const strategy = matchStrategy.strategy;

      // Resolvability check ONLY: resolving `${{ secrets.* }}` references in
      // `x-secret` fields surfaces a missing/undeclared secret as a clear
      // apply-time error. The RESOLVED VALUES ARE DISCARDED - the ORIGINAL
      // spec (references intact) is what gets validated and persisted, so a
      // resolved secret never lands in the stored row. The executor resolves
      // references just-in-time at run.
      await context.resolveSecretsBySchema({
        value: spec.config,
        schema: strategy.config.schema,
      });

      // Migrate-then-validate-strict: authored gitops YAML may be in an OLD
      // config shape, so run the migration chain (assume-v1-on-read) before
      // strict validation. Old-shape YAML still applies; genuine typos
      // (unknown keys no migration accounts for) are still rejected. Shares the
      // exact strict-validate path the `validateConfiguration` RPC uses, so the
      // two agree on what counts as valid. A strategy config is always a plain
      // object validated by the strategy's own schema, so narrowing the
      // `unknown` result to the stored `Record` shape is safe. Secret fields
      // hold reference strings here, which validate as ordinary strings.
      const strategyResult = await validateVersionedConfigStrict({
        config: strategy.config,
        value: spec.config,
        basePath: ["config"],
      });
      if (!strategyResult.ok) {
        throw new Error(
          `Strategy "${spec.strategy}" config validation failed: ${formatIssues(strategyResult.issues)}`,
        );
      }
      const migratedConfig = strategyResult.value as Record<string, unknown>;

      // Resolve and validate collector configs using their registry schemas
      const validatedCollectors = spec.collectors
        ? await Promise.all(
            spec.collectors.map(async (c) => {
              // Look up collector using strictly the fully qualified ID
              const collectorReg = deps.getCollectorRegistry();
              const allCollectors = collectorReg.getCollectors();
              const matchCollector = allCollectors.find(
                (col) => col.qualifiedId === c.collectorId
              );

              if (!matchCollector) {
                throw new Error(
                  `Unknown collector "${c.collectorId}". ` +
                    `Available: ${allCollectors
                      .map((col) => col.qualifiedId)
                      .join(", ")}`,
                );
              }
              const registered = matchCollector;

              // Resolvability check ONLY (see the strategy-config note): the
              // resolved values are discarded and the ORIGINAL config (with
              // references intact) is validated and persisted.
              await context.resolveSecretsBySchema({
                value: c.config,
                schema: registered.collector.config.schema,
              });

              // Migrate-then-validate-strict: authored gitops YAML may use an
              // OLD collector config shape. Run the migration chain before
              // strict validation so old-shape YAML still applies while
              // genuine typos are still rejected. Shares the exact strict-
              // validate path the `validateConfiguration` RPC uses. A collector
              // config is always a plain object validated by the collector's
              // schema, so narrowing the `unknown` result to the stored
              // `Record` shape is safe.
              const collectorResult = await validateVersionedConfigStrict({
                config: registered.collector.config,
                value: c.config,
                basePath: ["config"],
              });
              if (!collectorResult.ok) {
                throw new Error(
                  `Collector "${c.collectorId}" config validation failed: ${formatIssues(collectorResult.issues)}`,
                );
              }
              const migratedCollectorConfig = collectorResult.value as Record<
                string,
                unknown
              >;

              return { ...c, config: migratedCollectorConfig };
            }),
          )
        : undefined;

      // Create or update configuration
      const displayName = entity.metadata.title ?? entity.metadata.name;

      if (existingEntityId && !existingEntityId.startsWith("pending-")) {
        await service.updateConfiguration(existingEntityId, {
          name: displayName,
          strategyId: spec.strategy,
          config: migratedConfig,
          intervalSeconds: spec.intervalSeconds,
          collectors: validatedCollectors?.map((c) => ({
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
        config: migratedConfig,
        intervalSeconds: spec.intervalSeconds,
        collectors: validatedCollectors?.map((c) => ({
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

        // Materialise the (possibly partial) policy through the full
        // schema so DEFAULT_NOTIFICATION_POLICY fields fill in any
        // keys the operator omitted. Omitting `notificationPolicy`
        // entirely leaves the stored value as null (defaults applied
        // at read time).
        const notificationPolicy = entry.notificationPolicy
          ? NotificationPolicySchema.parse(entry.notificationPolicy)
          : undefined;

        await service.associateSystem({
          systemId: systemEntityId,
          configurationId: configId,
          enabled: true,
          stateThresholds,
          satelliteIds: entry.satelliteIds,
          includeLocal: entry.includeLocal,
          notificationPolicy,
        });

        // Retrieve config to get the interval for scheduling
        const config = await service.getConfiguration(configId);
        if (config) {
          await scheduleHealthCheck({
            queueManager: deps.getQueueManager(),
            payload: {
              configId,
              systemId: systemEntityId,
            },
            intervalSeconds: config.intervalSeconds,
          });
        }

        context.logger.info(
          `GitOps: associated ${entry.ref.kind} "${entry.ref.name}" (${configId}) with System "${entity.metadata.name}" and scheduled execution`,
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
      variantId: registered.qualifiedId,
      label: registered.strategy.displayName,
      description: `ID: ${registered.qualifiedId}\n\n${registered.strategy.description}`,
      schema: registered.strategy.config.schema,
    });
  }

  // 2. Register documentation for collector configs (fieldPath: "collectors[].config")
  for (const registered of collectorRegistry.getCollectors()) {
    const supportedStrategyIds = healthCheckRegistry
      .getStrategiesWithMeta()
      .filter((s) =>
        registered.collector.supportedPlugins.some(
          (p) => p.pluginId === s.ownerPluginId,
        ),
      )
      .map((s) => s.qualifiedId);

    kindRegistry.registerSpecSchemaDocumentation({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "Healthcheck",
      fieldPath: "collectors[].config",
      variantId: registered.qualifiedId,
      label: registered.collector.displayName,
      description: `ID: ${registered.qualifiedId}\n\n${registered.collector.description}`,
      schema: registered.collector.config.schema,
      conditions: [
        {
          fieldPath: "config",
          variantIds: supportedStrategyIds,
        },
      ],
    });

    // 3. Register documentation for collector assertions (fieldPath: "collectors[].assertions")
    const unwrapped = unwrapZodType(registered.collector.result.schema);
    
    if (unwrapped instanceof z.ZodObject) {
      const shape = unwrapped.shape;
      
      for (const [key, prop] of Object.entries(shape)) {
        const propUnwrapped = unwrapZodType(prop as z.ZodTypeAny);

        let fieldSchema: z.ZodTypeAny;

        if (propUnwrapped instanceof z.ZodNumber) {
          fieldSchema = numericField(key);
        } else if (propUnwrapped instanceof z.ZodString) {
          fieldSchema = stringField(key);
        } else if (propUnwrapped instanceof z.ZodBoolean) {
          fieldSchema = booleanField(key);
        } else if (propUnwrapped instanceof z.ZodArray) {
          fieldSchema = arrayField(key);
        } else if (propUnwrapped instanceof z.ZodEnum) {
          const enumValues = propUnwrapped.options;
          const stringValues = enumValues.filter((v: unknown) => typeof v === "string") as string[];
          fieldSchema = stringValues.length > 0 ? enumField(key, stringValues) : stringField(key);
        } else {
          fieldSchema = stringField(key);
        }

        kindRegistry.registerSpecSchemaDocumentation({
          apiVersion: CHECKSTACK_API_VERSION,
          kind: "Healthcheck",
          fieldPath: "collectors[].assertions",
          variantId: `${registered.qualifiedId}.assert.${key}`,
          label: `Assert: ${key}`,
          description: `Assertion documentation for the '${key}' field of ${registered.collector.displayName}.`,
          schema: z.array(fieldSchema).describe(`Assertions array`),
          conditions: [
            {
              fieldPath: "collectors[].config",
              variantIds: [registered.qualifiedId],
            },
          ],
        });
      }
    } else {
      // Fallback if result schema is not an object
      kindRegistry.registerSpecSchemaDocumentation({
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "Healthcheck",
        fieldPath: "collectors[].assertions",
        variantId: `${registered.qualifiedId}.assert.generic`,
        label: `${registered.collector.displayName} Assertions`,
        description: `Define assertions against the result of this collector.`,
        schema: z.array(
          z.object({
            field: z.string(),
            operator: DynamicOperators,
            value: z.unknown().optional(),
          })
        ).describe(`Assertions array`),
        conditions: [
          {
            fieldPath: "collectors[].config",
            variantIds: [registered.qualifiedId],
          },
        ],
      });
    }
  }
}

/**
 * Render the structured issues from {@link validateVersionedConfigStrict} into
 * a single human-readable message for the thrown GitOps reconcile error,
 * preserving the per-field path (e.g. `config.url: Invalid url`).
 */
function formatIssues(
  issues: Array<{ path: Array<string | number>; message: string }>,
): string {
  return issues
    .map((issue) =>
      issue.path.length > 0
        ? `${issue.path.join(".")}: ${issue.message}`
        : issue.message,
    )
    .join("; ");
}

function unwrapZodType(type: z.ZodTypeAny): z.ZodTypeAny {
  let current = type;
  while (current) {
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
      current = current.unwrap() as z.ZodTypeAny;
    } else if (current instanceof z.ZodDefault) {
      current = current._def.innerType as z.ZodTypeAny;
    } else if ("innerType" in current && typeof current.innerType === "function") {
      // Handles ZodEffects/ZodBranded generically without relying on removed types
      current = current.innerType() as z.ZodTypeAny;
    } else {
      break;
    }
  }
  return current;
}


