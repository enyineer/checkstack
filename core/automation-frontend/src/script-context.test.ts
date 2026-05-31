/**
 * Tests for the automation-context type-declaration generator.
 *
 * Each scenario builds a tiny definition + registry fixture, runs
 * `generateAutomationContextTypes`, and asserts on key fragments of the
 * emitted TS source. Full source-equivalence is brittle (whitespace +
 * field ordering shift with stylistic changes), so the assertions
 * target the load-bearing semantic invariants.
 */
import { describe, expect, it } from "bun:test";
import type {
  ArtifactTypeInfo,
  AutomationDefinition,
  TriggerInfo,
} from "@checkstack/automation-common";
import {
  generateAutomationContextTypes,
  generateSecretEnvTypes,
  secretEnvEnvNames,
} from "./script-context";

const incidentCreated: TriggerInfo = {
  qualifiedId: "incident.created",
  displayName: "Incident Created",
  category: "Incidents",
  ownerPluginId: "incident",
  payloadSchema: {
    type: "object",
    properties: {
      incidentId: { type: "string" },
      title: { type: "string" },
    },
    required: ["incidentId", "title"],
  },
};

const incidentResolved: TriggerInfo = {
  qualifiedId: "incident.resolved",
  displayName: "Incident Resolved",
  category: "Incidents",
  ownerPluginId: "incident",
  payloadSchema: {
    type: "object",
    properties: {
      incidentId: { type: "string" },
      resolvedAt: { type: "string" },
    },
    required: ["incidentId"],
  },
};

const jiraIssue: ArtifactTypeInfo = {
  // Qualified id as the registry emits it: `${ownerPluginId}.${localId}`.
  qualifiedId: "integration-jira.issue",
  displayName: "Jira Issue",
  ownerPluginId: "integration-jira",
  schema: {
    type: "object",
    properties: {
      key: { type: "string" },
      url: { type: "string" },
    },
    required: ["key"],
  },
};

function baseDef(
  overrides: Partial<AutomationDefinition> = {},
): AutomationDefinition {
  return {
    name: "Test",
    triggers: [{ event: "incident.created" }],
    conditions: [],
    actions: [],
    mode: "single",
    concurrency_scope: "automation",
    max_runs: 1,
    ...overrides,
  };
}

