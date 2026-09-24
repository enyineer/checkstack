import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { findManifestSidecars } from "./cache-layout";

describe("findManifestSidecars", () => {
  let work: string;

  beforeEach(async () => {
    work = await mkdtemp(path.join(tmpdir(), "cs-cache-layout-"));
  });
  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  test("finds sidecars whose packument mentions the package", async () => {
    await writeFile(
      path.join(work, "aaaa1111.npm"),
      "bun-npm-manifest-cache...leftpad...https://registry.npmjs.org/leftpad",
    );
    await writeFile(path.join(work, "bbbb2222.npm"), "other-package only");

    expect(await findManifestSidecars({ cacheDir: work, name: "leftpad" }))[
      "toEqual"
    ](["aaaa1111.npm"]);
  });

  test("finds every matching sidecar (e.g. per-registry packuments)", async () => {
    await writeFile(path.join(work, "a1.npm"), "x leftpad y");
    await writeFile(path.join(work, "b2.npm"), "leftpad again");
    await writeFile(path.join(work, "c3.npm"), "unrelated");

    const sidecars = await findManifestSidecars({ cacheDir: work, name: "leftpad" });
    expect(sidecars).toHaveLength(2);
    expect(sidecars).toContain("a1.npm");
    expect(sidecars).toContain("b2.npm");
  });

  test("only considers .npm files, ignoring other files that mention the name", async () => {
    await writeFile(path.join(work, "c4.npm"), "not-our-package");
    await writeFile(path.join(work, "marker.txt"), "leftpad");
    expect(
      await findManifestSidecars({ cacheDir: work, name: "leftpad" }),
    ).toEqual([]);
  });

  test("returns [] for a missing cache dir", async () => {
    expect(
      await findManifestSidecars({
        cacheDir: path.join(work, "does-not-exist"),
        name: "leftpad",
      }),
    ).toEqual([]);
  });

  test("matches the name inside binary packument bytes", async () => {
    // Binary-ish content with NULs around the name (as in the real format).
    const bytes = new Uint8Array(64);
    bytes.set([0, 1, 2, 0], 0);
    Buffer.from("leftpad").forEach((b, i) => {
      bytes[16 + i] = b;
    });
    await writeFile(path.join(work, "e6.npm"), bytes);

    expect(await findManifestSidecars({ cacheDir: work, name: "leftpad" })).toEqual(
      ["e6.npm"],
    );
  });
});
