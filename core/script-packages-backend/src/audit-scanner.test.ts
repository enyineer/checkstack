import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createAuditScanner,
  type SpawnFn,
  type SpawnOptions,
} from "./audit-scanner";

/**
 * Unit tests for the audit scanner's spawn wiring. We inject a fake `spawn`
 * so no real process runs - the property under test is that the audit reuses
 * the installer's SHARED cache dir (via `BUN_INSTALL_CACHE_DIR`) rather than
 * Bun's default global cache, so it cannot drift from the install path.
 */
describe("createAuditScanner spawn wiring", () => {
  let work: string;

  beforeEach(async () => {
    work = await mkdtemp(path.join(tmpdir(), "cs-audit-scanner-"));
  });
  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  function fakeSpawn(stdouts: string[]): {
    spawnFn: SpawnFn;
    calls: SpawnOptions[];
  } {
    const calls: SpawnOptions[] = [];
    let i = 0;
    const spawnFn: SpawnFn = (options) => {
      calls.push(options);
      const out = stdouts[i] ?? "";
      i += 1;
      return {
        stdout: new Response(out).body!,
        stderr: new Response("").body!,
        exited: Promise.resolve(0),
      };
    };
    return { spawnFn, calls };
  }

  test("passes the shared cache dir as BUN_INSTALL_CACHE_DIR to install AND audit", async () => {
    const cacheDir = path.join(work, "shared-cache");
    // First spawn = install (empty stdout), second = audit (JSON advisories).
    const auditJson = JSON.stringify({
      lodash: [
        { id: 1, severity: "high", vulnerable_versions: "<4.17.21" },
      ],
    });
    const { spawnFn, calls } = fakeSpawn(["", auditJson]);

    const scanner = createAuditScanner({
      scratchDir: path.join(work, "scratch"),
      cacheDir,
      registry: {
        registryUrl: "https://registry.npmjs.org/",
        scopedRegistries: [],
        authToken: undefined,
      },
      spawnFn,
    });

    const result = await scanner.scan({
      packages: [{ name: "lodash", version: "4.17.4", enabled: true }],
      ignoreScripts: true,
    });

    expect(calls).toHaveLength(2);
    // Both the install and the audit spawn must point at the shared cache dir.
    expect(calls[0]!.env.BUN_INSTALL_CACHE_DIR).toBe(cacheDir);
    expect(calls[1]!.env.BUN_INSTALL_CACHE_DIR).toBe(cacheDir);
    // First spawn installs (with --ignore-scripts), second runs `audit --json`.
    expect(calls[0]!.cmd).toContain("install");
    expect(calls[0]!.cmd).toContain("--ignore-scripts");
    expect(calls[1]!.cmd).toEqual([process.execPath, "audit", "--json"]);
    // The parsed advisory comes through.
    expect(result.advisories).toHaveLength(1);
    expect(result.advisories[0]!.packageName).toBe("lodash");
  });

  test("short-circuits (no spawn) when there are no enabled packages", async () => {
    const { spawnFn, calls } = fakeSpawn([]);
    const scanner = createAuditScanner({
      scratchDir: path.join(work, "scratch"),
      cacheDir: path.join(work, "cache"),
      registry: {
        registryUrl: "https://registry.npmjs.org/",
        scopedRegistries: [],
        authToken: undefined,
      },
      spawnFn,
    });
    const result = await scanner.scan({ packages: [], ignoreScripts: true });
    expect(result.advisories).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
