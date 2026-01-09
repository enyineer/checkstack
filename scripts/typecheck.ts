#!/usr/bin/env bun
/**
 * Custom typecheck script that runs TypeScript checks on all packages
 * and filters output to only show errors, making it easier to read.
 */

import { $ } from "bun";

console.log("Running typecheck across all packages...\n");

// Run the typecheck command and capture stdout/stderr
const result = await $`bun run --filter '*' typecheck 2>&1`.nothrow().quiet();

const output = result.stdout.toString();
const lines = output.split("\n");

// Filter to only show lines containing TypeScript errors
// TypeScript errors look like: "src/file.ts(10,5): error TS2345: ..."
// or: "error TS6059: ..." (for config errors)
const errorLines = lines.filter((line) => {
  // Show lines containing TypeScript error codes
  if (line.includes("error TS")) return true;
  // Show lines with file paths followed by error (common tsc output format)
  if (/\(\d+,\d+\):\s*error/.test(line)) return true;
  // Show lines that indicate a failed package (for context)
  if (line.includes("│") && line.includes("error")) return true;
  return false;
});

if (errorLines.length > 0) {
  console.log("TypeScript errors found:\n");
  console.log(errorLines.join("\n\n"));
  console.log(`\n\n${errorLines.length} error(s) found.`);
  process.exit(1);
}

// Check exit code - if there were errors but we didn't catch them
if (result.exitCode !== 0) {
  console.log("Typecheck failed with exit code:", result.exitCode);
  console.log("\nFull output for debugging:");
  console.log(`\n\n${output}`);
  process.exit(result.exitCode);
}

console.log("✓ No TypeScript errors found.");
process.exit(0);
