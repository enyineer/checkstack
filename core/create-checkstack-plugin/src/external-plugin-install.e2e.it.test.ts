/**
 * Full external-plugin E2E: scaffold → pack → install into a REAL running
 * Checkstack instance via the Plugin Manager UI → verify it loads.
 *
 * Distinct from `external-plugin-lifecycle.it.test.ts` (which boots the dev
 * SERVER): this boots the real backend + built SPA on a port (same launcher the
 * e2e suite uses), then drives a browser through the actual install wizard
 * (tarball upload + typed confirmation) and asserts:
 *
 *  1. the packaged plugin installs and its backend loads (`POST /api/widget/*`),
 *  2. the plugin's FRONTEND works (its route/nav entry + page render),
 *  3. the co-loaded CORE plugins still work (frontend nav + backend API) - i.e.
 *     installing the external plugin didn't break the platform.
 *
 * The instance's plugin install (`bun install` under the runtime dir) is pointed
 * at the same throwaway Verdaccio that holds the freshly-published workspace, so
 * the plugin's `@checkstack/*` deps resolve to versions the instance is running.
 *
 * Heavy (publish + full install + backend boot + browser); gated behind
 * `CHECKSTACK_E2E_INSTALL=1`, needs Postgres + the repo `.env`, and the frontend
 * must be built (`bun run --filter @checkstack/frontend build`).
 */
import { afterAll, beforeAll, describe, it } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Playwright's `expect` carries the web-first locator assertions (`toBeVisible`,
// `toHaveURL`, …) and also handles value assertions (`toBe`, `toEqual`); using
// it throughout keeps one assertion surface under bun:test's runner.
import { chromium, expect, type Browser } from "@playwright/test";
import { scaffoldStandaloneWorkspace, localSiblingNames } from "./scaffold-standalone";
import { createNpmViewResolver } from "./npm-view-resolver";
import {
  DEFAULT_REGISTRY_URL,
  buildVerdaccioConfig,
  buildNpmrc,
  discoverWorkspacePackages,
  publishWorkspacePackages,
  findMonorepoRoot,
  startVerdaccio,
  type RegistryHandle,
} from "./local-registry";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE_NAME = "widget";
const PLUGIN_ID = "widget";
const PACKAGE_SCOPE = "checkstackit";
const INSTANCE_PORT = 3199;
const INSTANCE_URL = `http://localhost:${INSTANCE_PORT}`;
const E2E_DB_NAME = "checkstack_e2e_extplugin";
const ADMIN = {
  name: "E2E Admin",
  email: "e2e-admin@example.com",
  password: "E2eAdminPassw0rd!",
};

function run({
  command,
  args,
  cwd,
  env,
  timeoutMs = 600_000,
}: {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: `${r.stderr ?? ""}${r.error ? r.error.message : ""}`,
  };
}

async function poll<T>({
  fn,
  timeoutMs,
  intervalMs = 1000,
}: {
  fn: () => Promise<T | undefined>;
  timeoutMs: number;
  intervalMs?: number;
}): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result !== undefined) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return undefined;
}

