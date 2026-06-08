/**
 * oRPC router for the Automation backend.
 *
 * Implements every procedure declared in `automationContract`
 * (`@checkstack/automation-common`). Auth + access checks are wired up via
 * `autoAuthMiddleware` driven by the contract's `meta.userType` /
 * `meta.access`.
 */
import { implement, ORPCError } from "@orpc/server";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { SafeDatabase, Logger, RpcClient } from "@checkstack/backend-api";
import {
  autoAuthMiddleware,
  correlationMiddleware,
  resolveActor,
  type RpcContext,
} from "@checkstack/backend-api";
import { AuthApi, isApplicationBindable } from "@checkstack/auth-common";
import type { SignalService } from "@checkstack/signal-common";
import { extractErrorMessage } from "@checkstack/common";
import {
  AUTOMATION_DEFINITION_CHANGED,
  AUTOMATION_RUN_COMPLETED,
  automationContract,
  type Automation,
  type AutomationArtifact,
  type AutomationRun,
  type AutomationRunStep,
  type TriggerInfo,
} from "@checkstack/automation-common";
import {
  evaluateBoolean,
  parseCondition,
  parseTemplate,
  render,
  TemplateError,
} from "@checkstack/template-engine";
import { ZodError } from "zod";

import type { ActionRegistry } from "./action-registry";
import type { ArtifactTypeRegistry } from "./artifact-type-registry";
import type { TriggerRegistry } from "./trigger-registry";
import type { AutomationStore } from "./automation-store";
import { dispatchTrigger } from "./dispatch/engine";
import type { DispatchDeps } from "./dispatch/types";
import { collectDefinitionIssues } from "./validate-definition";
import {
  resolveResolutionRootFromStore,
  resolveScriptPackagesDir,
} from "@checkstack/script-packages-backend";
import { runScriptTest } from "./script-test";
import { buildReplayContext } from "./script-test-replay";
import * as schema from "./schema";

interface RouterDeps {
  db: SafeDatabase<typeof schema>;
  automationStore: AutomationStore;
  triggerRegistry: TriggerRegistry;
  actionRegistry: ActionRegistry;
  artifactTypeRegistry: ArtifactTypeRegistry;
  dispatchDeps: DispatchDeps;
  signalService: SignalService;
  logger: Logger;
  /**
   * Trusted service client, used ONLY to resolve a candidate `runAs`
   * application's live access rules for the bind-authority check below. This
   * is an S2S read of the app's rules, not an automation action.
   */
  rpcClient: RpcClient;
}

/**
 * Map a `automation_runs` row to the wire `AutomationRun`.
 */
function mapRunRow(
  row: typeof schema.automationRuns.$inferSelect,
): AutomationRun {
  return {
    id: row.id,
    automationId: row.automationId,
    triggerId: row.triggerId,
    triggerEventId: row.triggerEventId,
    triggerPayload: row.triggerPayload,
    contextKey: row.contextKey,
    status: row.status as AutomationRun["status"],
    errorMessage: row.errorMessage ?? undefined,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? undefined,
  };
}

/**
 * Map a `automation_run_steps` row to the wire `AutomationRunStep`.
 */
function mapStepRow(
  row: typeof schema.automationRunSteps.$inferSelect,
): AutomationRunStep {
  return {
    id: row.id,
    runId: row.runId,
    actionPath: row.actionPath,
    actionId: row.actionId,
    actionKind: row.actionKind,
    providerActionId: row.providerActionId,
    status: row.status as AutomationRunStep["status"],
    attempts: row.attempts,
    errorMessage: row.errorMessage ?? undefined,
    resultPayload: row.resultPayload ?? undefined,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? undefined,
  };
}

/**
 * Map a `automation_artifacts` row to the wire `AutomationArtifact`.
 */
function mapArtifactRow(
  row: typeof schema.automationArtifacts.$inferSelect,
): AutomationArtifact {
  return {
    id: row.id,
    automationId: row.automationId,
    runId: row.runId,
    stepId: row.stepId,
    actionId: row.actionId,
    artifactType: row.artifactType,
    data: row.data,
    contextKey: row.contextKey,
    closedAt: row.closedAt ?? undefined,
    createdAt: row.createdAt,
  };
}


