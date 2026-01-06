import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  copyTemplate,
  prepareTemplateData,
  registerHelpers,
} from "./utils/template";
import { execSync } from "node:child_process";
import { rmSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_BASE_NAME = "scaffoldtest";
const TEST_SCAFFOLDS_DIR = "plugins/_test-scaffolds";

// Plugin types to test - these have the most template complexity
// Order matters: common must be scaffolded before frontend (frontend depends on common)
const PLUGIN_TYPES = ["common", "backend", "frontend"] as const;

describe("CLI Template Scaffolding", () => {
  const rootDir = path.resolve(__dirname, "../../..");
  const scaffoldsDir = path.join(rootDir, TEST_SCAFFOLDS_DIR);

  beforeAll(() => {
    registerHelpers();

    // Clean up any previous test scaffolds
    if (existsSync(scaffoldsDir)) {
      rmSync(scaffoldsDir, { recursive: true });
    }

    // Ensure the test scaffolds directory exists
    mkdirSync(scaffoldsDir, { recursive: true });

    // Scaffold ALL plugins first (order matters for dependencies)
    for (const pluginType of PLUGIN_TYPES) {
      const templateData = prepareTemplateData({
        baseName: TEST_BASE_NAME,
        pluginType,
        description: `Test ${pluginType} plugin for template validation`,
      });

      const templateDir = path.join(__dirname, "templates", pluginType);
      const targetDir = path.join(scaffoldsDir, templateData.pluginName);

      copyTemplate({
        templateDir,
        targetDir,
        data: templateData,
      });
    }

    // Run bun install ONCE after all plugins are scaffolded
    // This ensures workspace dependencies are resolved correctly
    execSync("bun install", {
      cwd: rootDir,
      stdio: "pipe",
      timeout: 120_000,
    });
  });

  afterAll(() => {
    // Cleanup all test packages
    if (existsSync(scaffoldsDir)) {
      rmSync(scaffoldsDir, { recursive: true });
    }

    // Re-run bun install to remove stale entries from bun.lock
    execSync("bun install", {
      cwd: rootDir,
      stdio: "pipe",
      timeout: 60_000,
    });
  });

  for (const pluginType of PLUGIN_TYPES) {
    const pluginName = `${TEST_BASE_NAME}-${pluginType}`;
    const targetDir = path.join(scaffoldsDir, pluginName);

    describe(`${pluginType} plugin template`, () => {
      it("should have scaffolded files", () => {
        expect(existsSync(path.join(targetDir, "package.json"))).toBe(true);
        expect(existsSync(path.join(targetDir, "src"))).toBe(true);
        expect(existsSync(path.join(targetDir, "tsconfig.json"))).toBe(true);
      });

      it("should pass typecheck", () => {
        try {
          execSync(
            `bun run --filter '@checkmate-monitor/${pluginName}' typecheck`,
            {
              cwd: rootDir,
              stdio: "pipe",
              timeout: 60_000,
            }
          );
        } catch (error) {
          const execError = error as { stderr?: Buffer; stdout?: Buffer };
          const stderr = execError.stderr?.toString() ?? "";
          const stdout = execError.stdout?.toString() ?? "";
          throw new Error(
            `Typecheck failed for ${pluginName}:\n${stderr}\n${stdout}`
          );
        }
      });

      it("should pass lint", () => {
        try {
          execSync(`bun run eslint ${TEST_SCAFFOLDS_DIR}/${pluginName}`, {
            cwd: rootDir,
            stdio: "pipe",
            timeout: 60_000,
          });
        } catch (error) {
          const execError = error as { stderr?: Buffer; stdout?: Buffer };
          const stderr = execError.stderr?.toString() ?? "";
          const stdout = execError.stdout?.toString() ?? "";
          throw new Error(
            `Lint failed for ${pluginName}:\n${stderr}\n${stdout}`
          );
        }
      });
    });
  }
});
