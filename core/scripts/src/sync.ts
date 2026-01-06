import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { Glob } from "bun";

function stripComments(text: string) {
  return text.replaceAll(/\/\/.*|\/\*[\s\S]*?\*\//g, "");
}

const rootDir = process.cwd();

// Standard scripts we want to share
const STANDARD_SCRIPTS: Record<string, string> = {
  typecheck: "tsc --noEmit",
  lint: "bun run lint:code",
  "lint:code": "eslint . --max-warnings 0",
};

const packageGlob = new Glob("{packages,plugins}/*/package.json");
const packages = [...packageGlob.scanSync({ cwd: rootDir })];

console.log(`Checking ${packages.length} packages for synchronization...`);

for (const pkgPath of packages) {
  const fullPkgPath = path.join(rootDir, pkgPath);
  const pkgDir = path.join(rootDir, pkgPath.replaceAll("/package.json", ""));
  const tsconfigPath = path.join(pkgDir, "tsconfig.json");

  const pkgContent = readFileSync(fullPkgPath, "utf8");
  let pkg;
  try {
    pkg = JSON.parse(pkgContent);
  } catch {
    console.error(`Failed to parse ${fullPkgPath}`);
    continue;
  }

  if (
    pkg.name === "@checkmate-monitor/scripts" ||
    pkg.name === "@checkmate-monitor/tsconfig"
  )
    continue;

  let pkgChanged = false;
  pkg.scripts = pkg.scripts || {};
  pkg.devDependencies = pkg.devDependencies || {};

  // Ensure @checkmate-monitor/scripts is present
  if (pkg.devDependencies["@checkmate-monitor/scripts"] !== "workspace:*") {
    console.log(
      `  [${pkg.name}] Adding @checkmate-monitor/scripts to devDependencies`
    );
    pkg.devDependencies["@checkmate-monitor/scripts"] = "workspace:*";
    pkgChanged = true;
  }

  // Update scripts
  for (const [name, script] of Object.entries(STANDARD_SCRIPTS)) {
    if (pkg.scripts[name] !== script) {
      console.log(`  [${pkg.name}] Updating script: ${name}`);
      pkg.scripts[name] = script;
      pkgChanged = true;
    }
  }

  if (pkgChanged) {
    writeFileSync(fullPkgPath, JSON.stringify(pkg, undefined, 2) + "\n");
  }

  // Manage tsconfig.json
  if (existsSync(tsconfigPath)) {
    const tsconfigContent = readFileSync(tsconfigPath, "utf8");
    let tsconfig;
    try {
      tsconfig = JSON.parse(stripComments(tsconfigContent));
    } catch {
      continue;
    }

    let tsconfigChanged = false;

    // Determine correct configType
    let configType = "backend.json";
    const isFrontend =
      pkgPath.includes("frontend") ||
      pkg.name.match(/frontend|ui|dashboard/) ||
      (pkg.dependencies &&
        (pkg.dependencies["react"] || pkg.dependencies["vite"]));
    const isCommon = pkgPath.includes("common") || pkg.name.includes("common");

    if (isFrontend) {
      configType = "frontend.json";
    } else if (isCommon) {
      configType = "common.json";
    }

    const expectedExtends = `@checkmate-monitor/tsconfig/${configType}`;
    if (tsconfig.extends !== expectedExtends) {
      console.log(
        `  [${pkg.name}] Updating tsconfig extends to ${expectedExtends}`
      );
      tsconfig.extends = expectedExtends;
      tsconfigChanged = true;
    }

    // Repair corrupted include path
    if (Array.isArray(tsconfig.include) && tsconfig.include.includes("src*")) {
      console.log(
        `  [${pkg.name}] Fixing corrupted include path in tsconfig.json`
      );
      tsconfig.include = tsconfig.include.map((i: string) =>
        i === "src*" ? "src" : i
      );
      tsconfigChanged = true;
    }

    if (tsconfigChanged) {
      writeFileSync(
        tsconfigPath,
        JSON.stringify(tsconfig, undefined, 2) + "\n"
      );
    }
  }
}

console.log("Synchronization complete!");