describe("generateAutomationContextTypes", () => {
  it("emits a single-variant trigger union for one subscribed trigger", () => {
    const { typeDefinitions } = generateAutomationContextTypes({
      definition: baseDef(),
      triggers: [incidentCreated, incidentResolved],
      artifactTypes: [],
      path: [{ slot: "root", index: 0 }],
    });
    expect(typeDefinitions).toContain('readonly event: "incident.created"');
    // The other registered trigger must NOT appear in the union — it
    // isn't subscribed by this automation.
    expect(typeDefinitions).not.toContain('readonly event: "incident.resolved"');
  });

  it("carries trigger.id (derived) and a shared actor on the trigger union", () => {
    const { typeDefinitions } = generateAutomationContextTypes({
      definition: baseDef(),
      triggers: [incidentCreated, incidentResolved],
      artifactTypes: [],
      path: [{ slot: "root", index: 0 }],
    });
    // id is a literal, derived from the event when no explicit id is set.
    expect(typeDefinitions).toContain('readonly id: "incident_created"');
    // actor is shared across every variant (intersected onto the union).
    expect(typeDefinitions).toContain("type AutomationActor =");
    expect(typeDefinitions).toContain("readonly actor: AutomationActor");
  });

  it("uses explicit trigger ids to discriminate two triggers on the same event", () => {
    const def = baseDef({
      triggers: [
        { event: "incident.created", id: "majors" },
        { event: "incident.created", id: "minors" },
      ],
    });
    const { typeDefinitions } = generateAutomationContextTypes({
      definition: def,
      triggers: [incidentCreated],
      artifactTypes: [],
      path: [{ slot: "root", index: 0 }],
    });
    expect(typeDefinitions).toContain('readonly id: "majors"');
    expect(typeDefinitions).toContain('readonly id: "minors"');
  });

  it("emits a multi-variant discriminated union when multiple triggers are subscribed", () => {
    const def = baseDef({
      triggers: [{ event: "incident.created" }, { event: "incident.resolved" }],
    });
    const { typeDefinitions } = generateAutomationContextTypes({
      definition: def,
      triggers: [incidentCreated, incidentResolved],
      artifactTypes: [],
      path: [{ slot: "root", index: 0 }],
    });
    expect(typeDefinitions).toContain('readonly event: "incident.created"');
    expect(typeDefinitions).toContain('readonly event: "incident.resolved"');
    // Each variant carries its own payload — `title` only appears in the
    // incident.created arm; `resolvedAt` only in incident.resolved.
    expect(typeDefinitions).toContain("title");
    expect(typeDefinitions).toContain("resolvedAt");
  });

  it("emits artifacts keyed by producing action id, nested by local name", () => {
    const def = baseDef({
      actions: [
        {
          id: "open_jira",
          action: "integration-jira.create_issue",
          config: {},
          enabled: true,
          continue_on_error: false,
        },
        {
          action: "automation.notify_user",
          config: {},
          enabled: true,
          continue_on_error: false,
        },
      ],
    });
    const { typeDefinitions } = generateAutomationContextTypes({
      definition: def,
      triggers: [incidentCreated],
      artifactTypes: [jiraIssue],
      actions: [
        // `produces` from listActions is the QUALIFIED artifact type id
        // (the registry qualifies it on registration), matching `jiraIssue`.
        {
          qualifiedId: "integration-jira.create_issue",
          produces: "integration-jira.issue",
        },
        { qualifiedId: "automation.notify_user" },
      ],
      path: [{ slot: "root", index: 1 }],
    });
    // Keyed by the producing action's id, nested by local artifact name -
    // mirrors the runtime `artifacts.open_jira.issue.key`.
    expect(typeDefinitions).toContain('readonly "open_jira"');
    expect(typeDefinitions).toContain('readonly "issue"');
    expect(typeDefinitions).toContain("key");
    expect(typeDefinitions).toContain("url");
  });

  it("falls back to Record<string, unknown> for artifacts when no producing actions are upstream", () => {
    const { typeDefinitions } = generateAutomationContextTypes({
      definition: baseDef(),
      triggers: [incidentCreated],
      artifactTypes: [jiraIssue],
      actions: [],
      path: [{ slot: "root", index: 0 }],
    });
    expect(typeDefinitions).toContain(
      "readonly artifacts: Record<string, unknown>",
    );
  });

  it("emits a repeat context only when the path descends through a repeat", () => {
    const def = baseDef({
      actions: [
        {
          repeat: {
            for_each: "{{ trigger.payload.items }}",
            sequence: [
              {
                action: "automation.notify_user",
                config: {},
                enabled: true,
                continue_on_error: false,
              },
            ],
          },
          enabled: true,
          continue_on_error: false,
        },
      ],
    });
    const inside = generateAutomationContextTypes({
      definition: def,
      triggers: [incidentCreated],
      artifactTypes: [],
      actions: [{ qualifiedId: "automation.notify_user" }],
      path: [
        { slot: "root", index: 0 },
        { slot: "repeat", index: 0 },
      ],
    });
    expect(inside.typeDefinitions).toContain("readonly repeat:");
    expect(inside.typeDefinitions).toContain("readonly index: number");
    expect(inside.typeDefinitions).toContain("readonly item: unknown");

    const outside = generateAutomationContextTypes({
      definition: def,
      triggers: [incidentCreated],
      artifactTypes: [],
      actions: [{ qualifiedId: "automation.notify_user" }],
      path: [{ slot: "root", index: 0 }],
    });
    expect(outside.typeDefinitions).not.toContain("readonly repeat:");
  });

  it("returns the resolved scope alongside the type definitions for picker reuse", () => {
    const { scope } = generateAutomationContextTypes({
      definition: baseDef(),
      triggers: [incidentCreated],
      artifactTypes: [],
      path: [{ slot: "root", index: 0 }],
    });
    expect(scope.entries.some((e) => e.path === "trigger")).toBe(true);
  });
});

