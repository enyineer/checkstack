import { describe, it, expect, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  scaffoldStandaloneWorkspace,
  localSiblingNames,
} from "./scaffold-standalone";
import { createNpmViewResolver } from "./npm-view-resolver";

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccp-standalone-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function readPkg(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

/** A resolver that pins every published @checkstack/* dep to a fixed version. */
function fixedResolver(baseName: string, packageScope: string) {
  return createNpmViewResolver({
    runNpmView: ({ packageName }) =>
      Promise.resolve({ version: `9.9.9-${packageName.length}` }),
    localSiblings: localSiblingNames({ baseName, packageScope }),
  });
}

describe("localSiblingNames", () => {
  it("builds scoped sibling names", () => {
    expect(localSiblingNames({ baseName: "widget", packageScope: "acme" })).toEqual(
      new Set(["@acme/widget-common", "@acme/widget-backend", "@acme/widget-frontend"]),
    );
  });

  it("builds unscoped sibling names", () => {
    expect(localSiblingNames({ baseName: "widget", packageScope: "" })).toEqual(
      new Set(["widget-common", "widget-backend", "widget-frontend"]),
    );
  });
});

describe("scaffoldStandaloneWorkspace — layout", () => {
  it("emits a root workspace + the trio under packages/", async () => {
    const root = makeTmpDir();
    await scaffoldStandaloneWorkspace({
      rootDir: root,
      baseName: "widget",
      description: "Widget plugin",
      packageScope: "acme",
      resolveVersion: fixedResolver("widget", "acme"),
    });

    expect(fs.existsSync(path.join(root, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, "tsconfig.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, "eslint.config.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".gitignore"))).toBe(true);
    expect(fs.existsSync(path.join(root, "README.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".changeset", "config.json"))).toBe(true);

    for (const type of ["common", "backend", "frontend"]) {
      expect(
        fs.existsSync(path.join(root, "packages", `widget-${type}`, "package.json")),
      ).toBe(true);
    }
  });

  it("makes the root a private Bun workspace with forwarding scripts", async () => {
    const root = makeTmpDir();
    await scaffoldStandaloneWorkspace({
      rootDir: root,
      baseName: "widget",
      description: "Widget plugin",
      packageScope: "acme",
      resolveVersion: fixedResolver("widget", "acme"),
    });

    const pkg = readPkg(path.join(root, "package.json"));
    expect(pkg.private).toBe(true);
    expect(pkg.workspaces).toEqual(["packages/*"]);
    const scripts = pkg.scripts as Record<string, string>;
    expect(scripts.dev).toContain("@acme/widget-backend");
    expect(scripts.pack).toContain("--bundle");
  });
});

describe("scaffoldStandaloneWorkspace — versions", () => {
  it("rewrites every published @checkstack/* dep to a concrete version", async () => {
    const root = makeTmpDir();
    await scaffoldStandaloneWorkspace({
      rootDir: root,
      baseName: "widget",
      description: "Widget plugin",
      packageScope: "acme",
      resolveVersion: fixedResolver("widget", "acme"),
    });

    const backend = readPkg(
      path.join(root, "packages", "widget-backend", "package.json"),
    );
    const deps = backend.dependencies as Record<string, string>;
    const devDeps = backend.devDependencies as Record<string, string>;
    // A published @checkstack/* dep is now a concrete caret.
    expect(deps["@checkstack/common"]).toMatch(/^\^9\.9\.9/);
    expect(devDeps["@checkstack/scripts"]).toMatch(/^\^9\.9\.9/);
  });

  it("leaves the local trio siblings as workspace:* and no published workspace:* survives", async () => {
    const root = makeTmpDir();
    await scaffoldStandaloneWorkspace({
      rootDir: root,
      baseName: "widget",
      description: "Widget plugin",
      packageScope: "acme",
      resolveVersion: fixedResolver("widget", "acme"),
    });

    const backend = readPkg(
      path.join(root, "packages", "widget-backend", "package.json"),
    );
    const deps = backend.dependencies as Record<string, string>;
    // The local common sibling stays a workspace range (installs locally).
    expect(deps["@acme/widget-common"]).toBe("workspace:*");

    // No @checkstack/* (published) range is left as workspace:* in any
    // trio package.
    for (const type of ["common", "backend", "frontend"]) {
      const pkg = readPkg(
        path.join(root, "packages", `widget-${type}`, "package.json"),
      );
      const sections = ["dependencies", "devDependencies", "peerDependencies"];
      for (const section of sections) {
        const block = pkg[section] as Record<string, string> | undefined;
        if (!block) continue;
        for (const [name, range] of Object.entries(block)) {
          if (name.startsWith("@checkstack/")) {
            expect(range.startsWith("workspace:")).toBe(false);
          }
        }
      }
    }
  });
});

describe("scaffoldStandaloneWorkspace — bundle emission", () => {
  it("sets checkstack.bundle on the backend listing the scoped siblings", async () => {
    const root = makeTmpDir();
    await scaffoldStandaloneWorkspace({
      rootDir: root,
      baseName: "widget",
      description: "Widget plugin",
      packageScope: "acme",
      resolveVersion: fixedResolver("widget", "acme"),
    });

    const backend = readPkg(
      path.join(root, "packages", "widget-backend", "package.json"),
    );
    const checkstack = backend.checkstack as { bundle?: string[] };
    expect(checkstack.bundle).toEqual([
      "@acme/widget-common",
      "@acme/widget-frontend",
    ]);
  });

  it("does NOT set checkstack.bundle on the common/frontend siblings", async () => {
    const root = makeTmpDir();
    await scaffoldStandaloneWorkspace({
      rootDir: root,
      baseName: "widget",
      description: "Widget plugin",
      packageScope: "",
      resolveVersion: fixedResolver("widget", ""),
    });

    for (const type of ["common", "frontend"]) {
      const pkg = readPkg(
        path.join(root, "packages", `widget-${type}`, "package.json"),
      );
      const checkstack = pkg.checkstack as { bundle?: unknown };
      expect(checkstack.bundle).toBeUndefined();
    }
  });

  it("emits unscoped sibling bundle names when no scope is given", async () => {
    const root = makeTmpDir();
    await scaffoldStandaloneWorkspace({
      rootDir: root,
      baseName: "widget",
      description: "Widget plugin",
      packageScope: "",
      resolveVersion: fixedResolver("widget", ""),
    });

    const backend = readPkg(
      path.join(root, "packages", "widget-backend", "package.json"),
    );
    expect(backend.name).toBe("widget-backend");
    const checkstack = backend.checkstack as { bundle?: string[] };
    expect(checkstack.bundle).toEqual(["widget-common", "widget-frontend"]);
  });
});
