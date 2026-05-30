/**
 * Router behaviour tests.
 *
 * Each handler is exercised via oRPC's `call()` test helper so the
 * contract's middleware (auth, access checks, input coercion) runs the
 * same way it does in production.
 *
 * For DB-backed handlers (`listRuns`, `getRun`, `cancelRun`) we stub the
 * drizzle chain just enough to satisfy the call shape. The richer
 * round-trip behaviour is covered by integration tests against a real DB
 * via the dispatch engine tests.
 */
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { z } from "zod";
import { call } from "@orpc/server";
import {
  createHook,
  createMockRpcContext,
  Versioned,
  type RpcContext,
} from "@checkstack/backend-api";
import {
  AUTOMATION_DEFINITION_CHANGED,
  AUTOMATION_RUN_COMPLETED,
  type Automation,
  type AutomationDefinition,
  type CreateAutomationInput,
  type UpdateAutomationInput,
} from "@checkstack/automation-common";
import {
  createMockSignalService,
  type MockSignalService,
} from "@checkstack/test-utils-backend";

import {
  createActionRegistry,
  type ActionRegistry,
} from "./action-registry";
import {
  createArtifactTypeRegistry,
  type ArtifactTypeRegistry,
} from "./artifact-type-registry";
import {
  createTriggerRegistry,
  type TriggerRegistry,
} from "./trigger-registry";
import type {
  ActionDefinition,
  ArtifactTypeDefinition,
  TriggerDefinition,
} from "./action-types";
import type { AutomationStore } from "./automation-store";
import { createAutomationRouter, type AutomationRouter } from "./router";
import { makeDispatchDeps } from "./dispatch/test-fixtures";

// ─── Test plugin metadata ────────────────────────────────────────────────

const testPlugin = { pluginId: "test" } as const;

// ─── Sample fixtures ─────────────────────────────────────────────────────

const samplePayloadSchema = z.object({ incidentId: z.string() });
const sampleHook = createHook<{ incidentId: string }>("incident.created");

const sampleTrigger: TriggerDefinition<{ incidentId: string }> = {
  id: "incident.created",
  displayName: "Incident Created",
  category: "Incidents",
  payloadSchema: samplePayloadSchema,
  hook: sampleHook,
  contextKey: (p) => p.incidentId,
};

const sampleAction: ActionDefinition<{ message: string }, { id: string }> = {
  id: "noop",
  displayName: "No-op",
  category: "Test",
  config: new Versioned({
    version: 1,
    schema: z.object({ message: z.string() }),
  }),
  // Local artifact id; the registry qualifies it to `test.thing`.
  produces: "thing",
  execute: async () => ({ success: true, artifact: { id: "x" } }),
};

const sampleArtifactType: ArtifactTypeDefinition<{ id: string }> = {
  id: "thing",
  displayName: "Thing",
  description: "A test artifact",
  schema: z.object({ id: z.string() }),
};

const sampleDefinition: AutomationDefinition = {
  name: "Sample",
  triggers: [{ id: "fire", event: "test.incident.created" }],
  conditions: [],
  actions: [],
  mode: "single",
  max_runs: 10,
};

// ─── In-memory automation store ──────────────────────────────────────────

function createInMemoryAutomationStore(): {
  store: AutomationStore;
  rows: Map<string, Automation>;
} {
  const rows = new Map<string, Automation>();
  let counter = 0;
  const now = () => new Date();

  const store: AutomationStore = {
    async create(input: CreateAutomationInput) {
      const id = `auto-${++counter}`;
      const automation: Automation = {
        id,
        name: input.name,
        description: input.description,
        status: input.status,
        definition: input.definition,
        createdAt: now(),
        updatedAt: now(),
      };
      rows.set(id, automation);
      return automation;
    },
    async update(input: UpdateAutomationInput) {
      const existing = rows.get(input.id);
      if (!existing) throw new Error(`Automation ${input.id} not found`);
      const next: Automation = {
        ...existing,
        name: input.name ?? existing.name,
        description: input.description ?? existing.description,
        status: input.status ?? existing.status,
        definition: input.definition ?? existing.definition,
        updatedAt: now(),
      };
      rows.set(input.id, next);
      return next;
    },
    async delete(id) {
      rows.delete(id);
    },
    async toggle(id, enabled) {
      const existing = rows.get(id);
      if (!existing) throw new Error(`Automation ${id} not found`);
      const next: Automation = {
        ...existing,
        status: enabled ? "enabled" : "disabled",
        updatedAt: now(),
      };
      rows.set(id, next);
      return next;
    },
    async getById(id) {
      return rows.get(id);
    },
    async list(filter) {
      const limit = filter?.limit ?? 50;
      const offset = filter?.offset ?? 0;
      const all = [...rows.values()].filter(
        (a) => !filter?.status || a.status === filter.status,
      );
      return {
        items: all.slice(offset, offset + limit),
        total: all.length,
      };
    },
    async findEnabledByTriggerEvent() {
      return [];
    },
    async listEnabled() {
      return [];
    },
  };

  return { store, rows };
}

