import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  PLUGINS,
  buildEmitFiles,
  changesetsNamingSdk,
  listPendingChangesets,
  readReleaseVersion,
  resolveSurfaceBaseRef,
  sdkSurfaceDriftFromBase,
  type EmitFile,
} from "./generate-sdk";

const ROOT = path.join(import.meta.dirname, "..");
const SDK_DIR = path.join(ROOT, "core", "sdk");

function fileByName(files: EmitFile[], rel: string): EmitFile {
  const abs = path.join(SDK_DIR, rel);
  const found = files.find((f) => f.file === abs);
  if (!found) throw new Error(`expected emit for ${rel}`);
  return found;
}

describe("generate-sdk codegen", () => {
  test("emits all 14 committed SDK files", () => {
    const files = buildEmitFiles();
    expect(files).toHaveLength(14);
  });

  test("CheckstackClient keys are exactly the plugin ids", () => {
    const files = buildEmitFiles();
    const client = fileByName(files, "src/client.ts").content;

    for (const { pluginId } of PLUGINS) {
      // Property key may be quoted (e.g. "script-packages").
      const quoted = `"${pluginId}":`;
      const bare = `${pluginId}:`;
      const present =
        client.includes(`  ${quoted}`) || client.includes(`  ${bare}`);
      expect(present).toBe(true);
    }
  });

  test("contracts.ts re-exports every *Api ClientDefinition", () => {
    const files = buildEmitFiles();
    const contracts = fileByName(files, "src/contracts.ts").content;
    for (const { apiExport, pkg } of PLUGINS) {
      expect(contracts).toContain(`export { ${apiExport} } from "${pkg}";`);
    }
  });

  test("both helpers ship a runtime identity body and types", () => {
    const files = buildEmitFiles();
    const hc = fileByName(files, "src/healthcheck.ts").content;
    const intg = fileByName(files, "src/integration.ts").content;

    expect(hc).toContain("export function defineHealthCheck");
    expect(hc).toContain("return value;");
    expect(hc).toContain("interface HealthCheckScriptResult");
    expect(hc).toContain("interface HealthCheckScriptContext");

    expect(intg).toContain("export function defineIntegration");
    expect(intg).toContain("return value;");
    expect(intg).toContain("interface IntegrationScriptResult");
    expect(intg).toContain("interface IntegrationScriptContext");
  });

  test("identity helper body matches the in-app runner rewrite (return value;)", () => {
    // esm-script-runner injects `export function <fn>(value) { return value; }`.
    // The published helper MUST be the same identity function so a script
    // authored against the SDK behaves identically when rewritten in-app.
    const files = buildEmitFiles();
    const hc = fileByName(files, "src/healthcheck.ts").content;
    expect(hc).toMatch(/export function defineHealthCheck[\s\S]*\{\s*return value;\s*\}/);
  });

  test("per-subpath .d.ts expose ONLY their own surface", () => {
    const files = buildEmitFiles();
    const hcDts = fileByName(files, "generated/healthcheck.d.ts").content;
    const intgDts = fileByName(files, "generated/integration.d.ts").content;

    expect(hcDts).toContain("export declare function defineHealthCheck");
    expect(hcDts).not.toContain("defineIntegration");
    expect(hcDts).not.toContain("CheckstackClient");

    expect(intgDts).toContain("export declare function defineIntegration");
    expect(intgDts).not.toContain("defineHealthCheck");
    expect(intgDts).not.toContain("CheckstackClient");
  });

  test("editor bundle declares subpath module names, never bare names", () => {
    const files = buildEmitFiles();
    const bundle = fileByName(files, "generated/editor-bundle.d.ts").content;

    expect(bundle).toContain('declare module "@checkstack/sdk/healthcheck"');
    expect(bundle).toContain('declare module "@checkstack/sdk/integration"');
    // Root subpath block resolves `import ... from "@checkstack/sdk"` (the
    // Phase-1 MINOR: the editor bundle must declare the root `@checkstack/sdk`).
    expect(bundle).toContain('declare module "@checkstack/sdk" {');
    // Bare names are intentionally absent so an old import errors in-editor.
    expect(bundle).not.toContain('declare module "@checkstack/healthcheck"');
    expect(bundle).not.toContain('declare module "@checkstack/integration"');
    // Helper functions are exported FROM the subpath modules (module-scoped,
    // not top-level globals: scriptContext.ts owns the global declarations, so
    // re-declaring them here would duplicate-error in the shared TS service).
    expect(bundle).toContain("export function defineHealthCheck");
    expect(bundle).toContain("export function defineIntegration");
    expect(bundle).not.toContain("declare function defineHealthCheck");
    expect(bundle).not.toContain("declare function defineIntegration");
    // The root block re-exports the helper symbols + the client factory.
    expect(bundle).toContain("export function createCheckstackClient");
  });

  test("package.json version is stamped from a fixture release version", () => {
    const files = buildEmitFiles({ version: "9.9.9-fixture" });
    const pkg = JSON.parse(fileByName(files, "package.json").content) as {
      version: string;
      name: string;
    };
    expect(pkg.name).toBe("@checkstack/sdk");
    expect(pkg.version).toBe("9.9.9-fixture");
  });

  test("committed package.json version === @checkstack/release version", () => {
    const committed = JSON.parse(
      readFileSync(path.join(SDK_DIR, "package.json"), "utf8"),
    ) as { version: string };
    expect(committed.version).toBe(readReleaseVersion());
  });

  test("committed files are byte-identical to a fresh generation (reproducible)", () => {
    const files = buildEmitFiles();
    for (const { file, content } of files) {
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, "utf8")).toBe(content);
    }
  });
});

