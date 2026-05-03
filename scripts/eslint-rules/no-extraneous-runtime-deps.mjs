import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Custom ESLint rule: no-extraneous-runtime-deps
 * 
 * Ensures that all runtime imports are present in the 'dependencies' or 'peerDependencies' 
 * section of the package.json, and not in 'devDependencies'.
 */

// Cache for package.json contents to avoid redundant disk reads.
// Keyed by absolute path; entries hold the parsed data plus the mtime they
// were read at, so we invalidate after `bun install` rewrites package.json
// without requiring an ESLint server restart in the IDE.
const packageJsonCache = new Map();

/**
 * Find the closest package.json for a file
 * @param {string} filePath 
 * @returns {string | undefined}
 */
function findPackageJson(filePath) {
  let currentDir = path.dirname(filePath);
  while (currentDir !== path.dirname(currentDir)) {
    const pkgJsonPath = path.join(currentDir, "package.json");
    if (existsSync(pkgJsonPath)) {
      return pkgJsonPath;
    }
    currentDir = path.dirname(currentDir);
  }
  return;
}

/**
 * Get the package name from an import source
 * @param {string} importSource 
 * @returns {string | undefined}
 */
function getPackageName(importSource) {
  if (!importSource || importSource.startsWith(".") || importSource.startsWith("/")) {
    return;
  }

  const parts = importSource.split("/");
  if (importSource.startsWith("@")) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
  }
  return parts[0];
}

const TEST_REGEX = /[./-](test|spec|e2e|test-utils|test-preload)\.[tj]sx?$/;
const UTILITY_PKG_REGEX = /-(test-utils|scripts)$/;

export const noExtraneousRuntimeDeps = {
  meta: {
    type: "problem",
    docs: {
      description: "Ensure runtime imports are listed in dependencies and not devDependencies",
      recommended: true,
    },
    messages: {
      extraneousDep: "Module '{{packageName}}' is a runtime dependency but is listed in devDependencies. Move it to dependencies.",
      missingDep: "Module '{{packageName}}' is a runtime dependency but is missing from package.json dependencies.",
      missingTypeDep: "Module '{{packageName}}' is imported for types but is missing from package.json dependencies/peerDependencies/devDependencies. Add it so TypeScript can resolve it on a clean install.",
    },
    schema: [],
  },

  create(context) {
    const filePath = context.filename || context.getFilename();
    
    // Only check runtime files (e.g., in src/ folders, excluding tests and special preloads)
    const isRuntimeFile = filePath.includes("/src/") && 
                         !filePath.includes("/test/") && 
                         !TEST_REGEX.test(filePath);

    if (!isRuntimeFile) {
      return {};
    }

    const pkgJsonPath = findPackageJson(filePath);
    if (!pkgJsonPath) {
      return {};
    }

    let mtimeMs;
    try {
      mtimeMs = statSync(pkgJsonPath).mtimeMs;
    } catch {
      return {};
    }

    const cached = packageJsonCache.get(pkgJsonPath);
    let pkgData = cached && cached.mtimeMs === mtimeMs ? cached.data : undefined;
    if (!pkgData) {
      try {
        const content = readFileSync(pkgJsonPath, "utf8");
        pkgData = JSON.parse(content);
        packageJsonCache.set(pkgJsonPath, { data: pkgData, mtimeMs });
      } catch {
        return {};
      }
    }

    // Skip rigid validation for "Utility" packages (test-utils, scripts)
    if (pkgData.name && UTILITY_PKG_REGEX.test(pkgData.name)) {
      return {};
    }

    const dependencies = pkgData.dependencies || {};
    const peerDependencies = pkgData.peerDependencies || {};
    const devDependencies = pkgData.devDependencies || {};

    /**
     * @param {import('eslint').Rule.Node} node
     * @param {string} packageName
     * @param {{ typeOnly?: boolean }} [options]
     */
    const validatePackage = (node, packageName, options = {}) => {
      // Ignore type-only packages and @types/*
      if (packageName.startsWith("@types/") || packageName.startsWith("node:")) {
        return;
      }
      // Vite/Webpack-style virtual modules (e.g.
      // `virtual:checkstack-dev-plugin`) are resolved by the bundler's
      // `resolve.alias` at runtime, never installed from npm. They have
      // no business in package.json.
      if (packageName.startsWith("virtual:")) {
        return;
      }

      // Built-ins shared across environments (Node + Bun)
      const builtins = [
        "fs", "path", "os", "crypto", "http", "https", "child_process", "util", "events", "stream",
        "bun", "bun:test", "@playwright/test" // Bun and Test built-ins
      ];

      if (builtins.includes(packageName)) {
        return;
      }

      const { typeOnly = false } = options;

      if (typeOnly) {
        // Type-only imports must still be resolvable by tsc. Allow any of
        // dependencies / peerDependencies / devDependencies, but flag if missing entirely.
        if (
          !dependencies[packageName] &&
          !peerDependencies[packageName] &&
          !devDependencies[packageName]
        ) {
          context.report({
            node,
            messageId: "missingTypeDep",
            data: { packageName },
          });
        }
        return;
      }

      if (devDependencies[packageName]) {
        context.report({
          node,
          messageId: "extraneousDep",
          data: { packageName },
        });
      } else if (!dependencies[packageName] && !peerDependencies[packageName]) {
        context.report({
          node,
          messageId: "missingDep",
          data: { packageName },
        });
      }
    };

    return {
      ImportDeclaration(node) {
        const importSource = node.source.value;
        const packageName = getPackageName(importSource);

        if (!packageName) return;

        const isTypeOnlyImport =
          node.importKind === "type" ||
          (node.specifiers.length > 0 &&
            node.specifiers.every(s => s.importKind === "type"));

        validatePackage(node, packageName, { typeOnly: isTypeOnlyImport });
      },
      
      CallExpression(node) {
        if (node.callee.type === "Import" || (node.callee.type === "Identifier" && node.callee.name === "require")) {
          const arg = node.arguments[0];
          if (arg?.type === "Literal" && typeof arg.value === "string") {
            const packageName = getPackageName(arg.value);
            if (packageName) {
              validatePackage(node, packageName);
            }
          }
        }
      }
    };
  },
};
