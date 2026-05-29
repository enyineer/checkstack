/**
 * Tests for the variable-scope resolver.
 *
 * Each scenario builds a minimal `AutomationDefinition` + registry-info
 * fixture, picks a target action path, runs the resolver, and asserts on
 * the entries returned (or the flattened paths for ordering tests).
 */
import { describe, expect, it } from "bun:test";
import type {
  ActionInfo,
  ActionInput,
  ArtifactTypeInfo,
  AutomationDefinition,
  TriggerInfo,
} from "./schemas";

function provider(action: string): ActionInput {
  return { action, config: {}, enabled: true, continue_on_error: false };
}

function variables(record: Record<string, unknown>): ActionInput {
  return { variables: record, enabled: true, continue_on_error: false };
}
import {
  appendArrayIndex,
  appendTemplateSegment,
  flattenScope,
  isTemplateIdentifier,
  resolveVariableScope,
  type ActionPath,
} from "./variable-scope";

const triggerInfo: TriggerInfo = {
  qualifiedId: "incident.created",
  displayName: "Incident Created",
  category: "Incidents",
  ownerPluginId: "incident",
  payloadSchema: {
    type: "object",
    properties: {
      incidentId: { type: "string", description: "Incident ID" },
      title: { type: "string" },
      severity: { type: "string", enum: ["low", "high"] },
    },
    required: ["incidentId", "title"],
  },
};

const otherTrigger: TriggerInfo = {
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

const jiraIssueArtifact: ArtifactTypeInfo = {
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

const createJiraAction: ActionInfo = {
  qualifiedId: "integration-jira.create_issue",
  displayName: "Create Jira Issue",
  category: "Jira",
  ownerPluginId: "integration-jira",
  configSchema: { type: "object" },
  produces: "jira.issue",
  consumes: [],
};

const notifyAction: ActionInfo = {
  qualifiedId: "automation.notify_user",
  displayName: "Notify User",
  category: "Notification",
  ownerPluginId: "automation",
  configSchema: { type: "object" },
  consumes: [],
};

// Artifact whose qualified id contains both a hyphen and a dot — the kind of
// id that breaks dot-notation template paths and forces bracket notation.
const dottedArtifact: ArtifactTypeInfo = {
  qualifiedId: "integration-jira.issue",
  displayName: "Jira Issue (dotted id)",
  ownerPluginId: "integration-jira",
  schema: {
    type: "object",
    properties: {
      issueKey: { type: "string" },
    },
    required: ["issueKey"],
  },
};

const dottedArtifactNoSchema: ArtifactTypeInfo = {
  qualifiedId: "integration-jira.issue",
  displayName: "Jira Issue (no schema)",
  ownerPluginId: "integration-jira",
  schema: { type: "object" },
};

const createDottedArtifactAction: ActionInfo = {
  qualifiedId: "integration-jira.create_issue_dotted",
  displayName: "Create Jira Issue (dotted artifact)",
  category: "Jira",
  ownerPluginId: "integration-jira",
  configSchema: { type: "object" },
  produces: "integration-jira.issue",
  consumes: [],
};

// Artifact whose schema has array properties: an array of objects (comments)
// and an array of scalars (tags). Exercises the array-element descent.
const arrayArtifact: ArtifactTypeInfo = {
  qualifiedId: "integration-jira.issue",
  displayName: "Jira Issue (with arrays)",
  ownerPluginId: "integration-jira",
  schema: {
    type: "object",
    properties: {
      comments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            author: { type: "string" },
          },
        },
      },
      tags: { type: "array", items: { type: "string" } },
    },
  },
};

function basicDefinition(
  overrides: Partial<AutomationDefinition> = {},
): AutomationDefinition {
  return {
    name: "Test automation",
    triggers: [{ event: "incident.created" }],
    conditions: [],
    actions: [],
    mode: "single",
    max_runs: 1,
    ...overrides,
  };
}

