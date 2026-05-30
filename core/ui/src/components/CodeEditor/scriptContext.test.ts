import { describe, expect, it } from "bun:test";
import {
  healthcheckScriptContext,
  integrationScriptContext,
  _internals,
} from "./scriptContext";
import type { JsonSchemaProperty } from "../DynamicForm/types";

describe("healthcheckScriptContext", () => {
  it("emits both the global and module-export declarations of defineHealthCheck", () => {
    const ctx = healthcheckScriptContext({});
    // Module declaration is what `import { defineHealthCheck } from
    // "@checkstack/healthcheck"` resolves to.
    expect(ctx.typeDefinitions).toContain('declare module "@checkstack/healthcheck"');
    expect(ctx.typeDefinitions).toContain("HealthCheckScriptResult");
    // Global declaration is what makes Monaco autocomplete `defineHea…`
    // _without_ requiring the user to type the import first (Monaco 0.55
    // doesn't expose `includeCompletionsForModuleExports`).
    expect(ctx.typeDefinitions).toMatch(/declare function defineHealthCheck/);
  });

  it("typed `context.config` reflects the supplied collector schema", () => {
    const ctx = healthcheckScriptContext({
      collectorConfigSchema: {
        type: "object",
        properties: {
          host: { type: "string", description: "Target hostname" },
          port: { type: "integer" },
          enabled: { type: "boolean" },
        },
        required: ["host", "port"],
      },
    });

    // Property names + descriptions should land in the generated context block.
    expect(ctx.typeDefinitions).toContain("declare const context");
    expect(ctx.typeDefinitions).toContain("readonly host: string");
    expect(ctx.typeDefinitions).toContain("readonly port: number");
    expect(ctx.typeDefinitions).toContain("readonly enabled?: boolean");
    expect(ctx.typeDefinitions).toContain("Target hostname");
  });

  it("falls back to a generic `Record<string, unknown>` config when no schema is given", () => {
    const ctx = healthcheckScriptContext({});
    // We ALWAYS declare `context` so the function-arg form
    // `defineHealthCheck(ctx => …)` is properly typed too — without a
    // schema, both the global and the function param fall back to a
    // generic config shape.
    expect(ctx.typeDefinitions).toContain("declare const context");
    expect(ctx.typeDefinitions).toContain("Record<string, unknown>");
    expect(ctx.typeDefinitions).toContain("HealthCheckScriptResult");
    expect(ctx.typeDefinitions).toContain("HealthCheckScriptContext");
  });

  it("exposes `context.check` and `context.system` run-context metadata", () => {
    // The runner injects check/system metadata alongside config, so the
    // editor must type them or `context.system.name` would error.
    const ctx = healthcheckScriptContext({});
    expect(ctx.typeDefinitions).toContain("readonly check: {");
    expect(ctx.typeDefinitions).toContain("readonly system: {");
    expect(ctx.typeDefinitions).toContain("readonly intervalSeconds: number");
  });

  it("types the `defineHealthCheck` callback parameter from the schema (not `unknown`)", () => {
    // Regression guard: the previous version had `(ctx: unknown) => …`,
    // so `ctx.config.host` produced "'ctx' is of type 'unknown'". The
    // callback param must reference the shared HealthCheckScriptContext
    // type that's also used for the global `context`.
    const ctx = healthcheckScriptContext({
      collectorConfigSchema: {
        type: "object",
        properties: { host: { type: "string" } },
        required: ["host"],
      },
    });
    expect(ctx.typeDefinitions).toMatch(
      /\(ctx:\s*HealthCheckScriptContext\)/,
    );
    // The shared context type carries the schema-derived field.
    expect(ctx.typeDefinitions).toContain("readonly host: string");
  });

  it("exposes inline TS + shell starters", () => {
    const ctx = healthcheckScriptContext({});
    expect(ctx.starterTemplates.typescript).toBeDefined();
    expect(ctx.starterTemplates.javascript).toBeDefined();
    expect(ctx.starterTemplates.shell).toBeDefined();
    expect(ctx.starterTemplates.typescript).toContain('import { loadavg } from "node:os"');
    expect(ctx.starterTemplates.typescript).toContain("defineHealthCheck");
    // Portable load-average read via `uptime` (works on Linux + macOS).
    expect(ctx.starterTemplates.shell).toContain("uptime");
    expect(ctx.starterTemplates.shell).toContain("load average");
    expect(ctx.starterTemplates.shell).toContain("awk");
    // Guard against a Linux-only regression: /proc/loadavg doesn't
    // exist on macOS, so the starter must not depend on it.
    expect(ctx.starterTemplates.shell).not.toContain("/proc/loadavg");
  });

  it("exposes the safe-env-vars whitelist for shell completion", () => {
    const ctx = healthcheckScriptContext({});
    const names = ctx.shellEnvVars.map((v) => v.name);
    // Sanity-check a few entries from the whitelist that scripts will
    // most often actually reference.
    expect(names).toContain("PATH");
    expect(names).toContain("HOME");
    expect(names).toContain("TZ");
    // Run-context vars the shell collector injects are suggested too.
    expect(names).toContain("CHECKSTACK_CHECK_NAME");
    expect(names).toContain("CHECKSTACK_SYSTEM_NAME");
    expect(names).toContain("CHECKSTACK_CHECK_INTERVAL_SECONDS");
    // Integration-only vars must NOT leak into the healthcheck context.
    expect(names).not.toContain("EVENT_ID");
    expect(names).not.toContain("PAYLOAD_TITLE");
  });

  it("surfaces the user's custom Env (JSON) keys as shell completions", () => {
    const ctx = healthcheckScriptContext({
      customEnv: { API_TOKEN: "secret", "not-an-ident": "x" },
    });
    const names = ctx.shellEnvVars.map((v) => v.name);
    // Valid shell identifier from the user's env is suggested...
    expect(names).toContain("API_TOKEN");
    // ...alongside the whitelist + reserved run-context vars.
    expect(names).toContain("PATH");
    expect(names).toContain("CHECKSTACK_SYSTEM_NAME");
    // Keys that aren't valid `$NAME` identifiers are dropped.
    expect(names).not.toContain("not-an-ident");
    // The user's own var must be ordered ahead of the whitelist + run-context
    // vars so it's not buried at the bottom of the suggest list.
    expect(names.indexOf("API_TOKEN")).toBeLessThan(names.indexOf("PATH"));
    expect(names.indexOf("API_TOKEN")).toBeLessThan(
      names.indexOf("CHECKSTACK_SYSTEM_NAME"),
    );
  });

  it("ignores a non-object customEnv without throwing", () => {
    const names = healthcheckScriptContext({
      customEnv: "not an object",
    }).shellEnvVars.map((v) => v.name);
    expect(names).toContain("PATH");
    expect(names).toContain("CHECKSTACK_CHECK_ID");
  });
});

