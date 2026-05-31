import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn } from "bun";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
  symlink,
} from "node:fs/promises";
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

  test("refuses a symlink entry with a safe name but an escaping target", async () => {
    // A symlink entry whose NAME is harmless (`evil`, no `..`/abs) but whose
    // TARGET escapes (`-> /etc`). The old name-only listing pass let it
    // through, then a later regular-file entry could write THROUGH the link
    // and escape targetDir. unpackInto must reject any symlink entry outright.
    const src = path.join(work, "linksrc");
    await mkdir(src, { recursive: true });
    await symlink("/etc", path.join(src, "evil"));
    const blob = await packDir({ parentDir: work, entryName: "linksrc" });

    const dest = path.join(work, "dest");
    await mkdir(dest, { recursive: true });
    await expect(
      unpackInto({ targetDir: dest, bytes: blob }),
    ).rejects.toThrow(/symlink|link/i);

    // Nothing materialized: the link must not exist under dest.
    expect(
      await readdir(dest).catch(() => []),
    ).not.toContain("linksrc");
  });

  test("refuses a relative symlink target that traverses with ..", async () => {
    const src = path.join(work, "linksrc2");
    await mkdir(src, { recursive: true });
    await symlink("../../../escape", path.join(src, "ln"));
    const blob = await packDir({ parentDir: work, entryName: "linksrc2" });

    const dest = path.join(work, "dest2");
    await mkdir(dest, { recursive: true });
    await expect(
      unpackInto({ targetDir: dest, bytes: blob }),
    ).rejects.toThrow(/symlink|link/i);
  });

  test("still round-trips a plain (link-free) directory after the link guard", async () => {
    const src = path.join(work, "plainsrc");
    await mkdir(path.join(src, "pkg@1.0.0"), { recursive: true });
    await writeFile(
      path.join(src, "pkg@1.0.0", "index.js"),
      "module.exports = 2;\n",
    );
    const blob = await packDir({ parentDir: src, entryName: "pkg@1.0.0" });
    const dest = path.join(work, "plaindest");
    await mkdir(dest, { recursive: true });
    await unpackInto({ targetDir: dest, bytes: blob });
    expect(
      await readFile(path.join(dest, "pkg@1.0.0", "index.js"), "utf8"),
    ).toBe("module.exports = 2;\n");
  });

  test("refuses an archive entry with an absolute path", async () => {
    const payloadDir = path.join(work, "payload2");
    await mkdir(payloadDir, { recursive: true });
    await writeFile(path.join(payloadDir, "abs.txt"), "x\n");
    // Absolute entry name (e.g. /tmp/.../abs.txt).
    const absName = path.join(payloadDir, "abs.txt");
    const blob = await makeArchiveWithEntry("/", absName);

    const dest = path.join(work, "dest");
    await mkdir(dest, { recursive: true });
    await expect(
      unpackInto({ targetDir: dest, bytes: blob }),
    ).rejects.toThrow(/unsafe archive entry/i);
  });
});