describe("generate-sdk --check drift guard", () => {
  function runCheck() {
    return spawnSync(
      "bun",
      ["run", path.join("scripts", "generate-sdk.ts"), "--check"],
      { cwd: ROOT, encoding: "utf8" },
    );
  }

  test("--check passes on a clean tree (committed output matches a fresh run)", () => {
    expect(runCheck().status).toBe(0);
  });

  test("--check exits nonzero when a generated file is mutated", () => {
    const target = path.join(SDK_DIR, "generated", "healthcheck.d.ts");
    const original = readFileSync(target, "utf8");
    try {
      writeFileSync(target, original + "\n// drift\n", "utf8");
      const result = runCheck();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("out of sync");
    } finally {
      writeFileSync(target, original, "utf8");
    }
    // Tree restored → clean again.
    expect(runCheck().status).toBe(0);
  });
});

describe("changeset readers", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  function makeChangesetDir(files: Record<string, string>): string {
    tmp = mkdtempSync(path.join(tmpdir(), "sdk-changeset-"));
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(tmp, name), content, "utf8");
    }
    return tmp;
  }

  test("listPendingChangesets ignores README.md and non-md files", () => {
    const dir = makeChangesetDir({
      "README.md": "# readme",
      "config.json": "{}",
      "feat-x.md": "---\n\"@checkstack/backend\": minor\n---\nx\n",
    });
    expect(listPendingChangesets(dir)).toEqual(["feat-x.md"]);
  });

  test("listPendingChangesets returns [] for a missing dir", () => {
    expect(listPendingChangesets(path.join(tmpdir(), "does-not-exist-xyz"))).toEqual(
      [],
    );
  });

  test("changesetsNamingSdk flags a changeset that bumps @checkstack/sdk", () => {
    const dir = makeChangesetDir({
      "bad.md": '---\n"@checkstack/sdk": minor\n---\nnope\n',
      "good.md": '---\n"@checkstack/backend": minor\n---\nfine\n',
    });
    expect(changesetsNamingSdk(dir)).toEqual(["bad.md"]);
  });

  test("changesetsNamingSdk ignores @checkstack/sdk-foo (not the exact name)", () => {
    const dir = makeChangesetDir({
      "x.md": '---\n"@checkstack/sdk-foo": minor\n---\nfine\n',
    });
    expect(changesetsNamingSdk(dir)).toEqual([]);
  });

  test("changesetsNamingSdk accepts unquoted + single-quoted forms", () => {
    const dir = makeChangesetDir({
      "u.md": "---\n@checkstack/sdk: patch\n---\nu\n",
      "s.md": "---\n'@checkstack/sdk': major\n---\ns\n",
    });
    expect(new Set(changesetsNamingSdk(dir))).toEqual(new Set(["u.md", "s.md"]));
  });
});

describe("§7.3 guard: --check fails on a changeset naming @checkstack/sdk", () => {
  const offender = path.join(ROOT, ".changeset", "zz-sdk-guard-fixture.md");

  afterEach(() => {
    if (existsSync(offender)) unlinkSync(offender);
  });

  test("--check exits nonzero and names the offending changeset", () => {
    writeFileSync(
      offender,
      '---\n"@checkstack/sdk": minor\n---\n\nshould be rejected\n',
      "utf8",
    );
    const result = spawnSync(
      "bun",
      ["run", path.join("scripts", "generate-sdk.ts"), "--check"],
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("references @checkstack/sdk");
    expect(result.stderr).toContain("zz-sdk-guard-fixture.md");
  });
});

describe("§7.1.1 guard: SDK surface drift vs base ref", () => {
  test("resolveSurfaceBaseRef resolves a real ref in this repo", () => {
    const ref = resolveSurfaceBaseRef({ cwd: ROOT });
    expect(typeof ref).toBe("string");
  });

  test("resolveSurfaceBaseRef returns undefined when no candidate exists", () => {
    expect(
      resolveSurfaceBaseRef({
        cwd: ROOT,
        candidates: ["definitely-not-a-ref-zzz"],
      }),
    ).toBeUndefined();
  });

  test("committed on-disk SDK surface is byte-identical to a fresh generation", () => {
    // The committed SDK surface files must match a fresh run (no forgotten
    // `generate:sdk`). We compare against the WORKING-TREE committed files, not
    // a git ref: a surface-changing phase legitimately differs from a prior
    // commit before it lands, but the on-disk committed copy must always equal
    // the fresh generation (this is the property the `--check` guard enforces).
    const surfaceRel = [
      path.join("generated", "index.d.ts"),
      path.join("generated", "healthcheck.d.ts"),
      path.join("generated", "integration.d.ts"),
      path.join("generated", "editor-bundle.d.ts"),
    ];
    const files = buildEmitFiles();
    for (const rel of surfaceRel) {
      const abs = path.join(ROOT, "core", "sdk", rel);
      const fresh = files.find((f) => f.file === abs)?.content;
      expect(fresh).toBeDefined();
      expect(readFileSync(abs, "utf8")).toBe(fresh as string);
    }
  });

  test("reports drift when a surface file's fresh content differs from base", () => {
    // Simulate a surface change by feeding a mutated emit set: the in-memory
    // `index.d.ts` content no longer matches what's committed at HEAD.
    const files = buildEmitFiles().map((f) =>
      f.file.endsWith(path.join("generated", "index.d.ts"))
        ? { ...f, content: f.content + "\n// surface change\n" }
        : f,
    );
    const drift = sdkSurfaceDriftFromBase({ files, baseRef: "HEAD", cwd: ROOT });
    expect(drift.some((p) => p.endsWith("index.d.ts"))).toBe(true);
  });
});
