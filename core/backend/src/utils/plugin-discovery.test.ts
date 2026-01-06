import { describe, it, expect, beforeEach, mock } from "bun:test";
import {
  extractPluginMetadata,
  discoverLocalPlugins,
  syncPluginsToDatabase,
  type PluginMetadata,
} from "./plugin-discovery";
import fs from "node:fs";
import path from "node:path";

// Mock filesystem for testing
const mockExistsSync = mock(() => true);
const mockReadFileSync = mock(() => "{}");
const mockReaddirSync = mock(() => []);

mock.module("node:fs", () => {
  const exports = {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    readdirSync: mockReaddirSync,
  };
  return {
    ...exports,
    default: exports,
  };
});

describe("extractPluginMetadata", () => {
  beforeEach(() => {
    mockExistsSync.mockClear();
    mockReadFileSync.mockClear();
    mockExistsSync.mockReturnValue(true);
  });

  it("should extract metadata from valid backend plugin", () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        name: "@checkmate-monitor/test-backend",
        version: "0.0.1",
        type: "module",
      })
    );

    const result = extractPluginMetadata({
      pluginDir: "/fake/path/test-backend",
    });

    expect(result).toEqual({
      packageName: "@checkmate-monitor/test-backend",
      pluginPath: "/fake/path/test-backend",
      type: "backend",
      enabled: true,
    });
  });

  it("should extract metadata from valid frontend plugin", () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        name: "@checkmate-monitor/test-frontend",
      })
    );

    const result = extractPluginMetadata({
      pluginDir: "/fake/path/test-frontend",
    });

    expect(result?.type).toBe("frontend");
  });

  it("should extract metadata from valid common plugin", () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        name: "@checkmate-monitor/test-common",
      })
    );

    const result = extractPluginMetadata({
      pluginDir: "/fake/path/test-common",
    });

    expect(result?.type).toBe("common");
  });

  it("should return undefined if package.json is missing", () => {
    mockExistsSync.mockReturnValue(false);

    const result = extractPluginMetadata({
      pluginDir: "/fake/path/invalid",
    });

    expect(result).toBeUndefined();
  });

  it("should return undefined if package.json has no name field", () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        version: "0.0.1",
      })
    );

    const result = extractPluginMetadata({
      pluginDir: "/fake/path/invalid",
    });

    expect(result).toBeUndefined();
  });

  it("should return undefined for non-plugin core (wrong suffix)", () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        name: "@checkmate-monitor/not-a-plugin",
      })
    );

    const result = extractPluginMetadata({
      pluginDir: "/fake/path/not-a-plugin",
    });

    expect(result).toBeUndefined();
  });

  it("should return undefined if package.json is malformed", () => {
    mockReadFileSync.mockReturnValue("invalid json{");

    const result = extractPluginMetadata({
      pluginDir: "/fake/path/invalid",
    });

    expect(result).toBeUndefined();
  });
});

describe("discoverLocalPlugins", () => {
  beforeEach(() => {
    mockExistsSync.mockClear();
    mockReadFileSync.mockClear();
    mockReaddirSync.mockClear();
    mockExistsSync.mockReturnValue(true);
  });

  it("should discover all valid backend plugins from both core/ and plugins/", () => {
    // Mock different contents for core/ and plugins/ directories
    mockReaddirSync.mockImplementation(((dirPath: string) => {
      if (dirPath.includes("core")) {
        return [
          { isDirectory: () => true, name: "auth-backend" },
          { isDirectory: () => false, name: "README.md" }, // File, should skip
        ];
      }
      if (dirPath.includes("plugins")) {
        return [
          { isDirectory: () => true, name: "catalog-backend" },
          { isDirectory: () => true, name: "invalid-plugin" }, // No -backend suffix
        ];
      }
      return [];
    }) as typeof mockReaddirSync);

    // Mock package.json reads
    mockReadFileSync.mockImplementation(((filePath: string) => {
      if (filePath.includes("auth-backend")) {
        return JSON.stringify({ name: "@checkmate-monitor/auth-backend" });
      }
      if (filePath.includes("catalog-backend")) {
        return JSON.stringify({ name: "@checkmate-monitor/catalog-backend" });
      }
      if (filePath.includes("invalid-plugin")) {
        return JSON.stringify({ name: "@checkmate-monitor/invalid-plugin" });
      }
      return "{}";
    }) as typeof mockReadFileSync);

    const result = discoverLocalPlugins({ workspaceRoot: "/fake/workspace" });

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.packageName)).toContain(
      "@checkmate-monitor/auth-backend"
    );
    expect(result.map((r) => r.packageName)).toContain(
      "@checkmate-monitor/catalog-backend"
    );
  });

  it("should filter plugins by type when type parameter is provided", () => {
    // Mock: core/ has backend and frontend, plugins/ has common
    mockReaddirSync.mockImplementation(((dirPath: string) => {
      if (dirPath.includes("core")) {
        return [
          { isDirectory: () => true, name: "auth-backend" },
          { isDirectory: () => true, name: "auth-frontend" },
        ];
      }
      if (dirPath.includes("plugins")) {
        return [{ isDirectory: () => true, name: "auth-common" }];
      }
      return [];
    }) as typeof mockReaddirSync);

    mockReadFileSync.mockImplementation(((filePath: string) => {
      if (filePath.includes("auth-backend")) {
        return JSON.stringify({ name: "@checkmate-monitor/auth-backend" });
      }
      if (filePath.includes("auth-frontend")) {
        return JSON.stringify({ name: "@checkmate-monitor/auth-frontend" });
      }
      if (filePath.includes("auth-common")) {
        return JSON.stringify({ name: "@checkmate-monitor/auth-common" });
      }
      return "{}";
    }) as typeof mockReadFileSync);

    const backendResult = discoverLocalPlugins({
      workspaceRoot: "/fake/workspace",
      type: "backend",
    });
    expect(backendResult).toHaveLength(1);
    expect(backendResult[0].type).toBe("backend");

    const frontendResult = discoverLocalPlugins({
      workspaceRoot: "/fake/workspace",
      type: "frontend",
    });
    expect(frontendResult).toHaveLength(1);
    expect(frontendResult[0].type).toBe("frontend");
  });

  it("should return empty array if neither core/ nor plugins/ directory exists", () => {
    mockExistsSync.mockReturnValue(false);

    const result = discoverLocalPlugins({ workspaceRoot: "/fake/workspace" });

    expect(result).toEqual([]);
  });

  it("should skip directories without valid package.json", () => {
    mockReaddirSync.mockImplementation(((dirPath: string) => {
      if (dirPath.includes("core")) {
        return [{ isDirectory: () => true, name: "broken-backend" }];
      }
      return [];
    }) as typeof mockReaddirSync);

    mockExistsSync.mockImplementation(((filePath: string) => {
      // core/ and plugins/ directories exist
      if (filePath.endsWith("core") || filePath.endsWith("plugins")) {
        return true;
      }
      // package.json doesn't exist for broken-backend
      return !filePath.includes("broken-backend");
    }) as typeof mockExistsSync);

    const result = discoverLocalPlugins({ workspaceRoot: "/fake/workspace" });

    expect(result).toEqual([]);
  });
});

