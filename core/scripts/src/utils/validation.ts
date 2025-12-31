import { existsSync } from "node:fs";
import path from "node:path";

const RESERVED_NAMES = new Set(["checkmate", "core", "api", "common"]);

/**
 * Validate plugin name follows naming conventions
 */
export function validatePluginName(name: string): {
  valid: boolean;
  error?: string;
} {
  // Must not be empty
  if (!name || name.trim().length === 0) {
    return { valid: false, error: "Plugin name cannot be empty" };
  }

  // Must be lowercase
  if (name !== name.toLowerCase()) {
    return {
      valid: false,
      error: "Plugin name must be lowercase (use hyphens for word separation)",
    };
  }

  // Can only contain lowercase letters, numbers, and hyphens
  if (!/^[\da-z-]+$/.test(name)) {
    return {
      valid: false,
      error:
        "Plugin name can only contain lowercase letters, numbers, and hyphens",
    };
  }

  // Cannot start or end with hyphen
  if (name.startsWith("-") || name.endsWith("-")) {
    return {
      valid: false,
      error: "Plugin name cannot start or end with a hyphen",
    };
  }

  // Cannot have consecutive hyphens
  if (name.includes("--")) {
    return {
      valid: false,
      error: "Plugin name cannot contain consecutive hyphens",
    };
  }

  // Check reserved names
  if (RESERVED_NAMES.has(name)) {
    return {
      valid: false,
      error: `'${name}' is a reserved name and cannot be used`,
    };
  }

  return { valid: true };
}

/**
 * Check if a plugin already exists
 */
export function pluginExists({
  baseName,
  pluginType,
  rootDir,
}: {
  baseName: string;
  pluginType: string;
  rootDir: string;
}): boolean {
  const pluginName = `${baseName}-${pluginType}`;
  const pluginPath = path.join(rootDir, "plugins", pluginName);
  return existsSync(pluginPath);
}

/**
 * Check if a package already exists in core/
 */
export function packageExists({
  baseName,
  pluginType,
  rootDir,
}: {
  baseName: string;
  pluginType: string;
  rootDir: string;
}): boolean {
  const packageName = `${baseName}-${pluginType}`;
  const packagePath = path.join(rootDir, "core", packageName);
  return existsSync(packagePath);
}

/**
 * Extract base name from full plugin name if provided
 * e.g., "catalog-backend" -> "catalog"
 */
export function extractBaseName(fullName: string): string {
  const parts = fullName.split("-");
  if (parts.length > 1) {
    const lastPart = parts.at(-1);
    const knownTypes = ["backend", "frontend", "common", "node", "react"];
    if (lastPart && knownTypes.includes(lastPart)) {
      return parts.slice(0, -1).join("-");
    }
  }
  return fullName;
}
