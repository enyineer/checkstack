#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import path from "node:path";

const command = process.argv[2];

if (!command) {
  console.log("Usage: checkmate-scripts <command>");
  console.log("Commands: sync, typecheck, lint");
  process.exit(1);
}

const rootDir = process.cwd();

if (command === "sync") {
  const result = spawnSync("bun", ["run", path.join(rootDir, "src/sync.ts")], {
    stdio: "inherit",
  });
  process.exit(result.status ?? 0);
}

// Fallback for other scripts if we want to centralize their execution logic
console.error(`Unknown command: ${command}`);
process.exit(1);
