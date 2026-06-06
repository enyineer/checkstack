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
 *  2. the plugin's FRONTEND works (its route/nav entry + page render), incl.
 *     the host's shared Monaco editor mounting inside the plugin page,
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
const PASCAL_NAME = "Widget";
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

/**
 * Replace the scaffolded frontend page with a minimal one that renders a
 * `CodeEditor` UNCONDITIONALLY. The scaffold default does not use the editor,
 * so without this the E2E would not exercise the shared-Monaco path at all.
 *
 * Why a full rewrite (not a surgical insert): the scaffold page gates its body
 * behind `<PageLayout loading={isLoading}>` and an early error-return, so an
 * editor placed inside it only renders once the plugin's `getItems` query
 * resolves - coupling the editor assertion to query timing. Rendering the
 * editor unconditionally tests exactly what we care about: a runtime plugin
 * resolving the host's shared editor. If the host failed to provide it, the
 * consume-only (`import: false`) share would throw and crash the page rather
 * than silently hide the editor. The page name MUST match the route loader in
 * `src/index.tsx` (`${pascalName}ListPage`).
 */
function injectCodeEditor({
  frontendDir,
  pascalName,
}: {
  frontendDir: string;
  pascalName: string;
}): void {
  const pagePath = path.join(
    frontendDir,
    "src",
    "components",
    `${pascalName}ListPage.tsx`,
  );
  if (!fs.existsSync(pagePath)) {
    throw new Error(
      `injectCodeEditor: expected scaffolded page at ${pagePath} - update ` +
        "this patch to match the frontend page template.",
    );
  }
  const page = [
    'import { PageLayout, CodeEditor } from "@checkstack/ui";',
    'import { Boxes } from "lucide-react";',
    "",
    `export const ${pascalName}ListPage = () => (`,
    `  <PageLayout title="${pascalName}" icon={Boxes}>`,
    '    <div data-testid="plugin-code-editor">',
    '      <CodeEditor',
    '        value="const probe = 1;"',
    '        language="typescript"',
    '        minHeight="120px"',
    "        onChange={() => {}}",
    "      />",
    "    </div>",
    "  </PageLayout>",
    ");",
    "",
  ].join("\n");
  fs.writeFileSync(pagePath, page);
}

/** Recursively collect dist filenames that look like bundled Monaco / workers. */
function findBundledMonaco({ frontendDir }: { frontendDir: string }): string[] {
  const dist = path.join(frontendDir, "dist");
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/monaco|codingame|\.worker/i.test(entry.name)) {
        hits.push(path.relative(dist, p));
      }
    }
  };
  if (fs.existsSync(dist)) walk(dist);
  return hits;
}