describe("resolveVariableScope", () => {
  it("returns no entries when path is empty", () => {
    const scope = resolveVariableScope({
      definition: basicDefinition(),
      triggers: [triggerInfo],
      actions: [],
      artifactTypes: [],
      path: [],
    });
    expect(scope.entries).toEqual([]);
  });

  it("exposes trigger.event + trigger.payload.* for a single subscribed trigger", () => {
    const scope = resolveVariableScope({
      definition: basicDefinition(),
      triggers: [triggerInfo],
      actions: [],
      artifactTypes: [],
      path: [{ slot: "root", index: 0 }],
    });
    const flat = flattenScope(scope).map((e) => e.path);
    expect(flat).toContain("trigger");
    expect(flat).toContain("trigger.event");
    expect(flat).toContain("trigger.payload");
    expect(flat).toContain("trigger.payload.incidentId");
    expect(flat).toContain("trigger.payload.title");
    expect(flat).toContain("trigger.payload.severity");
  });

  it("unions payload fields across multiple subscribed triggers and annotates conditional entries", () => {
    const definition = basicDefinition({
      triggers: [{ event: "incident.created" }, { event: "incident.resolved" }],
      actions: [],
    });
    const scope = resolveVariableScope({
      definition,
      triggers: [triggerInfo, otherTrigger],
      actions: [],
      artifactTypes: [],
      path: [{ slot: "root", index: 0 }],
    });
    const flat = flattenScope(scope);
    const byPath = new Map(flat.map((e) => [e.path, e]));

    // All payload fields from all triggers surface — picker shows everything.
    expect(byPath.has("trigger.payload.incidentId")).toBe(true);
    expect(byPath.has("trigger.payload.title")).toBe(true);
    expect(byPath.has("trigger.payload.resolvedAt")).toBe(true);

    // Universal field (on both triggers): no conditional annotation.
    expect(byPath.get("trigger.payload.incidentId")?.conditionalOnTriggers).toBeUndefined();

    // Per-trigger fields: annotated with the contributing trigger id.
    expect(byPath.get("trigger.payload.title")?.conditionalOnTriggers).toEqual([
      "incident.created",
    ]);
    expect(byPath.get("trigger.payload.resolvedAt")?.conditionalOnTriggers).toEqual([
      "incident.resolved",
    ]);

    // trigger.event becomes a string-literal union of the subscribed ids.
    expect(byPath.get("trigger.event")?.type).toBe(
      `"incident.created" | "incident.resolved"`,
    );
  });

  it("degrades to `unknown` payload when no triggers match the registry", () => {
    const definition = basicDefinition({
      triggers: [{ event: "nonexistent.event" }],
      actions: [],
    });
    const scope = resolveVariableScope({
      definition,
      triggers: [],
      actions: [],
      artifactTypes: [],
      path: [{ slot: "root", index: 0 }],
    });
    const payload = flattenScope(scope).find(
      (e) => e.path === "trigger.payload",
    );
    expect(payload?.type).toBe("unknown");
  });

  it("accumulates `var.*` entries from upstream variables actions in the same sequence", () => {
    const definition = basicDefinition({
      triggers: [{ event: "incident.created" }],
      actions: [
        variables({ foo: "hello", count: 5 }),
        provider("automation.notify_user"),
      ],
    });
    const scope = resolveVariableScope({
      definition,
      triggers: [triggerInfo],
      actions: [notifyAction],
      artifactTypes: [],
      path: [{ slot: "root", index: 1 }],
    });
    const flat = flattenScope(scope).map((e) => e.path);
    expect(flat).toContain("var.foo");
    expect(flat).toContain("var.count");
  });

  it("does NOT expose vars from later actions or other branches", () => {
    const definition = basicDefinition({
      triggers: [{ event: "incident.created" }],
      actions: [
        provider("automation.notify_user"),
        variables({ later: "value" }),
      ],
    });
    const scope = resolveVariableScope({
      definition,
      triggers: [triggerInfo],
      actions: [notifyAction],
      artifactTypes: [],
      // Target is the FIRST action, before the variables block.
      path: [{ slot: "root", index: 0 }],
    });
    const flat = flattenScope(scope).map((e) => e.path);
    expect(flat).not.toContain("var.later");
  });

  it("accumulates artifacts produced by upstream provider actions", () => {
    const definition = basicDefinition({
      triggers: [{ event: "incident.created" }],
      actions: [
        provider("integration-jira.create_issue"),
        provider("automation.notify_user"),
      ],
    });
    const scope = resolveVariableScope({
      definition,
      triggers: [triggerInfo],
      actions: [createJiraAction, notifyAction],
      artifactTypes: [jiraIssueArtifact],
      path: [{ slot: "root", index: 1 }],
    });
    const flat = flattenScope(scope).map((e) => e.path);
    expect(flat).toContain("artifact.jira.issue");
    expect(flat).toContain("artifact.jira.issue.key");
    expect(flat).toContain("artifact.jira.issue.url");
  });

  it("does not expose artifacts from sibling branches inside a choose", () => {
    const definition = basicDefinition({
      triggers: [{ event: "incident.created" }],
      actions: [
        {
          choose: [
            {
              when: "true",
              sequence: [
                provider("integration-jira.create_issue"),
              ],
            },
            {
              when: "false",
              sequence: [
                provider("automation.notify_user"),
              ],
            },
          ],
        },
      ],
    });
    // Target: the notify_user inside the second when-branch.
    const path: ActionPath = [
      { slot: "root", index: 0 },
      { slot: "choose-when", whenIndex: 1, index: 0 },
    ];
    const scope = resolveVariableScope({
      definition,
      triggers: [triggerInfo],
      actions: [createJiraAction, notifyAction],
      artifactTypes: [jiraIssueArtifact],
      path,
    });
    const flat = flattenScope(scope).map((e) => e.path);
    // The Jira issue was produced in the FIRST when-branch — must not leak
    // into the second branch's scope, because at runtime only one branch
    // executes.
    expect(flat).not.toContain("artifact.jira.issue");
  });

  it("exposes repeat.index inside a count-mode repeat", () => {
    const definition = basicDefinition({
      triggers: [{ event: "incident.created" }],
      actions: [
        {
          repeat: {
            count: 3,
            sequence: [
              provider("automation.notify_user"),
            ],
          },
        },
      ],
    });
    const path: ActionPath = [
      { slot: "root", index: 0 },
      { slot: "repeat", index: 0 },
    ];
    const scope = resolveVariableScope({
      definition,
      triggers: [triggerInfo],
      actions: [notifyAction],
      artifactTypes: [],
      path,
    });
    const flat = flattenScope(scope).map((e) => e.path);
    expect(flat).toContain("repeat.index");
    expect(flat).not.toContain("repeat.item");
  });

  it("exposes repeat.item inside a for_each repeat", () => {
    const definition = basicDefinition({
      triggers: [{ event: "incident.created" }],
      actions: [
        {
          repeat: {
            for_each: "{{ trigger.payload.items }}",
            sequence: [
              provider("automation.notify_user"),
            ],
          },
        },
      ],
    });
    const path: ActionPath = [
      { slot: "root", index: 0 },
      { slot: "repeat", index: 0 },
    ];
    const scope = resolveVariableScope({
      definition,
      triggers: [triggerInfo],
      actions: [notifyAction],
      artifactTypes: [],
      path,
    });
    const flat = flattenScope(scope).map((e) => e.path);
    expect(flat).toContain("repeat.index");
    expect(flat).toContain("repeat.item");
  });

  it("walks into parallel branches and exposes upstream vars from parent sequence", () => {
    const definition = basicDefinition({
      triggers: [{ event: "incident.created" }],
      actions: [
        variables({ outer: "set-before-parallel" }),
        {
          parallel: [
            provider("automation.notify_user"),
          ],
        },
      ],
    });
    const path: ActionPath = [
      { slot: "root", index: 1 },
      { slot: "parallel", index: 0 },
    ];
    const scope = resolveVariableScope({
      definition,
      triggers: [triggerInfo],
      actions: [notifyAction],
      artifactTypes: [],
      path,
    });
    const flat = flattenScope(scope).map((e) => e.path);
    expect(flat).toContain("var.outer");
  });
});

