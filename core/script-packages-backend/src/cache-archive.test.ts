import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn } from "bun";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { packDir, unpackInto } from "./cache-archive";

/** Build a gzip tar whose single entry is `entryName` (allowing `..`/abs). */
async function makeArchiveWithEntry(
  cwd: string,
  entryName: string,
): Promise<Uint8Array> {
  // `-P`/`--absolute-names` lets us store traversing or absolute names that
  // tar would otherwise strip — exactly the malicious shape we defend against.
  const proc = spawn({
    cmd: ["tar", "-czf", "-", "-P", entryName],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [bytes, exitCode] = await Promise.all([
    new Response(proc.stdout).bytes(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error("failed to build malicious archive");
  return bytes;
}

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

  test("refuses an archive entry that traverses out with ..", async () => {
    // Build an archive whose entry NAME is `../escape`. tar resolves the
    // name relative to its cwd, so the file lives one level up from cwd.
    const base = path.join(work, "base");
    const cwd = path.join(base, "inner");
    await mkdir(cwd, { recursive: true });
    await writeFile(path.join(base, "escape"), "pwned\n");
    const blob = await makeArchiveWithEntry(cwd, "../escape");

    const dest = path.join(work, "dest");
    await mkdir(dest, { recursive: true });

    await expect(
      unpackInto({ targetDir: dest, bytes: blob }),
    ).rejects.toThrow(/unsafe archive entry/i);

    // Nothing was written outside dest (the sibling "escape" must not appear).
    const siblings = await readdir(work);
    expect(siblings).not.toContain("escape");
  });

  test("refuses an archive entry with an absolute path", async () => {
    const payloadDir = path.join(work, "payload2");
    await mkdir(payloadDir, { recursive: true });
    await writeFile(path.join(payloadDir, "abs.txt"), "x\n");
    // Absolute entry name (e.g. /tmp/.../abs.txt).
    const absName = path.join(payloadDir, "abs.txt");
    const blob = await makeArchiveWithEntry("/", absName.replace(/^\//, "/"));

    const dest = path.join(work, "dest");
    await mkdir(dest, { recursive: true });
    await expect(
      unpackInto({ targetDir: dest, bytes: blob }),
    ).rejects.toThrow(/unsafe archive entry/i);
  });
});
