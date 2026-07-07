/**
 * Integration test for the automation run handlers' anti-spoof scoping against
 * a REAL Postgres. `getRun`, `cancelRun`, and `getRunScopeForReplay` are
 * authorized with `parentScope` by `automationId`, so the caller proves a grant
 * on the PARENT automation. Each handler MUST additionally scope its
 * `automation_runs` query by that automationId (`WHERE id AND automationId`), or
 * a caller could pair a run id belonging to automation A with an automation B
 * they manage and read/cancel A's run (an IDOR).
 *
 * These tests drive the ACTUAL handlers (via oRPC `call()`) against a real db,
 * proving the scoping holds at the SQL layer: a mismatched automationId yields
 * NOT_FOUND (the run is invisible), while a matched pair succeeds. The mocked-DB
 * unit tests in router.test.ts cannot exercise the real WHERE clause.
 *
 * Gated on CHECKSTACK_IT so it runs in CI (shared compose Postgres) and is
 * skipped in the default `bun test` run, matching the other *.it.test.ts here.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { call } from "@orpc/server";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  createMockRpcContext,
  type RpcClient,
  type SafeDatabase,
} from "@checkstack/backend-api";
import { createMockSignalService } from "@checkstack/test-utils-backend";
import type {
  Automation,
  CreateAutomationInput,
  UpdateAutomationInput,
} from "@checkstack/automation-common";
import * as schema from "./schema";
import { createActionRegistry } from "./action-registry";
import { createArtifactTypeRegistry } from "./artifact-type-registry";
import { createTriggerRegistry } from "./trigger-registry";
import { createAutomationTemplateRegistry } from "./template-registry";
import type { AutomationStore } from "./automation-store";
import { createAutomationRouter } from "./router";
import { makeDispatchDeps } from "./dispatch/test-fixtures";

const PG_URL =
  process.env.CHECKSTACK_IT_PG_URL ??
  "postgres://postgres:postgres@localhost:5432/postgres";
const SCHEMA = "automation_it_runscope";

const AUTOMATION_A = "auto-a";
const AUTOMATION_B = "auto-b";

let admin: Pool;
let pool: Pool;
let router: ReturnType<typeof createAutomationRouter>;
const context = createMockRpcContext();

// The run handlers never touch the automation store; a stub that throws on
// every method is a faithful "not used here" (an always-throwing async fn is
// assignable to each method's Promise return type, so no cast is needed).
const unusedStore: AutomationStore = {
  create: async (_input: CreateAutomationInput) => {
    throw new Error("automationStore.create is not used by run handlers");
  },
  update: async (_input: UpdateAutomationInput) => {
    throw new Error("automationStore.update is not used by run handlers");
  },
  delete: async () => {
    throw new Error("automationStore.delete is not used by run handlers");
  },
  toggle: async () => {
    throw new Error("automationStore.toggle is not used by run handlers");
  },
  getById: async () => {
    throw new Error("automationStore.getById is not used by run handlers");
  },
  list: async () => {
    throw new Error("automationStore.list is not used by run handlers");
  },
  listGroups: async () => {
    throw new Error("automationStore.listGroups is not used by run handlers");
  },
  findEnabledByTriggerEvent: async () => {
    throw new Error("not used by run handlers");
  },
  listEnabled: async () => {
    throw new Error("automationStore.listEnabled is not used by run handlers");
  },
};

async function insertRun(row: {
  id: string;
  automationId: string;
  status?: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO "${SCHEMA}".automation_runs
       (id, automation_id, trigger_id, trigger_event_id, trigger_payload, status)
     VALUES ($1, $2, 'incident.created', 'incident.incident.created', '{}'::jsonb, $3)`,
    [row.id, row.automationId, row.status ?? "success"],
  );
}

async function runStatus(id: string): Promise<string | undefined> {
  const res = await pool.query(
    `SELECT status FROM "${SCHEMA}".automation_runs WHERE id = $1`,
    [id],
  );
  return res.rows[0]?.status;
}

describe.skipIf(!process.env.CHECKSTACK_IT)(
  "Automation run handlers anti-spoof scoping (shared Postgres)",
  () => {
    beforeAll(async () => {
      admin = new Pool({ connectionString: PG_URL });
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
      // Only the tables the run handlers query directly are created; FKs are
      // omitted so the DDL stays focused on the WHERE-clause behavior.
      await admin.query(
        `CREATE TABLE "${SCHEMA}".automation_runs (
          id text PRIMARY KEY,
          automation_id text NOT NULL,
          trigger_id text NOT NULL,
          trigger_event_id text NOT NULL,
          trigger_payload jsonb NOT NULL,
          context_key text,
          status text NOT NULL DEFAULT 'pending',
          error_message text,
          started_at timestamp NOT NULL DEFAULT now(),
          finished_at timestamp
        )`,
      );
      await admin.query(
        `CREATE TABLE "${SCHEMA}".automation_run_steps (
          id text PRIMARY KEY,
          run_id text NOT NULL,
          action_path text NOT NULL,
          action_id text,
          action_kind text NOT NULL,
          provider_action_id text,
          status text NOT NULL DEFAULT 'pending',
          attempts integer NOT NULL DEFAULT 0,
          error_message text,
          result_payload jsonb,
          started_at timestamp NOT NULL DEFAULT now(),
          finished_at timestamp
        )`,
      );
      await admin.query(
        `CREATE TABLE "${SCHEMA}".automation_artifacts (
          id text PRIMARY KEY,
          automation_id text NOT NULL,
          run_id text NOT NULL,
          step_id text NOT NULL,
          action_id text,
          artifact_type text NOT NULL,
          data jsonb NOT NULL,
          context_key text,
          closed_at timestamp,
          created_at timestamp NOT NULL DEFAULT now()
        )`,
      );
      await admin.query(
        `CREATE TABLE "${SCHEMA}".automation_wait_locks (
          id text PRIMARY KEY,
          run_id text NOT NULL,
          action_path text NOT NULL,
          kind text NOT NULL DEFAULT 'trigger',
          event_id text NOT NULL,
          context_key text,
          filter_template text,
          wait_config jsonb,
          timeout_at timestamp,
          created_at timestamp NOT NULL DEFAULT now()
        )`,
      );
      await admin.query(
        `CREATE TABLE "${SCHEMA}".automation_run_state (
          run_id text PRIMARY KEY,
          scope_snapshot jsonb NOT NULL,
          last_action_path text,
          last_heartbeat_at timestamp NOT NULL DEFAULT now(),
          updated_at timestamp NOT NULL DEFAULT now()
        )`,
      );

      pool = new Pool({
        connectionString: PG_URL,
        options: `-c search_path=${SCHEMA}`,
      });
      const db = drizzle(pool, {
        schema,
      }) as unknown as SafeDatabase<typeof schema>;

      const { deps: dispatchDeps } = makeDispatchDeps();
      router = createAutomationRouter({
        db,
        automationStore: unusedStore,
        triggerRegistry: createTriggerRegistry(),
        actionRegistry: createActionRegistry(),
        artifactTypeRegistry: createArtifactTypeRegistry(),
        templateRegistry: createAutomationTemplateRegistry(),
        dispatchDeps,
        signalService: createMockSignalService(),
        logger: dispatchDeps.logger,
        // Only used by the runAs bind-authority check, which the run handlers
        // never invoke; the same minimal stub the unit test uses.
        rpcClient: {
          forPlugin: () => ({
            enrichApplicationPrincipal: async () => undefined,
          }),
        } as unknown as RpcClient,
      });
    });

    afterAll(async () => {
      await pool?.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.end();
    });

    beforeEach(async () => {
      await pool.query(
        `TRUNCATE "${SCHEMA}".automation_runs,
                 "${SCHEMA}".automation_run_steps,
                 "${SCHEMA}".automation_artifacts,
                 "${SCHEMA}".automation_wait_locks,
                 "${SCHEMA}".automation_run_state`,
      );
    });

    // ─── getRun ──────────────────────────────────────────────────────────

    it("getRun returns the run when the automationId matches", async () => {
      await insertRun({ id: "run-1", automationId: AUTOMATION_A });

      const res = await call(
        router.getRun,
        { id: "run-1", automationId: AUTOMATION_A },
        { context },
      );
      expect(res.run.id).toBe("run-1");
      expect(res.run.automationId).toBe(AUTOMATION_A);
    });

    it("getRun is NOT_FOUND when the automationId does not own the run", async () => {
      // Run belongs to A; caller is authorized against B (a foreign automation
      // they manage). The spoofed pair must not reveal the run.
      await insertRun({ id: "run-1", automationId: AUTOMATION_A });

      await expect(
        call(
          router.getRun,
          { id: "run-1", automationId: AUTOMATION_B },
          { context },
        ),
      ).rejects.toThrow(/not found/i);
    });

    // ─── cancelRun ───────────────────────────────────────────────────────

    it("cancelRun cancels the run when the automationId matches", async () => {
      await insertRun({
        id: "run-1",
        automationId: AUTOMATION_A,
        status: "running",
      });

      const res = await call(
        router.cancelRun,
        { id: "run-1", automationId: AUTOMATION_A },
        { context },
      );
      expect(res.success).toBe(true);
      expect(await runStatus("run-1")).toBe("cancelled");
    });

    it("cancelRun is NOT_FOUND and leaves the run untouched on a foreign automationId", async () => {
      await insertRun({
        id: "run-1",
        automationId: AUTOMATION_A,
        status: "running",
      });

      await expect(
        call(
          router.cancelRun,
          { id: "run-1", automationId: AUTOMATION_B },
          { context },
        ),
      ).rejects.toThrow(/not found/i);
      // The run was NOT cancelled by the spoofed call.
      expect(await runStatus("run-1")).toBe("running");
    });

    // ─── getRunScopeForReplay ────────────────────────────────────────────

    it("getRunScopeForReplay resolves when the automationId matches", async () => {
      await insertRun({ id: "run-1", automationId: AUTOMATION_A });

      const res = await call(
        router.getRunScopeForReplay,
        { runId: "run-1", automationId: AUTOMATION_A },
        { context },
      );
      // The scope object is returned (shape is handler-defined; presence proves
      // the run was resolved under the matching automationId).
      expect(res).toBeDefined();
    });

    it("getRunScopeForReplay is NOT_FOUND on a foreign automationId", async () => {
      await insertRun({ id: "run-1", automationId: AUTOMATION_A });

      await expect(
        call(
          router.getRunScopeForReplay,
          { runId: "run-1", automationId: AUTOMATION_B },
          { context },
        ),
      ).rejects.toThrow(/not found/i);
    });
  },
);
