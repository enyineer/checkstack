/**
 * Tests for the scope → completion-field flattening + shell-env derivation.
 *
 * The key invariant: completion fields carry both the canonical `path`
 * (used ONLY for shell-env names, which must match the backend's
 * path-based injection) and the runtime-parseable `templateRef` (what
 * gets inserted into `{{ }}`).
 */
import { describe, expect, it } from "bun:test";
import type { VariableScope } from "@checkstack/automation-common";
import { fieldsToShellEnvVars, flattenScopeToFields } from "./template-helpers";

const scope: VariableScope = {
  entries: [
    {
      path: "trigger",
      templateRef: "trigger",
      type: "object",
      children: [
        {
          path: "trigger.payload",
          templateRef: "trigger.payload",
          type: "object",
          children: [
            {
              path: "trigger.payload.severity",
              templateRef: "trigger.payload.severity",
              type: "string",
              jsonSchema: { type: "string", enum: ["low", "high"] },
            },
          ],
        },
      ],
    },
    {
      path: "artifact",
      templateRef: "artifacts",
      type: "object",
      children: [
        {
          path: "artifact.integration-jira.issue",
          templateRef: 'artifacts["integration-jira.issue"]',
          type: "object",
          children: [
            {
              path: "artifact.integration-jira.issue.issueKey",
              templateRef: 'artifacts["integration-jira.issue"].issueKey',
              type: "string",
            },
          ],
        },
      ],
    },
  ],
};

const arrayScope: VariableScope = {
  entries: [
    {
      path: "artifact.integration-jira.issue",
      templateRef: 'artifacts["integration-jira.issue"]',
      type: "object",
      children: [
        {
          path: "artifact.integration-jira.issue.tags",
          templateRef: 'artifacts["integration-jira.issue"].tags',
          type: "string[]",
          referenceable: true,
          children: [
            {
              path: "artifact.integration-jira.issue.tags[0]",
              templateRef: 'artifacts["integration-jira.issue"].tags[0]',
              type: "string",
            },
          ],
        },
      ],
    },
  ],
};

describe("flattenScopeToFields", () => {
  it("emits both the whole-array field and its element field", () => {
    const fields = flattenScopeToFields(arrayScope);
    const refs = fields.map((f) => f.templateRef);
    // Whole array (referenceable) AND the element are both offered.
    expect(refs).toContain('artifacts["integration-jira.issue"].tags');
    expect(refs).toContain('artifacts["integration-jira.issue"].tags[0]');
  });

  it("derives shell env names from the canonical path for array fields", () => {
    const fields = flattenScopeToFields(arrayScope);
    const vars = fieldsToShellEnvVars(fields);
    for (const v of vars) {
      expect(v.name).toMatch(/^CHECKSTACK_/);
      expect(v.name).not.toContain("[");
      expect(v.name).not.toContain("]");
      expect(v.name).not.toContain('"');
    }
  });

  it("carries both path and templateRef on each leaf", () => {
    const fields = flattenScopeToFields(scope);
    const severity = fields.find(
      (f) => f.path === "trigger.payload.severity",
    );
    expect(severity?.templateRef).toBe("trigger.payload.severity");
    expect(severity?.enumValues).toEqual(["low", "high"]);

    const issueKey = fields.find(
      (f) => f.path === "artifact.integration-jira.issue.issueKey",
    );
    expect(issueKey?.templateRef).toBe(
      'artifacts["integration-jira.issue"].issueKey',
    );
  });

  it("falls back to path when an entry has no templateRef", () => {
    const legacyScope: VariableScope = {
      entries: [{ path: "var.foo", type: "string" }],
    };
    const [field] = flattenScopeToFields(legacyScope);
    expect(field?.templateRef).toBe("var.foo");
  });
});

describe("fieldsToShellEnvVars", () => {
  it("derives env names from the canonical dotted path, NOT the bracket templateRef", () => {
    const fields = flattenScopeToFields(scope);
    const vars = fieldsToShellEnvVars(fields);
    const names = vars.map((v) => v.name);

    // Artifact env var must come from the dotted path, producing a clean
    // CHECKSTACK_ARTIFACT_* name — never from the bracket/quote form.
    const artifactVar = names.find((n) => n.includes("ARTIFACT"));
    expect(artifactVar).toBeDefined();
    expect(artifactVar).toMatch(/^CHECKSTACK_/);
    // No bracket / quote leakage from the templateRef into the env name.
    for (const name of names) {
      expect(name).not.toContain("[");
      expect(name).not.toContain('"');
      expect(name).not.toContain("artifacts");
    }
  });
});
