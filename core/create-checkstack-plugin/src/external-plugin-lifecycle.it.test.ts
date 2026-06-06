/**
 * End-to-end integration test for the external-plugin authoring lifecycle
 * against PUBLISHED tarballs (#251 Phase 3, plan §7).
 *
 * This is the single heavy lane that guards the whole external story: it
 * publishes the CURRENT working tree's `@checkstack/*` packages to a
 * throwaway local Verdaccio registry, scaffolds a standalone plugin
 * workspace on the fly (Phase-2 engine, resolver pointed at the local
 * registry), `bun install`s it from that registry, packs + bundles it, then
 * boots the published dev server and asserts the plugin serves
 * `POST /api/<pluginId>/*` == 200 and the frontend Vite server comes up
 * and answers HTTP (a hard assertion — #251 bug 2 is fixed).
 *
 * Because it publishes the live tree, it implicitly catches "a package.json
 * change broke the published shape" regressions — the rot this feature
 * exists to prevent. Finer-grained logic (version rewriting, env
 * construction, frontend-entry picking) lives in the fast unit suites; this
 * lane is intentionally one test.
 *
 * Gated behind `CHECKSTACK_IT=1` so the default `bun test` never runs it.
 * The `integration` CI job sets that flag, provides Postgres, and (Phase 3)
 * provides a Verdaccio registry. Connection comes from
 * `CHECKSTACK_IT_PG_URL`; the registry from `CHECKSTACK_SCAFFOLD_REGISTRY`
 * (defaulting to the harness-managed local registry).
 *
 * Heavy by design (publish + full `bun install` + backend boot is minutes,
 * not seconds), so the suite uses a generous timeout.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scaffoldStandaloneWorkspace, localSiblingNames } from "./scaffold-standalone";
import { createNpmViewResolver } from "./npm-view-resolver";
import {
  DEFAULT_REGISTRY_URL,
  buildVerdaccioConfig,
  buildNpmrc,
  buildNpmViewVersionArgs,
  discoverWorkspacePackages,
  publishWorkspacePackages,
  findMonorepoRoot,
  startVerdaccio,
  type RegistryHandle,
} from "./local-registry";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PG_URL =
  process.env.CHECKSTACK_IT_PG_URL ??
  "postgres://checkstack:checkstack@localhost:5432/checkstack";

const BASE_NAME = "widget";
const PLUGIN_ID = "widget"; // pluginId is the unscoped base, used in /api/<pluginId>/*
// A dedicated npm scope for the generated trio so its package names
// (@checkstackit/widget-*) never collide with the real @checkstack/* packages
// we publish to the same local registry. The routing pluginId stays unscoped
// (PLUGIN_ID above) regardless of the package scope.
const PACKAGE_SCOPE = "checkstackit";
// The published @checkstack/backend default-export server binds a fixed
// port (it does not honour $PORT), so the backend always listens on 3000.
// We poll that port rather than overriding PORT, which would be ignored.
const BACKEND_PORT = 3000;
const FRONTEND_PORT = 5917;
// A custom (arbitrary) Tailwind utility class we inject into the scaffolded
// plugin's frontend. `251px` is an uncommon value unlikely to appear in the
// platform's own CSS, so finding it in the compiled dev CSS proves the dev
// server compiled the PLUGIN'S OWN classes.
const TAILWIND_PROBE_CLASS = "p-[251px]";
const TAILWIND_PROBE_CSS = "251px";

/** Run a command, returning status + captured output (no inherited stdio). */
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
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: `${result.stderr ?? ""}${result.error ? result.error.message : ""}`,
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

