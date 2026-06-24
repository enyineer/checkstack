/**
 * Behaviour tests for the per-provider translation rules.
 *
 * The full `runWebhookSubscriptionMigration` path needs a database and
 * an RPC client, so it's covered by the existing dispatch-engine
 * integration fixtures (and ultimately by the smoke test). Here we
 * lock down `buildDefinitionFor`, which is where the interesting
 * mapping decisions live.
 */
import { describe, expect, it } from "bun:test";
import {
  buildDefinitionFor,
  type LegacySubscription,
} from "./from-webhook-subscriptions";

function sub(overrides: Partial<LegacySubscription> = {}): LegacySubscription {
  return {
    id: "sub-1",
    name: "Test",
    providerId: "integration-webhook.webhook",
    providerConfig: { url: "https://example.com/hook" },
    eventId: "incident.created",
    enabled: true,
    ...overrides,
  };
}

describe("buildDefinitionFor", () => {
  it("returns a failure for unknown providers", () => {
    const result = buildDefinitionFor(
      sub({ providerId: "made-up.provider" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/unsupported provider/);
    }
  });

  it("translates a Jira subscription to the jira.create_issue action", () => {
    const result = buildDefinitionFor(
      sub({
        providerId: "integration-jira.jira",
        providerConfig: {
          connectionId: "conn-1",
          projectKey: "PROJ",
          issueTypeId: "10001",
          summaryTemplate: "{{ trigger.payload.title }}",
          descriptionTemplate: "Severity: {{ trigger.payload.severity }}",
          priorityId: "3",
          fieldMappings: [
            { fieldKey: "customfield_1", template: "{{ trigger.payload.foo }}" },
          ],
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.actionId).toBe("integration-jira.create_issue");
    expect(result.definition.actions).toHaveLength(1);
    const action = result.definition.actions[0] as { action: string; config: Record<string, unknown> };
    expect(action.action).toBe("integration-jira.create_issue");
    expect(action.config.summary).toBe("{{ trigger.payload.title }}");
    expect(action.config.description).toBe(
      "Severity: {{ trigger.payload.severity }}",
    );
    expect(action.config.fieldMappings).toEqual([
      { fieldKey: "customfield_1", value: "{{ trigger.payload.foo }}" },
    ]);
  });

  it("generates a default body for Teams when the legacy schema had no template", () => {
    const result = buildDefinitionFor(
      sub({
        providerId: "integration-teams.teams",
        providerConfig: {
          connectionId: "conn-1",
          teamId: "team-1",
          channelId: "ch-1",
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const action = result.definition.actions[0] as { config: Record<string, unknown> };
    expect(typeof action.config.body).toBe("string");
    expect((action.config.body as string).length).toBeGreaterThan(0);
  });

  it("preserves an explicit Webex messageTemplate", () => {
    const result = buildDefinitionFor(
      sub({
        providerId: "integration-webex.webex",
        providerConfig: {
          connectionId: "conn-1",
          roomId: "room-1",
          messageTemplate: "Custom: {{ trigger.payload.title }}",
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const action = result.definition.actions[0] as { config: Record<string, unknown> };
    expect(action.config.markdown).toBe("Custom: {{ trigger.payload.title }}");
  });

  it("falls back to a default Webex markdown when messageTemplate is empty", () => {
    const result = buildDefinitionFor(
      sub({
        providerId: "integration-webex.webex",
        providerConfig: {
          connectionId: "conn-1",
          roomId: "room-1",
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const action = result.definition.actions[0] as { config: Record<string, unknown> };
    expect(typeof action.config.markdown).toBe("string");
    expect((action.config.markdown as string).length).toBeGreaterThan(0);
  });

  it("renames webhook bodyTemplate to body", () => {
    const result = buildDefinitionFor(
      sub({
        providerId: "integration-webhook.webhook",
        providerConfig: {
          url: "https://example.com/hook",
          method: "POST",
          contentType: "application/json",
          authType: "none",
          timeout: 10_000,
          bodyTemplate: `{"x":"{{ trigger.payload.x }}"}`,
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const action = result.definition.actions[0] as { config: Record<string, unknown> };
    expect(action.config.body).toBe(`{"x":"{{ trigger.payload.x }}"}`);
    expect(action.config.bodyTemplate).toBeUndefined();
  });

  it("maps the legacy shell provider to integration-script.run_shell and preserves workingDirectory", () => {
    const result = buildDefinitionFor(
      sub({
        providerId: "integration-script.shell",
        providerConfig: {
          script: "echo hi",
          timeout: 10_000,
          workingDirectory: "/tmp",
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.actionId).toBe("integration-script.run_shell");
    const action = result.definition.actions[0] as {
      config: Record<string, unknown>;
    };
    expect(action.config.script).toBe("echo hi");
    expect(action.config.workingDirectory).toBe("/tmp");
  });

  it("maps the legacy TS-script provider to integration-script.run_script and drops shell-only fields", () => {
    const result = buildDefinitionFor(
      sub({
        providerId: "integration-script.script",
        providerConfig: {
          script: "export default async () => ({ id: 'x' });",
          timeout: 10_000,
          // Legacy data may still have a stray workingDirectory — it
          // doesn't apply to the ESM runner, so the migration drops it
          // rather than silently feeding it to an action that ignores it.
          workingDirectory: "/tmp",
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.actionId).toBe("integration-script.run_script");
    const action = result.definition.actions[0] as {
      config: Record<string, unknown>;
    };
    expect(action.config.script).toBe(
      "export default async () => ({ id: 'x' });",
    );
    expect(action.config).not.toHaveProperty("workingDirectory");
  });

  it("emits an OR condition for systemFilter with multiple ids", () => {
    const result = buildDefinitionFor(
      sub({
        systemFilter: ["sys-1", "sys-2"],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.conditions).toHaveLength(1);
    const cond = result.definition.conditions[0] as { or: string[] };
    expect(cond.or).toHaveLength(2);
    expect(cond.or[0]).toContain("sys-1");
  });

  it("emits a single bare-expression condition for a single-id systemFilter", () => {
    const result = buildDefinitionFor(
      sub({ systemFilter: ["sys-only"] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.conditions).toHaveLength(1);
    const cond = result.definition.conditions[0];
    expect(typeof cond).toBe("string");
    expect(cond).toContain("sys-only");
    // Conditions are bare expressions — never wrapped in {{ }} template syntax.
    expect(cond).not.toContain("{{");
  });

  it("emits no conditions when systemFilter is empty", () => {
    const result = buildDefinitionFor(sub({ systemFilter: [] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.conditions).toEqual([]);
  });

  it("preserves the description and trigger event id", () => {
    const result = buildDefinitionFor(
      sub({
        description: "On-call paging",
        eventId: "incident.incident.created",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.description).toBe("On-call paging");
    expect(result.definition.triggers[0]?.event).toBe(
      "incident.incident.created",
    );
  });
});
