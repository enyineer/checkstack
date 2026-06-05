import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  copyTemplate,
  prepareTemplateData,
  registerHelpers,
  type TemplateData,
} from "../utils/template";
import {
  rewriteWorkspaceVersions,
  type VersionResolver,
} from "./rewrite-workspace-versions";

/**
 * Monorepo-decoupled scaffolding engine.
 *
 * The engine takes a {@link ScaffoldMode} plus a base name / description /
 * package type and renders the matching `templates/<type>` directory into a
 * target directory. It performs **no** `process.cwd()` reads of its own —
 * the caller supplies `rootDir` (monorepo) or `targetDir` (standalone), so
 * the same code runs both in-monorepo (`create`) and from a standalone
 * bootstrapper (`create-checkstack-plugin`, Phase 2).
 *
 * Mode-specific behaviour:
 *   - `monorepo`: writes into `<rootDir>/<location>/<name>`, keeps the
 *     template's `workspace:*` ranges verbatim, and refreshes the root
 *     TypeScript project references afterwards.
 *   - `standalone`: writes into `<targetDir>/<name>` (or a caller-chosen
 *     layout) and rewrites every `workspace:*` range to a concrete version
 *     via the injected {@link VersionResolver}. No references refresh —
 *     standalone repos don't use the root references graph.
 */

const SCAFFOLD_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Directory holding the per-type template trees. */
export const TEMPLATES_DIR = path.resolve(SCAFFOLD_DIR, "..", "templates");

export type ScaffoldMode =
  | { kind: "monorepo"; rootDir: string; location: "core" | "plugins" }
  | { kind: "standalone"; targetDir: string };

/** IO seam so tests can inject fakes for fs/spawn/logging. */
export interface ScaffoldIo {
  /**
   * Render a template directory into a target directory. Defaults to the
   * real Handlebars-backed {@link copyTemplate}.
   */
  copyTemplate: typeof copyTemplate;
  /**
   * Refresh the monorepo's TypeScript project references. Only invoked in
   * `monorepo` mode. Returns the exit status (0 = success).
   */
  refreshReferences: () => number;
  log: (message: string) => void;
  warn: (message: string) => void;
}

export interface ScaffoldPluginOptions {
  mode: ScaffoldMode;
  /** e.g. "widget" — combined with the type to form "widget-backend". */
  baseName: string;
  description: string;
  pluginType: string;
  /**
   * npm scope (without `@`) for the generated package. Defaults to
   * `checkstack` (the monorepo scope, so the in-monorepo `create` path is
   * unchanged); pass `""` for an unscoped standalone package.
   */
  packageScope?: string;
  /**
   * Resolve a concrete version for an `@checkstack/*` `workspace:*` dep.
   * Required in `standalone` mode; ignored in `monorepo` mode (templates
   * keep their `workspace:*` ranges so the workspace resolves them).
   */
  resolveVersion?: VersionResolver;
  /** Override the IO seam (tests). Defaults to the real filesystem. */
  io?: Partial<ScaffoldIo>;
}

export interface ScaffoldPluginResult {
  /** The directory the package was written into. */
  targetDir: string;
  /** Absolute paths of every file written. */
  createdFiles: string[];
  templateData: TemplateData;
}

/** Default IO seam: real filesystem + a root references refresh via bun. */
function defaultIo(): ScaffoldIo {
  return {
    copyTemplate,
    refreshReferences: () => {
      const result = spawnSync(
        "bun",
        ["run", "typecheck:references:generate"],
        { stdio: "inherit" },
      );
      return result.status ?? 0;
    },
    log: (message) => {
      console.log(message);
    },
    warn: (message) => {
      console.warn(message);
    },
  };
}

/**
 * Resolve the on-disk target directory for a given mode + plugin name.
 *
 * `monorepo` mirrors the historical `create` layout
 * (`<rootDir>/<location>/<name>`); `standalone` writes `<targetDir>/<name>`.
 */
export function resolveTargetDir({
  mode,
  pluginName,
}: {
  mode: ScaffoldMode;
  pluginName: string;
}): string {
  return mode.kind === "monorepo"
    ? path.join(mode.rootDir, mode.location, pluginName)
    : path.join(mode.targetDir, pluginName);
}

/**
 * Read, rewrite, and write back the `workspace:*` ranges in a rendered
 * `package.json`. Throws (listing the offending names) if any
 * `workspace:` range cannot be resolved — never silently emits
 * `workspace:*`, which the runtime install-time validator rejects.
 */