describe("integrationScriptContext", () => {
  it("emits both the global and module-export declarations of defineIntegration", () => {
    const ctx = integrationScriptContext({});
    expect(ctx.typeDefinitions).toContain('declare module "@checkstack/integration"');
    expect(ctx.typeDefinitions).toContain("IntegrationScriptResult");
    // Global form — analogous to defineHealthCheck.
    expect(ctx.typeDefinitions).toMatch(/declare function defineIntegration/);
  });

  it("typed `context.event.payload` reflects the supplied payload schema", () => {
    const ctx = integrationScriptContext({
      eventPayloadSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          severity: { type: "string", enum: ["low", "high"] },
        },
        required: ["title"],
      },
    });

    expect(ctx.typeDefinitions).toContain("readonly title: string");
    // Enum should narrow to the literal union.
    expect(ctx.typeDefinitions).toContain('"low" | "high"');
    expect(ctx.typeDefinitions).toContain("declare const context");
    expect(ctx.typeDefinitions).toContain("eventId");
  });

  it("types the `defineIntegration` callback parameter from the schema (not `unknown`)", () => {
    // Regression guard for the screenshot the user sent: typing
    // `context.event.eventId` inside `defineIntegration(async (context)
    // => …)` produced "'context' is of type 'unknown'" because the
    // virtual module declared the param as `unknown`. Must reference
    // the shared `IntegrationScriptContext` type instead.
    const ctx = integrationScriptContext({
      eventPayloadSchema: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
      },
    });
    expect(ctx.typeDefinitions).toMatch(
      /\(ctx:\s*IntegrationScriptContext\)/,
    );
    // The shared context type carries the schema-derived payload field.
    expect(ctx.typeDefinitions).toContain("readonly title: string");
    // And the always-present event metadata.
    expect(ctx.typeDefinitions).toContain("readonly eventId: string");
    expect(ctx.typeDefinitions).toContain("readonly deliveryId: string");
  });

  it("falls back to `Record<string, unknown>` payload when no schema is given", () => {
    const ctx = integrationScriptContext({});
    expect(ctx.typeDefinitions).toContain("declare const context");
    expect(ctx.typeDefinitions).toContain("IntegrationScriptContext");
    expect(ctx.typeDefinitions).toContain("Record<string, unknown>");
  });

  it("flattens nested payload schemas into PAYLOAD_* shell env-var hints", () => {
    const ctx = integrationScriptContext({
      eventPayloadSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Incident title" },
          severity: { type: "string" },
          metadata: {
            type: "object",
            properties: {
              region: { type: "string" },
              host: { type: "string" },
            },
          },
        },
      },
    });

    const names = ctx.shellEnvVars.map((v) => v.name);
    // Top-level scalars are flattened with the PAYLOAD_ prefix.
    expect(names).toContain("PAYLOAD_TITLE");
    expect(names).toContain("PAYLOAD_SEVERITY");
    // Nested objects are recursively flattened with underscore-joined keys.
    expect(names).toContain("PAYLOAD_METADATA_REGION");
    expect(names).toContain("PAYLOAD_METADATA_HOST");
    // The intermediate object key itself is NOT emitted (only its leaves).
    expect(names).not.toContain("PAYLOAD_METADATA");

    const title = ctx.shellEnvVars.find((v) => v.name === "PAYLOAD_TITLE");
    expect(title?.description).toBe("Incident title");
  });

  it("always includes the platform-injected core integration env vars", () => {
    const ctx = integrationScriptContext({});
    const names = ctx.shellEnvVars.map((v) => v.name);
    expect(names).toContain("EVENT_ID");
    expect(names).toContain("EVENT_TIMESTAMP");
    expect(names).toContain("DELIVERY_ID");
    expect(names).toContain("SUBSCRIPTION_ID");
    expect(names).toContain("SUBSCRIPTION_NAME");
    // Safe-vars are also still present.
    expect(names).toContain("PATH");
  });

  it("exposes inline TS + shell starters that reference the right variables", () => {
    const ctx = integrationScriptContext({});
    expect(ctx.starterTemplates.typescript).toContain("defineIntegration");
    expect(ctx.starterTemplates.typescript).toContain("context.event.eventId");
    expect(ctx.starterTemplates.shell).toContain("$EVENT_ID");
    expect(ctx.starterTemplates.shell).toContain("$PAYLOAD_TITLE");
  });

  it("falls back gracefully when the payload schema isn't available", () => {
    const ctx = integrationScriptContext({});
    // No `PAYLOAD_*` hints yet, but the core vars and starters are usable.
    const payloadVars = ctx.shellEnvVars.filter((v) =>
      v.name.startsWith("PAYLOAD_"),
    );
    expect(payloadVars).toHaveLength(0);
    expect(ctx.starterTemplates.typescript).toBeDefined();
    expect(ctx.starterTemplates.shell).toBeDefined();
  });
});

