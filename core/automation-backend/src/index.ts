import {
  createBackendPlugin,
  coreServices,
  type SafeDatabase,
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
import { AuthApi } from "@checkstack/auth-common";
import { entityKindExtensionPoint } from "@checkstack/gitops-backend";
import { aiToolExtensionPoint } from "@checkstack/ai-backend";
import { buildAutomationAiTools } from "./ai/register-ai-tools";
import { CHECKSTACK_API_VERSION } from "@checkstack/gitops-common";
import {
  reconcileAutomation,
  deleteAutomationEntity,
} from "./gitops-kinds";
import { registerAutomationGitOpsDocumentation } from "./gitops-docs";
import { AutomationDefinitionSchema } from "@checkstack/automation-common";

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
import { runFlappingAutomationMigration } from "./migration/flapping-to-window";
import {
  startDelayQueueConsumer,
  type DelayQueueConsumer,
} from "./dispatch/delay-queue";
import {
  startDwellQueueConsumer,
  type DwellQueueConsumer,
} from "./dispatch/dwell-queue";
import {
  startWaitTimeoutQueueConsumer,
  type WaitTimeoutQueueConsumer,
} from "./dispatch/wait-timeout-queue";
import {
  startDispatchQueueConsumer,
  type DispatchQueueConsumer,
} from "./dispatch/stage2-dispatch";
import {
  startStage1Router,
  type Stage1Router,
} from "./dispatch/stage1-router";
import { createDwellStore } from "./dispatch/dwell-store";
import { createWindowStore } from "./dispatch/window-store";
import { createRunStore } from "./dispatch/run-state";
import { createRunStateStore } from "./dispatch/run-state-store";
import { createRunSecretRegistry } from "./dispatch/run-secret-registry";
import {
  SECRET_RESOLVER_REF_ID,
  CONNECTION_STORE_REF_ID,
} from "./dispatch/secret-ref-ids";
import {
  startStalledSweeper,
  type StalledSweeper,
} from "./dispatch/stalled-sweeper";
import {
  setupTriggerSubscriptions,
  type TriggerSubscriptions,
} from "./dispatch/trigger-subscriber";
import type { DispatchDeps } from "./dispatch/types";
import { assembleDispatchGetService } from "./dispatch/assemble-get-service";
import {
  automationActionExtensionPoint,
  automationArtifactStoreRef,
  automationArtifactTypeExtensionPoint,
  automationFilterExtensionPoint,
  automationRegistriesRef,
  automationTemplateExtensionPoint,
  automationTriggerExtensionPoint,
} from "./extension-points";
import {
  createAutomationTemplateRegistry,
  type AutomationTemplateRegistry,
} from "./template-registry";
import { validateTemplates } from "./validate-templates";
import { builtinAutomationTemplates } from "./builtin-templates";
import {
  registerBuiltinTriggerConsumer,
  registerBuiltinTriggers,
} from "./builtin-triggers";
import {
  createChangeDeriverRegistry,
  createChangeEmitter,
  createEntityChangedSubscriptions,
  createEntityRegistry,
  createEntityStore,
  entityExtensionPoint,
  type ChangeDeriverRegistry,
  type ChangeEmitter,
  type EntityChangedSubscriptions,
  type EntityRegistry,
} from "./entity";
import { ENTITY_CHANGED_HOOK } from "./entity/hook";
import {
  notifyUserAction,
  logAction,
  notifyUserArtifactType,
} from "./builtin-actions";
import { aiAnalyzeAction, aiAnalysisArtifactType } from "./ai-action";
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
  templateRegistry: AutomationTemplateRegistry;
  dispatchDeps: DispatchDeps;
  automationStore: ReturnType<typeof createAutomationStore>;
  entityRegistry: EntityRegistry;
  entityChangeEmitter: ChangeEmitter;
  entityChangedSubscriptions: EntityChangedSubscriptions;
  changeDerivers: ChangeDeriverRegistry;
  triggerSubscriptions?: TriggerSubscriptions;
  stalledSweeper?: StalledSweeper;
  delayConsumer?: DelayQueueConsumer;
  dwellConsumer?: DwellQueueConsumer;
  waitTimeoutConsumer?: WaitTimeoutQueueConsumer;
  dispatchConsumer?: DispatchQueueConsumer;
  stage1Router?: Stage1Router;
}