describe("resolveVariableScope — condition-aware narrowing", () => {
  const multiTriggerDef = (
    actions: AutomationDefinition["actions"],
  ): AutomationDefinition =>
    basicDefinition({
      triggers: [
        { event: "incident.created" },
        { event: "incident.resolved" },
      ],
      actions,
    });

  it("narrows trigger.payload to the matching variant inside `when: trigger.event == \"…\"`", () => {
    const def = multiTriggerDef([
      {
        choose: [
          {
            when: 'trigger.event == "incident.created"',
            sequence: [provider("automation.notify_user")],
          },
        ],
        enabled: true,
        continue_on_error: false,
      },
    ]);
    const scope = resolveVariableScope({
      definition: def,
      triggers: [triggerInfo, otherTrigger],
      actions: [notifyAction],
      artifactTypes: [],
      path: [
        { slot: "root", index: 0 },
        { slot: "choose-when", whenIndex: 0, index: 0 },
      ],
    });
    const flat = flattenScope(scope);
    const byPath = new Map(flat.map((e) => [e.path, e]));

    // trigger.event collapses to the single literal — no longer a union.
    expect(byPath.get("trigger.event")?.type).toBe('"incident.created"');
    // `title` is no longer conditional inside this branch — it's
    // unconditional now that we know which trigger fired.
    expect(byPath.get("trigger.payload.title")?.conditionalOnTriggers).toBeUndefined();
    // `resolvedAt` (only on incident.resolved) is gone entirely from scope.
    expect(byPath.has("trigger.payload.resolvedAt")).toBe(false);
  });

  it("narrows for `\"X\" == trigger.event` (literal on the left)", () => {
    const def = multiTriggerDef([
      {
        choose: [
          {
            when: '"incident.resolved" == trigger.event',
            sequence: [provider("automation.notify_user")],
          },
        ],
        enabled: true,
        continue_on_error: false,
      },
    ]);
    const scope = resolveVariableScope({
      definition: def,
      triggers: [triggerInfo, otherTrigger],
      actions: [notifyAction],
      artifactTypes: [],
      path: [
        { slot: "root", index: 0 },
        { slot: "choose-when", whenIndex: 0, index: 0 },
      ],
    });
    const flat = flattenScope(scope).map((e) => e.path);
    expect(flat).toContain("trigger.payload.resolvedAt");
    expect(flat).not.toContain("trigger.payload.title");
  });

  it("supports `||` of equality checks (union of narrowings)", () => {
    const def = multiTriggerDef([
      {
        choose: [
          {
            when:
              'trigger.event == "incident.created" || trigger.event == "incident.resolved"',
            sequence: [provider("automation.notify_user")],
          },
        ],
        enabled: true,
        continue_on_error: false,
      },
    ]);
    const scope = resolveVariableScope({
      definition: def,
      triggers: [triggerInfo, otherTrigger],
      actions: [notifyAction],
      artifactTypes: [],
      path: [
        { slot: "root", index: 0 },
        { slot: "choose-when", whenIndex: 0, index: 0 },
      ],
    });
    const flat = flattenScope(scope).map((e) => e.path);
    // Both event-specific fields appear because the condition allows
    // either trigger.
    expect(flat).toContain("trigger.payload.title");
    expect(flat).toContain("trigger.payload.resolvedAt");
  });

  it("supports `!=` to exclude a trigger from the universe", () => {
    const def = multiTriggerDef([
      {
        choose: [
          {
            when: 'trigger.event != "incident.created"',
            sequence: [provider("automation.notify_user")],
          },
        ],
        enabled: true,
        continue_on_error: false,
      },
    ]);
    const scope = resolveVariableScope({
      definition: def,
      triggers: [triggerInfo, otherTrigger],
      actions: [notifyAction],
      artifactTypes: [],
      path: [
        { slot: "root", index: 0 },
        { slot: "choose-when", whenIndex: 0, index: 0 },
      ],
    });
    const flat = flattenScope(scope).map((e) => e.path);
    expect(flat).not.toContain("trigger.payload.title");
    expect(flat).toContain("trigger.payload.resolvedAt");
  });

  it("supports `{ and: [...] }` combinator — intersection of narrowings", () => {
    const def = multiTriggerDef([
      {
        choose: [
          {
            when: {
              and: [
                'trigger.event != "incident.resolved"',
                'trigger.event == "incident.created"',
              ],
            },
            sequence: [provider("automation.notify_user")],
          },
        ],
        enabled: true,
        continue_on_error: false,
      },
    ]);
    const scope = resolveVariableScope({
      definition: def,
      triggers: [triggerInfo, otherTrigger],
      actions: [notifyAction],
      artifactTypes: [],
      path: [
        { slot: "root", index: 0 },
        { slot: "choose-when", whenIndex: 0, index: 0 },
      ],
    });
    const flat = flattenScope(scope).map((e) => e.path);
    expect(flat).toContain("trigger.payload.title");
    expect(flat).not.toContain("trigger.payload.resolvedAt");
  });

  it("falls back to the full union when the condition doesn't gate on trigger.event", () => {
    const def = multiTriggerDef([
      {
        choose: [
          {
            // Condition doesn't reference `trigger.event` at all.
            when: 'trigger.payload.incidentId == "abc"',
            sequence: [provider("automation.notify_user")],
          },
        ],
        enabled: true,
        continue_on_error: false,
      },
    ]);
    const scope = resolveVariableScope({
      definition: def,
      triggers: [triggerInfo, otherTrigger],
      actions: [notifyAction],
      artifactTypes: [],
      path: [
        { slot: "root", index: 0 },
        { slot: "choose-when", whenIndex: 0, index: 0 },
      ],
    });
    const byPath = new Map(
      flattenScope(scope).map((e) => [e.path, e]),
    );
    // Both event-specific fields surface, still annotated.
    expect(byPath.get("trigger.payload.title")?.conditionalOnTriggers).toEqual([
      "incident.created",
    ]);
    expect(byPath.get("trigger.payload.resolvedAt")?.conditionalOnTriggers).toEqual([
      "incident.resolved",
    ]);
  });

  it("compounds narrowing across nested choose branches", () => {
    const def = multiTriggerDef([
      {
        choose: [
          {
            // Outer narrows to {created, resolved} (no change).
            when:
              'trigger.event == "incident.created" || trigger.event == "incident.resolved"',
            sequence: [
              {
                choose: [
                  {
                    // Inner narrows further to {created}.
                    when: 'trigger.event == "incident.created"',
                    sequence: [provider("automation.notify_user")],
                  },
                ],
                enabled: true,
                continue_on_error: false,
              },
            ],
          },
        ],
        enabled: true,
        continue_on_error: false,
      },
    ]);
    const scope = resolveVariableScope({
      definition: def,
      triggers: [triggerInfo, otherTrigger],
      actions: [notifyAction],
      artifactTypes: [],
      path: [
        { slot: "root", index: 0 },
        { slot: "choose-when", whenIndex: 0, index: 0 },
        { slot: "choose-when", whenIndex: 0, index: 0 },
      ],
    });
    const flat = flattenScope(scope).map((e) => e.path);
    expect(flat).toContain("trigger.payload.title");
    expect(flat).not.toContain("trigger.payload.resolvedAt");
  });
});