async function rewriteRenderedPackageJson({
  targetDir,
  resolveVersion,
  io,
}: {
  targetDir: string;
  resolveVersion: VersionResolver;
  io: ScaffoldIo;
}): Promise<void> {
  const pkgJsonPath = path.join(targetDir, "package.json");
  if (!fs.existsSync(pkgJsonPath)) {
    io.warn(
      `No package.json found in ${targetDir}; skipped version rewriting.`,
    );
    return;
  }
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as Record<
    string,
    unknown
  >;
  const { rewritten, unresolved } = await rewriteWorkspaceVersions({
    pkg,
    resolveVersion,
  });
  if (unresolved.length > 0) {
    throw new Error(
      `Could not resolve concrete versions for ${unresolved.length} ` +
        `workspace dependenc${unresolved.length === 1 ? "y" : "ies"}: ` +
        `${unresolved.join(", ")}. ` +
        `A standalone scaffold must not emit 'workspace:*' ranges.`,
    );
  }
  if (rewritten) {
    fs.writeFileSync(pkgJsonPath, `${JSON.stringify(pkg, undefined, 2)}\n`);
    io.log(`Resolved workspace versions in ${path.basename(targetDir)}.`);
  }
}

/**
 * Render one plugin package type into the mode-appropriate target dir.
 *
 * Behaviour-preserving for the in-monorepo `create` command: same target
 * layout, same `copyTemplate`, same references refresh. Standalone mode
 * additionally rewrites `workspace:*` ranges to concrete versions.
 */
export async function scaffoldPlugin({
  mode,
  baseName,
  description,
  pluginType,
  packageScope = "checkstack",
  resolveVersion,
  io,
}: ScaffoldPluginOptions): Promise<ScaffoldPluginResult> {
  registerHelpers();

  const resolvedIo: ScaffoldIo = { ...defaultIo(), ...io };

  const templateData = prepareTemplateData({
    baseName,
    pluginType,
    description,
    packageScope,
  });

  const templateDir = path.join(TEMPLATES_DIR, pluginType);
  const targetDir = resolveTargetDir({
    mode,
    pluginName: templateData.pluginName,
  });

  const createdFiles = resolvedIo.copyTemplate({
    templateDir,
    targetDir,
    data: templateData,
  });

  if (mode.kind === "standalone") {
    if (!resolveVersion) {
      throw new Error(
        "scaffoldPlugin in standalone mode requires a `resolveVersion` " +
          "resolver to rewrite workspace ranges to concrete versions.",
      );
    }
    await rewriteRenderedPackageJson({
      targetDir,
      resolveVersion,
      io: resolvedIo,
    });
  }

  return { targetDir, createdFiles, templateData };
}

/**
 * Directory holding the standalone-only root workspace templates (root
 * `package.json`, tsconfig, eslint, README, `.gitignore`, changeset
 * config). Rendered only by {@link scaffoldStandaloneRoot}.
 */
export const STANDALONE_ROOT_TEMPLATE_DIR = path.join(
  TEMPLATES_DIR,
  "standalone-root",
);

export interface ScaffoldStandaloneRootResult {
  /** The repo root directory the workspace files were written into. */
  rootDir: string;
  createdFiles: string[];
  templateData: TemplateData;
}

/**
 * Render the standalone repo's root workspace files into `rootDir`.
 *
 * This is the wrapper around the per-type trio that turns three loose
 * packages into an installable local Bun workspace: a private root
 * `package.json` with `workspaces: ["packages/*"]` and forwarding scripts
 * (`dev`/`pack`/`typecheck`/`lint`/`test`), a root tsconfig, a
 * self-contained eslint config, a `.gitignore`, a quickstart README, and a
 * changeset config + initial changeset. Standalone-only: the in-monorepo
 * `create` command never calls this.
 */
export function scaffoldStandaloneRoot({
  rootDir,
  baseName,
  description,
  packageScope = "checkstack",
  io,
}: {
  rootDir: string;
  baseName: string;
  description: string;
  packageScope?: string;
  io?: Partial<ScaffoldIo>;
}): ScaffoldStandaloneRootResult {
  registerHelpers();
  const resolvedIo: ScaffoldIo = { ...defaultIo(), ...io };

  // The root files describe the workspace as a whole, not one plugin type;
  // we reuse prepareTemplateData with a sentinel "plugin" type so the
  // pascal/camel/id derivations are available to the root templates.
  const templateData = prepareTemplateData({
    baseName,
    pluginType: "plugin",
    description,
    packageScope,
  });

  const createdFiles = resolvedIo.copyTemplate({
    templateDir: STANDALONE_ROOT_TEMPLATE_DIR,
    targetDir: rootDir,
    data: templateData,
  });

  return { rootDir, createdFiles, templateData };
}

/**
 * Refresh the monorepo's TypeScript project references. No-op outside
 * `monorepo` mode (standalone repos do not use the root references graph).
 * Returns the exit status; non-zero means the refresh failed and the
 * caller should warn the user to run it manually.
 */
export function refreshMonorepoReferences({
  mode,
  io,
}: {
  mode: ScaffoldMode;
  io?: Partial<ScaffoldIo>;
}): number {
  if (mode.kind !== "monorepo") return 0;
  const resolvedIo: ScaffoldIo = { ...defaultIo(), ...io };
  return resolvedIo.refreshReferences();
}