// ─── Fluent drizzle-chain mock helpers ───────────────────────────────────

/**
 * Build a fluent stub for a `db.select().from(...).where(...).orderBy().limit().offset()`
 * chain. The terminal call resolves to `rows`. Suitable for both the
 * `await` form and the `.limit/.orderBy/...` chained form.
 */
interface FluentSelectTail extends Promise<unknown[]> {
  where: ReturnType<typeof mock>;
  orderBy: ReturnType<typeof mock>;
  limit: ReturnType<typeof mock>;
  offset: ReturnType<typeof mock>;
}

function fluentSelect(rows: unknown[]) {
  const terminal = Promise.resolve(rows);
  const tail: FluentSelectTail = Object.assign(terminal, {
    where: mock(() => tail),
    orderBy: mock(() => tail),
    limit: mock(() => tail),
    offset: mock(() => tail),
  });
  return {
    from: mock(() => tail),
  };
}

function fluentInsertReturning(row: unknown) {
  return {
    values: mock(() => ({
      returning: mock(() => Promise.resolve([row])),
    })),
  };
}

function fluentUpdate() {
  return {
    set: mock(() => ({
      where: mock(() => Promise.resolve()),
    })),
  };
}

function fluentDelete() {
  return {
    where: mock(() => Promise.resolve()),
  };
}

// ─── Shared per-test deps ─────────────────────────────────────────────────

interface RouterHarness {
  router: AutomationRouter;
  context: RpcContext;
  automationStore: AutomationStore;
  triggerRegistry: TriggerRegistry;
  actionRegistry: ActionRegistry;
  artifactTypeRegistry: ArtifactTypeRegistry;
  signalService: MockSignalService;
  automationRows: Map<string, Automation>;
  db: ReturnType<typeof createMockDbForRouter>;
  dispatchDeps: ReturnType<typeof makeDispatchDeps>["deps"];
}

function createMockDbForRouter() {
  return {
    select: mock(() => fluentSelect([])),
    insert: mock(() => fluentInsertReturning(undefined)),
    update: mock(() => fluentUpdate()),
    delete: mock(() => fluentDelete()),
  };
}