describe("isTemplateIdentifier", () => {
  it("accepts bare identifiers", () => {
    expect(isTemplateIdentifier("issueKey")).toBe(true);
    expect(isTemplateIdentifier("_private")).toBe(true);
    expect(isTemplateIdentifier("$ref")).toBe(true);
    expect(isTemplateIdentifier("a1_b2")).toBe(true);
  });

  it("rejects non-identifier segments", () => {
    expect(isTemplateIdentifier("integration-jira.issue")).toBe(false);
    expect(isTemplateIdentifier("weird-name")).toBe(false);
    expect(isTemplateIdentifier("has.dot")).toBe(false);
    expect(isTemplateIdentifier("1leading")).toBe(false);
    expect(isTemplateIdentifier("")).toBe(false);
  });
});

describe("appendArrayIndex", () => {
  it("appends a bare numeric index in bracket notation", () => {
    expect(appendArrayIndex({ base: "artifacts", index: 0 })).toBe(
      "artifacts[0]",
    );
    expect(
      appendArrayIndex({
        base: 'artifacts["integration-jira.issue"].tags',
        index: 0,
      }),
    ).toBe('artifacts["integration-jira.issue"].tags[0]');
  });
});

describe("appendTemplateSegment", () => {
  it("uses dot notation for identifier segments", () => {
    expect(appendTemplateSegment({ base: "variables", segment: "foo" })).toBe(
      "variables.foo",
    );
    expect(
      appendTemplateSegment({ base: "trigger.payload", segment: "title" }),
    ).toBe("trigger.payload.title");
  });

  it("uses JSON-quoted bracket notation for dotted segments", () => {
    expect(
      appendTemplateSegment({
        base: "artifacts",
        segment: "integration-jira.issue",
      }),
    ).toBe('artifacts["integration-jira.issue"]');
  });

  it("uses bracket notation for hyphenated segments", () => {
    expect(
      appendTemplateSegment({ base: "variables", segment: "weird-name" }),
    ).toBe('variables["weird-name"]');
  });

  it("uses bracket notation for leading-digit segments", () => {
    expect(appendTemplateSegment({ base: "variables", segment: "1st" })).toBe(
      'variables["1st"]',
    );
  });
});

