#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import path from "node:path";

const command = process.argv[2];

if (!command) {
  console.log("Usage: checkmate-scripts <command>");
  console.log("\nCommands:");
  console.log("  create      - Create a new plugin interactively");
  console.log("  sync        - Synchronize package configurations");
  console.log("  typecheck   - Run TypeScript type checking");
  console.log("  lint        - Run linting checks");
  process.exit(1);
}

const rootDir = process.cwd();

if (command === "sync") {
  const result = spawnSync(
    "bun",
    ["run", path.join(rootDir, "packages/scripts/src/sync.ts")],
    {
      stdio: "inherit",
    }
  );
  process.exit(result.status ?? 0);
}

if (command === "create") {
  const result = spawnSync(
    "bun",
    ["run", path.join(rootDir, "packages/scripts/src/commands/create.ts")],
    {
      stdio: "inherit",
    }
  );
  process.exit(result.status ?? 0);
}

// Fallback for other scripts if we want to centralize their execution logic
console.error(`Unknown command: ${command}`);
process.exit(1);