describe("generateSecretEnvTypes", () => {
  it("emits a ProcessEnv augmentation typing each declared key as string", () => {
    const out = generateSecretEnvTypes({ envNames: ["API_TOKEN", "DB_PASS"] });
    expect(out).toContain("declare namespace NodeJS");
    expect(out).toContain("interface ProcessEnv");
    expect(out).toContain("readonly API_TOKEN: string;");
    expect(out).toContain("readonly DB_PASS: string;");
  });

  it("stays a global script - no top-level export/import that would modularize the merged extra-lib", () => {
    // A single top-level `export`/`import` would turn the concatenated
    // `context + secretEnv` extra-lib into a module, demoting the
    // `declare const context` global to a module-local binding and breaking
    // `context.*` IntelliSense. The augmentation must use an ambient
    // `declare namespace`, never `declare global { … } export {};`.
    const out = generateSecretEnvTypes({ envNames: ["API_TOKEN"] });
    expect(out).not.toMatch(/^\s*export\b/m);
    expect(out).not.toMatch(/^\s*import\b/m);
    expect(out).not.toContain("declare global");
  });

  it("emits an empty string for empty input so the caller drops it", () => {
    expect(generateSecretEnvTypes({ envNames: [] })).toBe("");
  });

  it("skips invalid identifiers but keeps the valid ones", () => {
    const out = generateSecretEnvTypes({
      envNames: ["GOOD", "BAD-NAME", "123start", "with space", "_ok$"],
    });
    expect(out).toContain("readonly GOOD: string;");
    expect(out).toContain("readonly _ok$: string;");
    expect(out).not.toContain("BAD-NAME");
    expect(out).not.toContain("123start");
    expect(out).not.toContain("with space");
  });

  it("emits an empty string when every name is invalid", () => {
    expect(generateSecretEnvTypes({ envNames: ["BAD-NAME", "1x"] })).toBe("");
  });

  it("de-duplicates repeated keys", () => {
    const out = generateSecretEnvTypes({ envNames: ["TOKEN", "TOKEN"] });
    const occurrences = out.split("readonly TOKEN: string;").length - 1;
    expect(occurrences).toBe(1);
  });

  it("merged context + secretEnv stays a global script (regression guard)", () => {
    // Reproduces the action-leaf-cards merge: the `context` global concatenated
    // with the secretEnv augmentation must NOT contain a top-level
    // export/import, otherwise `declare const context` stops being global and
    // its IntelliSense silently disappears in the automation script editor.
    const { typeDefinitions } = generateAutomationContextTypes({
      definition: baseDef(),
      triggers: [],
      path: [{ slot: "root", index: 0 }],
    });
    const secretEnvLib = generateSecretEnvTypes({ envNames: ["API_TOKEN"] });
    const merged = [typeDefinitions, secretEnvLib].filter(Boolean).join("\n\n");
    expect(merged).toContain("declare const context");
    expect(merged).toContain("declare namespace NodeJS");
    expect(merged).not.toMatch(/^\s*export\b/m);
    expect(merged).not.toMatch(/^\s*import\b/m);
  });
});

describe("secretEnvEnvNames", () => {
  const configSchema = {
    type: "object",
    properties: {
      script: { type: "string", "x-editor-types": ["typescript"] },
      secretEnv: {
        type: "object",
        additionalProperties: { type: "string" },
        "x-secret-env": true,
      },
    },
  };

  it("returns the env-var keys from the x-secret-env mapping value", () => {
    expect(
      secretEnvEnvNames({
        configSchema,
        config: {
          script: "export default async () => {}",
          secretEnv: {
            API_TOKEN: "${{ secrets.jira_token }}",
            DB: "${{ secrets.db }}",
          },
        },
      }),
    ).toEqual(["API_TOKEN", "DB"]);
  });

  it("locates the field by annotation, not by name", () => {
    const renamed = {
      type: "object",
      properties: {
        mySecrets: {
          type: "object",
          additionalProperties: { type: "string" },
          "x-secret-env": true,
        },
      },
    };
    expect(
      secretEnvEnvNames({
        configSchema: renamed,
        config: { mySecrets: { TOKEN: "${{ secrets.t }}" } },
      }),
    ).toEqual(["TOKEN"]);
  });

  it("returns [] when there is no x-secret-env field", () => {
    expect(
      secretEnvEnvNames({
        configSchema: { type: "object", properties: { script: { type: "string" } } },
        config: { script: "x" },
      }),
    ).toEqual([]);
  });

  it("returns [] when the mapping is missing or not a record", () => {
    expect(secretEnvEnvNames({ configSchema, config: {} })).toEqual([]);
    expect(
      secretEnvEnvNames({ configSchema, config: { secretEnv: "nope" } }),
    ).toEqual([]);
  });

  it("returns [] for malformed schema / config input", () => {
    expect(secretEnvEnvNames({ configSchema: null, config: null })).toEqual([]);
    expect(
      secretEnvEnvNames({ configSchema: "not-a-schema", config: 42 }),
    ).toEqual([]);
  });
});