describe.skipIf(!process.env.CHECKSTACK_IT)(
  "external plugin lifecycle (published tarballs)",
  () => {
    let tmpRoot: string;
    let workspaceDir: string;
    let backendDir: string;
    let npmrcPath: string;
    let registryUrl: string;
    let cacheDir: string;
    let ownedRegistry: RegistryHandle | undefined;
    let devChild: ChildProcess | undefined;
    let monorepoRoot: string;

    beforeAll(async () => {
      monorepoRoot = findMonorepoRoot({ from: HERE });
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ccp-e2e-"));

      // Per-run isolated bun install cache. CRITICAL: bun's global
      // content-addressed cache is keyed by name@version, so re-publishing the
      // SAME @checkstack/* version (the tree's current version, unchanged
      // between local runs) would serve a STALE tarball from a previous run
      // instead of the just-published one. An isolated cache dir forces every
      // run to fetch the freshly-published tarballs from the local registry.
      cacheDir = path.join(tmpRoot, "bun-cache");
      fs.mkdirSync(cacheDir, { recursive: true });

      // The throwaway .npmrc routing every fetch/publish at the local
      // registry, plus the fake auth token that satisfies the publish proto.
      registryUrl = process.env.CHECKSTACK_SCAFFOLD_REGISTRY ?? DEFAULT_REGISTRY_URL;
      npmrcPath = path.join(tmpRoot, ".npmrc");
      fs.writeFileSync(npmrcPath, buildNpmrc({ registryUrl }));

      // Two modes:
      //   - CI provides Verdaccio AND publishes the workspace itself (a
      //     dedicated step, so a publish failure is attributed clearly).
      //     Detected via CHECKSTACK_SCAFFOLD_REGISTRY being preset — the test
      //     then only verifies the registry answers and does NOT re-publish
      //     (that would collide on already-published versions).
      //   - Local runs own the lifecycle: spin up Verdaccio here and publish
      //     the full non-private workspace into it.
      const registryProvidedByCi = Boolean(process.env.CHECKSTACK_SCAFFOLD_REGISTRY);
      if (!registryProvidedByCi) {
        const storageDir = path.join(tmpRoot, "verdaccio-storage");
        const configPath = path.join(tmpRoot, "verdaccio.yaml");
        fs.mkdirSync(storageDir, { recursive: true });
        fs.writeFileSync(configPath, buildVerdaccioConfig({ storageDir }));
        ownedRegistry = await startVerdaccio({ configPath, url: registryUrl });

        // Publish the full non-private workspace to the local registry. We
        // use `bun publish --registry <url>` (resolves workspace:* to
        // concrete versions) rather than the real-registry
        // `publish-packages.ts`. We publish the FULL set because the
        // scaffolded plugin depends on @checkstack/backend, whose transitive
        // closure spans most of the platform.
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

      // Sanity: @checkstack/backend and create-checkstack-plugin answer.
      for (const name of ["@checkstack/backend", "create-checkstack-plugin"]) {
        const view = run({
          command: "npm",
          args: buildNpmViewVersionArgs({ packageName: name, registryUrl }),
          cwd: tmpRoot,
          env: { NPM_CONFIG_USERCONFIG: npmrcPath },
          timeoutMs: 60_000,
        });
        expect(view.status, `npm view ${name}: ${view.stderr}`).toBe(0);
        expect(view.stdout.trim().length).toBeGreaterThan(0);
      }
    }, 600_000);

    afterAll(async () => {
      if (devChild && devChild.exitCode === null) {
        devChild.kill("SIGTERM");
        await new Promise((r) => setTimeout(r, 500));
        if (devChild.exitCode === null) devChild.kill("SIGKILL");
      }
      await ownedRegistry?.stop();
      if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it("scaffolds with zero workspace ranges and a concrete version per @checkstack dep", async () => {
      workspaceDir = path.join(tmpRoot, BASE_NAME);
      // Resolver pointed at the local registry — exactly the injected seam
      // the create-checkstack-plugin CLI exposes via --registry. Local trio
      // siblings stay workspace:* (resolved from the local Bun workspace).
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

      backendDir = path.join(workspaceDir, "packages", `${BASE_NAME}-backend`);
      expect(fs.existsSync(backendDir)).toBe(true);
      expect(fs.existsSync(path.join(workspaceDir, "packages", `${BASE_NAME}-common`))).toBe(true);
      expect(fs.existsSync(path.join(workspaceDir, "packages", `${BASE_NAME}-frontend`))).toBe(true);

      // Inject a probe element using a CUSTOM (arbitrary) Tailwind utility
      // class into the plugin's own frontend source. The dev server must
      // compile it into the dev CSS from a published install (proving the
      // @checkstack/frontend Tailwind-toolchain-as-runtime-deps + preset
      // export + plugin-glob injection actually styles author code, not just
      // the precompiled @checkstack/ui components). Asserted in the dev test.
      const frontendIndex = path.join(
        workspaceDir,
        "packages",
        `${BASE_NAME}-frontend`,
        "src",
        "index.tsx",
      );
      const original = fs.readFileSync(frontendIndex, "utf8");
      fs.writeFileSync(
        frontendIndex,
        // e2e Monaco render probe: mount @checkstack/ui's CodeEditor into a body
        // overlay at the plugin frontend's MODULE LOAD (eagerly imported by the
        // dev shell to register the plugin, so it runs independently of
        // routing/auth). The dev test asserts it actually renders in a browser —
        // proving the dev server's pre-built Monaco workers + alias redirect
        // work, not just that the boot log is clean.
        `import { CodeEditor as __E2ECodeEditor } from "@checkstack/ui";\n` +
          `import { createRoot as __e2eCreateRoot } from "react-dom/client";\n` +
          `import { useState as __e2eUseState } from "react";\n` +
          `if (typeof document !== "undefined") {\n` +
          `  const __el = document.createElement("div");\n` +
          `  __el.id = "__e2e_monaco__";\n` +
          `  __el.style.cssText = "position:fixed;bottom:0;right:0;width:480px;height:260px;z-index:99999;background:#fff";\n` +
          `  document.body.appendChild(__el);\n` +
          `  const __E2EEditor = () => {\n` +
          `    const [v, setV] = __e2eUseState("interface H { status: \\"ok\\" | \\"down\\" }\\nconst p: H = { status: \\"ok\\" }\\n");\n` +
          `    return <__E2ECodeEditor value={v} onChange={setV} language="typescript" minHeight="220px" />;\n` +
          `  };\n` +
          `  __e2eCreateRoot(__el).render(<__E2EEditor />);\n` +
          `}\n` +
          `// e2e Tailwind probe: a custom arbitrary utility class.\n` +
          `export const __TailwindProbe = () => <div className="${TAILWIND_PROBE_CLASS}" />;\n` +
          original,
      );

      // Every @checkstack/* dep must be a concrete (caret) version, never
      // workspace:* — install rejects workspace ranges. Only the local trio
      // siblings keep workspace:* (they resolve from the local workspace).
      const siblings = localSiblingNames({ baseName: BASE_NAME, packageScope: PACKAGE_SCOPE });
      for (const type of ["common", "backend", "frontend"]) {
        const pkg = JSON.parse(
          fs.readFileSync(
            path.join(workspaceDir, "packages", `${BASE_NAME}-${type}`, "package.json"),
            "utf8",
          ),
        ) as Record<string, Record<string, string> | unknown>;
        for (const section of ["dependencies", "devDependencies"] as const) {
          const deps = (pkg[section] as Record<string, string> | undefined) ?? {};
          for (const [name, range] of Object.entries(deps)) {
            if (name.startsWith("@checkstack/")) {
              expect(range, `${name} in ${type}`).not.toContain("workspace:");
              expect(range).toMatch(/^\^?\d/);
            } else if (siblings.has(name)) {
              expect(range).toBe("workspace:*");
            }
          }
        }
      }

      // The backend primary must carry checkstack.bundle (required for
      // plugin-pack --bundle). Siblings must NOT.
      const backendPkg = JSON.parse(
        fs.readFileSync(path.join(backendDir, "package.json"), "utf8"),
      ) as { checkstack?: { bundle?: string[] } };
      expect(backendPkg.checkstack?.bundle).toEqual([
        `@${PACKAGE_SCOPE}/${BASE_NAME}-common`,
        `@${PACKAGE_SCOPE}/${BASE_NAME}-frontend`,
      ]);
    });

    it("installs from the local registry", () => {
      const install = run({
        command: "bun",
        args: ["install"],
        cwd: workspaceDir,
        env: {
          NPM_CONFIG_USERCONFIG: npmrcPath,
          BUN_CONFIG_REGISTRY: registryUrl,
          // Isolated cache so the just-published tarballs win over any
          // same-version copy in bun's global cache (see beforeAll).
          BUN_INSTALL_CACHE_DIR: cacheDir,
        },
      });
      expect(install.status, install.stderr).toBe(0);
      // @checkstack/backend + @checkstack/dev-server must resolve in the
      // backend package's reachable node_modules (hoisted or local).
      const resolves = (name: string) => {
        const r = run({
          command: "bun",
          args: ["-e", `require.resolve(${JSON.stringify(`${name}/package.json`)})`],
          cwd: backendDir,
        });
        return r.status === 0;
      };
      expect(resolves("@checkstack/backend")).toBe(true);
      expect(resolves("@checkstack/dev-server")).toBe(true);
    }, 600_000);

    it("validates, packs, and bundles (workspace rewrite is a no-op for @checkstack deps)", () => {
      const packEnv = {
        NPM_CONFIG_USERCONFIG: npmrcPath,
        BUN_CONFIG_REGISTRY: registryUrl,
        BUN_INSTALL_CACHE_DIR: cacheDir,
      };
      const validate = run({
        command: "bun",
        args: ["run", "pack", "--", "--validate-only"],
        cwd: backendDir,
        env: packEnv,
      });
      expect(validate.status, validate.stderr || validate.stdout).toBe(0);

      const bundle = run({
        command: "bun",
        args: ["run", "pack", "--", "--bundle"],
        cwd: backendDir,
        env: packEnv,
      });
      expect(bundle.status, bundle.stderr || bundle.stdout).toBe(0);

      const distDir = path.join(backendDir, "dist");
      const bundleTarball = fs
        .readdirSync(distDir)
        .find((f) => f.endsWith("-bundle.tgz"));
      expect(bundleTarball, "expected a *-bundle.tgz in dist/").toBeDefined();
    }, 600_000);

    it("boots the dev server and serves POST /api/<pluginId>/* == 200 with a JSON array", async () => {
      // Boot the published dev server via the scaffolded `dev` script. It
      // spawns the real @checkstack/backend with the plugin loaded under
      // synthetic dev auth, against the integration Postgres.
      devChild = spawn("bun", ["run", "dev"], {
        cwd: backendDir,
        env: {
          ...process.env,
          NPM_CONFIG_USERCONFIG: npmrcPath,
          BUN_CONFIG_REGISTRY: registryUrl,
          BUN_INSTALL_CACHE_DIR: cacheDir,
          DATABASE_URL: PG_URL,
          // The published backend binds a fixed port; PORT is not honoured,
          // so we poll BACKEND_PORT (3000) below. The Vite dev port IS
          // configurable, so we set it to avoid a 5173 collision.
          FRONTEND_PORT: String(FRONTEND_PORT),
          NODE_ENV: "development",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let bootLog = "";
      devChild.stdout?.on("data", (c: Buffer) => {
        bootLog += c.toString();
      });
      devChild.stderr?.on("data", (c: Buffer) => {
        bootLog += c.toString();
      });

      // Poll the plugin endpoint until the backend is ready (migrations +
      // plugin load take time on a cold install).
      const body = await poll({
        timeoutMs: 180_000,
        fn: async () => {
          if (devChild?.exitCode !== null && devChild?.exitCode !== undefined) {
            throw new Error(`dev server exited early (${devChild.exitCode}):\n${bootLog}`);
          }
          try {
            const res = await fetch(`http://localhost:${BACKEND_PORT}/api/${PLUGIN_ID}/getItems`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ json: {} }),
            });
            if (res.status !== 200) return undefined;
            return await res.json();
          } catch {
            return undefined;
          }
        },
      });
      expect(body, `no 200 from /api/${PLUGIN_ID}/getItems.\nboot log:\n${bootLog}`).toBeDefined();
      // oRPC wraps the array output in a { json: [...] } envelope.
      const payload =
        body && typeof body === "object" && "json" in body
          ? (body as { json: unknown }).json
          : body;
      expect(Array.isArray(payload)).toBe(true);

      // (backend+frontend case) The dev server must recognise the
      // -frontend sibling in the bundle and bring up the Vite frontend dev
      // server from the PUBLISHED install. The dev server resolves
      // @checkstack/frontend (its own peer dep, NOT reachable from the
      // plugin's package under a clean `bun install`) from its own install
      // location, and picks up the workspace `-frontend` sibling by
      // scanning sibling directories — #251 bug 2, fixed in
      // @checkstack/dev-server's dev-frontend.ts. Both the "started" log
      // line AND a live HTTP response are now HARD assertions, so this lane
      // is fully green including the frontend.
      const startedFrontend = await poll({
        timeoutMs: 60_000,
        fn: async () =>
          /🎨 Frontend dev server/.test(bootLog) ? true : undefined,
      });
      expect(
        startedFrontend,
        `dev server never started the Vite frontend.\nboot log:\n${bootLog}`,
      ).toBe(true);
      expect(
        /Frontend dev server failed to start/.test(bootLog),
        `dev server logged a Vite startup failure (regression of #251 bug 2).\nboot log:\n${bootLog}`,
      ).toBe(false);

      const viteUp = await poll({
        timeoutMs: 60_000,
        fn: async () => {
          if (devChild?.exitCode !== null && devChild?.exitCode !== undefined) {
            throw new Error(
              `dev server exited before Vite answered (${devChild.exitCode}):\n${bootLog}`,
            );
          }
          try {
            const res = await fetch(`http://localhost:${FRONTEND_PORT}/`);
            return res.status < 500 ? true : undefined;
          } catch {
            return undefined;
          }
        },
      });
      expect(
        viteUp,
        `Vite did not answer on :${FRONTEND_PORT} (frontend HMR unavailable).\nboot log:\n${bootLog}`,
      ).toBe(true);

      // The dev shell must be STYLED from a published install: fetch the
      // compiled dev CSS (Vite serves index.css's processed output via the
      // `?direct` query) and assert the PLUGIN'S OWN custom Tailwind class
      // compiled. This proves @checkstack/frontend shipping the Tailwind
      // toolchain as runtime deps + exporting `tailwind-preset` + the dev
      // server injecting the plugin's source globs all work end-to-end.
      const compiledCss = await poll({
        timeoutMs: 60_000,
        fn: async () => {
          try {
            const res = await fetch(
              `http://localhost:${FRONTEND_PORT}/src/index.css?direct`,
            );
            if (res.status >= 400) return undefined;
            const text = await res.text();
            // Skip Vite's HTML error-overlay response (a failed PostCSS load
            // returns 200 with an HTML doc, not CSS).
            if (text.includes("Internal Server Error")) return undefined;
            return text.includes(TAILWIND_PROBE_CSS) ? text : undefined;
          } catch {
            return undefined;
          }
        },
      });
      expect(
        compiledCss,
        `dev CSS did not contain the plugin's custom Tailwind class (${TAILWIND_PROBE_CLASS} → "${TAILWIND_PROBE_CSS}"); the dev shell is unstyled.\nboot log:\n${bootLog}`,
      ).toBeDefined();

      // RENDER verification: @checkstack/ui's CodeEditor (Monaco) must actually
      // MOUNT with syntax highlighting in a real browser against the standalone
      // dev server. This is the end-to-end guard for the pre-built-worker fix
      // (`@checkstack/ui` is a pre-bundled npm dep here; the dev server serves
      // pre-built Monaco workers and redirects the `?worker&url` imports to
      // them). The probe (scaffold step) mounts an editor into #__e2e_monaco__.
      const { chromium } = await import("@playwright/test");
      const browser = await chromium.launch();
      try {
        const pwPage = await browser.newPage();
        const pageErrors: string[] = [];
        pwPage.on("pageerror", (e) => pageErrors.push(String(e.message)));
        await pwPage.goto(`http://localhost:${FRONTEND_PORT}/`, {
          waitUntil: "load",
          timeout: 60_000,
        });
        // Monaco token spans (`mtk1`, `mtk5`, …) prove the editor rendered AND
        // tokenized — not just an empty shell. Vite may re-optimize deps on the
        // first editor load (504 + reload), so retry across reloads.
        const tokenSelector =
          '#__e2e_monaco__ .monaco-editor .view-lines [class^="mtk"]';
        let tokenCount = 0;
        for (let i = 0; i < 8 && tokenCount === 0; i++) {
          await pwPage.waitForTimeout(3000);
          tokenCount = await pwPage.locator(tokenSelector).count().catch(() => 0);
          if (tokenCount === 0)
            await pwPage.reload({ waitUntil: "load" }).catch(() => {});
        }
        if (tokenCount === 0) {
          const diag = await pwPage.evaluate(() => ({
            overlay: !!document.getElementById("__e2e_monaco__"),
            anyMonaco: document.querySelectorAll(".monaco-editor").length,
          }));
          throw new Error(
            `@checkstack/ui's Monaco CodeEditor did not render in the standalone dev server.\n` +
              `diag=${JSON.stringify(diag)} pageErrors=${JSON.stringify(pageErrors.slice(0, 6))}\n` +
              `boot log:\n${bootLog}`,
          );
        }
        expect(tokenCount).toBeGreaterThan(0);
      } finally {
        await browser.close();
      }
    }, 300_000);
  },
);