/** True if the built frontend references the shared `@checkstack/ui/code-editor`. */
function distReferencesSharedEditor({
  frontendDir,
}: {
  frontendDir: string;
}): boolean {
  const dist = path.join(frontendDir, "dist");
  if (!fs.existsSync(dist)) return false;
  const stack = [dist];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else if (/\.(js|mjs|json)$/.test(entry.name)) {
        const text = fs.readFileSync(p, "utf8");
        // The bare shared key, or MF's mangled loadShare virtual name for it
        // (`@checkstack/ui/code-editor` → ...code_mf_2_editor...).
        if (text.includes("code-editor") || text.includes("code_mf_2_editor")) {
          return true;
        }
      }
    }
  }
  return false;
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

      // Make the run hermetic. The instance installs runtime plugins into
      // `<repoRoot>/runtime_plugins` (see core/backend/src/index.ts), which
      // PERSISTS across runs. The plugin version is fixed at 0.0.1, so a prior
      // run's install is reused and `bun install <tgz>` skips re-extracting the
      // freshly-packed dist - serving a STALE plugin frontend. Wipe it (and any
      // stray scope dir hoisted into the repo's node_modules) so the install
      // always materialises the bundle we just built.
      for (const stale of [
        path.join(monorepoRoot, "runtime_plugins"),
        path.join(monorepoRoot, "node_modules", `@${PACKAGE_SCOPE}`),
      ]) {
        fs.rmSync(stale, { recursive: true, force: true });
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
      const frontendDir = path.join(workspaceDir, "packages", `${BASE_NAME}-frontend`);
      // Make the plugin actually render the shared editor (scaffold default
      // doesn't) so install exercises the shared-Monaco path end-to-end.
      injectCodeEditor({ frontendDir, pascalName: PASCAL_NAME });
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
      if (process.env.CHECKSTACK_E2E_KEEP) {
        console.log("[e2e] bundle pack stdout:\n" + bundle.stdout);
        console.log("[e2e] bundle pack stderr:\n" + bundle.stderr);
      }
      // Build-time proof of Option B: the plugin imports CodeEditor yet its
      // frontend build must NOT bundle Monaco (it shares the host's), and it
      // MUST reference the shared `@checkstack/ui/code-editor` module.
      const bundledMonaco = findBundledMonaco({ frontendDir });
      expect(
        bundledMonaco,
        `plugin frontend bundled Monaco instead of sharing it: ${bundledMonaco.join(", ")}`,
      ).toEqual([]);
      expect(
        distReferencesSharedEditor({ frontendDir }),
        "frontend build does not reference the shared @checkstack/ui/code-editor",
      ).toBe(true);

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
            // Use the SAME throwaway cache as the scaffold install. Without
            // this the instance's plugin co-install (`bun install <tgz>`) uses
            // the global bun cache, which can hold a stale same-version
            // `@checkstackit/widget-*@0.0.1` from a previous run and skip
            // re-extracting the freshly-built bundle (missing its new dist).
            BUN_INSTALL_CACHE_DIR: cacheDir,
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
      if (process.env.CHECKSTACK_E2E_KEEP) {
        page.on("console", (m) => {
          if (
            m.type() === "error" ||
            m.type() === "warning" ||
            /plugin|editor|share|federation|remote/i.test(m.text())
          ) {
            console.log(`[browser:${m.type()}] ${m.text()}`);
          }
        });
        page.on("pageerror", (e) => console.log(`[browser:pageerror] ${e.message}`));
        page.on("requestfailed", (r) =>
          console.log(`[browser:reqfail] ${r.url()} ${r.failure()?.errorText}`),
        );
      }

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
      if (process.env.CHECKSTACK_E2E_KEEP) {
        await page
          .waitForSelector('[data-testid="plugin-code-editor"]', { timeout: 8_000 })
          .catch(() => undefined);
        const html = await page.content();
        const dump = path.join(tmpRoot, "widget-page.html");
        fs.writeFileSync(dump, html);
        await page.screenshot({ path: path.join(tmpRoot, "widget-page.png"), fullPage: true });
        const main = await page.locator("main, #root").first().innerText().catch(() => "<no text>");
        console.log(`[e2e] widget page URL: ${page.url()}`);
        console.log(`[e2e] widget page dumped: ${dump} (${html.length} bytes)`);
        console.log(`[e2e] widget main text (first 600):\n${main.slice(0, 600)}`);
        console.log(`[e2e] testid count: ${await page.getByTestId("plugin-code-editor").count()}`);
        console.log(`[e2e] .monaco-editor count: ${await page.locator(".monaco-editor").count()}`);
      }
      // The shared editor (provided by the HOST, never bundled into the plugin)
      // mounts inside the plugin's page - runtime proof of Option B.
      await expect(page.getByTestId("plugin-code-editor")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.locator(".monaco-editor").first()).toBeVisible({
        timeout: 30_000,
      });

      // --- (core plugins co-load) a core plugin still works, frontend + backend ---
      const catalogRes = await page.request.post(
        `${INSTANCE_URL}/api/catalog/getEntities`,
        { data: { json: {} } },
      );
      expect(catalogRes.status(), `catalog API status ${catalogRes.status()}`).toBe(200);
      // Core nav entries are still present (the external plugin didn't break the shell).
      await expect(page.getByRole("link", { name: "Catalog" })).toBeVisible();
    }, 300_000);
  },
);