describe("resolveVariableScope — templateRef", () => {
  it("brackets a dotted/hyphenated artifact id and dots its schema children", () => {
    const definition = basicDefinition({
      triggers: [{ event: "incident.created" }],
      actions: [
        provider("integration-jira.create_issue_dotted"),
        provider("automation.notify_user"),
      ],
    });
    const scope = resolveVariableScope({
      definition,
      triggers: [triggerInfo],
      actions: [createDottedArtifactAction, notifyAction],
      artifactTypes: [dottedArtifact],
      path: [{ slot: "root", index: 1 }],
    });
    const byPath = new Map(flattenScope(scope).map((e) => [e.path, e]));

    // path stays canonical & dotted (other consumers slice it).
    const child = byPath.get("artifact.integration-jira.issue.issueKey");
    expect(child).toBeDefined();
    expect(child?.path).toBe("artifact.integration-jira.issue.issueKey");
    // templateRef brackets the artifact id, dots the identifier child key.
    expect(child?.templateRef).toBe(
      'artifacts["integration-jira.issue"].issueKey',
    );

    // The artifact node itself.
    const node = byPath.get("artifact.integration-jira.issue");
    expect(node?.templateRef).toBe('artifacts["integration-jira.issue"]');
  });

  it("brackets a dotted artifact id even with no schema children", () => {
    const definition = basicDefinition({
      triggers: [{ event: "incident.created" }],
      actions: [
        provider("integration-jira.create_issue_dotted"),
        provider("automation.notify_user"),
      ],
    });
    const scope = resolveVariableScope({
      definition,
      triggers: [triggerInfo],
      actions: [createDottedArtifactAction, notifyAction],
      artifactTypes: [dottedArtifactNoSchema],
      path: [{ slot: "root", index: 1 }],
    });
    const node = flattenScope(scope).find(
      (e) => e.path === "artifact.integration-jira.issue",
    );
    expect(node).toBeDefined();
    expect(node?.templateRef).toBe('artifacts["integration-jira.issue"]');
    expect(node?.children).toBeUndefined();
  });

  it("maps the var namespace to plural variables in templateRef", () => {
    const definition = basicDefinition({
      triggers: [{ event: "incident.created" }],
      actions: [
        variables({ foo: "hello" }),
        provider("automation.notify_user"),
      ],
    });
    const scope = resolveVariableScope({
      definition,
      triggers: [triggerInfo],
      actions: [notifyAction],
      artifactTypes: [],
      path: [{ slot: "root", index: 1 }],
    });
    const entry = flattenScope(scope).find((e) => e.path === "var.foo");
    expect(entry?.path).toBe("var.foo");
    expect(entry?.templateRef).toBe("variables.foo");
  });

  it("brackets a hyphenated variable name in templateRef", () => {
    const definition = basicDefinition({
      triggers: [{ event: "incident.created" }],
      actions: [
        variables({ "weird-name": "hello" }),
        provider("automation.notify_user"),
      ],
    });
    const scope = resolveVariableScope({
      definition,
      triggers: [triggerInfo],
      actions: [notifyAction],
      artifactTypes: [],
      path: [{ slot: "root", index: 1 }],
    });
    const entry = flattenScope(scope).find(
      (e) => e.path === "var.weird-name",
    );
    expect(entry?.path).toBe("var.weird-name");
    expect(entry?.templateRef).toBe('variables["weird-name"]');
  });

  it("descends into an array-of-objects: whole array + element children", () => {
    const definition = basicDefinition({
      triggers: [{ event: "incident.created" }],
      actions: [
        provider("integration-jira.create_issue_dotted"),
        provider("automation.notify_user"),
      ],
    });
    const scope = resolveVariableScope({
      definition,
      triggers: [triggerInfo],
      actions: [createDottedArtifactAction, notifyAction],
      artifactTypes: [arrayArtifact],
      path: [{ slot: "root", index: 1 }],
    });
    const flat = flattenScope(scope);
    const byRef = new Map(flat.map((e) => [e.templateRef, e]));

    // The whole-array node is referenceable and keeps the array type label.
    const commentsNode = byRef.get('artifacts["integration-jira.issue"].comments');
    expect(commentsNode).toBeDefined();
    expect(commentsNode?.referenceable).toBe(true);
    expect(commentsNode?.type).toBe("object[]");

    // An element-object child descends via the representative index 0.
    const authorNode = byRef.get(
      'artifacts["integration-jira.issue"].comments[0].author',
    );
    expect(authorNode).toBeDefined();
    expect(authorNode?.type).toBe("string");
  });

  it("descends into an array-of-scalars: whole array + element leaf", () => {
    const definition = basicDefinition({
      triggers: [{ event: "incident.created" }],
      actions: [
        provider("integration-jira.create_issue_dotted"),
        provider("automation.notify_user"),
      ],
    });
    const scope = resolveVariableScope({
      definition,
      triggers: [triggerInfo],
      actions: [createDottedArtifactAction, notifyAction],
      artifactTypes: [arrayArtifact],
      path: [{ slot: "root", index: 1 }],
    });
    const byRef = new Map(
      flattenScope(scope).map((e) => [e.templateRef, e]),
    );

    const tagsNode = byRef.get('artifacts["integration-jira.issue"].tags');
    expect(tagsNode).toBeDefined();
    expect(tagsNode?.referenceable).toBe(true);
    expect(tagsNode?.type).toBe("string[]");

    const tagsElem = byRef.get('artifacts["integration-jira.issue"].tags[0]');
    expect(tagsElem).toBeDefined();
    expect(tagsElem?.type).toBe("string");
    // A scalar element is a leaf — no children.
    expect(tagsElem?.children).toBeUndefined();
  });

  it("keeps trigger/repeat templateRef equal to path for static identifier paths", () => {
    const definition = basicDefinition({
      triggers: [{ event: "incident.created" }],
      actions: [
        {
          repeat: {
            for_each: "{{ trigger.payload.items }}",
            sequence: [provider("automation.notify_user")],
          },
        },
      ],
    });
    const scope = resolveVariableScope({
      definition,
      triggers: [triggerInfo],
      actions: [notifyAction],
      artifactTypes: [],
      path: [
        { slot: "root", index: 0 },
        { slot: "repeat", index: 0 },
      ],
    });
    const byPath = new Map(flattenScope(scope).map((e) => [e.path, e]));
    expect(byPath.get("trigger.event")?.templateRef).toBe("trigger.event");
    expect(byPath.get("trigger.payload")?.templateRef).toBe("trigger.payload");
    expect(byPath.get("trigger.payload.title")?.templateRef).toBe(
      "trigger.payload.title",
    );
    expect(byPath.get("repeat.index")?.templateRef).toBe("repeat.index");
    expect(byPath.get("repeat.item")?.templateRef).toBe("repeat.item");
  });
});

describe("flattenScope ordering", () => {
  it("emits parents before children depth-first", () => {
    const scope = resolveVariableScope({
      definition: basicDefinition(),
      triggers: [triggerInfo],
      actions: [],
      artifactTypes: [],
      path: [{ slot: "root", index: 0 }],
    });
    const flat = flattenScope(scope).map((e) => e.path);
    const triggerIdx = flat.indexOf("trigger");
    const payloadIdx = flat.indexOf("trigger.payload");
    const titleIdx = flat.indexOf("trigger.payload.title");
    expect(triggerIdx).toBeLessThan(payloadIdx);
    expect(payloadIdx).toBeLessThan(titleIdx);
  });
});
