import { describe, it, expect, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  scaffoldPlugin,
  refreshMonorepoReferences,
  resolveTargetDir,
  type ScaffoldIo,
} from "./scaffold-plugin";
import type { VersionResolver } from "./rewrite-workspace-versions";
import type { copyTemplate } from "../utils/template";

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scaffold-engine-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const constantResolver =
  (version: string): VersionResolver =>
  () =>
    Promise.resolve(version);

/** Records the copyTemplate args and writes nothing real. */
function recordingCopyTemplate(): {
  spy: typeof copyTemplate;
  calls: { templateDir: string; targetDir: string }[];
} {
  const calls: { templateDir: string; targetDir: string }[] = [];
  const spy: typeof copyTemplate = ({ templateDir, targetDir }) => {
    calls.push({ templateDir, targetDir });
    return [];
  };
  return { spy, calls };
}

describe("resolveTargetDir", () => {
  it("uses <rootDir>/<location>/<name> in monorepo mode", () => {
    expect(
      resolveTargetDir({
        mode: { kind: "monorepo", rootDir: "/repo", location: "plugins" },
        pluginName: "widget-backend",
      }),
    ).toBe(path.join("/repo", "plugins", "widget-backend"));
  });

  it("uses <targetDir>/<name> in standalone mode", () => {
    expect(
      resolveTargetDir({
        mode: { kind: "standalone", targetDir: "/out" },
        pluginName: "widget-backend",
      }),
    ).toBe(path.join("/out", "widget-backend"));
  });
});

describe("scaffoldPlugin — mode parameterization", () => {
  it("renders the matching template dir into the monorepo target", async () => {
    const { spy, calls } = recordingCopyTemplate();
    const io: Partial<ScaffoldIo> = { copyTemplate: spy };

    const result = await scaffoldPlugin({
      mode: { kind: "monorepo", rootDir: "/repo", location: "core" },
      baseName: "widget",
      description: "Widget plugin",
      pluginType: "backend",
      io,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].templateDir).toEndWith(path.join("templates", "backend"));
    expect(calls[0].targetDir).toBe(
      path.join("/repo", "core", "widget-backend"),
    );
    expect(result.templateData.pluginName).toBe("widget-backend");
    expect(result.templateData.pluginId).toBe("widget-backend");
  });

  it("does not rewrite versions in monorepo mode", async () => {
    const targetRoot = makeTmpDir();
    // Real render so a package.json with workspace:* lands on disk.
    await scaffoldPlugin({
      mode: { kind: "monorepo", rootDir: targetRoot, location: "core" },
      baseName: "widget",
      description: "Widget plugin",
      pluginType: "common",
    });
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(targetRoot, "core", "widget-common", "package.json"),
        "utf8",
      ),
    ) as { dependencies?: Record<string, string> };
    const ranges = Object.values(pkg.dependencies ?? {});
    expect(ranges.some((r) => r.startsWith("workspace:"))).toBe(true);
  });

  it("throws in standalone mode when no resolveVersion is supplied", async () => {
    const { spy } = recordingCopyTemplate();
    await expect(
      scaffoldPlugin({
        mode: { kind: "standalone", targetDir: makeTmpDir() },
        baseName: "widget",
        description: "Widget plugin",
        pluginType: "backend",
        io: { copyTemplate: spy },
      }),
    ).rejects.toThrow(/standalone mode requires a `resolveVersion`/);
  });

  it("rewrites every workspace range to a concrete version in standalone mode", async () => {
    const out = makeTmpDir();
    await scaffoldPlugin({
      mode: { kind: "standalone", targetDir: out },
      baseName: "widget",
      description: "Widget plugin",
      pluginType: "backend",
      resolveVersion: constantResolver("^1.2.3"),
    });

    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(out, "widget-backend", "package.json"),
        "utf8",
      ),
    ) as Record<string, Record<string, string> | undefined>;

    const allRanges = [
      ...Object.values(pkg.dependencies ?? {}),
      ...Object.values(pkg.devDependencies ?? {}),
      ...Object.values(pkg.peerDependencies ?? {}),
    ];
    expect(allRanges.some((r) => r.startsWith("workspace:"))).toBe(false);
    // Every @checkstack/* dep is now the concrete resolved version.
    expect(pkg.dependencies?.["@checkstack/common"]).toBe("^1.2.3");
    expect(pkg.devDependencies?.["@checkstack/scripts"]).toBe("^1.2.3");
  });

  it("reports the rewrite through the io.log seam in standalone mode", async () => {
    const out = makeTmpDir();
    const logs: string[] = [];
    await scaffoldPlugin({
      mode: { kind: "standalone", targetDir: out },
      baseName: "widget",
      description: "Widget plugin",
      pluginType: "backend",
      resolveVersion: constantResolver("^1.2.3"),
      io: { log: (m) => logs.push(m) },
    });
    expect(logs.some((m) => m.includes("Resolved workspace versions"))).toBe(
      true,
    );
  });

  it("fails loudly if a workspace dep cannot be resolved in standalone mode", async () => {
    const out = makeTmpDir();
    const failing: VersionResolver = () => Promise.resolve(undefined);
    await expect(
      scaffoldPlugin({
        mode: { kind: "standalone", targetDir: out },
        baseName: "widget",
        description: "Widget plugin",
        pluginType: "backend",
        resolveVersion: failing,
      }),
    ).rejects.toThrow(/must not emit 'workspace:\*'/);
  });
});

describe("refreshMonorepoReferences — gated by mode", () => {
  it("invokes the refresh in monorepo mode", () => {
    let called = 0;
    const status = refreshMonorepoReferences({
      mode: { kind: "monorepo", rootDir: "/repo", location: "core" },
      io: {
        refreshReferences: () => {
          called += 1;
          return 0;
        },
      },
    });
    expect(called).toBe(1);
    expect(status).toBe(0);
  });

  it("is a no-op in standalone mode", () => {
    let called = 0;
    const status = refreshMonorepoReferences({
      mode: { kind: "standalone", targetDir: "/out" },
      io: {
        refreshReferences: () => {
          called += 1;
          return 0;
        },
      },
    });
    expect(called).toBe(0);
    expect(status).toBe(0);
  });
});
