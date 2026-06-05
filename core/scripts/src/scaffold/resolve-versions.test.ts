import { describe, it, expect, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createWorkspaceMapResolver } from "./resolve-versions";

const tmpDirs: string[] = [];

function makeSiblingDir({ version }: { version: string }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-versions-"));
  tmpDirs.push(dir);
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "@checkstack/common", version }),
  );
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("createWorkspaceMapResolver", () => {
  it("resolves a workspace dep to a caret on the sibling's version", async () => {
    const dir = makeSiblingDir({ version: "0.12.0" });
    const resolve = createWorkspaceMapResolver({
      workspaceMap: new Map([["@checkstack/common", dir]]),
    });

    expect(
      await resolve({
        packageName: "@checkstack/common",
        workspaceRange: "workspace:*",
      }),
    ).toBe("^0.12.0");
  });

  it("returns undefined for a name not in the map", async () => {
    const resolve = createWorkspaceMapResolver({ workspaceMap: new Map() });
    expect(
      await resolve({
        packageName: "@checkstack/missing",
        workspaceRange: "workspace:*",
      }),
    ).toBeUndefined();
  });
});
