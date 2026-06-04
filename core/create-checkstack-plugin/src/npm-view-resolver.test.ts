import { describe, it, expect } from "bun:test";
import {
  createNpmViewResolver,
  buildNpmViewArgs,
  type NpmViewRunner,
} from "./npm-view-resolver";

/** Records every package it was asked for and answers from a fixed table. */
function fakeRunner(
  versions: Record<string, string>,
): { runner: NpmViewRunner; calls: string[] } {
  const calls: string[] = [];
  const runner: NpmViewRunner = ({ packageName }) => {
    calls.push(packageName);
    const v = versions[packageName];
    return Promise.resolve(v ? { version: v } : { version: undefined });
  };
  return { runner, calls };
}

describe("buildNpmViewArgs", () => {
  it("queries <pkg>@<tag> version with the default latest tag", () => {
    expect(
      buildNpmViewArgs({ packageName: "@checkstack/common" }),
    ).toEqual(["view", "@checkstack/common@latest", "version"]);
  });

  it("threads a custom version tag", () => {
    expect(
      buildNpmViewArgs({ packageName: "@checkstack/common", versionTag: "next" }),
    ).toEqual(["view", "@checkstack/common@next", "version"]);
  });

  it("threads a custom registry", () => {
    expect(
      buildNpmViewArgs({
        packageName: "@checkstack/common",
        registry: "http://localhost:4873",
      }),
    ).toEqual([
      "view",
      "@checkstack/common@latest",
      "version",
      "--registry",
      "http://localhost:4873",
    ]);
  });
});

describe("createNpmViewResolver", () => {
  it("resolves a published @checkstack/* dep to a caret on its latest version", async () => {
    const { runner } = fakeRunner({ "@checkstack/common": "0.12.0" });
    const resolve = createNpmViewResolver({ runNpmView: runner });

    expect(
      await resolve({
        packageName: "@checkstack/common",
        workspaceRange: "workspace:*",
      }),
    ).toBe("^0.12.0");
  });

  it("resolves each @checkstack/* dep independently (not lockstepped)", async () => {
    const { runner } = fakeRunner({
      "@checkstack/common": "0.12.0",
      "@checkstack/backend": "0.15.0",
    });
    const resolve = createNpmViewResolver({ runNpmView: runner });

    expect(
      await resolve({
        packageName: "@checkstack/common",
        workspaceRange: "workspace:*",
      }),
    ).toBe("^0.12.0");
    expect(
      await resolve({
        packageName: "@checkstack/backend",
        workspaceRange: "workspace:*",
      }),
    ).toBe("^0.15.0");
  });

  it("leaves local workspace siblings as workspace:* (not published)", async () => {
    const { runner, calls } = fakeRunner({});
    const resolve = createNpmViewResolver({
      runNpmView: runner,
      localSiblings: new Set(["widget-common", "widget-frontend"]),
    });

    expect(
      await resolve({
        packageName: "widget-common",
        workspaceRange: "workspace:*",
      }),
    ).toBe("workspace:*");
    // The registry is never queried for a local sibling.
    expect(calls).not.toContain("widget-common");
  });

  it("caches a resolution so the registry is queried once per package", async () => {
    const { runner, calls } = fakeRunner({ "@checkstack/common": "0.12.0" });
    const resolve = createNpmViewResolver({ runNpmView: runner });

    await resolve({
      packageName: "@checkstack/common",
      workspaceRange: "workspace:*",
    });
    await resolve({
      packageName: "@checkstack/common",
      workspaceRange: "workspace:*",
    });
    expect(calls).toEqual(["@checkstack/common"]);
  });

  it("returns undefined for an unresolvable published dep so the engine can aggregate the failure", async () => {
    const { runner } = fakeRunner({});
    const resolve = createNpmViewResolver({ runNpmView: runner });

    expect(
      await resolve({
        packageName: "@checkstack/common",
        workspaceRange: "workspace:*",
      }),
    ).toBeUndefined();
  });

  it("propagates a subprocess failure (registry unreachable)", async () => {
    const runner: NpmViewRunner = () =>
      Promise.reject(new Error("npm view exited with status 1"));
    const resolve = createNpmViewResolver({ runNpmView: runner });

    await expect(
      resolve({
        packageName: "@checkstack/common",
        workspaceRange: "workspace:*",
      }),
    ).rejects.toThrow(/npm view exited/);
  });
});
