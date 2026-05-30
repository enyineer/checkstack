import {
  createBackendPlugin,
  coreServices,
} from "@checkstack/backend-api";
import {
  automationAccess,
  automationAccessRules,
  automationContract,
  automationRoutes,
  pluginMetadata,
} from "@checkstack/automation-common";
import { resolveRoute, extractErrorMessage } from "@checkstack/common";
import type { PluginMetadata } from "@checkstack/common";
import { registerSearchProvider } from "@checkstack/command-backend";
import {
  createDefaultFilterRegistry,
  type FilterRegistry,
} from "@checkstack/template-engine";
import { HealthCheckApi } from "@checkstack/healthcheck-common";

import type {
  ActionDefinition,
  ArtifactTypeDefinition,
  TriggerDefinition,
} from "./action-types";
import { createTriggerRegistry, type TriggerRegistry } from "./trigger-registry";
import { createActionRegistry, type ActionRegistry } from "./action-registry";
import {
  createArtifactTypeRegistry,
  type ArtifactTypeRegistry,
} from "./artifact-type-registry";
import { createArtifactStore } from "./artifact-store";
import { createAutomationStore } from "./automation-store";
import { createAutomationRouter } from "./router";
import { runWebhookSubscriptionMigration } from "./migration/from-webhook-subscriptions";
import {
  startDelayQueueConsumer,
  type DelayQueueConsumer,
} from "./dispatch/delay-queue";
import {
  startDwellQueueConsumer,
  type DwellQueueConsumer,
} from "./dispatch/dwell-queue";
import {
  startWaitUntilQueueConsumer,
  type WaitUntilQueueConsumer,
} from "./dispatch/wait-until-queue";
import { createDwellStore } from "./dispatch/dwell-store";
import { createRunStore } from "./dispatch/run-state";
import { createRunStateStore } from "./dispatch/run-state-store";
import {
  startStalledSweeper,
  type StalledSweeper,
} from "./dispatch/stalled-sweeper";
import {
  setupTriggerSubscriptions,
  type TriggerSubscriptions,
} from "./dispatch/trigger-subscriber";
import type { DispatchDeps } from "./dispatch/types";
import {
  automationActionExtensionPoint,
  automationArtifactStoreRef,
  automationArtifactTypeExtensionPoint,
  automationFilterExtensionPoint,
  automationRegistriesRef,
  automationTriggerExtensionPoint,
} from "./extension-points";
import {
  registerBuiltinTriggerConsumer,
  registerBuiltinTriggers,
} from "./builtin-triggers";
import {
  createNotifyUserAction,
  logAction,
  notifyUserArtifactType,
} from "./builtin-actions";
import * as schema from "./schema";

/**
 * Internal env stash used to thread registries / stores from `register()`
 * and `init()` into `afterPluginsReady()`. Mirrors the established
 * pattern in `integration-backend/src/index.ts`.
 */
interface EnvStash {
  triggerRegistry: TriggerRegistry;
  actionRegistry: ActionRegistry;
  artifactTypeRegistry: ArtifactTypeRegistry;
  dispatchDeps: DispatchDeps;
  automationStore: ReturnType<typeof createAutomationStore>;
  triggerSubscriptions?: TriggerSubscriptions;
  stalledSweeper?: StalledSweeper;
  delayConsumer?: DelayQueueConsumer;
  dwellConsumer?: DwellQueueConsumer;
  waitUntilConsumer?: WaitUntilQueueConsumer;
}

