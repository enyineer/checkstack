import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * LOAD-BEARING resolution test (plan §4.1, §9 Phase-1 row 4).
 *
 * Asserts that under `nodenext` module resolution an external consumer
 * resolves `@checkstack/sdk/healthcheck` and `@checkstack/sdk/integration`
 * through the package's `exports` map to EXACTLY their own per-subpath
 * `.d.ts` — not a shared ambient file. The negative fixture proves the two
 * subpaths do not bleed into each other.
 *
 * The package is symlinked into a temp `node_modules/@checkstack/sdk` so the
 * REAL `exports` map drives resolution (a `paths` mapping would bypass it and
 * defeat the test).
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const SDK_PKG_DIR = path.resolve(import.meta.dirname, "..");
const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures");
const TSC = path.join(REPO_ROOT, "node_modules", ".bin", "tsc");

const NODENEXT_COMPILER_OPTIONS = {
  module: "nodenext",
  moduleResolution: "nodenext",
  target: "esnext",
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  // No ambient libs — the subpath `.d.ts` must stand alone.
  types: [] as string[],
};

let workDir: string;

function runTsc({
  consumer,
  tsconfigName,
}: {
  consumer: string;
  tsconfigName: string;
}) {
  const tsconfigPath = path.join(workDir, tsconfigName);
  writeFileSync(
    tsconfigPath,
    JSON.stringify(
      {
        compilerOptions: NODENEXT_COMPILER_OPTIONS,
        include: [consumer],
      },
      undefined,
      2,
    ),
    "utf8",
  );
  return spawnSync(TSC, ["-p", tsconfigPath], {
    cwd: workDir,
    encoding: "utf8",
  });
}

beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "checkstack-sdk-resolution-"));
  mkdirSync(path.join(workDir, "node_modules", "@checkstack"), {
    recursive: true,
  });
  symlinkSync(
    SDK_PKG_DIR,
    path.join(workDir, "node_modules", "@checkstack", "sdk"),
    "dir",
  );
});

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe("@checkstack/sdk subpath exports (nodenext)", () => {
  test("healthcheck + integration subpaths resolve to their own surface", async () => {
    // Materialize fixture contents synchronously for tsc.
    writeFileSync(
      path.join(workDir, "consumer-good.ts"),
      await Bun.file(path.join(FIXTURES_DIR, "consumer-good.ts")).text(),
      "utf8",
    );
    const result = runTsc({
      consumer: "consumer-good.ts",
      tsconfigName: "tsconfig.good.json",
    });
    if (result.status !== 0) {
      console.error(result.stdout, result.stderr);
    }
    expect(result.status).toBe(0);
  });

  test("importing a foreign helper from a subpath is a resolution error", async () => {
    writeFileSync(
      path.join(workDir, "consumer-cross-subpath.ts"),
      await Bun.file(
        path.join(FIXTURES_DIR, "consumer-cross-subpath.ts"),
      ).text(),
      "utf8",
    );
    const result = runTsc({
      consumer: "consumer-cross-subpath.ts",
      tsconfigName: "tsconfig.cross.json",
    });
    expect(result.status).not.toBe(0);
    // TS2305: Module has no exported member 'defineIntegration'.
    expect(result.stdout + result.stderr).toContain("defineIntegration");
  });
});
