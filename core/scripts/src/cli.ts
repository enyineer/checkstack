#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import path from "node:path";

const command = process.argv[2];

if (!command) {
  console.log("Usage: checkstack-scripts <command>");
  console.log("\nCommands:");
  console.log("  create        - Create a new plugin interactively");
  console.log("  sync          - Synchronize package configurations");
  console.log("  generate      - Generate migrations and strip public schema");
  console.log("  plugin-pack   - Pack a plugin (or bundle) into a .tgz for distribution");
  console.log("  dev           - Run a local Checkstack dev server with the current directory's plugin loaded");
  console.log("  typecheck     - Run TypeScript type checking");
  console.log("  lint          - Run linting checks");
  process.exit(1);
}

const rootDir = process.cwd();

if (command === "sync") {
  const result = spawnSync(
    "bun",
    ["run", path.join(rootDir, "core/scripts/src/sync.ts")],
    {
      stdio: "inherit",
    }
  );
  process.exit(result.status ?? 0);
}

if (command === "create") {
  const result = spawnSync(
    "bun",
    ["run", path.join(rootDir, "core/scripts/src/commands/create.ts")],
    {
      stdio: "inherit",
    }
  );
  process.exit(result.status ?? 0);
}

if (command === "generate") {
  const result = spawnSync(
    "bun",
    [path.join(rootDir, "core/scripts/src/commands/generate.ts")],
    {
      cwd: rootDir, // Keep cwd as root, script will handle paths
      stdio: "inherit",
    }
  );
  process.exit(result.status ?? 0);
}

if (command === "plugin-pack") {
  // Dispatch to the plugin-pack module. We invoke it via `bun run` so it
  // works whether the user runs `bunx @checkstack/scripts plugin-pack`
  // (resolves to node_modules), `bun run cli plugin-pack`
  // (relative path from repo), or via the bin script.
  const scriptPath = path.resolve(
    new URL("commands/plugin-pack.ts", import.meta.url).pathname,
  );
  const result = spawnSync("bun", ["run", scriptPath, ...process.argv.slice(3)], {
    stdio: "inherit",
  });
  process.exit(result.status ?? 0);
}

if (command === "dev") {
  const scriptPath = path.resolve(
    new URL("commands/dev-server.ts", import.meta.url).pathname,
  );
  const result = spawnSync("bun", ["run", scriptPath, ...process.argv.slice(3)], {
    stdio: "inherit",
  });
  process.exit(result.status ?? 0);
}

// Fallback for other scripts if we want to centralize their execution logic
console.error(`Unknown command: ${command}`);
process.exit(1);