export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    // Mutable DB ref — populated in init(), consumed by the GitOps
    // reconcile/delete closures (only called during sync, after init).
    let gitopsDb: SafeDatabase<typeof schema> | undefined;

    const triggerRegistry = createTriggerRegistry();
    const actionRegistry = createActionRegistry();
    const artifactTypeRegistry = createArtifactTypeRegistry();
    // Curated example-automation templates contributed by core + plugins.
    // Validated against the live registries in `afterPluginsReady` before
    // any are served (see `validate-templates.ts`).
    const templateRegistry = createAutomationTemplateRegistry();
    // Shared filter registry — seeded with the built-in defaults (incl.
    // the Wave-2 duration helpers) and extended by plugins via the
    // filter extension point in Phase 1. The dispatch engine reads from
    // this same instance, so plugin filters are live by `init()`.
    const filterRegistry: FilterRegistry = createDefaultFilterRegistry();

    // Run-scoped secret registry — created here in `register()` (it has no
    // deps) so the SAME instance backs both the dispatch masking choke
    // points (wired in `init()`) and the entity-store masking choke point
    // (run-originated entity writes mask through this in the handle).
    const secretRegistry = createRunSecretRegistry();

    // Entity state machine (reactive automation engine §4). The change
    // emitter buffers until `emitHook` is wired in `afterPluginsReady`
    // (§3.7); the registry exposes `defineEntity` / `declareNonReactiveState`
    // through the extension point below, callable from other plugins'
    // `register`/`init`. The DB-backed store is bound in `init()` (after
    // migrations run).
    const entityChangeEmitter = createChangeEmitter();
    const entityRegistry = createEntityRegistry({
      secretRegistry,
      emitter: entityChangeEmitter,
    });

    // Reactive dispatch pipeline (reactive automation engine §7). The
    // change-deriver registry maps a kind's change → trigger event id(s)
    // for Stage-1 routing; per-domain derivers are registered in Phase 4.
    // The entity-changed subscription service rides ENTITY_CHANGED (filtered
    // by kind) so other plugins can react without touching the internal hook
    // (§6.1). Both buffer registrations made before afterPluginsReady wires
    // the real `onHook`.
    const changeDerivers = createChangeDeriverRegistry();
    const entityChangedSubscriptions = createEntityChangedSubscriptions();

    env.registerAccessRules(automationAccessRules);

    // Phase 1: register the entity extension point so other plugins can
    // resolve it and call `defineEntity` during their own register/init.
    env.registerExtensionPoint(entityExtensionPoint, {
      defineEntity: entityRegistry.defineEntity,
      declareNonReactiveState: entityRegistry.declareNonReactiveState,
      onEntityChanged: entityChangedSubscriptions.onEntityChanged,
      registerChangeDeriver: (input) => changeDerivers.register(input),
    });

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

    env.registerExtensionPoint(automationTemplateExtensionPoint, {
      registerTemplate: (template, metadata) => {
        templateRegistry.register(template, metadata);
      },
    });

    // Register this plugin's own built-in example templates. They reference
    // ids by string (incl. other plugins' actions); the startup validator
    // skips any whose capabilities aren't installed.
    for (const template of builtinAutomationTemplates) {
      templateRegistry.register(template, pluginMetadata);
    }

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

    // GitOps `Automation` kind. The DB isn't available until init(), so a
    // mutable ref is populated there and read by the reconcile closures
    // (only invoked during sync, well after init) — mirrors catalog-backend.
    const kindRegistry = env.getExtensionPoint(entityKindExtensionPoint);
    kindRegistry.registerKind({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "Automation",
      specSchema: AutomationDefinitionSchema,
      reconcile: async ({ entity, existingEntityId, context }) => {
        if (!gitopsDb) throw new Error("Automation database not initialized");
        return reconcileAutomation(gitopsDb, {
          entity,
          existingEntityId,
          logger: context.logger,
        });
      },
      delete: async ({ entityId, context }) => {
        if (!gitopsDb) throw new Error("Automation database not initialized");
        await deleteAutomationEntity(gitopsDb, {
          entityId,
          logger: context.logger,
        });
      },
    });

    // Register the GitOps spec-schema documentation PROVIDER for the
    // `Automation` kind HERE in register() (not afterPluginsReady). It is a
    // LAZY provider: it re-reads the trigger/action registries on every
    // kind-browser query (`describeKinds()`), so it needs no populated
    // registries at registration time — registering it early, before any
    // init / afterPluginsReady ordering, guarantees it is always present.
    // Surfaces each trigger's / provider action's config schema in the Kind
    // Registry, conditioned on the chosen `triggers[].event` /
    // `actions[].action`.
    registerAutomationGitOpsDocumentation({
      kindRegistry,
      triggerRegistry,
      actionRegistry,
    });

    env.registerInit({
      schema,
      deps: {
        logger: coreServices.logger,
        rpc: coreServices.rpc,
        rpcClient: coreServices.rpcClient,
        rpcClientAs: coreServices.rpcClientAs,
        queueManager: coreServices.queueManager,
        signalService: coreServices.signalService,
        advisoryLock: coreServices.advisoryLock,
      },
      init: async ({
        logger,
        database,
        rpc,
        rpcClient,
        rpcClientAs,
        queueManager,
        signalService,
        advisoryLock,
      }) => {
        logger.debug("⚙️  Initializing Automation Backend...");

        // Populate the mutable DB ref the GitOps reconcile closures read.
        gitopsDb = database as SafeDatabase<typeof schema>;

        // Run-scoped secret registry: created in `register()` (the SAME
        // instance) so it accumulates every secret value resolved during a
        // run and every persistence choke point (run store step/run output,
        // run-state scope snapshot, artifact data, AND run-originated entity
        // writes) masks before write.
        const artifactStore = createArtifactStore(database, secretRegistry);
        const runStore = createRunStore(database, logger, secretRegistry);
        const runStateStore = createRunStateStore(
          database,
          advisoryLock,
          secretRegistry,
        );
        const dwellStore = createDwellStore(database);
        const windowStore = createWindowStore(database);
        const automationStore = createAutomationStore(database);

        // Bind the DB-backed transition store to the registry (the extension
        // point impl registered in `register()` forwards through it). Model B:
        // the transition store owns the tx + `entity_transitions` log for
        // EVERY kind. Bound here in `init()` — after migrations have run — so
        // the table exists.
        const entityStore = createEntityStore(database);
        entityRegistry.setStore({ store: entityStore });

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
          notifyUserAction as ActionDefinition<unknown, unknown>,
          pluginMetadata,
        );
        actionRegistry.register(
          aiAnalyzeAction as ActionDefinition<unknown, unknown>,
          pluginMetadata,
        );
        artifactTypeRegistry.register(
          notifyUserArtifactType as ArtifactTypeDefinition<unknown>,
          pluginMetadata,
        );
        artifactTypeRegistry.register(
          aiAnalysisArtifactType as ArtifactTypeDefinition<unknown>,
          pluginMetadata,
        );
        await registerBuiltinTriggerConsumer({ queueManager, logger });

        // Register this plugin's AI tools (propose/update/delete) into the AI
        // registry via the extension point - owned here, not in ai-backend.
        const aiToolExt = env.getExtensionPoint(aiToolExtensionPoint);
        for (const tool of buildAutomationAiTools()) {
          aiToolExt.registerTool(tool, pluginMetadata);
        }

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
          windowStore,
          queueManager,
          // Sensing-layer scope pre-resolution reads live health state
          // through this client. forPlugin is lazy; the actual RPC only
          // fires at evaluation time. NOTE: this is the trusted client used
          // for TRIGGER/CONDITION evaluation (event delivery), NOT for action
          // execution - actions run as the automation's `runAs` service
          // account via `rpcClientForApplication` below.
          healthCheckClient: rpcClient.forPlugin(HealthCheckApi),
          // Per-run application-scoped client factory: the engine builds the
          // run's client from the automation's `runAs` and threads it into
          // every action's `context.rpcClient`, so ALL action data access
          // authenticates as the bounded service account (never god mode).
          rpcClientForApplication: rpcClientAs,
          // Resolve the runAs service account's effective access rules (a
          // trusted S2S read of the app's own rules) so the engine can enforce
          // each action's `requiredAccessRules` against the bounded principal -
          // the only authz point for integration actions, which resolve
          // credentials through a trusted service rather than the bounded client.
          resolveRunAsAccessRules: async (applicationId) => {
            const enriched = await rpcClient
              .forPlugin(AuthApi)
              .enrichApplicationPrincipal({ applicationId });
            return enriched?.accessRules ?? [];
          },
          // Kind-agnostic entity resolver for reactive `wait_until` wake
          // re-evaluation (Model B): the registry routes each kind to its
          // plugin `read` accessor. Unknown kinds
          // yield `undefined` (enrichment leaves them unresolved, fail-open).
          // This is what lets a wait on `state.<kind>.<id>` (incident, slo, …)
          // re-evaluate correctly when that kind changes (not just health).
          entityResolverFor: (kind) => entityRegistry.entityResolverFor(kind),
          // Registry-backed resolution of provider-action deps (connection
          // store, secret resolver, ...) at execute time. Safe here because
          // dispatch only runs from afterPluginsReady onward, by which point
          // every service is registered. `env.getService` resolves through
          // the real ServiceRegistry and throws clearly on a missing ref.
          getService: assembleDispatchGetService({
            envGetService: env.getService,
          }),
          // Run-wide secret masking: the engine wraps each run's getService
          // to register resolved secrets here, and the run store masks step
          // / run output before persistence.
          secretRegistry,
          secretResolverRefId: SECRET_RESOLVER_REF_ID,
          connectionStoreRefId: CONNECTION_STORE_REF_ID,
          // Serialize the concurrency-mode check-then-create with a
          // transaction-scoped advisory lock (blocks until granted,
          // auto-releases at COMMIT) so racing fires can't double-run a
          // single-mode automation. Runs on the dedicated lock pool (lock held
          // there, work on the admin pool) so it can't starve the admin pool.
          withConcurrencyLock: <T>(key: string, fn: () => Promise<T>) =>
            advisoryLock.withXactLock({ key, fn }),
        };

        const stash = env as unknown as EnvStash;
        stash.triggerRegistry = triggerRegistry;
        stash.actionRegistry = actionRegistry;
        stash.artifactTypeRegistry = artifactTypeRegistry;
        stash.templateRegistry = templateRegistry;
        stash.dispatchDeps = dispatchDeps;
        stash.automationStore = automationStore;
        stash.entityRegistry = entityRegistry;
        stash.entityChangeEmitter = entityChangeEmitter;
        stash.entityChangedSubscriptions = entityChangedSubscriptions;
        stash.changeDerivers = changeDerivers;

        const router = createAutomationRouter({
          db: database,
          automationStore,
          triggerRegistry,
          actionRegistry,
          artifactTypeRegistry,
          templateRegistry,
          dispatchDeps,
          signalService,
          logger,
          rpcClient,
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
          await s.stage1Router?.dispose();
          await s.entityChangedSubscriptions?.disposeAll();
          s.stalledSweeper?.stop();
          await s.delayConsumer?.stop();
          await s.dwellConsumer?.stop();
          await s.waitTimeoutConsumer?.stop();
          await s.dispatchConsumer?.stop();
        });

        logger.debug("✅ Automation Backend initialized.");
      },

      afterPluginsReady: async ({
        database,
        logger,
        onHook,
        emitHook,
        rpcClient,
      }) => {
        const stash = env as unknown as EnvStash;
        const triggers = stash.triggerRegistry.getTriggers();
        const actions = stash.actionRegistry.getActions();
        const artifactTypes = stash.artifactTypeRegistry.getArtifactTypes();

        // Wire the deferred entity-change emitter to the real `emitHook`
        // (only injectable here — §3.7). Any change events buffered during
        // the init / afterPluginsReady window are flushed in order now, so
        // there is no silent no-emit gap.
        await stash.entityChangeEmitter.wire((payload) =>
          emitHook(ENTITY_CHANGED_HOOK, payload),
        );

        // Wire the public cross-plugin entity-change subscription service
        // (§6.1). Subscriptions registered by other plugins during their
        // register/init are bound to the real `onHook` now.
        stash.entityChangedSubscriptions.wire({ onHook, logger });

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

        // Validate every registered example-automation template against the
        // now fully-populated live registries. Templates whose capabilities
        // aren't installed are skipped silently; templates that reference a
        // DRIFTED action/trigger/artifact interface are logged loudly and
        // withheld, so a stale template can never reach an operator.
        const templateValidation = await validateTemplates({
          templates: stash.templateRegistry.list(),
          triggerRegistry: stash.triggerRegistry,
          actionRegistry: stash.actionRegistry,
        });
        // A withheld template is never silent: a missing-capability template
        // (an optional integration is not installed) WARNS so an operator can
        // see why it is absent, and a drifted template (capabilities present
        // but the definition no longer validates) is an ERROR.
        for (const { template, missing } of templateValidation.unavailable) {
          logger.warn(
            `⚠️  Automation template "${template.id}" withheld — requires capabilities not installed on this instance: ${missing.join(", ")}`,
          );
        }
        for (const { template, issues } of templateValidation.invalid) {
          logger.error(
            `❌ Automation template "${template.id}" is INVALID against the current capability registries (interface drift?). It will be withheld from the catalogue. Issues: ${issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; ")}`,
          );
        }
        stash.templateRegistry.setValidated(templateValidation.valid);
        logger.debug(
          `⚙️  ${templateValidation.valid.length} automation template(s) available` +
            ` (${templateValidation.unavailable.length} unavailable, ${templateValidation.invalid.length} invalid)`,
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

        // Reactive `wait_until` timeout timer: the consumer that fires when
        // a suspended wait's single deadline job pops, applying the
        // continue/fail-on-timeout policy. Reactive waits are otherwise woken
        // by Stage-1 routing on a relevant ENTITY_CHANGED (no polling).
        stash.waitTimeoutConsumer = await startWaitTimeoutQueueConsumer({
          deps: stash.dispatchDeps,
          automationStore: stash.automationStore,
          logger,
        });

        // Stage-2 dispatch fan-out: the consumer that runs each per-run
        // dispatch job enqueued by Stage-1 routing (reason: trigger →
        // dispatchTrigger; reason: wake → resume the suspended wait_until).
        stash.dispatchConsumer = await startDispatchQueueConsumer({
          deps: stash.dispatchDeps,
          automationStore: stash.automationStore,
          changeDerivers: stash.changeDerivers,
          logger,
        });

        // Stage-1 routing: claim each ENTITY_CHANGED on the
        // `automation-entity-route` work-queue (exactly one instance), do
        // cheap indexed routing (wake-index intersection + trigger-event
        // derivation), and enqueue Stage-2 jobs.
        stash.stage1Router = await startStage1Router({
          deps: stash.dispatchDeps,
          automationStore: stash.automationStore,
          changeDerivers: stash.changeDerivers,
          onHook,
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

        // One-time migration: rewrite legacy `healthcheck.flapping_detected`
        // triggers onto the generic windowed-count gate over
        // `healthcheck.system_health_changed` (the flapping trigger + hook
        // were removed). Idempotent — already-migrated / non-flapping rows are
        // skipped — so it is safe to run on every boot.
        try {
          await runFlappingAutomationMigration({ db: database, logger });
        } catch (error) {
          logger.error(
            `Flapping automation migration failed unexpectedly: ${extractErrorMessage(error, "unknown error")}`,
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

// Entity state machine — the typed path to reactive state. The internal
// ENTITY_CHANGED hook is intentionally NOT re-exported (§6.1).
export { entityExtensionPoint } from "./entity";
export { withEntityWrite, withEntityRemove } from "./entity";
export type {
  EntityExtensionPoint,
  DefineEntity,
  DefineEntityInput,
  DeclareNonReactiveState,
  DeclareNonReactiveStateInput,
  EntityHandle,
  EntityMutationOpts,
  EntityRead,
  MutateInput,
  RemoveInput,
  EntityTx,
  EntityChangeDeriver,
  EntityChangePayloadMapper,
  RegisterChangeDeriver,
  OnEntityChanged,
  OnEntityChangedInput,
  EntityChangedHandler,
  EntityChangedDelivery,
  EntityChangedUnsubscribe,
} from "./entity";

// The validated entity-change payload (Phase 4 derivers + cross-plugin
// consumers type against this). Re-exported from automation-common so a
// domain plugin needs only the automation-backend dependency.
export type { EntityChanged } from "@checkstack/automation-common";

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

export { makeEntityDrivenTriggerSetup } from "./entity-driven-trigger";

export type { ArtifactStore, PersistedArtifact } from "./artifact-store";
export type { TriggerRegistry } from "./trigger-registry";
export type { ActionRegistry } from "./action-registry";
export type { ArtifactTypeRegistry } from "./artifact-type-registry";
export type { AutomationRegistries } from "./extension-points";
export type { AutomationStore } from "./automation-store";
export type { LoadedAutomation } from "./dispatch/types";