describe("syncPluginsToDatabase", () => {
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => ({
            limit: mock(() => Promise.resolve([])),
          })),
        })),
      })),
      insert: mock(() => ({
        values: mock(() => Promise.resolve()),
      })),
      update: mock(() => ({
        set: mock(() => ({
          where: mock(() => Promise.resolve()),
        })),
      })),
    };
  });

  it("should insert new plugin that doesn't exist in database", async () => {
    const localPlugins: PluginMetadata[] = [
      {
        packageName: "@checkmate-monitor/new-backend",
        pluginPath: "/workspace/plugins/new-backend",
        type: "backend",
        enabled: true,
      },
    ];

    // Mock: plugin doesn't exist
    mockDb.select.mockReturnValue({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => Promise.resolve([])),
        })),
      })),
    });

    await syncPluginsToDatabase({ localPlugins, db: mockDb });

    expect(mockDb.insert).toHaveBeenCalled();
    const insertCall = mockDb.insert.mock.results[0].value;
    expect(insertCall.values).toHaveBeenCalledWith({
      name: "@checkmate-monitor/new-backend",
      path: "/workspace/plugins/new-backend",
      type: "backend",
      enabled: true,
      isUninstallable: false,
    });
  });

  it("should update path for renamed local plugin", async () => {
    const localPlugins: PluginMetadata[] = [
      {
        packageName: "@checkmate-monitor/renamed-backend",
        pluginPath: "/workspace/plugins/new-location",
        type: "backend",
        enabled: true,
      },
    ];

    // Mock: plugin exists as local plugin (isUninstallable=false)
    mockDb.select.mockReturnValue({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() =>
            Promise.resolve([
              {
                name: "@checkmate-monitor/renamed-backend",
                path: "/workspace/plugins/old-location",
                isUninstallable: false,
              },
            ])
          ),
        })),
      })),
    });

    await syncPluginsToDatabase({ localPlugins, db: mockDb });

    expect(mockDb.update).toHaveBeenCalled();
    const updateCall = mockDb.update.mock.results[0].value;
    expect(updateCall.set).toHaveBeenCalledWith({
      path: "/workspace/plugins/new-location",
      type: "backend",
    });
  });

  it("should not modify remotely installed plugins", async () => {
    const localPlugins: PluginMetadata[] = [
      {
        packageName: "@checkmate-monitor/remote-backend",
        pluginPath: "/workspace/plugins/remote-backend",
        type: "backend",
        enabled: true,
      },
    ];

    // Mock: plugin exists as remote plugin (isUninstallable=true)
    mockDb.select.mockReturnValue({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() =>
            Promise.resolve([
              {
                name: "@checkmate-monitor/remote-backend",
                path: "/runtime/node_modules/@checkmate-monitor/remote-backend",
                isUninstallable: true,
              },
            ])
          ),
        })),
      })),
    });

    await syncPluginsToDatabase({ localPlugins, db: mockDb });

    // Should not call insert or update
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});
