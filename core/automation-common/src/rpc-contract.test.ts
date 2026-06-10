/**
 * Contract-level guards for automation team scoping (instanceAccess wiring).
 *
 * Grants are keyed as (resourceType="automation.automation", resourceId=automation.id).
 * These tests assert that the correct instanceAccess is declared on every proc
 * that targets a single automation or lists automations, so
 * `autoAuthMiddleware` enforces per-automation team scope correctly.
 *
 * Pattern: read `proc["~orpc"].meta` — the stable internal accessor the
 * sandbox-policy tests across other plugins use.
 */
import { describe, expect, test } from "bun:test";
import { automationContract } from "./rpc-contract";

type ProcMeta = {
  instanceAccess?: {
    idParam?: string;
    listKey?: string;
    recordKey?: string;
    global?: boolean;
    create?: { teamIdParam?: string; idField?: string };
  };
  userType?: string;
};

function metaFor(procName: keyof typeof automationContract): ProcMeta {
  const p = automationContract[procName] as unknown as Record<string, unknown>;
  const orpc = p["~orpc"] as { meta?: ProcMeta };
  return orpc.meta ?? {};
}

// ─── listAutomations ──────────────────────────────────────────────────────────

describe("listAutomations instanceAccess", () => {
  test("uses listKey 'items' (PaginatedResult wraps items under that key)", () => {
    expect(metaFor("listAutomations").instanceAccess).toEqual({
      listKey: "items",
    });
  });
});

// ─── Single-automation reads ──────────────────────────────────────────────────

describe("getAutomation instanceAccess", () => {
  test("uses idParam 'id'", () => {
    expect(metaFor("getAutomation").instanceAccess).toEqual({ idParam: "id" });
  });
});

// ─── Mutations targeting a specific automation ────────────────────────────────

describe("updateAutomation instanceAccess", () => {
  test("uses idParam 'id' (UpdateAutomationInputSchema.id)", () => {
    expect(metaFor("updateAutomation").instanceAccess).toEqual({
      idParam: "id",
    });
  });
});

describe("deleteAutomation instanceAccess", () => {
  test("uses idParam 'id'", () => {
    expect(metaFor("deleteAutomation").instanceAccess).toEqual({
      idParam: "id",
    });
  });
});

describe("toggleAutomation instanceAccess", () => {
  test("uses idParam 'id'", () => {
    expect(metaFor("toggleAutomation").instanceAccess).toEqual({
      idParam: "id",
    });
  });
});

describe("manualRun instanceAccess", () => {
  test("uses idParam 'automationId' (ManualRunInputSchema field)", () => {
    expect(metaFor("manualRun").instanceAccess).toEqual({
      idParam: "automationId",
    });
  });
});

// ─── createAutomation CREATE mode ─────────────────────────────────────────────

describe("createAutomation instanceAccess.create", () => {
  test("carries create mode with teamIdParam 'teamId' and idField 'id'", () => {
    expect(metaFor("createAutomation").instanceAccess).toEqual({
      create: { teamIdParam: "teamId", idField: "id" },
    });
  });

  test("idField 'id' matches the top-level string id on AutomationSchema output", () => {
    // AutomationSchema.shape.id is a z.string() — the middleware reads
    // response.id to key the owning-team grant after a successful create.
    const meta = metaFor("createAutomation").instanceAccess;
    expect(meta?.create?.idField).toBe("id");
  });

  test("teamIdParam 'teamId' matches the optional input field added to CreateAutomationInputSchema", () => {
    const meta = metaFor("createAutomation").instanceAccess;
    expect(meta?.create?.teamIdParam).toBe("teamId");
  });
});

// ─── Global / unscoped endpoints — explicitly marked global ───────────────────

describe("endpoints explicitly marked global", () => {
  /**
   * listRuns / getRun / cancelRun — runs are sub-resources; grants are keyed
   * per-automation id, not per-run id. listRuns has an optional automationId
   * filter (not always present), and there are no run-level grants in the
   * grant store. Marked global; per-automation filtering is enforced upstream
   * via the automation-level procs that guard access to the automation itself.
   *
   * listAutomationGroups — returns group labels, not automation instances.
   * listAutomationTemplates — read-only catalogue, no per-automation grant.
   * createAutomation — carries instanceAccess.create (see block above).
   * validateDefinition / renderTemplate / testScript / getRunScopeForReplay —
   *   stateless compute tools; no automation id required or reliable.
   * listTriggers / listActions / listArtifactTypes — global registry reads.
   * listMigrationFailures / acknowledgeMigrationFailure — admin-only,
   *   keyed by migration-failure id, not automation id.
   *
   * Each now declares `instanceAccess: { global: true }` so the access
   * intent is explicit rather than implied by an absent field.
   */
  const global: Array<keyof typeof automationContract> = [
    "listAutomationGroups",
    "listAutomationTemplates",
    "validateDefinition",
    "listRuns",
    "getRun",
    "cancelRun",
    "listTriggers",
    "listActions",
    "listArtifactTypes",
    "listMigrationFailures",
    "acknowledgeMigrationFailure",
    "testScript",
    "getRunScopeForReplay",
    "renderTemplate",
  ];

  for (const procName of global) {
    test(`${procName} is marked instanceAccess.global === true`, () => {
      expect(metaFor(procName).instanceAccess?.global).toBe(true);
    });
  }
});
