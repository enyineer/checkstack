import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * `@module-federation/vite` is deliberately pinned EXACTLY - in the host
 * (`core/frontend`, so a broken upstream release can never ride in on the
 * automerged lock-file-maintenance PR and hold every other security update
 * hostage) and in the scaffolded plugin frontend template (a scaffolded
 * workspace has no lockfile, so a range there resolves to whatever upstream
 * published minutes ago - exactly how 1.17.1 broke CI). MF is the host<->
 * remote ABI surface, so the two pins MUST be the same version: this guard
 * fails the moment someone bumps one side without the other.
 */
describe("@module-federation/vite pin lockstep", () => {
  const read = (rel: string): string =>
    readFileSync(path.join(__dirname, rel), "utf8");

  const extractPin = (source: string, file: string): string => {
    const match = source.match(/"@module-federation\/vite":\s*"([^"]+)"/);
    if (!match) throw new Error(`no @module-federation/vite dep in ${file}`);
    return match[1]!;
  };

  it("host and plugin template pin the identical exact version", () => {
    const hostPin = extractPin(
      read("../../../frontend/package.json"),
      "core/frontend/package.json",
    );
    const templatePin = extractPin(
      read("../templates/frontend/package.json.hbs"),
      "core/scripts/src/templates/frontend/package.json.hbs",
    );

    expect(templatePin).toBe(hostPin);
    // An exact pin, not a range: ranges are what let an untested upstream
    // release into a build.
    expect(hostPin).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
