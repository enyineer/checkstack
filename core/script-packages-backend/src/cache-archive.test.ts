import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { packDir, unpackInto } from "./cache-archive";

describe("cache-archive pack/unpack", () => {
  let work: string;

  beforeEach(async () => {
    work = await mkdtemp(path.join(tmpdir(), "cs-archive-"));
  });
  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  test("round-trips a directory tree through tar+gzip", async () => {
    const src = path.join(work, "src");
    const entry = "pkg@1.0.0";
    const entryDir = path.join(src, entry);
    await mkdir(path.join(entryDir, "sub"), { recursive: true });
    await writeFile(path.join(entryDir, "index.js"), "module.exports = 1;\n");
    await writeFile(path.join(entryDir, "sub", "x.txt"), "deep\n");

    const blob = await packDir({ parentDir: src, entryName: entry });
    expect(blob.byteLength).toBeGreaterThan(0);

    const dest = path.join(work, "dest");
    await mkdir(dest, { recursive: true });
    await unpackInto({ targetDir: dest, bytes: blob });

    expect(await readFile(path.join(dest, entry, "index.js"), "utf8")).toBe(
      "module.exports = 1;\n",
    );
    expect(await readFile(path.join(dest, entry, "sub", "x.txt"), "utf8")).toBe(
      "deep\n",
    );
  });

  test("throws on a corrupt archive", async () => {
    const dest = path.join(work, "dest");
    await mkdir(dest, { recursive: true });
    await expect(
      unpackInto({ targetDir: dest, bytes: new Uint8Array([1, 2, 3, 4]) }),
    ).rejects.toThrow(/tar extract failed/i);
  });
});
