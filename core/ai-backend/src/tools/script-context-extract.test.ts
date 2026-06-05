import { describe, expect, test } from "bun:test";
import { SDK_EDITOR_BUNDLE_DTS } from "@checkstack/sdk/editor-bundle";
import {
  resolveScriptContext,
  extractDeclareModuleBlock,
  ScriptContextExtractionError,
  HEALTHCHECK_SHELL_ENV,
  AUTOMATION_SHELL_ENV,
} from "./script-context-extract";

describe("extractDeclareModuleBlock (pure)", () => {
  test("returns the full declare-module block for a known module", () => {
    const block = extractDeclareModuleBlock({
      bundle: SDK_EDITOR_BUNDLE_DTS,
      moduleName: "@checkstack/sdk/healthcheck",
    });
    expect(block.startsWith('declare module "@checkstack/sdk/healthcheck"')).toBe(
      true,
    );
    expect(block.trimEnd().endsWith("}")).toBe(true);
    // It must contain the helper + context types, and NOT bleed into the next module.
    expect(block).toContain("defineHealthCheck");
    expect(block).toContain("HealthCheckScriptContext");
    expect(block).not.toContain("defineIntegration");
  });

  test("brace-matches a nested block correctly (no early termination)", () => {
    const bundle =
      'declare module "x" {\n  interface A { readonly b: { readonly c: string } }\n}\ndeclare module "y" { export const z: number; }';
    const block = extractDeclareModuleBlock({ bundle, moduleName: "x" });
    expect(block).toContain("readonly c: string");
    expect(block).not.toContain("export const z");
  });

  test("throws a clear error for a missing module", () => {
    expect(() =>
      extractDeclareModuleBlock({
        bundle: SDK_EDITOR_BUNDLE_DTS,
        moduleName: "@checkstack/sdk/does-not-exist",
      }),
    ).toThrow(ScriptContextExtractionError);
  });
});

describe("resolveScriptContext (pure)", () => {
  test("healthcheck-script extracts the healthcheck module + helper", () => {
    const resolved = resolveScriptContext({
      context: "healthcheck-script",
      bundle: SDK_EDITOR_BUNDLE_DTS,
    });
    expect(resolved.language).toBe("typescript");
    expect(resolved.sdkModule).toBe("@checkstack/sdk/healthcheck");
    expect(resolved.helper).toBe("defineHealthCheck");
    expect(resolved.declarations).toContain("HealthCheckScriptResult");
    expect(resolved.shellEnv).toBeUndefined();
    expect(resolved.allowsManagedPackages).toBe(true);
    expect(resolved.starterExample).toContain("defineHealthCheck");
  });

  test("automation-action-script extracts the integration module + helper", () => {
    const resolved = resolveScriptContext({
      context: "automation-action-script",
      bundle: SDK_EDITOR_BUNDLE_DTS,
    });
    expect(resolved.sdkModule).toBe("@checkstack/sdk/integration");
    expect(resolved.helper).toBe("defineIntegration");
    expect(resolved.declarations).toContain("IntegrationScriptContext");
    expect(resolved.declarations).not.toContain("defineHealthCheck");
  });

  test("healthcheck-shell returns the env table, no SDK module", () => {
    const resolved = resolveScriptContext({
      context: "healthcheck-shell",
      bundle: SDK_EDITOR_BUNDLE_DTS,
    });
    expect(resolved.language).toBe("shell");
    expect(resolved.sdkModule).toBeUndefined();
    expect(resolved.helper).toBeUndefined();
    expect(resolved.shellEnv).toBe(HEALTHCHECK_SHELL_ENV);
    expect(resolved.declarations).toContain("CHECKSTACK_CHECK_ID");
    expect(resolved.allowsManagedPackages).toBe(false);
  });

  test("automation-action-shell returns the automation env table", () => {
    const resolved = resolveScriptContext({
      context: "automation-action-shell",
      bundle: SDK_EDITOR_BUNDLE_DTS,
    });
    expect(resolved.language).toBe("shell");
    expect(resolved.shellEnv).toBe(AUTOMATION_SHELL_ENV);
    expect(resolved.declarations).toContain("CHECKSTACK_EVENT_ID");
  });
});