describe.skipIf(!process.env.CHECKSTACK_E2E_INSTALL)(
  "external plugin install (real instance + UI)",
  () => {
    let monorepoRoot: string;
    let tmpRoot: string;
    let cacheDir: string;
    let npmrcPath: string;
    let registryUrl: string;
    let ownedRegistry: RegistryHandle | undefined;
    let instance: ChildProcess | undefined;
    let bundleTarball: string;
    let browser: Browser | undefined;
    let instanceLog = "";

    beforeAll(async () => {
      monorepoRoot = findMonorepoRoot({ from: HERE });

      const distIndex = path.join(monorepoRoot, "core", "frontend", "dist", "index.html");
      if (!fs.existsSync(distIndex)) {
        throw new Error(
          `Frontend is not built (${distIndex} missing). Run \`bun run --filter @checkstack/frontend build\` first.`,
        );
      }

      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ext-install-"));
      cacheDir = path.join(tmpRoot, "bun-cache");
      fs.mkdirSync(cacheDir, { recursive: true });
      registryUrl = process.env.CHECKSTACK_SCAFFOLD_REGISTRY ?? DEFAULT_REGISTRY_URL;
      npmrcPath = path.join(tmpRoot, ".npmrc");
      fs.writeFileSync(npmrcPath, buildNpmrc({ registryUrl }));

      // 1. Verdaccio + publish the workspace (so both the scaffold AND the
      //    instance's plugin-install resolve the current versions).
      if (!process.env.CHECKSTACK_SCAFFOLD_REGISTRY) {
        const storageDir = path.join(tmpRoot, "verdaccio-storage");
        const configPath = path.join(tmpRoot, "verdaccio.yaml");
        fs.mkdirSync(storageDir, { recursive: true });
        fs.writeFileSync(configPath, buildVerdaccioConfig({ storageDir }));
        ownedRegistry = await startVerdaccio({ configPath, url: registryUrl });
        const packages = discoverWorkspacePackages({ monorepoRoot });
        const outcomes = publishWorkspacePackages({
          packages,
          registryUrl,
          npmrcPath,
          env: { ...process.env, BUN_INSTALL_CACHE_DIR: cacheDir },
        });
        const failed = outcomes.filter((o) => o.status !== 0);
        expect(
          failed,
          `publish failures:\n${failed.map((f) => `${f.name}: ${f.stderr}`).join("\n")}`,
        ).toEqual([]);
      }

      // 2. Scaffold the plugin (resolver → Verdaccio), install, pack a bundle.
      const workspaceDir = path.join(tmpRoot, BASE_NAME);
      const resolveVersion = createNpmViewResolver({
        registry: registryUrl,
        localSiblings: localSiblingNames({ baseName: BASE_NAME, packageScope: PACKAGE_SCOPE }),
      });
      await scaffoldStandaloneWorkspace({
        rootDir: workspaceDir,
        baseName: BASE_NAME,
        description: "Widget e2e plugin",
        packageScope: PACKAGE_SCOPE,
        resolveVersion,
      });
      const backendDir = path.join(workspaceDir, "packages", `${BASE_NAME}-backend`);
      const installEnv = {
        NPM_CONFIG_USERCONFIG: npmrcPath,
        BUN_CONFIG_REGISTRY: registryUrl,
        BUN_INSTALL_CACHE_DIR: cacheDir,
      };
      const install = run({ command: "bun", args: ["install"], cwd: workspaceDir, env: installEnv });
      expect(install.status, install.stderr).toBe(0);
      const bundle = run({
        command: "bun",
        args: ["run", "pack", "--", "--bundle"],
        cwd: backendDir,
        env: installEnv,
      });
      expect(bundle.status, bundle.stderr || bundle.stdout).toBe(0);
      const distDir = path.join(backendDir, "dist");
      const tgz = fs.readdirSync(distDir).find((f) => f.endsWith("-bundle.tgz"));
      expect(tgz, "expected a *-bundle.tgz").toBeDefined();
      bundleTarball = path.join(distDir, tgz!);

      // 3. Boot the real instance (fresh e2e DB) with its plugin-install pointed
      //    at Verdaccio. `--env-file` supplies the secrets; PORT / DB name /
      //    registry are NOT in `.env`, so our overrides win.
      instance = spawn(
        "bun",
        ["--env-file", path.join(monorepoRoot, ".env"), path.join("core", "e2e", "scripts", "start-e2e-server.ts")],
        {
          cwd: monorepoRoot,
          env: {
            ...process.env,
            PORT: String(INSTANCE_PORT),
            CHECKSTACK_E2E_DB_NAME: E2E_DB_NAME,
            BUN_CONFIG_REGISTRY: registryUrl,
            NPM_CONFIG_USERCONFIG: npmrcPath,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      instance.stdout?.on("data", (c: Buffer) => (instanceLog += c.toString()));
      instance.stderr?.on("data", (c: Buffer) => (instanceLog += c.toString()));

      const ready = await poll({
        timeoutMs: 120_000,
        fn: async () => {
          if (instance?.exitCode != null) {
            throw new Error(`instance exited early (${instance.exitCode}):\n${instanceLog}`);
          }
          try {
            const res = await fetch(`${INSTANCE_URL}/.checkstack/ready`);
            const body = (await res.json()) as { ready?: boolean };
            return body.ready === true ? true : undefined;
          } catch {
            return undefined;
          }
        },
      });
      expect(ready, `instance never became ready.\n${instanceLog}`).toBe(true);
    }, 600_000);

    afterAll(async () => {
      await browser?.close();
      if (instance && instance.exitCode == null) {
        instance.kill("SIGTERM");
        await new Promise((r) => setTimeout(r, 1000));
        if (instance.exitCode == null) instance.kill("SIGKILL");
      }
      await ownedRegistry?.stop();
      if (tmpRoot && !process.env.CHECKSTACK_E2E_KEEP) {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      } else if (tmpRoot) {
        console.log(`[e2e] kept workspace: ${tmpRoot}`);
      }
    });

    it("installs the packaged plugin via the UI; frontend + backend + core plugins load", async () => {
      browser = await chromium.launch();
      const page = await browser.newPage({ baseURL: INSTANCE_URL });

      // --- Onboard the first admin (fresh DB → onboarding) ---
      await page.goto("/");
      await page.waitForURL(/\/auth\/onboarding$/, { timeout: 30_000 });
      await page.locator("#name").fill(ADMIN.name);
      await page.locator("#email").fill(ADMIN.email);
      await page.locator("#password").fill(ADMIN.password);
      await page.locator("#confirmPassword").fill(ADMIN.password);
      await page.getByRole("button", { name: "Complete Setup" }).click();
      await page.waitForURL((url) => url.pathname === "/", { timeout: 30_000 });
      await expect(page.getByRole("button", { name: ADMIN.name })).toBeVisible({ timeout: 15_000 });

      // --- Install the bundle via the Plugin Manager UI ---
      await page.goto("/pluginmanager/install");
      await expect(page.getByRole("heading", { name: "Install plugin" })).toBeVisible();
      await page.getByRole("tab", { name: "Tarball Upload" }).click();
      await page.locator("#tarball-file").setInputFiles(bundleTarball);
      await page.getByRole("button", { name: /Upload & preview/i }).click();

      // Typed-confirmation modal: type the primary package name, then Install.
      const primaryName = `@${PACKAGE_SCOPE}/${BASE_NAME}-backend`;
      const confirmInput = page.getByRole("textbox").last();
      await expect(confirmInput).toBeVisible({ timeout: 30_000 });
      await confirmInput.fill(primaryName);
      await page.getByRole("button", { name: /^Install/ }).click();

      // Install lands on the installed list with a success toast.
      await expect(page.getByText(/Installed \d+ package/)).toBeVisible({ timeout: 180_000 });
      // The installed route is "/" in the pluginmanager namespace, so the page
      // navigates to `/pluginmanager/` (trailing slash) on success.
      await page.waitForURL(/\/pluginmanager\/?$/, { timeout: 30_000 });
      await expect(page.getByRole("cell", { name: primaryName })).toBeVisible({ timeout: 15_000 });

      // --- (backend) the plugin's API responds ---
      // `getItems` is access-gated (widgetAccess.read), so call it through the
      // authenticated browser context (page.request shares the session cookie),
      // not a bare node fetch. Poll because the install broadcast loads the
      // backend module asynchronously after the install RPC returns.
      const apiOk = await poll({
        timeoutMs: 60_000,
        fn: async () => {
          const res = await page.request.post(
            `${INSTANCE_URL}/api/${PLUGIN_ID}/getItems`,
            { data: { json: {} } },
          );
          return res.status() === 200 ? true : undefined;
        },
      });
      expect(apiOk, `plugin backend API never returned 200.\n${instanceLog}`).toBe(true);

      // --- (frontend) the plugin's route/nav entry + page render ---
      await page.goto("/");
      const widgetNav = page.getByRole("link", { name: "Widget" });
      await expect(widgetNav).toBeVisible({ timeout: 30_000 });
      await widgetNav.click();
      await expect(page).toHaveURL(/\/widget/, { timeout: 15_000 });
      // The plugin's page rendered (not a 404/error boundary).
      await expect(page.getByText(/not found|something went wrong/i)).toHaveCount(0);

      // --- (core plugins co-load) a core plugin still works, frontend + backend ---
      const catalogRes = await page.request.post(
        `${INSTANCE_URL}/api/catalog/listEntities`,
        { data: { json: {} } },
      );
      expect(catalogRes.status(), `catalog API status ${catalogRes.status()}`).toBe(200);
      // Core nav entries are still present (the external plugin didn't break the shell).
      await expect(page.getByRole("link", { name: "Catalog" })).toBeVisible();
    }, 300_000);
  },
);