export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    const triggerRegistry = createTriggerRegistry();
    const actionRegistry = createActionRegistry();
    const artifactTypeRegistry = createArtifactTypeRegistry();
    // Shared filter registry — seeded with the built-in defaults (incl.
    // the Wave-2 duration helpers) and extended by plugins via the
    // filter extension point in Phase 1. The dispatch engine reads from
    // this same instance, so plugin filters are live by `init()`.
    const filterRegistry: FilterRegistry = createDefaultFilterRegistry();

    env.registerAccessRules(automationAccessRules);

    env.registerExtensionPoint(automationTriggerExtensionPoint, {
      registerTrigger: <TPayload, TConfig = void>(
        definition: TriggerDefinition<TPayload, TConfig>,
        metadata: PluginMetadata,
      ) => {
        triggerRegistry.register(
          definition as TriggerDefinition<unknown, unknown>,
          metadata,
        );
      },
    });

    env.registerExtensionPoint(automationActionExtensionPoint, {
      registerAction: <TConfig, TArtifact = unknown>(
        definition: ActionDefinition<TConfig, TArtifact>,
        metadata: PluginMetadata,
      ) => {
        actionRegistry.register(
          definition as ActionDefinition<unknown, unknown>,
          metadata,
        );
      },
    });

    env.registerExtensionPoint(automationArtifactTypeExtensionPoint, {
      registerArtifactType: <T>(
        definition: ArtifactTypeDefinition<T>,
        metadata: PluginMetadata,
      ) => {
        artifactTypeRegistry.register(
          definition as ArtifactTypeDefinition<unknown>,
          metadata,
        );
      },
    });

    // Filters registered by plugins in Phase 1 are collected here and
    // applied (with collision-warning) in `init()` where a logger is
    // available. Collecting first keeps `register()` logger-free.
    const pendingFilters: Array<{
      name: string;
      filter: Parameters<FilterRegistry["register"]>[1];
      pluginId: string;
    }> = [];
    env.registerExtensionPoint(automationFilterExtensionPoint, {
      registerFilter: (definition, metadata) => {
        pendingFilters.push({
          name: definition.name,
          filter: definition.filter,
          pluginId: metadata.pluginId,
        });
      },
    });

    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
        rpc: coreServices.rpc,
        rpcClient: coreServices.rpcClient,
        queueManager: coreServices.queueManager,
        signalService: coreServices.signalService,
      },
      init: async ({
        logger,
        database,
        rpc,
        rpcClient,
        queueManager,
        signalService,
      }) => {
        logger.debug("⚙️  Initializing Automation Backend...");

        const artifactStore = createArtifactStore(database);
        const runStore = createRunStore(database);
        const runStateStore = createRunStateStore(database);
        const dwellStore = createDwellStore(database);
        const automationStore = createAutomationStore(database);

        env.registerService(automationArtifactStoreRef, artifactStore);
        env.registerService(automationRegistriesRef, {
          triggers: triggerRegistry,
          actions: actionRegistry,
          artifactTypes: artifactTypeRegistry,
        });

        // ─── Built-in triggers + actions ──────────────────────────────
        // automation-backend ships its own triggers/actions through the
        // same registries it exposes to other plugins; the registration
        // happens here in init() because the trigger setup needs
        // `queueManager` and the `notify_user` action needs
        // `rpcClient`. The shared consumer for built-in trigger ticks
        // is started here too — by the time `setupTriggerSubscriptions`
        // calls each trigger's `setup()` in afterPluginsReady, the
        // consumer is already draining the queue.
        registerBuiltinTriggers({
          queueManager,
          pluginMetadata,
          registerTrigger: (trigger, metadata) => {
            triggerRegistry.register(trigger, metadata);
          },
        });
        actionRegistry.register(
          logAction as ActionDefinition<unknown, unknown>,
          pluginMetadata,
        );
        actionRegistry.register(
          createNotifyUserAction({ rpcClient }) as ActionDefinition<
            unknown,
            unknown
          >,
          pluginMetadata,
        );
        artifactTypeRegistry.register(
          notifyUserArtifactType as ArtifactTypeDefinition<unknown>,
          pluginMetadata,
        );
        await registerBuiltinTriggerConsumer({ queueManager, logger });

        // Apply plugin-contributed filters collected in register(),
        // skipping any that would shadow a built-in (warn, don't clobber).
        for (const pf of pendingFilters) {
          if (filterRegistry.has(pf.name)) {
            logger.warn(
              `Plugin ${pf.pluginId} tried to register filter "${pf.name}" which already exists; skipping.`,
            );
            continue;
          }
          filterRegistry.register(pf.name, pf.filter);
        }

        const dispatchDeps: DispatchDeps = {
          logger,
          filters: filterRegistry,
          registries: {
            triggers: triggerRegistry,
            actions: actionRegistry,
            artifactTypes: artifactTypeRegistry,
          },
          artifactStore,
          runStore,
          runStateStore,
          dwellStore,
          queueManager,
          // Sensing-layer scope pre-resolution reads live health state
          // through this client. forPlugin is lazy; the actual RPC only
          // fires at evaluation time.
          healthCheckClient: rpcClient.forPlugin(HealthCheckApi),
          getService: async () => {
            throw new Error(
              "getService not yet wired — automation dispatch invoked too early",
            );
          },
        };

        const stash = env as unknown as EnvStash;
        stash.triggerRegistry = triggerRegistry;
        stash.actionRegistry = actionRegistry;
        stash.artifactTypeRegistry = artifactTypeRegistry;
        stash.dispatchDeps = dispatchDeps;
        stash.automationStore = automationStore;

        const router = createAutomationRouter({
          db: database,
          automationStore,
          triggerRegistry,
          actionRegistry,
          artifactTypeRegistry,
          dispatchDeps,
          signalService,
          logger,
        });
        rpc.registerRouter(router, automationContract);

        registerSearchProvider({
          pluginMetadata,
          commands: [
            {
              id: "list",
              title: "Manage Automations",
              subtitle: "View, edit, enable, or disable automations",
              iconName: "Workflow",
              shortcuts: ["meta+shift+a", "ctrl+shift+a"],
              route: resolveRoute(automationRoutes.routes.list),
              requiredAccessRules: [automationAccess.read],
            },
            {
              id: "create",
              title: "Create Automation",
              subtitle: "Build a new automation from triggers and actions",
              iconName: "Plus",
              route: resolveRoute(automationRoutes.routes.create),
              requiredAccessRules: [automationAccess.manage],
            },
            {
              id: "playground",
              title: "Template Playground",
              subtitle: "Test automation templates against a sample payload",
              iconName: "Beaker",
              route: resolveRoute(automationRoutes.routes.playground),
              requiredAccessRules: [automationAccess.read],
            },
          ],
        });

        env.registerCleanup(async () => {
          const s = env as unknown as EnvStash;
          await s.triggerSubscriptions?.dispose();
          s.stalledSweeper?.stop();
          await s.delayConsumer?.stop();
          await s.dwellConsumer?.stop();
          await s.waitUntilConsumer?.stop();
        });

        logger.debug("✅ Automation Backend initialized.");
      },

      afterPluginsReady: async ({ database, logger, onHook, rpcClient }) => {
        const stash = env as unknown as EnvStash;
        const triggers = stash.triggerRegistry.getTriggers();
        const actions = stash.actionRegistry.getActions();
        const artifactTypes = stash.artifactTypeRegistry.getArtifactTypes();

        logger.debug(
          `⚙️  Registered ${triggers.length} automation triggers${
            triggers.length > 0
              ? ": " + triggers.map((t) => t.qualifiedId).join(", ")
              : ""
          }`,
        );
        logger.debug(
          `⚙️  Registered ${actions.length} automation actions${
            actions.length > 0
              ? ": " + actions.map((a) => a.qualifiedId).join(", ")
              : ""
          }`,
        );
        logger.debug(
          `⚙️  Registered ${artifactTypes.length} artifact types${
            artifactTypes.length > 0
              ? ": " + artifactTypes.map((t) => t.qualifiedId).join(", ")
              : ""
          }`,
        );

        // Trigger fan-in: subscribe to every registered hook-backed
        // trigger in work-queue mode; instantiate setup-backed triggers
        // per referencing automation.
        stash.triggerSubscriptions = await setupTriggerSubscriptions({
          deps: stash.dispatchDeps,
          onHook,
          automationStore: stash.automationStore,
          logger,
        });

        // Crash-safe delay: register the consumer that fires when a
        // scheduled queue job pops, resuming the suspended run.
        stash.delayConsumer = await startDelayQueueConsumer({
          deps: stash.dispatchDeps,
          automationStore: stash.automationStore,
          logger,
        });

        // `for:` dwell: register the consumer that fires when a dwell's
        // scheduled job pops, re-confirming state before starting the run.
        stash.dwellConsumer = await startDwellQueueConsumer({
          deps: stash.dispatchDeps,
          automationStore: stash.automationStore,
          logger,
        });

        // `wait_until`: register the consumer that re-checks a suspended
        // run's condition on each poll tick.
        stash.waitUntilConsumer = await startWaitUntilQueueConsumer({
          deps: stash.dispatchDeps,
          automationStore: stash.automationStore,
          logger,
        });

        // Restart safety + horizontal scaling: periodically scan for
        // runs whose heartbeat is older than the threshold and resume
        // them under an advisory lock.
        stash.stalledSweeper = startStalledSweeper({
          deps: stash.dispatchDeps,
          automationStore: stash.automationStore,
          logger,
        });

        // One-time migration: pull legacy `webhook_subscriptions` rows
        // via the integration-backend service RPC and translate each
        // into an automation. Already-migrated rows (matched on
        // `managed_by`) are skipped, so this is safe to run on every
        // boot. Failures are recorded for admin review via the
        // `listMigrationFailures` RPC.
        try {
          await runWebhookSubscriptionMigration({
            db: database,
            rpcClient,
            logger,
          });
        } catch (error) {
          logger.error(
            `Subscription migration failed unexpectedly: ${extractErrorMessage(error, "unknown error")}`,
          );
        }

        logger.debug("✅ Automation Backend afterPluginsReady complete.");
      },
    });
  },
});

// ─── Re-exports for consumer plugins ─────────────────────────────────────

export {
  automationTriggerExtensionPoint,
  automationActionExtensionPoint,
  automationArtifactTypeExtensionPoint,
  automationRegistriesRef,
  automationArtifactStoreRef,
} from "./extension-points";

export type {
  TriggerDefinition,
  ActionDefinition,
  ArtifactTypeDefinition,
  ActionExecutionContext,
  ActionRunScope,
  ActionResult,
  ArtifactTypeRef,
  RegisteredTrigger,
  RegisteredAction,
  RegisteredArtifactType,
  TriggerSetupFn,
  TriggerTeardown,
} from "./action-types";

export type { ArtifactStore, PersistedArtifact } from "./artifact-store";
export type { TriggerRegistry } from "./trigger-registry";
export type { ActionRegistry } from "./action-registry";
export type { ArtifactTypeRegistry } from "./artifact-type-registry";
export type { AutomationRegistries } from "./extension-points";
export type { AutomationStore } from "./automation-store";