export function createAutomationRouter(deps: RouterDeps) {
  const {
    db,
    automationStore,
    triggerRegistry,
    actionRegistry,
    artifactTypeRegistry,
    dispatchDeps,
    signalService,
    logger,
  } = deps;

  const os = implement(automationContract)
    .$context<RpcContext>()
    .use(correlationMiddleware)
    .use(autoAuthMiddleware);

  /**
   * Enforce bind authority: the caller may only set an automation's `runAs`
   * to an application whose access rules are a SUBSET of the caller's, so a
   * user can never grant an automation more authority than they hold.
   */
  async function assertCanBindRunAs(
    runAs: string,
    context: RpcContext,
  ): Promise<void> {
    const callerRules =
      context.user && "accessRules" in context.user
        ? (context.user.accessRules ?? [])
        : [];
    const enriched = await deps.rpcClient
      .forPlugin(AuthApi)
      .enrichApplicationPrincipal({ applicationId: runAs });
    if (!enriched) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Service account "${runAs}" does not exist.`,
      });
    }
    if (
      !isApplicationBindable({
        appAccessRules: enriched.accessRules,
        callerAccessRules: callerRules,
      })
    ) {
      throw new ORPCError("FORBIDDEN", {
        message: `You are not allowed to run an automation as "${enriched.name}": it holds access rules you do not have.`,
      });
    }
  }

  return os.router({
    // ─── Automations CRUD ────────────────────────────────────────────────

    listAutomations: os.listAutomations.handler(async ({ input }) => {
      const { limit, offset, status, group } = input;
      const result = await automationStore.list({
        limit,
        offset,
        status,
        group,
      });
      return {
        items: result.items,
        total: result.total,
        limit,
        offset,
      };
    }),

    listAutomationGroups: os.listAutomationGroups.handler(async () => {
      const groups = await automationStore.listGroups();
      return { groups };
    }),

    getAutomation: os.getAutomation.handler(async ({ input }) => {
      const automation = await automationStore.getById(input.id);
      if (!automation) {
        throw new ORPCError("NOT_FOUND", {
          message: `Automation ${input.id} not found`,
        });
      }
      return automation;
    }),

    createAutomation: os.createAutomation.handler(async ({ input, context }) => {
      await assertCanBindRunAs(input.runAs, context);
      let created: Automation;
      try {
        created = await automationStore.create(input);
      } catch (error) {
        if (error instanceof ZodError) {
          throw new ORPCError("BAD_REQUEST", {
            message: `Invalid automation definition: ${error.message}`,
          });
        }
        throw error;
      }
      await signalService.broadcast(AUTOMATION_DEFINITION_CHANGED, {
        action: "created",
        automationId: created.id,
      });
      logger.info(`Created automation "${created.name}" (${created.id})`);
      return created;
    }),

    updateAutomation: os.updateAutomation.handler(async ({ input, context }) => {
      const existing = await automationStore.getById(input.id);
      if (!existing) {
        throw new ORPCError("NOT_FOUND", {
          message: `Automation ${input.id} not found`,
        });
      }
      if (input.runAs !== undefined) {
        await assertCanBindRunAs(input.runAs, context);
      }
      let updated: Automation;
      try {
        updated = await automationStore.update(input);
      } catch (error) {
        if (error instanceof ZodError) {
          throw new ORPCError("BAD_REQUEST", {
            message: `Invalid automation definition: ${error.message}`,
          });
        }
        throw error;
      }
      await signalService.broadcast(AUTOMATION_DEFINITION_CHANGED, {
        action: "updated",
        automationId: updated.id,
      });
      return updated;
    }),

    deleteAutomation: os.deleteAutomation.handler(async ({ input }) => {
      const existing = await automationStore.getById(input.id);
      if (!existing) {
        throw new ORPCError("NOT_FOUND", {
          message: `Automation ${input.id} not found`,
        });
      }
      await automationStore.delete(input.id);
      await signalService.broadcast(AUTOMATION_DEFINITION_CHANGED, {
        action: "deleted",
        automationId: input.id,
      });
      logger.info(`Deleted automation ${input.id}`);
      return { success: true };
    }),

    toggleAutomation: os.toggleAutomation.handler(async ({ input }) => {
      const existing = await automationStore.getById(input.id);
      if (!existing) {
        throw new ORPCError("NOT_FOUND", {
          message: `Automation ${input.id} not found`,
        });
      }
      const updated = await automationStore.toggle(input.id, input.enabled);
      await signalService.broadcast(AUTOMATION_DEFINITION_CHANGED, {
        action: "updated",
        automationId: input.id,
      });
      return updated;
    }),

    // ─── Definition validation ───────────────────────────────────────────

    validateDefinition: os.validateDefinition.handler(async ({ input }) => {
      // Deep validation: structural shape PLUS each provider action's
      // config against its registered schema, trigger configs, and
      // unknown trigger/action ids — so the editor surfaces invalid
      // values / keys, not just malformed structure.
      const issues = await collectDefinitionIssues(input.definition, {
        triggerRegistry,
        actionRegistry,
      });
      return {
        valid: issues.length === 0,
        errors: issues,
      };
    }),

    // ─── Manual run ──────────────────────────────────────────────────────

    manualRun: os.manualRun.handler(async ({ input, context }) => {
      const automation = await automationStore.getById(input.automationId);
      if (!automation) {
        throw new ORPCError("NOT_FOUND", {
          message: `Automation ${input.automationId} not found`,
        });
      }

      const triggers = automation.definition.triggers;
      const selectedTrigger = input.triggerId
        ? triggers.find((t) => (t.id ?? t.event) === input.triggerId)
        : triggers[0];
      if (!selectedTrigger) {
        throw new ORPCError("BAD_REQUEST", {
          message: input.triggerId
            ? `Trigger ${input.triggerId} not found on automation ${automation.id}`
            : `Automation ${automation.id} has no triggers`,
        });
      }

      const triggerDef = triggerRegistry.getTrigger(selectedTrigger.event);
      const contextKey =
        triggerDef?.contextKey?.(input.payload) ?? null;

      const result = await dispatchTrigger(dispatchDeps, {
        automation: {
          id: automation.id,
          name: automation.name,
          status: automation.status,
          definition: automation.definition,
          runAs: automation.runAs ?? null,
        },
        triggerId: selectedTrigger.id ?? selectedTrigger.event,
        triggerEventId: selectedTrigger.event,
        payload: input.payload,
        // Attribute the manual run to whoever invoked it.
        actor: resolveActor(context.user),
        contextKey,
      });

      await signalService.broadcast(AUTOMATION_RUN_COMPLETED, {
        runId: result.runId,
        automationId: automation.id,
        status: result.status as AutomationRun["status"],
      });

      return { runId: result.runId };
    }),

    // ─── Runs / history ──────────────────────────────────────────────────

    listRuns: os.listRuns.handler(async ({ input }) => {
      const { limit, offset, automationId, status } = input;

      const filters = [];
      if (automationId) {
        filters.push(eq(schema.automationRuns.automationId, automationId));
      }
      if (status) {
        filters.push(eq(schema.automationRuns.status, status));
      }
      const whereClause =
        filters.length > 0 ? and(...filters) : undefined;

      const baseSelect = db.select().from(schema.automationRuns);
      const rows = whereClause
        ? await baseSelect
            .where(whereClause)
            .orderBy(desc(schema.automationRuns.startedAt))
            .limit(limit)
            .offset(offset)
        : await baseSelect
            .orderBy(desc(schema.automationRuns.startedAt))
            .limit(limit)
            .offset(offset);

      const baseCount = db
        .select({ c: sql<number>`count(*)::int` })
        .from(schema.automationRuns);
      const countRows = whereClause
        ? await baseCount.where(whereClause)
        : await baseCount;

      return {
        items: rows.map((row) => mapRunRow(row)),
        total: countRows[0]?.c ?? 0,
        limit,
        offset,
      };
    }),

    getRun: os.getRun.handler(async ({ input }) => {
      const runRow = await db
        .select()
        .from(schema.automationRuns)
        .where(eq(schema.automationRuns.id, input.id))
        .limit(1);
      const run = runRow[0];
      if (!run) {
        throw new ORPCError("NOT_FOUND", {
          message: `Run ${input.id} not found`,
        });
      }

      const [stepRows, artifactRows] = await Promise.all([
        db
          .select()
          .from(schema.automationRunSteps)
          .where(eq(schema.automationRunSteps.runId, input.id))
          .orderBy(asc(schema.automationRunSteps.startedAt)),
        db
          .select()
          .from(schema.automationArtifacts)
          .where(eq(schema.automationArtifacts.runId, input.id))
          .orderBy(asc(schema.automationArtifacts.createdAt)),
      ]);

      return {
        run: mapRunRow(run),
        steps: stepRows.map((row) => mapStepRow(row)),
        artifacts: artifactRows.map((row) => mapArtifactRow(row)),
      };
    }),

    cancelRun: os.cancelRun.handler(async ({ input }) => {
      const runRow = await db
        .select()
        .from(schema.automationRuns)
        .where(eq(schema.automationRuns.id, input.id))
        .limit(1);
      const run = runRow[0];
      if (!run) {
        throw new ORPCError("NOT_FOUND", {
          message: `Run ${input.id} not found`,
        });
      }

      // Idempotent: a run already in a terminal state is a no-op.
      const terminal = new Set([
        "success",
        "failed",
        "cancelled",
        "skipped",
      ]);
      if (terminal.has(run.status)) {
        return { success: true };
      }

      const now = new Date();
      // Atomic: marking the run cancelled and tearing down its wait locks +
      // durable state must commit together. Without the transaction a failure
      // after the status update left the wait lock behind, so a later trigger
      // event could resume a run that is already marked cancelled.
      await db.transaction(async (tx) => {
        await tx
          .update(schema.automationRuns)
          .set({
            status: "cancelled",
            errorMessage: "Cancelled by operator",
            finishedAt: now,
          })
          .where(eq(schema.automationRuns.id, input.id));

        // Tear down any pending wait locks so a future trigger event
        // doesn't accidentally resume a cancelled run.
        await tx
          .delete(schema.automationWaitLocks)
          .where(eq(schema.automationWaitLocks.runId, input.id));

        // Drop the per-run durable state — cancellation is terminal.
        await tx
          .delete(schema.automationRunState)
          .where(eq(schema.automationRunState.runId, input.id));
      });

      await signalService.broadcast(AUTOMATION_RUN_COMPLETED, {
        runId: input.id,
        automationId: run.automationId,
        status: "cancelled",
      });

      logger.info(`Cancelled automation run ${input.id}`);
      return { success: true };
    }),

    // ─── Registry introspection ──────────────────────────────────────────

    listTriggers: os.listTriggers.handler(async () => {
      const items: TriggerInfo[] = triggerRegistry
        .getTriggers()
        .map((t) => ({
          qualifiedId: t.qualifiedId,
          displayName: t.displayName,
          description: t.description,
          category: t.category ?? "Uncategorized",
          ownerPluginId: t.ownerPluginId,
          payloadSchema: t.payloadJsonSchema,
          configSchema: t.configJsonSchema,
          contextKeyLabel: t.contextKeyLabel,
        }));
      return { items };
    }),

    listActions: os.listActions.handler(async () => {
      const items = actionRegistry.getActions().map((a) => ({
        qualifiedId: a.qualifiedId,
        displayName: a.displayName,
        description: a.description,
        category: a.category ?? "Uncategorized",
        ownerPluginId: a.ownerPluginId,
        configSchema: a.configJsonSchema,
        produces: a.produces,
        consumes: a.consumes ?? [],
        connectionProviderId: a.connectionProviderId,
        requiredAccessRules: a.requiredAccessRules ?? [],
      }));
      return { items };
    }),

    listArtifactTypes: os.listArtifactTypes.handler(async () => {
      const items = artifactTypeRegistry.getArtifactTypes().map((t) => ({
        qualifiedId: t.qualifiedId,
        displayName: t.displayName,
        description: t.description,
        ownerPluginId: t.ownerPluginId,
        schema: t.jsonSchema,
      }));
      return { items };
    }),

    // ─── Subscription-migration failures ────────────────────────────────

    listMigrationFailures: os.listMigrationFailures.handler(async () => {
      const rows = await db
        .select()
        .from(schema.automationMigrationFailures)
        .orderBy(desc(schema.automationMigrationFailures.createdAt));
      return {
        items: rows.map((row) => ({
          id: row.id,
          subscriptionId: row.subscriptionId,
          subscriptionName: row.subscriptionName,
          providerId: row.providerId,
          eventId: row.eventId,
          reason: row.reason,
          detail: row.detail ?? undefined,
          providerConfig: row.providerConfig,
          createdAt: row.createdAt,
        })),
      };
    }),

    acknowledgeMigrationFailure: os.acknowledgeMigrationFailure.handler(
      async ({ input }) => {
        const result = await db
          .delete(schema.automationMigrationFailures)
          .where(eq(schema.automationMigrationFailures.id, input.id))
          .returning({ id: schema.automationMigrationFailures.id });
        if (result.length === 0) {
          throw new ORPCError("NOT_FOUND", {
            message: `Migration failure ${input.id} not found`,
          });
        }
        logger.info(`Acknowledged migration failure ${input.id}`);
        return { success: true };
      },
    ),

    // ─── Inline script testing ───────────────────────────────────────────

    testScript: os.testScript.handler(async ({ input }) => {
      // Resolve the managed npm-package root from the local store so a test
      // resolves the same allowlisted packages the real `run_script` action
      // would (plan §4.1). Filesystem-only: ready when a tree is
      // materialized, else unset. Execution safety is the runner's
      // (auto-install disabled).
      const status = await resolveResolutionRootFromStore(
        resolveScriptPackagesDir(),
      );
      const resolutionRoot =
        status.mode === "ready" ? status.root : undefined;
      return runScriptTest({ input, deps: { resolutionRoot } });
    }),

    getRunScopeForReplay: os.getRunScopeForReplay.handler(async ({ input }) => {
      const runRow = await db
        .select()
        .from(schema.automationRuns)
        .where(eq(schema.automationRuns.id, input.runId))
        .limit(1);
      const run = runRow[0];
      if (!run) {
        throw new ORPCError("NOT_FOUND", {
          message: `Run ${input.runId} not found`,
        });
      }

      const [artifactRows, runState] = await Promise.all([
        db
          .select()
          .from(schema.automationArtifacts)
          .where(eq(schema.automationArtifacts.runId, input.runId))
          .orderBy(asc(schema.automationArtifacts.createdAt)),
        dispatchDeps.runStateStore.load(input.runId),
      ]);

      const context = buildReplayContext({
        run: {
          triggerEventId: run.triggerEventId,
          triggerPayload: run.triggerPayload,
        },
        artifacts: artifactRows.map((row) => ({
          artifactType: row.artifactType,
          actionId: row.actionId,
          data: row.data,
        })),
        scopeSnapshot: runState?.scopeSnapshot,
      });

      return { context, scopeSnapshotAvailable: runState !== undefined };
    }),

    // ─── Template playground ─────────────────────────────────────────────

    renderTemplate: os.renderTemplate.handler(async ({ input }) => {
      const filters = dispatchDeps.filters;
      try {
        if (input.mode === "condition") {
          const parsed = parseCondition(input.template);
          const booleanResult = evaluateBoolean(parsed, input.context, {
            filters,
          });
          return { success: true, booleanResult };
        }
        const parsed = parseTemplate(input.template);
        const output = render(parsed, input.context, { filters });
        return { success: true, output };
      } catch (error) {
        if (error instanceof TemplateError) {
          return {
            success: false,
            error: {
              message: error.message,
              line: error.range.start.line,
              column: error.range.start.column,
            },
          };
        }
        return {
          success: false,
          error: {
            message: extractErrorMessage(error, "Template error"),
            line: 1,
            column: 1,
          },
        };
      }
    }),
  });
}

export type AutomationRouter = ReturnType<typeof createAutomationRouter>;
