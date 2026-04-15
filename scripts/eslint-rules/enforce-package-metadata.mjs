import fs from "node:fs";
import path from "node:path";

const validatedPackages = new Set();
const VALID_TYPES = ["backend", "frontend", "common", "tooling"];

const findPackageJson = (filePath) => {
  let currentDir = path.dirname(filePath);
  while (currentDir !== "/" && currentDir !== ".") {
    const pkgPath = path.join(currentDir, "package.json");
    if (fs.existsSync(pkgPath)) {
      return pkgPath;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }
  return;
};

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Enforce checkstack metadata (type) in package.json",
      category: "Architectural",
      recommended: true,
    },
    schema: [],
    messages: {
      missingMetadata: "Package missing 'checkstack' metadata block in package.json.",
      missingType: "Package missing 'checkstack.type' in package.json.",
      invalidType: "Invalid 'checkstack.type' value '{{type}}'. Valid values are: {{validTypes}}.",
      failedToRead: "Failed to read or parse package.json: {{error}}.",
    },
  },
  create(context) {
    return {
      Program() {
        const filePath = context.getFilename();
        
        // Skip files that are not in a package (e.g. root files)
        if (filePath.includes("node_modules") || filePath.includes(".git")) return;

        const pkgJsonPath = findPackageJson(filePath);
        if (!pkgJsonPath) return;

        // Only validate each package.json once per lint run to save performance
        if (validatedPackages.has(pkgJsonPath)) return;
        validatedPackages.add(pkgJsonPath);

        try {
          const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
          
          // Skip the root workspace package.json
          if (pkgJson.name === "checkstack-monorepo") return;

          if (!pkgJson.checkstack) {
            context.report({
              loc: { line: 1, column: 0 },
              messageId: "missingMetadata",
            });
            return;
          }

          const type = pkgJson.checkstack.type;
          if (!type) {
            context.report({
              loc: { line: 1, column: 0 },
              messageId: "missingType",
            });
            return;
          }

          if (!VALID_TYPES.includes(type)) {
            context.report({
              loc: { line: 1, column: 0 },
              messageId: "invalidType",
              data: {
                type,
                validTypes: VALID_TYPES.join(", "),
              },
            });
          }
        } catch (error) {
          context.report({
            loc: { line: 1, column: 0 },
            messageId: "failedToRead",
            data: { error: error.message },
          });
        }
      },
    };
  },
};
