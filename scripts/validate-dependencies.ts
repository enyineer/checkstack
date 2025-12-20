#!/usr/bin/env bun
/**
 * Validates that package dependencies follow the architecture rules:
 * - Common plugins → ONLY common packages
 * - Frontend plugins → Frontend OR common packages
 * - Backend plugins → Backend OR common packages
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

type PackageType = "common" | "frontend" | "backend" | "core" | "unknown";

interface ValidationError {
  package: string;
  dependency: string;
  reason: string;
}

/**
 * Determine package type from its name
 */
function getPackageType(packageName: string): PackageType {
  if (packageName.endsWith("-common")) return "common";
  if (packageName.endsWith("-frontend")) return "frontend";
  if (packageName.endsWith("-frontend-plugin")) return "frontend";
  if (packageName.endsWith("-backend")) return "backend";
  if (packageName.endsWith("-backend-plugin")) return "backend";
  if (packageName.startsWith("@checkmate/common")) return "common";
  if (packageName.startsWith("@checkmate/frontend")) return "frontend";
  if (packageName.startsWith("@checkmate/backend")) return "backend";
  if (packageName.startsWith("@checkmate/ui")) return "frontend"; // UI is frontend

  // Core packages (can be used by everyone)
  if (packageName === "@checkmate/common") return "core";

  return "unknown";
}

/**
 * Check if a dependency is allowed for a given package type
 */
function isDependencyAllowed(
  packageType: PackageType,
  dependencyName: string
): boolean {
  const depType = getPackageType(dependencyName);

  // Core packages can be used by everyone
  if (depType === "core") return true;

  // External packages (not @checkmate/*) are allowed
  if (!dependencyName.startsWith("@checkmate/")) return true;

  // Check architecture rules
  switch (packageType) {
    case "common": {
      // Common can only depend on other common packages
      return depType === "common";
    }

    case "frontend": {
      // Frontend can depend on frontend or common
      return depType === "frontend" || depType === "common";
    }

    case "backend": {
      // Backend can depend on backend or common
      return depType === "backend" || depType === "common";
    }

    case "core": {
      // Core packages should have minimal dependencies
      return depType === "common";
    }

    case "unknown": {
      // Unknown packages - allow everything (external packages)
      return true;
    }

    default: {
      return false;
    }
  }
}

/**
 * Validate a single package
 */
function validatePackage(packagePath: string): ValidationError[] {
  const packageJsonPath = path.join(packagePath, "package.json");

  if (!existsSync(packageJsonPath)) {
    return [];
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const packageName = packageJson.name;
  const packageType = getPackageType(packageName);

  if (packageType === "unknown") {
    // Skip validation for unknown package types
    return [];
  }

  const errors: ValidationError[] = [];
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.peerDependencies,
  };

  for (const [depName] of Object.entries(dependencies)) {
    if (!isDependencyAllowed(packageType, depName)) {
      const depType = getPackageType(depName);
      errors.push({
        package: packageName,
        dependency: depName,
        reason: `${packageType} packages cannot depend on ${depType} packages`,
      });
    }
  }

  return errors;
}

/**
 * Main validation function
 */
function validateDependencies(): void {
  const rootDir = process.cwd();
  const errors: ValidationError[] = [];

  // Check packages/* directory
  const packagesDir = path.join(rootDir, "packages");
  if (existsSync(packagesDir)) {
    const packages = readdirSync(packagesDir, { withFileTypes: true });
    for (const pkg of packages) {
      if (pkg.isDirectory()) {
        const pkgErrors = validatePackage(path.join(packagesDir, pkg.name));
        errors.push(...pkgErrors);
      }
    }
  }

  // Check plugins/* directory
  const pluginsDir = path.join(rootDir, "plugins");
  if (existsSync(pluginsDir)) {
    const plugins = readdirSync(pluginsDir, { withFileTypes: true });
    for (const plugin of plugins) {
      if (plugin.isDirectory()) {
        const pluginErrors = validatePackage(
          path.join(pluginsDir, plugin.name)
        );
        errors.push(...pluginErrors);
      }
    }
  }

  // Report errors
  if (errors.length > 0) {
    console.error("\n❌ Dependency Architecture Violations Found:\n");
    for (const error of errors) {
      console.error(
        `  ${error.package}\n    → depends on ${error.dependency}\n    → ${error.reason}\n`
      );
    }
    console.error(
      `\n📋 Architecture Rules:\n  • Common plugins → ONLY common packages\n  • Frontend plugins → Frontend OR common packages\n  • Backend plugins → Backend OR common packages\n`
    );
    process.exit(1);
  }

  console.log("✅ All package dependencies follow architecture rules");
}

// Run validation
validateDependencies();
