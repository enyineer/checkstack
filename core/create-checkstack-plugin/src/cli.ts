#!/usr/bin/env bun
import path from "node:path";
import fs from "node:fs";
import inquirer from "inquirer";
import {
  parseCliArgs,
  validateBaseName,
  validateScope,
  type CliArgs,
} from "./cli-args";
import {
  scaffoldStandaloneWorkspace,
  localSiblingNames,
} from "./scaffold-standalone";
import { createNpmViewResolver } from "./npm-view-resolver";
import { initGitRepo } from "./git";

/**
 * `create-checkstack-plugin` — a thin standalone bootstrapper.
 *
 * Resolves a target dir + base name + scope (via flags or interactive
 * prompts), resolves concrete published `@checkstack/*` versions from the
 * registry's `latest` dist-tag, renders the standalone trio workspace via
 * the `@checkstack/scripts` engine, then `git init`s the result. All the
 * heavy lifting lives in `@checkstack/scripts`; this package only adds the
 * prompts, version resolution, and git wiring so `bun create
 * checkstack-plugin` / `bunx create-checkstack-plugin` work ergonomically.
 */

interface Answers {
  baseName: string;
  scope: string;
  targetDir: string;
}

async function gatherAnswers(args: CliArgs): Promise<Answers> {
  if (args.yes) {
    const baseName = args.targetDir
      ? path.basename(path.resolve(args.targetDir))
      : "widget";
    const baseCheck = validateBaseName(baseName);
    if (!baseCheck.valid) {
      throw new Error(`Invalid plugin name '${baseName}': ${baseCheck.error}`);
    }
    return {
      baseName,
      scope: args.scope ?? "",
      targetDir: path.resolve(args.targetDir ?? baseName),
    };
  }

  const { baseName } = await inquirer.prompt<{ baseName: string }>([
    {
      type: "input",
      name: "baseName",
      message: "Plugin base name (e.g. 'widget' for 'widget-backend'):",
      default: args.targetDir
        ? path.basename(path.resolve(args.targetDir))
        : undefined,
      validate: (input: string) => {
        const check = validateBaseName(input.trim());
        return check.valid || check.error || false;
      },
      filter: (input: string) => input.trim(),
    },
  ]);

  let scope = args.scope;
  if (scope === undefined) {
    const { scopeInput } = await inquirer.prompt<{ scopeInput: string }>([
      {
        type: "input",
        name: "scopeInput",
        message:
          "npm scope without '@' (leave blank to publish unscoped):",
        default: "",
        validate: (input: string) => {
          const check = validateScope(input.trim());
          return check.valid || check.error || false;
        },
        filter: (input: string) => input.trim(),
      },
    ]);
    scope = scopeInput;
  }

  const targetDir = path.resolve(args.targetDir ?? baseName);
  return { baseName, scope, targetDir };
}

export async function run({
  argv,
  env,
}: {
  argv: string[];
  env: Record<string, string | undefined>;
}): Promise<number> {
  const args = parseCliArgs({ argv, env });
  if (args.help) {
    printHelp();
    return 0;
  }

  const { baseName, scope, targetDir } = await gatherAnswers(args);

  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    console.error(`Target directory '${targetDir}' already exists and is not empty.`);
    return 1;
  }

  const description = `${baseName.charAt(0).toUpperCase()}${baseName.slice(1)} plugin`;

  const resolveVersion = createNpmViewResolver({
    registry: args.registry,
    versionTag: args.versionTag,
    localSiblings: localSiblingNames({ baseName, packageScope: scope }),
  });

  console.log(`\nScaffolding ${baseName} plugin in ${targetDir} ...`);

  await scaffoldStandaloneWorkspace({
    rootDir: targetDir,
    baseName,
    description,
    packageScope: scope,
    resolveVersion,
  });

  console.log("Wrote the workspace root and the common/backend/frontend trio.");

  if (args.git) {
    initGitRepo({ dir: targetDir });
  }

  printNextSteps({ targetDir, baseName });
  return 0;
}

function printNextSteps({
  targetDir,
  baseName,
}: {
  targetDir: string;
  baseName: string;
}): void {
  const rel = path.relative(process.cwd(), targetDir) || ".";
  console.log("\nDone. Next steps:");
  console.log(`  1. cd ${rel}`);
  console.log("  2. Start Postgres (see README.md)");
  console.log("  3. bun install");
  console.log("  4. bun run dev");
  console.log(`  5. POST http://localhost:3000/api/${baseName}/getItems\n`);
}

function printHelp(): void {
  console.log(`Usage: create-checkstack-plugin [target-dir] [options]

Scaffold a standalone Checkstack plugin workspace (common + backend +
frontend) with concrete published @checkstack/* versions, ready to
\`bun install && bun run dev\`.

Options:
  --scope <name>        npm scope without '@' (e.g. acme). Prompted if omitted.
  --no-scope            Publish the trio unscoped (widget-backend, ...).
  --version-tag <tag>   dist-tag to resolve versions from (default: latest).
  --registry <url>      Registry for version resolution
                        (env: CHECKSTACK_SCAFFOLD_REGISTRY).
  --no-git              Do not run \`git init\`.
  --yes, -y             Accept defaults without prompting.
  --help, -h            Show this message.
`);
}

if (import.meta.main) {
  const code = await run({ argv: process.argv.slice(2), env: process.env });
  process.exit(code);
}
