/**
 * Argument parsing for the `create-checkstack-plugin` CLI.
 *
 * Kept pure (no IO) so it can be unit-tested. Supports:
 *   - a positional target directory (the repo to create);
 *   - `--scope <name>` / `--no-scope` to control the npm scope;
 *   - `--version-tag <tag>` (default `latest`) for the dist-tag to resolve;
 *   - `--registry <url>` (env fallback `CHECKSTACK_SCAFFOLD_REGISTRY`);
 *   - `--no-git` to skip `git init`;
 *   - `--yes` to accept defaults non-interactively (used by the e2e test).
 */

export interface CliArgs {
  /** Positional target directory, if given. */
  targetDir?: string;
  /** Explicit scope (without `@`), or "" if `--no-scope`, or undefined. */
  scope?: string;
  versionTag: string;
  registry?: string;
  git: boolean;
  /** Skip prompts and use defaults / provided flags. */
  yes: boolean;
  help: boolean;
}

export function parseCliArgs({
  argv,
  env = {},
}: {
  argv: string[];
  env?: Record<string, string | undefined>;
}): CliArgs {
  const args: CliArgs = {
    versionTag: "latest",
    registry: env.CHECKSTACK_SCAFFOLD_REGISTRY,
    git: true,
    yes: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--scope": {
        args.scope = argv[++i];
        break;
      }
      case "--no-scope": {
        args.scope = "";
        break;
      }
      case "--version-tag": {
        args.versionTag = argv[++i];
        break;
      }
      case "--registry": {
        args.registry = argv[++i];
        break;
      }
      case "--no-git": {
        args.git = false;
        break;
      }
      case "--yes":
      case "-y": {
        args.yes = true;
        break;
      }
      case "--help":
      case "-h": {
        args.help = true;
        break;
      }
      default: {
        if (!a.startsWith("-") && args.targetDir === undefined) {
          args.targetDir = a;
        }
        break;
      }
    }
  }

  return args;
}

/**
 * Validate a base plugin name (lowercase, hyphen-separated, no reserved
 * words). Mirrors the monorepo `validatePluginName` rules.
 */
export function validateBaseName(name: string): {
  valid: boolean;
  error?: string;
} {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: "Plugin name cannot be empty" };
  }
  if (name !== name.toLowerCase()) {
    return { valid: false, error: "Plugin name must be lowercase" };
  }
  if (!/^[\da-z-]+$/.test(name)) {
    return {
      valid: false,
      error: "Plugin name can only contain lowercase letters, numbers, and hyphens",
    };
  }
  if (name.startsWith("-") || name.endsWith("-")) {
    return { valid: false, error: "Plugin name cannot start or end with a hyphen" };
  }
  if (name.includes("--")) {
    return { valid: false, error: "Plugin name cannot contain consecutive hyphens" };
  }
  if (new Set(["checkstack", "core", "api", "common"]).has(name)) {
    return { valid: false, error: `'${name}' is a reserved name` };
  }
  return { valid: true };
}

/** Validate an npm scope (without the leading `@`). Empty is allowed (unscoped). */
export function validateScope(scope: string): { valid: boolean; error?: string } {
  if (scope === "") return { valid: true };
  if (!/^[a-z\d][a-z\d._-]*$/.test(scope)) {
    return {
      valid: false,
      error:
        "Scope must start with a lowercase letter or digit and contain only " +
        "lowercase letters, digits, '.', '_', or '-' (no leading '@').",
    };
  }
  return { valid: true };
}
