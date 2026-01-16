/**
 * Custom ESLint rule: enforce-architecture-deps
 *
 * Enforces architecture dependency rules:
 * - Common packages → ONLY common packages
 * - Frontend packages → Frontend OR common packages
 * - Backend packages → Backend OR common packages
 *
 * This replaces the validate-dependencies.ts script with real-time linting.
 */

/**
 * Determine package type from its name
 * @param {string} packageName
 * @returns {"common" | "frontend" | "backend" | "core" | "unknown"}
 */
function getPackageType(packageName) {
  if (!packageName) return "unknown";

  if (packageName.endsWith("-common")) return "common";
  if (packageName.endsWith("-frontend")) return "frontend";
  if (packageName.endsWith("-frontend-plugin")) return "frontend";
  if (packageName.endsWith("-backend")) return "backend";
  if (packageName.endsWith("-backend-plugin")) return "backend";
  if (packageName.startsWith("@checkstack/common")) return "common";
  if (packageName.startsWith("@checkstack/frontend")) return "frontend";
  if (packageName.startsWith("@checkstack/backend")) return "backend";
  if (packageName.startsWith("@checkstack/ui")) return "frontend"; // UI is frontend
  if (packageName === "@checkstack/queue-api") return "backend"; // Queue API is backend

  // Core packages (can be used by everyone)
  if (packageName === "@checkstack/common") return "core";

  return "unknown";
}

/**
 * Check if an import is allowed for a given package type
 * @param {"common" | "frontend" | "backend" | "core" | "unknown"} sourceType
 * @param {string} importedPackage
 * @returns {boolean}
 */
function isImportAllowed(sourceType, importedPackage) {
  const depType = getPackageType(importedPackage);

  // Core packages can be used by everyone
  if (depType === "core") return true;

  // External packages (not @checkstack/*) are allowed
  if (!importedPackage.startsWith("@checkstack/")) return true;

  // Unknown dependencies are allowed (external packages)
  if (depType === "unknown") return true;

  // Check architecture rules
  switch (sourceType) {
    case "common": {
      // Common can only depend on other common packages
      // Exception: frontend-api is allowed for slot definition utilities (createSlot)
      if (importedPackage === "@checkstack/frontend-api") {
        return true;
      }
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
      // Unknown packages - allow everything
      return true;
    }

    default: {
      return true;
    }
  }
}

/**
 * Extract package name from file path
 * @param {string} filePath
 * @returns {string | undefined}
 */
function getPackageNameFromPath(filePath) {
  if (!filePath) return;

  // Match patterns like /core/auth-frontend/src/... or /plugins/my-plugin-backend/src/...
  const match = filePath.match(/[/\\](?:core|plugins)[/\\]([^/\\]+)[/\\]/);

  if (match) {
    return `@checkstack/${match[1]}`;
  }

  return;
}

/**
 * Extract package name from import source
 * @param {string} importSource
 * @returns {string}
 */
function getImportedPackage(importSource) {
  // For scoped packages like @checkstack/auth-frontend
  if (importSource.startsWith("@")) {
    const parts = importSource.split("/");
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}`;
    }
  }
  return importSource;
}

export const enforceArchitectureDeps = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Enforce architecture dependency rules: common→common, frontend→frontend/common, backend→backend/common",
      recommended: true,
    },
    messages: {
      invalidImport:
        'Architecture violation: {{sourceType}} packages cannot import from {{depType}} packages. "{{sourcePackage}}" cannot import "{{importedPackage}}".',
    },
    schema: [],
  },

  create(context) {
    const filePath = context.filename || context.getFilename();
    const sourcePackage = getPackageNameFromPath(filePath);

    // Skip if we can't determine the source package
    if (!sourcePackage) return {};

    const sourceType = getPackageType(sourcePackage);

    // Skip if source type is unknown
    if (sourceType === "unknown") return {};

    return {
      ImportDeclaration(node) {
        const importSource = node.source.value;
        const importedPackage = getImportedPackage(importSource);

        if (!isImportAllowed(sourceType, importedPackage)) {
          const depType = getPackageType(importedPackage);
          context.report({
            node,
            messageId: "invalidImport",
            data: {
              sourcePackage,
              sourceType,
              importedPackage,
              depType,
            },
          });
        }
      },

      // Also check dynamic imports
      CallExpression(node) {
        if (
          node.callee.type === "Import" ||
          (node.callee.type === "Identifier" && node.callee.name === "require")
        ) {
          const arg = node.arguments[0];
          if (arg?.type === "Literal" && typeof arg.value === "string") {
            const importSource = arg.value;
            const importedPackage = getImportedPackage(importSource);

            if (!isImportAllowed(sourceType, importedPackage)) {
              const depType = getPackageType(importedPackage);
              context.report({
                node,
                messageId: "invalidImport",
                data: {
                  sourcePackage,
                  sourceType,
                  importedPackage,
                  depType,
                },
              });
            }
          }
        }
      },
    };
  },
};
