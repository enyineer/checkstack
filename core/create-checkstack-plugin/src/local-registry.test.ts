import { describe, it, expect, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildVerdaccioConfig,
  buildNpmrc,
  buildBunPublishArgs,
  buildNpmViewVersionArgs,
  discoverWorkspacePackages,
  publishWorkspacePackages,
  findMonorepoRoot,
  DEFAULT_REGISTRY_URL,
  type WorkspacePackage,
} from "./local-registry";

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccp-localreg-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("buildVerdaccioConfig", () => {
  it("grants anonymous publish to @checkstack/* and create-checkstack-plugin", () => {
    const yaml = buildVerdaccioConfig({ storageDir: "/tmp/store", port: 4999 });
    expect(yaml).toContain("'@checkstack/*'");
    expect(yaml).toContain("'create-checkstack-plugin'");
    expect(yaml).toContain("publish: $anonymous");
    expect(yaml).toContain("listen: 0.0.0.0:4999");
    expect(yaml).toContain('storage: "/tmp/store"');
    // Large bundled platform tarballs must not hit Verdaccio's 10mb default
    // body cap (413 Payload Too Large).
    expect(yaml).toContain("max_body_size: 500mb");
    // Falls back to the public registry for third-party transitive deps.
    expect(yaml).toContain("proxy: npmjs");
  });
});

describe("buildNpmrc", () => {
  it("pins the scope to the local registry and carries a throwaway token", () => {
    const npmrc = buildNpmrc({ registryUrl: "http://localhost:4873" });
    expect(npmrc).toContain("@checkstack:registry=http://localhost:4873");
    expect(npmrc).toContain("//localhost:4873/:_authToken=fake-checkstack-it-token");
  });

  it("defaults to the default registry url", () => {
    expect(buildNpmrc()).toContain(`registry=${DEFAULT_REGISTRY_URL}`);
  });
});

describe("buildBunPublishArgs / buildNpmViewVersionArgs", () => {
  it("targets the local registry", () => {
    expect(buildBunPublishArgs({ registryUrl: "http://x:1" })).toEqual([
      "publish",
      "--registry",
      "http://x:1",
      "--access",
      "public",
    ]);
    expect(
      buildNpmViewVersionArgs({ packageName: "@checkstack/common", registryUrl: "http://x:1" }),
    ).toEqual(["view", "@checkstack/common", "version", "--registry", "http://x:1"]);
  });
});

describe("discoverWorkspacePackages", () => {
  it("collects core/* + plugins/* package.jsons, skipping _-dirs and missing names", () => {
    const root = makeTmpDir();
    const mk = (rel: string, json: Record<string, unknown>) => {
      const dir = path.join(root, rel);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(json));
    };
    mk("core/alpha", { name: "@checkstack/alpha", version: "1.0.0" });
    mk("core/secret", { name: "@checkstack/release", version: "1.0.0", private: true });
    mk("core/_test-scaffolds", { name: "@checkstack/scaffolds", version: "1.0.0" });
    mk("plugins/beta", { name: "@checkstack/beta", version: "2.0.0" });
    mk("plugins/nameless", { version: "3.0.0" });

    const found = discoverWorkspacePackages({ monorepoRoot: root });
    const names = found.map((p) => p.name).sort();
    expect(names).toEqual(["@checkstack/alpha", "@checkstack/beta", "@checkstack/release"]);
    expect(found.find((p) => p.name === "@checkstack/release")?.private).toBe(true);
    expect(found.find((p) => p.name === "@checkstack/alpha")?.private).toBe(false);
  });
});

describe("publishWorkspacePackages", () => {
  it("publishes only non-private packages via the injected runner with registry env", () => {
    const packages: WorkspacePackage[] = [
      { name: "@checkstack/a", version: "1.0.0", dir: "/repo/core/a", private: false },
      { name: "@checkstack/priv", version: "1.0.0", dir: "/repo/core/priv", private: true },
      { name: "@checkstack/b", version: "2.0.0", dir: "/repo/core/b", private: false },
    ];
    const calls: { command: string; args: string[]; cwd: string; userconfig?: string; registry?: string }[] = [];
    const outcomes = publishWorkspacePackages({
      packages,
      registryUrl: "http://localhost:4873",
      npmrcPath: "/tmp/.npmrc",
      env: {},
      run: ({ command, args, cwd, env }) => {
        calls.push({
          command,
          args,
          cwd,
          userconfig: env.NPM_CONFIG_USERCONFIG,
          registry: env.BUN_CONFIG_REGISTRY,
        });
        return { status: 0, stderr: "" };
      },
    });
    expect(outcomes.map((o) => o.name)).toEqual(["@checkstack/a", "@checkstack/b"]);
    expect(outcomes.every((o) => o.status === 0)).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.command).toBe("bun");
    expect(calls[0]?.args).toContain("publish");
    expect(calls[0]?.userconfig).toBe("/tmp/.npmrc");
    expect(calls[0]?.registry).toBe("http://localhost:4873");
  });
});

describe("findMonorepoRoot", () => {
  it("walks up to the checkstack-monorepo package.json", () => {
    const root = makeTmpDir();
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "checkstack-monorepo" }),
    );
    const nested = path.join(root, "core", "create-checkstack-plugin", "src");
    fs.mkdirSync(nested, { recursive: true });
    expect(findMonorepoRoot({ from: nested })).toBe(root);
  });

  it("throws when no monorepo root is found", () => {
    const root = makeTmpDir();
    expect(() => findMonorepoRoot({ from: root })).toThrow(/checkstack-monorepo/);
  });
});
