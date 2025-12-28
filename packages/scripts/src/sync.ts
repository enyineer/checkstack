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

console.log(
  `Checking ${packages.length} packages for script synchronization...`
);

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

  if (pkg.name === "@checkmate/scripts" || pkg.name === "@checkmate/tsconfig")
    continue;

  let pkgChanged = false;
  pkg.scripts = pkg.scripts || {};
  pkg.devDependencies = pkg.devDependencies || {};

  // Ensure @checkmate/scripts is present
  if (pkg.devDependencies["@checkmate/scripts"] !== "workspace:*") {
    console.log(`  [${pkg.name}] Adding @checkmate/scripts to devDependencies`);
    pkg.devDependencies["@checkmate/scripts"] = "workspace:*";
    pkgChanged = true;
  }

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

  // Also fix tsconfig.json if it exists
  if (existsSync(tsconfigPath)) {
    const tsconfigContent = readFileSync(tsconfigPath, "utf8");
    let tsconfig;
    try {
      tsconfig = JSON.parse(stripComments(tsconfigContent));
    } catch {
      continue;
    }

    if (Array.isArray(tsconfig.include) && tsconfig.include.includes("src*")) {
      console.log(
        `  [${pkg.name}] Fixing corrupted include path in tsconfig.json`
      );
      tsconfig.include = tsconfig.include.map((i: string) =>
        i === "src*" ? "src" : i
      );
      writeFileSync(
        tsconfigPath,
        JSON.stringify(tsconfig, undefined, 2) + "\n"
      );
    }
  }
}

console.log("Synchronization complete!");
