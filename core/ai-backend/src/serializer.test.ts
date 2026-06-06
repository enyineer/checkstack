import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { toJsonSchema, configString } from "@checkstack/backend-api";
import type { RegisteredAiTool } from "./tool-registry";
import { serializeTool, serializeTools } from "./serializer";

describe("serializeTool", () => {
  const inputSchema = z.object({ status: z.string().optional() });
  const tool: RegisteredAiTool = {
    name: "incident.list",
    description: "List incidents.",
    effect: "read",
    input: inputSchema,
    requiredAccessRules: ["incident.incident.read"],
    execute: () => Promise.resolve({}),
  };

  test("produces the SAME JSON Schema as toJsonSchema (no second serializer drift)", () => {
    const descriptor = serializeTool({ tool });
    // The serializer must wrap the platform's toJsonSchema verbatim, so a tool
    // input schema and the same schema run through the OpenAPI substrate agree.
    expect(descriptor.inputSchema).toEqual(toJsonSchema(inputSchema));
  });

  test("carries name, description, effect, and requiredAccessRules", () => {
    const descriptor = serializeTool({ tool });
    expect(descriptor.name).toBe("incident.list");
    expect(descriptor.description).toBe("List incidents.");
    expect(descriptor.effect).toBe("read");
    expect(descriptor.requiredAccessRules).toEqual(["incident.incident.read"]);
  });

  test("includes outputSchema only when the tool declares an output", () => {
    expect(serializeTool({ tool }).outputSchema).toBeUndefined();
    const withOutput: RegisteredAiTool = {
      ...tool,
      output: z.object({ count: z.number() }),
    };
    expect(serializeTool({ tool: withOutput }).outputSchema).toEqual(
      toJsonSchema(z.object({ count: z.number() })),
    );
  });

  test("serializes a tool whose schema has Date fields (no throw)", () => {
    // Regression for "The assistant hit an error: Date cannot be represented in
    // JSON Schema": tools that read timestamped resources (incidents, health
    // checks, anomalies) carry `z.date()` fields. Projecting the tool list must
    // not throw - it runs on every chat turn before the model is even called.
    const dateTool: RegisteredAiTool = {
      name: "incident.get",
      description: "Get an incident.",
      effect: "read",
      input: z.object({ id: z.string() }),
      output: z.object({ id: z.string(), createdAt: z.date() }),
      requiredAccessRules: ["incident.incident.read"],
      execute: () => Promise.resolve({}),
    };
    const descriptor = serializeTool({ tool: dateTool });
    const out = descriptor.outputSchema as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(out.properties.createdAt?.type).toBe("string");
    expect(out.properties.createdAt?.format).toBe("date-time");
  });

  test("never emits a secret VALUE into the descriptor", () => {
    // A tool whose input has an x-secret field: the schema describes the field
    // but the descriptor must never contain a concrete secret value.
    const secretTool: RegisteredAiTool = {
      name: "thing.configure",
      description: "Configure a thing.",
      effect: "read",
      input: z.object({ apiKey: configString({ "x-secret": true }) }),
      requiredAccessRules: ["ai.tools.manage"],
      execute: () => Promise.resolve({}),
    };
    const serialized = JSON.stringify(serializeTool({ tool: secretTool }));
    // The descriptor is pure schema metadata — it carries no runtime values.
    expect(serialized).not.toContain("super-secret");
    // The x-secret marker IS preserved (so transports can mask), but no value.
    expect(serialized).toContain("x-secret");
  });
});

describe("serializeTools", () => {
  test("serializes each tool", () => {
    const tools: RegisteredAiTool[] = [
      {
        name: "a.one",
        description: "a",
        effect: "read",
        input: z.object({}),
        requiredAccessRules: [],
        execute: () => Promise.resolve({}),
      },
      {
        name: "b.two",
        description: "b",
        effect: "mutate",
        input: z.object({}),
        requiredAccessRules: ["b.x.manage"],
        execute: () => Promise.resolve({}),
      },
    ];
    expect(serializeTools({ tools }).map((d) => d.name)).toEqual([
      "a.one",
      "b.two",
    ]);
  });
});
