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
import { generateAutomationContextTypes } from "./script-context";

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
  qualifiedId: "jira.issue",
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

  it("emits artifacts as a typed lookup map when upstream actions produce them", () => {
    const def = baseDef({
      actions: [
        {
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
        { qualifiedId: "integration-jira.create_issue", produces: "jira.issue" },
        { qualifiedId: "automation.notify_user" },
      ],
      path: [{ slot: "root", index: 1 }],
    });
    expect(typeDefinitions).toContain('"jira.issue"');
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
