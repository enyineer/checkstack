import { z } from "zod";
import {
  createClientDefinition,
  PaginatedResult,
  PaginationInput,
  proc,
} from "@checkstack/common";
import { automationAccess, automationResourceTypes } from "./access";
import { pluginMetadata } from "./plugin-metadata";
import { AutomationTemplateSchema } from "./templates";
import {
  ReplayScopeInputSchema,
  ReplayScopeResultSchema,
  ScriptTestInputSchema,
  ScriptTestResultSchema,
} from "./script-test-schemas";
import {
  ActionInfoSchema,
  ArtifactTypeInfoSchema,
  AutomationArtifactSchema,
  AutomationRunSchema,
  AutomationRunStepSchema,
  AutomationGroupSchema,
  AutomationSchema,
  AutomationStatusSchema,
  CreateAutomationInputSchema,
  ListRunsInputSchema,
  ManualRunInputSchema,
  TriggerInfoSchema,
  UpdateAutomationInputSchema,
  ValidateDefinitionInputSchema,
  ValidateDefinitionResultSchema,
} from "./schemas";

/**
 * Automation RPC contract. Mirrors the integration-common pattern: each
 * procedure is built via `proc()` with `userType`, `operationType`, and
 * `access` metadata so `autoAuthMiddleware` enforces auth + access checks
 * automatically.
 *
 * Read operations require `automationAccess.read`. Anything that mutates
 * state, runs an automation, or returns potentially sensitive registry
 * metadata that gates editor UIs requires `automationAccess.manage`.
 */
