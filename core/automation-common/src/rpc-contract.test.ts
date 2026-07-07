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
import { automationResourceTypes } from "./access";

type ProcMeta = {
  instanceAccess?: {
    idParam?: string;
    listKey?: string;
    recordKey?: string;
    global?: boolean;
    create?: { teamIdParam?: string; idField?: string };
    typeScoped?: { action?: string };
    parentScope?: {
      resourceType?: string;
      action?: string;
      idParam?: string;
    };
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

// ─── Run sub-resources — scoped by the PARENT automation ──────────────────────

describe("run procs are parentScoped on the owning automation", () => {
  /**
   * Runs are sub-resources: grants are keyed per-automation id, not per-run id.
   * Each of these carries the owning `automationId` in its input, so the correct
   * gate is `parentScope` on `automation.automation` - a team-scoped caller may
   * touch a run iff they hold the matching grant on its automation. `read` for
   * the read paths; `manage` for the cancel mutation. (A bare `global` here would
   * wrongly exclude team-scoped managers who lack a global rule.)
   */
  const readParentScoped: Array<keyof typeof automationContract> = [
    "listRuns",
    "getRun",
    "getRunScopeForReplay",
  ];

  for (const procName of readParentScoped) {
    test(`${procName} is parentScoped (read) on the automation via 'automationId'`, () => {
      expect(metaFor(procName).instanceAccess).toEqual({
        parentScope: {
          resourceType: automationResourceTypes.automation,
          action: "read",
          idParam: "automationId",
        },
      });
    });
  }

  test("cancelRun is parentScoped (manage) on the automation via 'automationId'", () => {
    expect(metaFor("cancelRun").instanceAccess).toEqual({
      parentScope: {
        resourceType: automationResourceTypes.automation,
        action: "manage",
        idParam: "automationId",
      },
    });
  });
});

// ─── No-instance utilities / catalogues — typeScoped ──────────────────────────

describe("no-instance utility & catalogue procs are typeScoped", () => {
  /**
   * These have no reliable automation id to scope on but ARE reached by a
   * team-scoped manager (registry reads for the editor, the stateless
   * validate/render tools, template/group catalogues). `typeScoped` authorizes a
   * caller holding the global rule OR ANY automation grant, so a team member can
   * open the authoring UI before owning an instance - the correct fix over the
   * old `global: true`, which excluded team-scoped callers.
   */
  const typeScoped: Array<keyof typeof automationContract> = [
    "listAutomationGroups",
    "listAutomationTemplates",
    "validateDefinition",
    "listTriggers",
    "listActions",
    "listArtifactTypes",
    "renderTemplate",
  ];

  for (const procName of typeScoped) {
    test(`${procName} is marked instanceAccess.typeScoped`, () => {
      expect(metaFor(procName).instanceAccess).toEqual({ typeScoped: {} });
    });
  }

  test("testScript is typeScoped at the 'manage' action (it runs user script)", () => {
    // Running an arbitrary script is a manage-level capability, so the utility
    // gate requires a manage-level automation grant, not merely read.
    expect(metaFor("testScript").instanceAccess).toEqual({
      typeScoped: { action: "manage" },
    });
  });
});

// ─── Genuinely global (admin-only) endpoints ──────────────────────────────────

describe("admin-only endpoints stay global", () => {
  /**
   * Migration-failure admin endpoints are keyed by migration-failure id, not
   * automation id, and are not part of any team-scoped authoring flow, so they
   * remain deliberately `global: true`.
   */
  const global: Array<keyof typeof automationContract> = [
    "listMigrationFailures",
    "acknowledgeMigrationFailure",
  ];

  for (const procName of global) {
    test(`${procName} is marked instanceAccess.global === true`, () => {
      expect(metaFor(procName).instanceAccess?.global).toBe(true);
    });
  }
});