function makeRouter(): RouterHarness {
  const { store: automationStore, rows: automationRows } =
    createInMemoryAutomationStore();

  const triggerRegistry = createTriggerRegistry();
  triggerRegistry.register(sampleTrigger, testPlugin);

  const actionRegistry = createActionRegistry();
  actionRegistry.register(sampleAction, testPlugin);

  const artifactTypeRegistry = createArtifactTypeRegistry();
  artifactTypeRegistry.register(sampleArtifactType, testPlugin);

  const signalService = createMockSignalService();
  const db = createMockDbForRouter();

  const { deps: dispatchDeps } = makeDispatchDeps({
    actions: actionRegistry,
    artifactTypes: artifactTypeRegistry,
    triggers: triggerRegistry,
  });

  const router = createAutomationRouter({
    db: db as never,
    automationStore,
    triggerRegistry,
    actionRegistry,
    artifactTypeRegistry,
    dispatchDeps,
    signalService,
    logger: dispatchDeps.logger,
  });

  const context = createMockRpcContext();

  return {
    router,
    context,
    automationStore,
    triggerRegistry,
    actionRegistry,
    artifactTypeRegistry,
    signalService,
    automationRows,
    db,
    dispatchDeps,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("Automation Router", () => {
  let h: RouterHarness;
  beforeEach(() => {
    h = makeRouter();
  });

  // ─── CRUD ──────────────────────────────────────────────────────────────

  describe("listAutomations", () => {
    it("paginates the in-memory store and returns total", async () => {
      await h.automationStore.create({
        name: "A",
        status: "enabled",
        definition: sampleDefinition,
      });
      await h.automationStore.create({
        name: "B",
        status: "disabled",
        definition: sampleDefinition,
      });
      const res = await call(
        h.router.listAutomations,
        { limit: 50, offset: 0 },
        { context: h.context },
      );
      expect(res.total).toBe(2);
      expect(res.items).toHaveLength(2);
    });

    it("filters by status", async () => {
      await h.automationStore.create({
        name: "A",
        status: "enabled",
        definition: sampleDefinition,
      });
      await h.automationStore.create({
        name: "B",
        status: "disabled",
        definition: sampleDefinition,
      });
      const res = await call(
        h.router.listAutomations,
        { limit: 50, offset: 0, status: "enabled" },
        { context: h.context },
      );
      expect(res.total).toBe(1);
      expect(res.items[0]?.name).toBe("A");
    });
  });

  describe("getAutomation", () => {
    it("returns the row by id", async () => {
      const created = await h.automationStore.create({
        name: "A",
        status: "enabled",
        definition: sampleDefinition,
      });
      const res = await call(
        h.router.getAutomation,
        { id: created.id },
        { context: h.context },
      );
      expect(res.id).toBe(created.id);
    });

    it("404s on unknown id", async () => {
      await expect(
        call(
          h.router.getAutomation,
          { id: "missing" },
          { context: h.context },
        ),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe("createAutomation", () => {
    it("persists and broadcasts a `created` signal", async () => {
      const res = await call(
        h.router.createAutomation,
        {
          name: "New",
          status: "enabled",
          definition: sampleDefinition,
        },
        { context: h.context },
      );
      expect(res.name).toBe("New");
      expect(h.signalService.wasSignalEmitted(AUTOMATION_DEFINITION_CHANGED.id)).toBe(
        true,
      );
      const emitted = h.signalService.getRecordedSignalsById(
        AUTOMATION_DEFINITION_CHANGED.id,
      );
      expect(emitted[0]?.payload).toMatchObject({
        action: "created",
        automationId: res.id,
      });
    });
  });

  describe("updateAutomation", () => {
    it("updates and broadcasts an `updated` signal", async () => {
      const created = await h.automationStore.create({
        name: "Old",
        status: "enabled",
        definition: sampleDefinition,
      });
      const res = await call(
        h.router.updateAutomation,
        { id: created.id, name: "New" },
        { context: h.context },
      );
      expect(res.name).toBe("New");
      expect(
        h.signalService
          .getRecordedSignalsById(AUTOMATION_DEFINITION_CHANGED.id)[0]
          ?.payload,
      ).toMatchObject({ action: "updated", automationId: created.id });
    });

    it("404s when the automation does not exist", async () => {
      await expect(
        call(
          h.router.updateAutomation,
          { id: "missing", name: "Whatever" },
          { context: h.context },
        ),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe("deleteAutomation", () => {
    it("removes the row and broadcasts a `deleted` signal", async () => {
      const created = await h.automationStore.create({
        name: "Doomed",
        status: "enabled",
        definition: sampleDefinition,
      });
      const res = await call(
        h.router.deleteAutomation,
        { id: created.id },
        { context: h.context },
      );
      expect(res.success).toBe(true);
      expect(await h.automationStore.getById(created.id)).toBeUndefined();
      expect(
        h.signalService
          .getRecordedSignalsById(AUTOMATION_DEFINITION_CHANGED.id)[0]
          ?.payload,
      ).toMatchObject({ action: "deleted", automationId: created.id });
    });

    it("404s when missing", async () => {
      await expect(
        call(
          h.router.deleteAutomation,
          { id: "missing" },
          { context: h.context },
        ),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe("toggleAutomation", () => {
    it("disables an enabled row", async () => {
      const created = await h.automationStore.create({
        name: "X",
        status: "enabled",
        definition: sampleDefinition,
      });
      const res = await call(
        h.router.toggleAutomation,
        { id: created.id, enabled: false },
        { context: h.context },
      );
      expect(res.status).toBe("disabled");
    });
  });

  // ─── Definition validation ───────────────────────────────────────────

  describe("validateDefinition", () => {
    it("returns valid: true for a well-formed definition", async () => {
      const res = await call(
        h.router.validateDefinition,
        { definition: sampleDefinition },
        { context: h.context },
      );
      expect(res.valid).toBe(true);
      expect(res.errors).toEqual([]);
    });

    it("returns issues for an invalid definition", async () => {
      const res = await call(
        h.router.validateDefinition,
        { definition: { name: "", triggers: [] } },
        { context: h.context },
      );
      expect(res.valid).toBe(false);
      expect(res.errors.length).toBeGreaterThan(0);
      // every error should carry path + message
      for (const err of res.errors) {
        expect(typeof err.message).toBe("string");
        expect(Array.isArray(err.path)).toBe(true);
      }
    });
  });

  // ─── Registry introspection ─────────────────────────────────────────

  describe("listTriggers", () => {
    it("returns the registered triggers with payload schemas", async () => {
      const res = await call(
        h.router.listTriggers,
        {},
        { context: h.context },
      );
      expect(res.items).toHaveLength(1);
      expect(res.items[0]?.qualifiedId).toBe("test.incident.created");
      expect(res.items[0]?.payloadSchema).toBeDefined();
    });
  });

  describe("listActions", () => {
    it("returns the registered actions with `produces` propagated", async () => {
      const res = await call(
        h.router.listActions,
        {},
        { context: h.context },
      );
      expect(res.items).toHaveLength(1);
      expect(res.items[0]?.produces).toBe("test.thing");
      expect(res.items[0]?.consumes).toEqual([]);
    });
  });

  describe("listArtifactTypes", () => {
    it("returns the registered artifact types", async () => {
      const res = await call(
        h.router.listArtifactTypes,
        {},
        { context: h.context },
      );
      expect(res.items).toHaveLength(1);
      expect(res.items[0]?.qualifiedId).toBe("test.thing");
    });
  });

  // ─── manualRun ───────────────────────────────────────────────────────

  describe("manualRun", () => {
    it("404s on missing automation", async () => {
      await expect(
        call(
          h.router.manualRun,
          { automationId: "missing", payload: {} },
          { context: h.context },
        ),
      ).rejects.toThrow(/not found/i);
    });

    it("400s when no trigger matches", async () => {
      const created = await h.automationStore.create({
        name: "X",
        status: "enabled",
        definition: sampleDefinition,
      });
      await expect(
        call(
          h.router.manualRun,
          {
            automationId: created.id,
            triggerId: "does-not-exist",
            payload: {},
          },
          { context: h.context },
        ),
      ).rejects.toThrow(/Trigger does-not-exist not found/);
    });

    it("dispatches with the first trigger when none specified", async () => {
      const created = await h.automationStore.create({
        name: "X",
        status: "enabled",
        definition: sampleDefinition,
      });
      const res = await call(
        h.router.manualRun,
        {
          automationId: created.id,
          payload: { incidentId: "INC-1" },
        },
        { context: h.context },
      );
      expect(res.runId).toMatch(/^run-/);
      // run-completed signal fires once the dispatch returns
      expect(
        h.signalService.wasSignalEmitted(AUTOMATION_RUN_COMPLETED.id),
      ).toBe(true);
    });
  });

  // ─── cancelRun ───────────────────────────────────────────────────────

  describe("cancelRun", () => {
    it("404s when the run does not exist", async () => {
      h.db.select.mockReturnValueOnce(fluentSelect([]) as never);
      await expect(
        call(h.router.cancelRun, { id: "missing" }, { context: h.context }),
      ).rejects.toThrow(/not found/i);
    });

    it("is idempotent for runs already in a terminal state", async () => {
      h.db.select.mockReturnValueOnce(
        fluentSelect([
          {
            id: "r1",
            automationId: "a1",
            triggerId: "t",
            triggerEventId: "e",
            triggerPayload: {},
            contextKey: null,
            status: "success",
            errorMessage: null,
            startedAt: new Date(),
            finishedAt: new Date(),
          },
        ]) as never,
      );
      const res = await call(
        h.router.cancelRun,
        { id: "r1" },
        { context: h.context },
      );
      expect(res.success).toBe(true);
      // no update / delete because already terminal
      expect(h.db.update).not.toHaveBeenCalled();
      expect(h.db.delete).not.toHaveBeenCalled();
    });

    it("cancels a running run, tears down wait locks + state, and broadcasts", async () => {
      h.db.select.mockReturnValueOnce(
        fluentSelect([
          {
            id: "r1",
            automationId: "a1",
            triggerId: "t",
            triggerEventId: "e",
            triggerPayload: {},
            contextKey: null,
            status: "running",
            errorMessage: null,
            startedAt: new Date(),
            finishedAt: null,
          },
        ]) as never,
      );
      const res = await call(
        h.router.cancelRun,
        { id: "r1" },
        { context: h.context },
      );
      expect(res.success).toBe(true);
      expect(h.db.update).toHaveBeenCalled();
      expect(h.db.delete).toHaveBeenCalledTimes(2); // wait locks + run state
      expect(
        h.signalService
          .getRecordedSignalsById(AUTOMATION_RUN_COMPLETED.id)[0]
          ?.payload,
      ).toMatchObject({ runId: "r1", status: "cancelled" });
    });
  });

  // ─── renderTemplate ──────────────────────────────────────────────────

  describe("renderTemplate", () => {
    it("renders a template with the provided context", async () => {
      const res = await call(
        h.router.renderTemplate,
        {
          template: "Hello {{ name }}!",
          context: { name: "world" },
          mode: "template",
        },
        { context: h.context },
      );
      expect(res.success).toBe(true);
      expect(res.output).toBe("Hello world!");
    });

    it("evaluates a condition", async () => {
      const res = await call(
        h.router.renderTemplate,
        {
          template: "x > 0",
          context: { x: 5 },
          mode: "condition",
        },
        { context: h.context },
      );
      expect(res.success).toBe(true);
      expect(res.booleanResult).toBe(true);
    });

    it("returns parse errors with line / column", async () => {
      const res = await call(
        h.router.renderTemplate,
        {
          template: "Hello {{ name",
          context: {},
          mode: "template",
        },
        { context: h.context },
      );
      expect(res.success).toBe(false);
      expect(res.error?.message).toBeDefined();
      expect(typeof res.error?.line).toBe("number");
      expect(typeof res.error?.column).toBe("number");
    });
  });

  describe("testScript", () => {
    it("runs a shell script against the flattened sample context", async () => {
      const res = await call(
        h.router.testScript,
        {
          kind: "shell",
          script: 'echo "$CHECKSTACK_TRIGGER_PAYLOAD_ID"',
          context: { trigger: { event: "incident.created", payload: { id: "INC-7" } } },
          timeoutMs: 10_000,
        },
        { context: h.context },
      );
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toBe("INC-7");
      expect(res.error).toBeUndefined();
      expect(res.timedOut).toBe(false);
    });

    it("surfaces a non-zero shell exit code as an error", async () => {
      const res = await call(
        h.router.testScript,
        { kind: "shell", script: "exit 3", timeoutMs: 10_000 },
        { context: h.context },
      );
      expect(res.exitCode).toBe(3);
      expect(res.error).toContain("exited with code 3");
    });

    it("runs a typescript script and returns its default export", async () => {
      const res = await call(
        h.router.testScript,
        {
          kind: "typescript",
          script: "export default { ok: context.trigger.payload.id };",
          context: { trigger: { event: "e", payload: { id: "INC-9" } } },
          timeoutMs: 10_000,
        },
        { context: h.context },
      );
      expect(res.result).toEqual({ ok: "INC-9" });
      expect(res.error).toBeUndefined();
    });
  });

  describe("getRunScopeForReplay", () => {
    it("reconstructs trigger + artifacts and reports snapshot availability", async () => {
      // First select() → the run row; second select() → artifact rows.
      const runRow = {
        id: "run-1",
        triggerEventId: "incident.incident.created",
        triggerPayload: { id: "INC-7" },
      };
      const artifactRows = [
        { artifactType: "jira.issue", actionId: "j", data: { key: "P-1" } },
      ];
      h.db.select = mock(() => fluentSelect([runRow]))
        .mockImplementationOnce(() => fluentSelect([runRow]))
        .mockImplementationOnce(() => fluentSelect(artifactRows));
      h.dispatchDeps.runStateStore.load = mock(async () => ({
        scopeSnapshot: { vars: { count: 2 } },
        lastActionPath: null,
        lastHeartbeatAt: new Date(),
      }));

      const res = await call(
        h.router.getRunScopeForReplay,
        { runId: "run-1" },
        { context: h.context },
      );

      expect(res.context.trigger).toEqual({
        event: "incident.incident.created",
        payload: { id: "INC-7" },
      });
      expect(res.context.artifacts).toEqual({
        "jira.issue": { key: "P-1" },
        j: { key: "P-1" },
      });
      expect(res.context.var).toEqual({ count: 2 });
      expect(res.scopeSnapshotAvailable).toBe(true);
    });

    it("reports scopeSnapshotAvailable=false when the run state is cleared", async () => {
      const runRow = {
        id: "run-2",
        triggerEventId: "e",
        triggerPayload: {},
      };
      h.db.select = mock(() => fluentSelect([runRow]))
        .mockImplementationOnce(() => fluentSelect([runRow]))
        .mockImplementationOnce(() => fluentSelect([]));
      h.dispatchDeps.runStateStore.load = mock(async () => undefined);

      const res = await call(
        h.router.getRunScopeForReplay,
        { runId: "run-2" },
        { context: h.context },
      );
      expect(res.scopeSnapshotAvailable).toBe(false);
      expect(res.context.var).toEqual({});
    });

    it("404s on an unknown run id", async () => {
      h.db.select = mock(() => fluentSelect([]));
      await expect(
        call(
          h.router.getRunScopeForReplay,
          { runId: "missing" },
          { context: h.context },
        ),
      ).rejects.toThrow(/not found/i);
    });
  });
});
