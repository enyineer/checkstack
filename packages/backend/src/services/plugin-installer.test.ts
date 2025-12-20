import { describe, it, expect, mock, beforeEach } from "bun:test";

// 1. Mock child_process and fs BEFORE importing the target module
const mockExec = mock((_cmd: string, cb: any) => {
  cb(null, { stdout: "mocked" }, { stderr: "" });
});

const mockExistsSync = mock(() => true);
const mockMkdirSync = mock();
const mockReadFileSync = mock(() => JSON.stringify({ name: "mock-plugin" }));

mock.module("node:util", () => ({
  promisify: (fn: any) => {
    return async (...args: any[]) => {
      // Return a promise that resolves with what our mock would return
      // We can just call mockExec and return its "result"
      return new Promise((resolve) => {
        fn(...args, (err: any, stdout: any, stderr: any) =>
          resolve({ stdout, stderr })
        );
      });
    };
  },
}));

mock.module("node:child_process", () => ({
  exec: mockExec,
}));

mock.module("node:fs", () => {
  const exports = {
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    readFileSync: mockReadFileSync,
  };
  return {
    ...exports,
    default: exports,
  };
});

// 2. Now import the module under test
import { PluginLocalInstaller } from "./plugin-installer";
import fs from "node:fs";
import path from "node:path";

describe("PluginLocalInstaller", () => {
  const runtimeDir = "/tmp/runtime_plugins";
  let installer: PluginLocalInstaller;
  let customExec: any;

  beforeEach(() => {
    customExec = mock(() => Promise.resolve({ stdout: "mocked", stderr: "" }));
    installer = new PluginLocalInstaller(runtimeDir, customExec);
    mockExistsSync.mockClear();
    mockExistsSync.mockReturnValue(true);
  });

  it("should install a package using npm", async () => {
    const result = await installer.install("my-plugin");

    expect(customExec).toHaveBeenCalled();
    const command = customExec.mock.calls[0][0];
    expect(command).toContain("npm install my-plugin");
    expect(command).toContain(`--prefix ${path.resolve(runtimeDir)}`);

    expect(result.name).toBe("mock-plugin");
  });

  it("should handle scoped packages correctly", async () => {
    const result = await installer.install("@scope/plugin");

    expect(customExec).toHaveBeenCalled();
    const command = customExec.mock.calls[0][0];
    expect(command).toContain("npm install @scope/plugin");

    expect(result.name).toBe("mock-plugin");
  });

  it("should throw error if package.json is missing after install", async () => {
    // The constructor was already called in beforeEach.
    // The next call to existsSync will be inside the install method for the pkgJsonPath.
    mockExistsSync.mockReturnValueOnce(false);

    await expect(installer.install("failing-plugin")).rejects.toThrow(
      "not found"
    );
  });
});
