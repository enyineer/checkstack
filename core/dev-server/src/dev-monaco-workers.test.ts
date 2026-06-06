import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  __test,
  prepareMonacoWorkers,
  type ViteBuild,
} from "./dev-monaco-workers";

// `@codingame/*` worker entries live in `@checkstack/ui`'s deps (two levels up).
const UI_DIR = path.resolve(import.meta.dir, "../../ui");
const VSCODE_DIR = "/fake/vscode";

const tmpDirs: string[] = [];
function makeCacheBase(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccmw-test-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

/** A build that just writes a dummy bundle where vite would, tracking calls. */
function fakeBuild(): { fn: ViteBuild; calls: () => number } {
  let calls = 0;
  const fn: ViteBuild = (config) => {
    calls++;
    const b = config.build;
    if (!b?.outDir || !b.lib || typeof b.lib === "boolean") {
      throw new Error("unexpected build config");
    }
    const name =
      typeof b.lib.fileName === "function"
        ? b.lib.fileName("es", "entry")
        : String(b.lib.fileName);
    fs.writeFileSync(path.join(b.outDir, name), "export default {};\n");
    return Promise.resolve();
  };
  return { fn, calls: () => calls };
}

describe("computeCacheKey", () => {
  it("is deterministic for the same inputs", () => {
    const a = __test.computeCacheKey({ vscodeDir: "/x", versions: ["1", "2"] });
    const b = __test.computeCacheKey({ vscodeDir: "/x", versions: ["1", "2"] });
    expect(a).toBe(b);
  });

  it("changes when the vscode dir or a worker version changes", () => {
    const base = __test.computeCacheKey({ vscodeDir: "/x", versions: ["1"] });
    expect(__test.computeCacheKey({ vscodeDir: "/y", versions: ["1"] })).not.toBe(base);
    expect(__test.computeCacheKey({ vscodeDir: "/x", versions: ["2"] })).not.toBe(base);
  });
});

describe("buildAliases", () => {
  it("redirects each `?worker&url` import to its stub", () => {
    const aliases = __test.buildAliases("/cache");
    expect(aliases).toHaveLength(__test.WORKERS.length);
    for (const w of __test.WORKERS) {
      const a = aliases.find((x) => (x.find as RegExp).test(`${w.spec}?worker&url`));
      expect(a).toBeDefined();
      expect(a!.replacement).toBe(__test.stubFile("/cache", w.name));
      // Must NOT match the bare specifier without the worker query.
      expect((a!.find as RegExp).test(w.spec)).toBe(false);
    }
  });
});

describe("prepareMonacoWorkers", () => {
  it("builds once, then reuses the cache on a second call", async () => {
    const cacheBaseDir = makeCacheBase();
    const first = fakeBuild();
    const setupA = await prepareMonacoWorkers({
      resolveFrom: [UI_DIR],
      vscodeDir: VSCODE_DIR,
      cacheBaseDir,
      buildFn: first.fn,
    });
    expect(setupA).toBeDefined();
    expect(first.calls()).toBe(__test.WORKERS.length); // one build per worker
    expect(setupA!.aliases).toHaveLength(__test.WORKERS.length);

    // Stubs export the served worker URLs.
    for (const w of __test.WORKERS) {
      const stub = setupA!.aliases.find(
        (a) => a.replacement.endsWith(`${w.name}.stub.js`),
      )!.replacement;
      expect(fs.readFileSync(stub, "utf8")).toContain(
        `${__test.SERVE_PREFIX}${w.name}.worker.js`,
      );
    }

    // Second call: same inputs → cache hit, build NOT invoked again.
    const second = fakeBuild();
    const setupB = await prepareMonacoWorkers({
      resolveFrom: [UI_DIR],
      vscodeDir: VSCODE_DIR,
      cacheBaseDir,
      buildFn: second.fn,
    });
    expect(setupB).toBeDefined();
    expect(second.calls()).toBe(0);
  });

  it("returns undefined and leaves no ready cache when the build fails", async () => {
    const cacheBaseDir = makeCacheBase();
    const failing: ViteBuild = () => Promise.reject(new Error("boom"));
    const setup = await prepareMonacoWorkers({
      resolveFrom: [UI_DIR],
      vscodeDir: VSCODE_DIR,
      cacheBaseDir,
      buildFn: failing,
    });
    expect(setup).toBeUndefined();
    // No promoted cache dir was left behind (only the base remains).
    const entries = fs
      .readdirSync(cacheBaseDir)
      .filter((e) => __test.isCacheReady(path.join(cacheBaseDir, e)));
    expect(entries).toHaveLength(0);
  });

  it("returns undefined when the editor stack can't be resolved", async () => {
    const cacheBaseDir = makeCacheBase();
    const { fn } = fakeBuild();
    const setup = await prepareMonacoWorkers({
      resolveFrom: [path.join(cacheBaseDir, "does-not-exist")],
      vscodeDir: VSCODE_DIR,
      cacheBaseDir,
      buildFn: fn,
    });
    expect(setup).toBeUndefined();
  });
});