describe("flattenSchemaToEnvVars (internal)", () => {
  const { flattenSchemaToEnvVars } = _internals;

  it("returns an empty list for non-object schemas", () => {
    expect(flattenSchemaToEnvVars({ type: "string" })).toEqual([]);
    expect(flattenSchemaToEnvVars({ type: "number" })).toEqual([]);
  });

  it("normalises field names: uppercases and replaces dots/dashes", () => {
    const schema: JsonSchemaProperty = {
      type: "object",
      properties: {
        "user.email": { type: "string" },
        "first-name": { type: "string" },
        "field!with$weird?chars": { type: "string" },
      },
    };

    const names = flattenSchemaToEnvVars(schema).map((v) => v.name);
    expect(names).toContain("PAYLOAD_USER_EMAIL");
    expect(names).toContain("PAYLOAD_FIRST_NAME");
    // Special characters are stripped, not preserved.
    expect(names).toContain("PAYLOAD_FIELDWITHWEIRDCHARS");
  });

  it("respects a custom prefix for nested flattening", () => {
    const schema: JsonSchemaProperty = {
      type: "object",
      properties: {
        title: { type: "string" },
      },
    };

    const result = flattenSchemaToEnvVars(schema, "EVENT");
    expect(result[0]?.name).toBe("EVENT_TITLE");
  });

  it("includes example placeholders sized to the property type", () => {
    const schema: JsonSchemaProperty = {
      type: "object",
      properties: {
        name: { type: "string" },
        count: { type: "number" },
        on: { type: "boolean" },
      },
    };

    const byName = Object.fromEntries(
      flattenSchemaToEnvVars(schema).map((v) => [v.name, v]),
    );
    expect(byName.PAYLOAD_NAME?.example).toBe("<string>");
    expect(byName.PAYLOAD_COUNT?.example).toBe("<number>");
    expect(byName.PAYLOAD_ON?.example).toBe("<true|false>");
  });
});
