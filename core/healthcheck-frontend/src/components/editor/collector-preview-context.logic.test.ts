import { describe, it, expect } from "bun:test";
import {
  schemaHasTemplatableFields,
  buildTemplatePreviewContext,
  buildHealthCheckTemplateProperties,
} from "./collector-preview-context.logic";
import type { JsonSchema } from "@checkstack/ui";

describe("schemaHasTemplatableFields", () => {
  it("returns false for empty/missing schema", () => {
    expect(schemaHasTemplatableFields(undefined)).toBe(false);
    expect(schemaHasTemplatableFields(null)).toBe(false);
    expect(schemaHasTemplatableFields({ type: "object" })).toBe(false);
    expect(
      schemaHasTemplatableFields({ type: "object", properties: {} }),
    ).toBe(false);
  });

  it("detects a top-level templatable field", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        url: { type: "string", "x-templatable": true },
        method: { type: "string" },
      },
    };
    expect(schemaHasTemplatableFields(schema)).toBe(true);
  });

  it("returns false when no field is templatable", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        url: { type: "string" },
        timeout: { type: "number" },
      },
    };
    expect(schemaHasTemplatableFields(schema)).toBe(false);
  });

  it("detects a nested templatable field in an object property", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        auth: {
          type: "object",
          properties: {
            token: { type: "string", "x-templatable": true },
          },
        },
      },
    };
    expect(schemaHasTemplatableFields(schema)).toBe(true);
  });

  it("detects a templatable field inside array items", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        headers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              value: { type: "string", "x-templatable": true },
            },
          },
        },
      },
    };
    expect(schemaHasTemplatableFields(schema)).toBe(true);
  });
});

describe("buildTemplatePreviewContext", () => {
  it("places environment fields under `environment`", () => {
    const ctx = buildTemplatePreviewContext({
      environmentFields: { baseUrl: "https://staging.example.com" },
    });
    expect(ctx.environment).toEqual({
      baseUrl: "https://staging.example.com",
    });
  });

  it("defaults check/system to empty objects when absent", () => {
    const ctx = buildTemplatePreviewContext({ environmentFields: {} });
    expect(ctx).toEqual({ environment: {}, check: {}, system: {} });
  });

  it("includes curated check/system metadata when provided", () => {
    const ctx = buildTemplatePreviewContext({
      environmentFields: { baseUrl: "https://x" },
      check: { id: "c1", name: "API health", intervalSeconds: 60 },
      system: { id: "s1", name: "Payments" },
    });
    expect(ctx).toEqual({
      environment: { baseUrl: "https://x" },
      check: { id: "c1", name: "API health", intervalSeconds: 60 },
      system: { id: "s1", name: "Payments" },
    });
  });

  it("carries the system's custom fields so `{{ system.metadata.* }}` previews", () => {
    const ctx = buildTemplatePreviewContext({
      environmentFields: {},
      system: { id: "s1", name: "Payments", metadata: { baseUrl: "https://p" } },
    });
    expect(ctx.system).toEqual({
      id: "s1",
      name: "Payments",
      metadata: { baseUrl: "https://p" },
    });
  });
});

describe("buildHealthCheckTemplateProperties", () => {
  it("always offers the check + system id/name namespace", () => {
    const paths = buildHealthCheckTemplateProperties({
      environmentFields: {},
    }).map((p) => p.path);
    expect(paths).toContain("check.id");
    expect(paths).toContain("system.id");
    expect(paths).toContain("system.name");
  });

  it("offers a completion per environment field", () => {
    const paths = buildHealthCheckTemplateProperties({
      environmentFields: { baseUrl: "x", region: "eu" },
    }).map((p) => p.path);
    expect(paths).toContain("environment.baseUrl");
    expect(paths).toContain("environment.region");
  });

  it("offers `system.metadata.<key>` completions for a concrete system", () => {
    const paths = buildHealthCheckTemplateProperties({
      environmentFields: {},
      systemFields: { baseUrl: "https://p", tier: "1" },
    }).map((p) => p.path);
    expect(paths).toContain("system.metadata.baseUrl");
    expect(paths).toContain("system.metadata.tier");
  });

  it("omits system.metadata completions when no concrete system is in context", () => {
    const paths = buildHealthCheckTemplateProperties({
      environmentFields: {},
    }).map((p) => p.path);
    expect(paths.some((p) => p.startsWith("system.metadata."))).toBe(false);
  });
});
