/**
 * Security Audit Orchestrator
 * This script runs Trivy security scans and generates reports in multiple formats:
 * 1. Terminal Table (for immediate feedback)
 * 2. JSON (for machine readability)
 * 3. HTML (for detailed browser-based investigation)
 */

import { $ } from "bun";
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";

const mode = process.argv[2] as "fs" | "image";
const target = mode === "image" ? "checkstack-prod:latest" : "/root";

if (!mode || (mode !== "fs" && mode !== "image")) {
  console.error("❌ Usage: bun run scripts/audit-trivy.ts <fs|image>");
  throw new Error("Invalid usage");
}

const reportsDir = path.join(process.cwd(), "reports");
if (!existsSync(reportsDir)) {
  mkdirSync(reportsDir);
}

const TRIVY_IMAGE = "ghcr.io/aquasecurity/trivy:latest";
const commonFlags = ["--ignore-unfixed", "--severity", "CRITICAL"];

async function runAudit() {
  console.log(`🔎 Starting Security Audit (${mode})...`);

  try {
    // 1. Terminal Table
    console.log("\n📊 Generating Terminal Report...");
    const tableCmd = [
      "docker", "run", "--rm",
      "-v", `${process.cwd()}:/root`,
      "-v", "/var/run/docker.sock:/var/run/docker.sock",
      "-v", `${process.env.HOME}/Library/Caches:/root/.cache/`,
      TRIVY_IMAGE,
      mode,
      "--format", "table",
      "--exit-code", "1",
      ...commonFlags,
      target
    ];
    
    // We expect the table command to fail if vulnerabilities are found (exit code 1)
    const tableResult = await $`${tableCmd}`.quiet().nothrow();

    // 2. JSON Report
    console.log("📄 Generating JSON Report...");
    await $`docker run --rm \
      -v ${process.cwd()}:/root \
      -v /var/run/docker.sock:/var/run/docker.sock \
      -v ${process.env.HOME}/Library/Caches:/root/.cache/ \
      ${TRIVY_IMAGE} \
      ${mode} \
      --format json \
      -o /root/reports/${mode}-audit.json \
      ${commonFlags} \
      ${target}`.quiet();

    // 3. HTML Report
    console.log("🌐 Generating HTML Report...");
    await $`docker run --rm \
      -v ${process.cwd()}:/root \
      -v /var/run/docker.sock:/var/run/docker.sock \
      -v ${process.env.HOME}/Library/Caches:/root/.cache/ \
      ${TRIVY_IMAGE} \
      ${mode} \
      --format template \
      --template "@contrib/html.tpl" \
      -o /root/reports/${mode}-audit.html \
      ${commonFlags} \
      ${target}`.quiet();

    console.log(`\n✅ Audit Complete! Reports generated in ./reports/${mode}-audit.*`);
    
    // If table scan failed (vulnerabilities found), exit with non-zero to fail CI/scripts
    if (tableResult.exitCode !== 0) {
      console.error(`\n❌ CRITICAL vulnerabilities found. See ./reports/${mode}-audit.html for details.`);
      throw new Error("Security audit failed");
    }

  } catch (error) {
    console.error("❌ Audit failed to execute:", error);
    throw error;
  }
}

await runAudit();
