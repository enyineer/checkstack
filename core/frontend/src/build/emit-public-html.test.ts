import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { copyIndexToPublic, emitPublicHtml } from "./emit-public-html";

/**
 * Regression guard for the custom-domain public bundle. The backend serves a
 * verified custom-domain host from `public.html` and 404s if it is missing
 * (`core/backend/src/index.ts`). The build never emitted `public.html`, so every
 * custom-domain navigational route 404'd from the moment the feature shipped in
 * #341. This proves the build step now produces `public.html` from the built
 * `index.html`, so that gap cannot silently return.
 */
const tmpDirs: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "emit-public-html-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("emit-public-html", () => {
  test("copyIndexToPublic writes public.html byte-identical to index.html", () => {
    const dir = tmp();
    const html = "<!doctype html><html><body>entry</body></html>";
    fs.writeFileSync(path.join(dir, "index.html"), html);

    expect(copyIndexToPublic(dir)).toBe(true);

    const publicPath = path.join(dir, "public.html");
    expect(fs.existsSync(publicPath)).toBe(true);
    expect(fs.readFileSync(publicPath, "utf8")).toBe(html);
  });

  test("copyIndexToPublic is a no-op (returns false) when index.html is absent", () => {
    const dir = tmp();
    expect(copyIndexToPublic(dir)).toBe(false);
    expect(fs.existsSync(path.join(dir, "public.html"))).toBe(false);
  });

  test("the vite plugin emits public.html on writeBundle, keyed to options.dir", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "index.html"), "<html>x</html>");
    const plugin = emitPublicHtml({ fallbackDir: "/nonexistent" });

    // Invoke the writeBundle hook the way rollup/vite does, with the real out dir.
    const hook = plugin.writeBundle;
    const fn = typeof hook === "function" ? hook : hook?.handler;
    if (!fn) throw new Error("writeBundle hook missing");
    // The bundle arg is unused by this plugin; pass the output options with dir.
    // @ts-expect-error - only `dir` is read; a full NormalizedOutputOptions is not needed.
    fn.call({}, { dir }, {});

    expect(fs.existsSync(path.join(dir, "public.html"))).toBe(true);
  });
});