export const automationContract = {
  // ─── Automations CRUD ──────────────────────────────────────────────────

  listAutomations: proc({
    operationType: "query",
    userType: "authenticated",
    access: [automationAccess.read],
    // PaginatedResult wraps items in `{ items: [...], total, limit, offset }`.
    // Each item has a string `.id` equal to the automation id used in grants
    // (resourceType "automation.automation", resourceId = automation.id).
    instanceAccess: { listKey: "items" },
  })
    .input(
      PaginationInput.extend({
        status: AutomationStatusSchema.optional(),
        group: AutomationGroupSchema.optional(),
      }),
    )
    .output(PaginatedResult(AutomationSchema)),

  /**
   * Distinct, non-null group values across all automations, sorted
   * alphabetically. Powers the edit-page group picker's "pick existing"
   * suggestions.
   */
  listAutomationGroups: proc({
    operationType: "query",
    userType: "authenticated",
    access: [automationAccess.read],
    // Utility list — returns distinct group name strings, no automation instance
    // to scope on. Reachable by any team-scoped automation manager editing their
    // automation, so gate by ANY automation grant (typeScoped), not the global rule.
    instanceAccess: { typeScoped: {} },
  }).output(z.object({ groups: z.array(z.string()) })),

  getAutomation: proc({
    operationType: "query",
    userType: "authenticated",
    access: [automationAccess.read],
    // Single-resource pre-check: grants are keyed per-automation id.
    instanceAccess: { idParam: "id" },
  })
    .input(z.object({ id: z.string() }))
    .output(AutomationSchema),

  /**
   * Curated example-automation templates contributed by core + plugins, for
   * the "create new automation" picker. Read-gated: viewing a starting point
   * is part of authoring and never creates anything on its own.
   */
  listAutomationTemplates: proc({
    operationType: "query",
    userType: "authenticated",
    access: [automationAccess.read],
    // Static template catalogue — no automation instance to scope on. A team
    // member who may CREATE automations opens the "new automation" picker, so
    // gate by ANY automation grant (creator included) rather than the global rule.
    instanceAccess: { typeScoped: {} },
  }).output(z.object({ items: z.array(AutomationTemplateSchema) })),

  createAutomation: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [automationAccess.manage],
    // CREATE mode: the middleware reads `input.teamId` to resolve the owning
    // team and, after the handler returns, writes an owning-team grant keyed
    // (resourceType="automation.automation", resourceId=<output.id>).
    // `idField: "id"` points to the top-level `id` on the AutomationSchema
    // output, which is the automation's UUID string.
    instanceAccess: { create: { teamIdParam: "teamId", idField: "id" } },
  })
    .input(CreateAutomationInputSchema)
    .output(AutomationSchema),

  updateAutomation: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [automationAccess.manage],
    // UpdateAutomationInputSchema has `.id` — the automation being updated.
    instanceAccess: { idParam: "id" },
  })
    .route({ method: "PATCH" })
    .input(UpdateAutomationInputSchema)
    .output(AutomationSchema),

  deleteAutomation: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [automationAccess.manage],
    // Single-resource pre-check: grants are keyed per-automation id.
    instanceAccess: { idParam: "id" },
  })
    .route({ method: "DELETE" })
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() })),

  toggleAutomation: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [automationAccess.manage],
    // Single-resource pre-check: grants are keyed per-automation id.
    instanceAccess: { idParam: "id" },
  })
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .output(AutomationSchema),

  // ─── Definition validation ─────────────────────────────────────────────

  validateDefinition: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [automationAccess.read],
    // Stateless validation utility — input is definition content, no automation
    // id. A team-scoped automation manager validates a draft in the editor, so
    // gate by ANY automation grant (typeScoped), not the global rule.
    instanceAccess: { typeScoped: {} },
  })
    .input(ValidateDefinitionInputSchema)
    .output(ValidateDefinitionResultSchema),

  // ─── Manual run ────────────────────────────────────────────────────────

  manualRun: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [automationAccess.manage],
    // ManualRunInputSchema has `.automationId` — the automation being run.
    // Pre-check ensures the caller has manage access to this specific automation.
    instanceAccess: { idParam: "automationId" },
  })
    .input(ManualRunInputSchema)
    .output(z.object({ runId: z.string() })),

  // ─── Runs / history ────────────────────────────────────────────────────

  listRuns: proc({
    operationType: "query",
    userType: "authenticated",
    access: [automationAccess.read],
    // Scope by the PARENT automation: a team-scoped user may list a given
    // automation's runs iff they can read that automation. When `automationId`
    // is omitted (cross-automation "all runs" view) parentScope fails closed for
    // team-scoped callers, so only a global-read holder sees every automation's runs.
    instanceAccess: {
      parentScope: {
        resourceType: automationResourceTypes.automation,
        action: "read",
        idParam: "automationId",
      },
    },
  })
    .input(ListRunsInputSchema)
    .output(PaginatedResult(AutomationRunSchema)),

  getRun: proc({
    operationType: "query",
    userType: "authenticated",
    access: [automationAccess.read],
    // Scope by the PARENT automation: the caller passes the owning `automationId`
    // (always in the run-detail URL), and the handler additionally filters the
    // run fetch by it, so a caller cannot read another automation's run by
    // pairing its run id with an automationId they happen to hold a grant on.
    instanceAccess: {
      parentScope: {
        resourceType: automationResourceTypes.automation,
        action: "read",
        idParam: "automationId",
      },
    },
  })
    .input(z.object({ id: z.string(), automationId: z.string() }))
    .output(
      z.object({
        run: AutomationRunSchema,
        steps: z.array(AutomationRunStepSchema),
        artifacts: z.array(AutomationArtifactSchema),
      }),
    ),

  cancelRun: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [automationAccess.manage],
    // Scope by the PARENT automation (MANAGE): the caller passes the owning
    // `automationId` and the handler filters the run fetch by it, so a caller
    // cannot cancel another automation's run by pairing its run id with an
    // automationId they hold a manage grant on.
    instanceAccess: {
      parentScope: {
        resourceType: automationResourceTypes.automation,
        action: "manage",
        idParam: "automationId",
      },
    },
  })
    .input(z.object({ id: z.string(), automationId: z.string() }))
    .output(z.object({ success: z.boolean() })),

  // ─── Registry introspection ────────────────────────────────────────────

  listTriggers: proc({
    operationType: "query",
    userType: "authenticated",
    access: [automationAccess.read],
    // Registry catalogue — no automation instance to scope on. Shown in the
    // editor, so gate by ANY automation grant (typeScoped), not the global rule.
    instanceAccess: { typeScoped: {} },
  }).output(z.object({ items: z.array(TriggerInfoSchema) })),

  listActions: proc({
    operationType: "query",
    userType: "authenticated",
    access: [automationAccess.read],
    // Registry catalogue — no automation instance to scope on. Shown in the
    // editor, so gate by ANY automation grant (typeScoped), not the global rule.
    instanceAccess: { typeScoped: {} },
  }).output(z.object({ items: z.array(ActionInfoSchema) })),

  listArtifactTypes: proc({
    operationType: "query",
    userType: "authenticated",
    access: [automationAccess.read],
    // Registry catalogue — no automation instance to scope on. Shown in the
    // editor, so gate by ANY automation grant (typeScoped), not the global rule.
    instanceAccess: { typeScoped: {} },
  }).output(z.object({ items: z.array(ArtifactTypeInfoSchema) })),

  // ─── Subscription-migration failures ──────────────────────────────────
  //
  // Surfaces every legacy `webhook_subscriptions` row the one-time
  // migration couldn't translate into an automation. Admins see the
  // list on boot, fix each one by hand (recreating it as an
  // automation), then acknowledge it to clear the entry.

  listMigrationFailures: proc({
    operationType: "query",
    userType: "authenticated",
    access: [automationAccess.manage],
    // Admin utility — output ids are migration-failure record ids, not automation ids.
    instanceAccess: { global: true },
  }).output(
    z.object({
      items: z.array(
        z.object({
          id: z.string(),
          subscriptionId: z.string(),
          subscriptionName: z.string(),
          providerId: z.string(),
          eventId: z.string(),
          reason: z.string(),
          detail: z.string().optional(),
          providerConfig: z.record(z.string(), z.unknown()),
          createdAt: z.coerce.date(),
        }),
      ),
    }),
  ),

  acknowledgeMigrationFailure: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [automationAccess.manage],
    // input.id is a migration-failure record id, not an automation id.
    instanceAccess: { global: true },
  })
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() })),

  // ─── Inline script testing ─────────────────────────────────────────────

  /**
   * Run a `run_script` (TypeScript) or `run_shell` (shell) script against
   * an editable sample context, using the same sandboxed runner the real
   * action uses. Lets operators test a script directly in the editor
   * without dispatching a whole automation.
   *
   * Gated by `manage` because authoring + running a script already
   * executes code on the central backend — this is the same privilege.
   * The run is time-bounded and always central (real satellite runs may
   * differ; the UI notes this).
   */
  testScript: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [automationAccess.manage],
    // Stateless sandboxed code execution — not tied to a specific automation id.
    // A team-scoped automation manager tests a script in the editor; authoring +
    // running a script is the same privilege, so gate by MANAGE capability on the
    // automation type (typeScoped manage), not the global rule.
    instanceAccess: { typeScoped: { action: "manage" } },
  })
    .input(ScriptTestInputSchema)
    .output(ScriptTestResultSchema),

  /**
   * Reconstruct an editable test context from a real automation run, so an
   * operator can replay a script against the data that run saw. Reads run
   * data only (trigger + persisted artifacts, plus the durable scope
   * snapshot when the run is still in-flight), so it's gated by `read`.
   */
  getRunScopeForReplay: proc({
    operationType: "query",
    userType: "authenticated",
    access: [automationAccess.read],
    // Scope by the PARENT automation: the caller passes the owning `automationId`
    // (the editor knows it) and the handler filters the run fetch by it, so a
    // caller cannot read another automation's run scope via a run id it does not own.
    instanceAccess: {
      parentScope: {
        resourceType: automationResourceTypes.automation,
        action: "read",
        idParam: "automationId",
      },
    },
  })
    .input(ReplayScopeInputSchema)
    .output(ReplayScopeResultSchema),

  // ─── Template playground ───────────────────────────────────────────────

  /**
   * Render a template (or evaluate a condition) against a sample context.
   * Used by the playground page and the inline preview in the editor.
   */
  renderTemplate: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [automationAccess.read],
    // Stateless template rendering utility — no automation id in input. Used by
    // the editor's inline preview + playground, so gate by ANY automation grant
    // (typeScoped), not the global rule.
    instanceAccess: { typeScoped: {} },
  })
    .input(
      z.object({
        template: z.string(),
        context: z.record(z.string(), z.unknown()).default({}),
        mode: z.enum(["template", "condition"]).default("template"),
      }),
    )
    .output(
      z.object({
        success: z.boolean(),
        output: z.string().optional(),
        booleanResult: z.boolean().optional(),
        error: z
          .object({
            message: z.string(),
            line: z.number(),
            column: z.number(),
          })
          .optional(),
      }),
    ),
};

export type AutomationContract = typeof automationContract;

/**
 * Client definition for typed `rpcApi.forPlugin(AutomationApi)` calls
 * from the frontend.
 */
export const AutomationApi = createClientDefinition(
  automationContract,
  pluginMetadata,
);
