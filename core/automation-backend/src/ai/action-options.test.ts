import { describe, expect, test } from "bun:test";
import type { ActionInput } from "@checkstack/automation-common";
import {
  buildResolverContext,
  collectProviderActionNodes,
  getResolverField,
  listResolverFields,
} from "./action-options";

/** A config schema shaped like `toJsonSchema(configString(...))` output. */
const JIRA_CREATE_SCHEMA = {
  type: "object",
  properties: {
    connectionId: { type: "string", "x-options-resolver": "connectionOptions" },
    projectKey: { type: "string", "x-options-resolver": "projectOptions" },
    issueTypeId: {
      type: "string",
      "x-options-resolver": "issueTypeOptions",
      "x-depends-on": ["connectionId", "projectKey"],
    },
    summary: { type: "string" }, // free-form, no resolver
  },
};

describe("getResolverField", () => {
  test("reads the resolver name + dependencies for a dynamic field", () => {
    expect(getResolverField(JIRA_CREATE_SCHEMA, "issueTypeId")).toEqual({
      field: "issueTypeId",
      resolverName: "issueTypeOptions",
      dependsOn: ["connectionId", "projectKey"],
    });
  });

  test("defaults dependsOn to [] when absent", () => {
    expect(getResolverField(JIRA_CREATE_SCHEMA, "projectKey")).toEqual({
      field: "projectKey",
      resolverName: "projectOptions",
      dependsOn: [],
    });
  });

  test("returns undefined for a free-form field or an unknown field", () => {
    expect(getResolverField(JIRA_CREATE_SCHEMA, "summary")).toBeUndefined();
    expect(getResolverField(JIRA_CREATE_SCHEMA, "nope")).toBeUndefined();
  });

  test("tolerates a non-object schema", () => {
    expect(getResolverField(undefined, "x")).toBeUndefined();
    expect(getResolverField("nope", "x")).toBeUndefined();
  });
});

describe("listResolverFields", () => {
  test("returns every resolver-backed field (incl. connectionId), not free-form", () => {
    const fields = listResolverFields(JIRA_CREATE_SCHEMA)
      .map((f) => f.field)
      .sort();
    expect(fields).toEqual(["connectionId", "issueTypeId", "projectKey"]);
  });

  test("empty for a schema with no properties", () => {
    expect(listResolverFields({ type: "object" })).toEqual([]);
  });
});

describe("buildResolverContext", () => {
  test("collects non-connection deps and excludes connectionId", () => {
    const { context, missing } = buildResolverContext({
      dependsOn: ["connectionId", "projectKey"],
      values: { connectionId: "c1", projectKey: "OPS" },
    });
    expect(context).toEqual({ projectKey: "OPS" });
    expect(missing).toEqual([]);
  });

  test("reports a missing dependency value", () => {
    const { context, missing } = buildResolverContext({
      dependsOn: ["connectionId", "projectKey"],
      values: { connectionId: "c1" },
    });
    expect(context).toEqual({});
    expect(missing).toEqual(["projectKey"]);
  });

  test("treats a templated dependency as missing (can't resolve at propose time)", () => {
    const { missing } = buildResolverContext({
      dependsOn: ["projectKey"],
      values: { projectKey: "{{ trigger.payload.project }}" },
    });
    expect(missing).toEqual(["projectKey"]);
  });
});

describe("collectProviderActionNodes", () => {
  test("flattens nested provider actions with correct issue paths", () => {
    const actions: ActionInput[] = [
      {
        action: "integration-jira.search_issues",
        config: {},
        enabled: true,
        continue_on_error: false,
      },
      {
        choose: [
          {
            when: "{{ x }}",
            sequence: [
              {
                action: "integration-jira.create_issue",
                config: {},
                enabled: true,
                continue_on_error: false,
              },
            ],
          },
        ],
        else: [
          {
            action: "integration-teams.send_message",
            config: {},
            enabled: true,
            continue_on_error: false,
          },
        ],
        enabled: true,
        continue_on_error: false,
      },
    ];
    const nodes = collectProviderActionNodes(actions);
    expect(nodes.map((n) => `${n.action.action}@${n.path.join(".")}`)).toEqual([
      "integration-jira.search_issues@actions.0",
      "integration-jira.create_issue@actions.1.choose.0.sequence.0",
      "integration-teams.send_message@actions.1.else.0",
    ]);
  });
});

/**
 * A create_issue-shaped schema with a `fieldMappings` array whose per-row
 * `fieldKey` carries a resolver (the Jira "additional fields" case): the
 * resolver lives NESTED inside the array's `items.properties`.
 */
const SCHEMA_WITH_NESTED_RESOLVER = {
  type: "object",
  properties: {
    connectionId: { type: "string", "x-options-resolver": "connectionOptions" },
    projectKey: { type: "string", "x-options-resolver": "projectOptions" },
    issueTypeId: {
      type: "string",
      "x-options-resolver": "issueTypeOptions",
      "x-depends-on": ["connectionId", "projectKey"],
    },
    fieldMappings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          fieldKey: {
            type: "string",
            "x-options-resolver": "fieldOptions",
            "x-depends-on": ["connectionId", "projectKey", "issueTypeId"],
          },
          value: { type: "string" },
        },
      },
    },
  },
};

describe("nested (array-item) resolver fields", () => {
  test("getResolverField resolves a dotted path into an array's row schema", () => {
    expect(
      getResolverField(SCHEMA_WITH_NESTED_RESOLVER, "fieldMappings.fieldKey"),
    ).toEqual({
      field: "fieldMappings.fieldKey",
      resolverName: "fieldOptions",
      dependsOn: ["connectionId", "projectKey", "issueTypeId"],
    });
  });

  test("getResolverField returns undefined for a non-resolver nested leaf", () => {
    expect(
      getResolverField(SCHEMA_WITH_NESTED_RESOLVER, "fieldMappings.value"),
    ).toBeUndefined();
  });

  test("listResolverFields includes the nested field as a dotted path", () => {
    const fields = listResolverFields(SCHEMA_WITH_NESTED_RESOLVER).map((f) => f.field);
    expect(fields).toContain("projectKey");
    expect(fields).toContain("fieldMappings.fieldKey");
  });
});
