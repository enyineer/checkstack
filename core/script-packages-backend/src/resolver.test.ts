import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCentralResolver } from "./resolver";

/**
 * Hermetic resolver tests. No internet: we point the registry at an
 * unreachable loopback address so `bun install` fails fast (connection
 * refused), exercising the REAL resolve path through to its error.
 *
 * The security-relevant property under test: the scratch dir holds a
 * plaintext `.npmrc` with the registry auth token, so it MUST be removed on
 * EVERY exit path - including failures - not only on the success path.
 */
describe("createCentralResolver scratch cleanup", () => {
  let work: string;

  beforeEach(async () => {
    work = await mkdtemp(path.join(tmpdir(), "cs-resolver-"));
  });
  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  async function exists(p: string): Promise<boolean> {
    try {
      await stat(p);
      return true;
    } catch {
      return false;
    }
  }

  test("removes the token-bearing scratch dir when bun install fails", async () => {
    const scratchDir = path.join(work, "scratch");
    const resolver = createCentralResolver({
      scratchDir,
      cacheDir: path.join(work, "cache"),
      registry: {
        // Unreachable loopback → fast ConnectionRefused, no real network.
        registryUrl: "http://127.0.0.1:1/",
        scopedRegistries: [],
        authToken: "super-secret-token",
      },
    });

    await expect(
      resolver.resolve({
        packages: [
          {
            name: "definitely-not-a-real-pkg-xyz-123",
            version: "1.0.0",
            enabled: true,
          },
        ],
        ignoreScripts: true,
      }),
    ).rejects.toThrow();

    // The scratch dir (and its .npmrc token) must be gone after the failure.
    expect(await exists(scratchDir)).toBe(false);
    expect(await exists(path.join(scratchDir, ".npmrc"))).toBe(false);
  }, 30_000);
});
